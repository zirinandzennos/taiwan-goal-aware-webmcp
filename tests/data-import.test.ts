import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTimetableDatabase } from "../scripts/import/build-timetable-db";
import { acquireRequestedDailyTimetables, assessSupplyDates, authorizationHeader, dailyTimetableUrl, REQUESTED_DATES, resolveAuthorizationHeader, supplyDateUrl, TOKEN_ENDPOINT } from "../scripts/import/fetch-tdx-thsr";
import { normalizeTdxThsrRecords } from "../scripts/import/normalize-tdx-thsr";
import type { TdxDailyTimetableRecord } from "../scripts/import/types";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function record(overrides: Partial<TdxDailyTimetableRecord> = {}): TdxDailyTimetableRecord {
  return {
    TrainDate: "2026-08-27",
    DailyTrainInfo: { TrainNo: "0126" },
    StopTimes: [
      { StopSequence: 1, StationID: "1070", StationName: { En: "Zuoying" }, ArrivalTime: "17:35:00", DepartureTime: "17:35:00" },
      { StopSequence: 2, StationID: "1030", StationName: { En: "Taoyuan" }, ArrivalTime: "19:14:00", DepartureTime: "19:16:00" },
    ],
    ...overrides,
  };
}

describe("TDX THSR snapshot pipeline", () => {
  it("requires credentials and never silently falls back", () => {
    expect(() => authorizationHeader({})).toThrow("TDX credentials missing");
    expect(authorizationHeader({ TDX_API_KEY: "secret" })).toBe("Bearer secret");
    expect(dailyTimetableUrl("2026-08-27")).toContain("2026-08-27");
    expect(dailyTimetableUrl("2026-08-27")).toContain("%24top=1000");
    expect(supplyDateUrl()).toContain("/DailyTimetable/TrainDates");
  });

  it("obtains one bearer token from local client credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ access_token: "redacted-token", token_type: "Bearer", expires_in: 86400 }), { status: 200 }));
    await expect(resolveAuthorizationHeader({ TDX_CLIENT_ID: "client-id", TDX_CLIENT_SECRET: "client-secret" }, fetchMock)).resolves.toBe("Bearer redacted-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(TOKEN_ENDPOINT);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
  });

  it("checks the official supply-date list before fetching any daily payload", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      StartDate: "2026-08-28",
      EndDate: "2026-09-02",
      TrainDates: REQUESTED_DATES.slice(1),
      UpdateTime: "2026-08-30T04:00:00+08:00",
    }), { status: 200 }));
    const result = await acquireRequestedDailyTimetables("Bearer redacted", fetchMock);
    expect(result.assessment.availableDates).toEqual(REQUESTED_DATES.slice(1));
    expect(result.assessment.missingDates).toEqual(["2026-08-27"]);
    expect(result.records).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(supplyDateUrl());
  });

  it("fetches all seven dated payloads only after all dates are supplied", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === supplyDateUrl()) return new Response(JSON.stringify({ StartDate: REQUESTED_DATES[0], EndDate: REQUESTED_DATES[6], TrainDates: [...REQUESTED_DATES], UpdateTime: "2026-08-30T04:00:00+08:00" }), { status: 200 });
      const date = REQUESTED_DATES.find((candidate) => url.includes(candidate));
      return new Response(JSON.stringify(date ? [record({ TrainDate: date, DailyTrainInfo: { TrainNo: date.slice(-2) } })] : []), { status: 200 });
    });
    const result = await acquireRequestedDailyTimetables("Bearer redacted", fetchMock);
    expect(result.assessment.missingDates).toEqual([]);
    expect(result.records.map((item) => item.TrainDate).sort()).toEqual([...REQUESTED_DATES]);
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("validates the supply-date response shape", () => {
    expect(() => assessSupplyDates({ TrainDates: REQUESTED_DATES })).toThrow("missing required TrainDateList fields");
  });

  it("normalizes dated service instances with explicit Taipei offsets", () => {
    const snapshot = normalizeTdxThsrRecords([record()], { snapshotId: "snapshot-test", retrievedAt: "2026-08-30T00:00:00Z" });
    expect(snapshot.serviceRuns[0]).toMatchObject({ id: "THSR_0126_20260827", serviceDate: "2026-08-27", sourceSnapshotId: "snapshot-test" });
    expect(snapshot.stopTimes.map((stop) => stop.departureAt)).toEqual(["2026-08-27T17:35:00+08:00", "2026-08-27T19:16:00+08:00"]);
    expect(snapshot.nodes).toHaveLength(2);
  });

  it("rejects dates outside the snapshot, duplicate runs, and invalid rows", () => {
    const metadata = { snapshotId: "snapshot-test", retrievedAt: "2026-08-30T00:00:00Z" };
    expect(() => normalizeTdxThsrRecords([record({ TrainDate: "2026-09-03" })], metadata)).toThrow("outside fixed snapshot period");
    expect(() => normalizeTdxThsrRecords([record(), record()], metadata)).toThrow("Duplicate service run");
    expect(() => normalizeTdxThsrRecords([record({ StopTimes: [{ ...record().StopTimes[0], ArrivalTime: "bad" }, record().StopTimes[1]] })], metadata)).toThrow("Invalid provider time");
    expect(() => normalizeTdxThsrRecords([record({ StopTimes: [record().StopTimes[1], record().StopTimes[0]] })], metadata)).toThrow("Unordered stop sequence");
    expect(() => normalizeTdxThsrRecords([record({ StopTimes: [{ ...record().StopTimes[0], ArrivalTime: null }, record().StopTimes[1]] })], metadata)).toThrow("Invalid provider time");
  });

  it("materializes an explicitly marked cross-midnight run without losing the Taipei offset", () => {
    const overnight = record({
      DailyTrainInfo: { TrainNo: "0999", Overnight: true },
      StopTimes: [
        { ...record().StopTimes[0], ArrivalTime: "23:58:00", DepartureTime: "23:59:00" },
        { ...record().StopTimes[1], ArrivalTime: "00:05:00", DepartureTime: "00:06:00" },
      ],
    });
    const snapshot = normalizeTdxThsrRecords([overnight], { snapshotId: "snapshot-test", retrievedAt: "2026-08-30T00:00:00Z" });
    expect(snapshot.stopTimes[1]).toMatchObject({ arrivalAt: "2026-08-28T00:05:00+08:00", departureAt: "2026-08-28T00:06:00+08:00" });
    expect(() => normalizeTdxThsrRecords([{ ...overnight, DailyTrainInfo: { TrainNo: "0999", Overnight: false } }], { snapshotId: "snapshot-test", retrievedAt: "2026-08-30T00:00:00Z" })).toThrow("Unexpected cross-midnight");
  });

  it("builds the required SQLite schema and node/departure index", () => {
    const directory = mkdtempSync(join(tmpdir(), "journey-timetable-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "snapshot.sqlite");
    const snapshot = normalizeTdxThsrRecords([record()], { snapshotId: "snapshot-test", retrievedAt: "2026-08-30T00:00:00Z" });
    buildTimetableDatabase(snapshot, path);
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      expect(database.prepare("SELECT COUNT(*) AS count FROM nodes").get()).toMatchObject({ count: 2 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM service_runs").get()).toMatchObject({ count: 1 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM stop_times").get()).toMatchObject({ count: 2 });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_stop_times_node_departure'").get()).toMatchObject({ name: "idx_stop_times_node_departure" });
    } finally { database.close(); }
  });
});
