import { describe, expect, it } from "vitest";
import { validateJourneyConnections } from "../src/journey/connectionValidator";
import type { JourneyStep } from "../src/journey/types";

const source = { provider: "fixture", retrievedAt: "2026-08-31T00:00:00+08:00", dataMode: "FIXTURE" as const };
const place = { id: "station", name: "Station" };

function step(id: string, type: JourneyStep["type"], start: string, end: string): JourneyStep {
  return { id, type, from: place, to: place, plannedStart: start, plannedEnd: end, durationSec: (Date.parse(end) - Date.parse(start)) / 1000, costTwd: 0, timingQuality: "SCHEDULED", source };
}

describe("canonical connection validator", () => {
  it("subtracts transfer walking and the mandatory buffer before reporting slack", () => {
    const result = validateJourneyConnections([
      step("ride-1", "RIDE", "2026-08-31T12:00:00+08:00", "2026-08-31T12:10:00+08:00"),
      step("walk", "TRANSFER_WALK", "2026-08-31T12:10:00+08:00", "2026-08-31T12:12:00+08:00"),
      step("wait", "WAIT", "2026-08-31T12:12:00+08:00", "2026-08-31T12:18:00+08:00"),
      step("ride-2", "RIDE", "2026-08-31T12:18:00+08:00", "2026-08-31T12:30:00+08:00"),
    ], 180);
    expect(result).toMatchObject({ status: "FEASIBLE", minimumConnectionSlackSec: 180, transferSlacksSec: [180] });
    expect(result.diagnostics[0]).toMatchObject({
      requiredReadyAt: "2026-08-31T12:15:00.000+08:00",
      nextDepartureAt: "2026-08-31T12:18:00+08:00",
      appliedTransferBufferSec: 180,
      transferBufferApplicationCount: 1,
    });
  });

  it("passes exactly at the three-minute preparation boundary", () => {
    const result = validateJourneyConnections([
      step("ride-1", "RIDE", "2026-08-31T12:00:00+08:00", "2026-08-31T12:10:00+08:00"),
      step("ride-2", "RIDE", "2026-08-31T12:13:00+08:00", "2026-08-31T12:30:00+08:00"),
    ], 180);
    expect(result.status).toBe("RISKY");
    expect(result.diagnostics[0]).toMatchObject({ connectionSlackSec: 0, transferBufferApplicationCount: 1 });
  });

  it("fails one second below the three-minute boundary", () => {
    const result = validateJourneyConnections([
      step("ride-1", "RIDE", "2026-08-31T12:00:00+08:00", "2026-08-31T12:10:00+08:00"),
      step("ride-2", "RIDE", "2026-08-31T12:12:59+08:00", "2026-08-31T12:30:00+08:00"),
    ], 180);
    expect(result).toMatchObject({ status: "IMPOSSIBLE", transferSlacksSec: [-1] });
  });

  it("rejects a connection that cannot fit walking plus buffer", () => {
    const result = validateJourneyConnections([
      step("ride-1", "RIDE", "2026-08-31T12:00:00+08:00", "2026-08-31T12:10:00+08:00"),
      step("walk", "TRANSFER_WALK", "2026-08-31T12:10:00+08:00", "2026-08-31T12:14:00+08:00"),
      step("ride-2", "RIDE", "2026-08-31T12:15:00+08:00", "2026-08-31T12:30:00+08:00"),
    ], 180);
    expect(result).toMatchObject({ status: "IMPOSSIBLE", reasonCodes: ["TRANSFER_BUFFER_NOT_MET"] });
  });
});
