import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { buildTimetableDatabase } from "../scripts/import/build-timetable-db";
import { authorizationHeader, dailyTimetableUrl } from "../scripts/import/fetch-tdx-thsr";
import { normalizeTdxThsrRecords } from "../scripts/import/normalize-tdx-thsr";
import type { TdxDailyTimetableRecord } from "../scripts/import/types";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function record(overrides: Partial<TdxDailyTimetableRecord> = {}): TdxDailyTimetableRecord {
  return {
    TrainDate: "2026-08-24",
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
    expect(dailyTimetableUrl("2026-08-24")).toContain("2026-08-24");
  });

  it("normalizes dated service instances with explicit Taipei offsets", () => {
    const snapshot = normalizeTdxThsrRecords([record()], { snapshotId: "snapshot-test", retrievedAt: "2026-08-30T00:00:00Z" });
    expect(snapshot.serviceRuns[0]).toMatchObject({ id: "THSR_0126_20260824", serviceDate: "2026-08-24", sourceSnapshotId: "snapshot-test" });
    expect(snapshot.stopTimes.map((stop) => stop.departureAt)).toEqual(["2026-08-24T17:35:00+08:00", "2026-08-24T19:16:00+08:00"]);
    expect(snapshot.nodes).toHaveLength(2);
  });

  it("rejects dates outside the snapshot, duplicate runs, and invalid rows", () => {
    const metadata = { snapshotId: "snapshot-test", retrievedAt: "2026-08-30T00:00:00Z" };
    expect(() => normalizeTdxThsrRecords([record({ TrainDate: "2026-08-31" })], metadata)).toThrow("outside fixed snapshot period");
    expect(() => normalizeTdxThsrRecords([record(), record()], metadata)).toThrow("Duplicate service run");
    expect(() => normalizeTdxThsrRecords([record({ StopTimes: [{ ...record().StopTimes[0], ArrivalTime: "bad" }, record().StopTimes[1]] })], metadata)).toThrow("Invalid provider time");
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
