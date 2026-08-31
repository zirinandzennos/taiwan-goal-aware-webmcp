import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const evidence = JSON.parse(readFileSync(resolve("data/snapshots/2026-08-31_2026-09-06/official-secondary-evidence.json"), "utf8"));
const source = (evidenceId: string) => evidence.sources.find((entry: any) => entry.evidenceId === evidenceId);

describe("official secondary evidence normalization", () => {
  it("preserves the MaaS UUID without pretending it is a train number", () => {
    expect(evidence.maasRawIdentityAudit.preservedFields).toMatchObject({
      tripId: "68f538cb-a363-49c4-b171-6a178e545fb9",
      trainNo: null,
      originStationId: "1070",
      destinationStationId: "1010",
    });
  });

  it("rejects the time-only 1226 clue when its operating day does not cover the snapshot", () => {
    const thsrc = source("THSRC-SUMMER-2026-SPECIAL-TIMETABLE");
    expect(thsrc.extractedFields).toMatchObject({
      trainNo: "1226",
      serviceDateWeekday: "MONDAY",
      applicableOnServiceDate: false,
      compatibleSecondaryMatchSet: [],
    });
    expect(thsrc.extractedFields.operatesOn).toEqual(["FRIDAY"]);
  });

  it("keeps terminal timetable evidence at the terminal and finds no 14:19 service", () => {
    const bus = source("TAOYUAN-EBUS-208A-20260831");
    expect(bus.extractedFields.originTerminal.internalStopId).toBe(1848);
    expect(bus.extractedFields.terminalDepartures).toEqual(["08:15", "11:40", "14:05", "17:45"]);
    expect(bus.extractedFields.compatibleFixedScheduleMatchSet).toEqual([]);
    expect(bus.limitations.join(" ")).toContain("no intermediate time is inferred");
  });

  it("records an exact route-direction-stop adult fare and excludes stale operator data", () => {
    expect(source("TAOYUAN-EBUS-208A-FARE-1848-1108").extractedFields).toMatchObject({
      routeInternalId: 2081,
      taoyuanGoBack: 1,
      tdxDirection: 0,
      fromStopId: 1848,
      toStopId: 1108,
      fullFareTwd: 18,
    });
    expect(source("UBUS-208A-PAGE-1768").candidateIdsCovered).toEqual([]);
  });
});
