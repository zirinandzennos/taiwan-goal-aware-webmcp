import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runOfficialGoldenJourney } from "../scripts/import/run-golden-journey";

describe("frozen official TDX golden journey", () => {
  it("runs exact-date planning and delay replanning without credentials or live TDX", () => {
    const previousClientId = process.env.TDX_CLIENT_ID;
    const previousClientSecret = process.env.TDX_CLIENT_SECRET;
    delete process.env.TDX_CLIENT_ID;
    delete process.env.TDX_CLIENT_SECRET;
    try {
      const proof = runOfficialGoldenJourney() as any;
      expect(proof.snapshotId).toMatch(/^tdx-thsr-20260831-20260906-/);
      expect(proof.request).toMatchObject({ originId: "1070", destinationId: "1020", departAt: "2026-08-31T11:30:00+08:00", goal: { id: "ENTER_XPARK", deadlineAt: "2026-08-31T17:00:00+08:00", goalActionBufferMinutes: 9 } });
      expect(proof.golden.candidateCount).toBeGreaterThan(0);
      expect(proof.golden).toMatchObject({ status: "FEASIBLE", finalArrivalAt: "2026-08-31T13:09:00+08:00", goalDeadline: "2026-08-31T17:00:00+08:00", safetyMarginMinutes: 222, reasonCodes: ["MEETS_DEADLINE_WITH_BUFFER"] });
      expect(proof.golden.selected).toEqual([{ serviceId: "THSR_1634_20260831:1070-1020", serviceRunId: "THSR_1634_20260831", trainNo: "1634", fromNodeId: "1070", toNodeId: "1020", departureAt: "2026-08-31T11:35:00+08:00", arrivalAt: "2026-08-31T13:09:00+08:00" }]);
      expect(proof.golden.selected.every((service: any) => service.departureAt.startsWith("2026-08-31T"))).toBe(true);
      expect(proof.replan).toMatchObject({ nodeId: "1060", currentAt: "2026-08-31T11:49:00+08:00", status: "FEASIBLE", goalDeadline: "2026-08-31T17:00:00+08:00", safetyMarginMinutes: 162, reasonCodes: ["MEETS_DEADLINE_WITH_BUFFER"] });
      expect(proof.replan.missedService).toEqual({ serviceId: "THSR_1634_20260831:1060-1020", serviceRunId: "THSR_1634_20260831", trainNo: "1634", departureAt: "2026-08-31T11:48:00+08:00", arrivalAt: "2026-08-31T13:09:00+08:00" });
      expect(proof.replan.replacementServices).toEqual([{ serviceId: "THSR_0640_20260831:1060-1020", serviceRunId: "THSR_0640_20260831", trainNo: "0640", fromNodeId: "1060", toNodeId: "1020", departureAt: "2026-08-31T12:48:00+08:00", arrivalAt: "2026-08-31T14:09:00+08:00" }]);
      expect(proof.replan.currentAt > proof.replan.missedService.departureAt).toBe(true);
      expect(proof.replan.replacementServices.map((service: any) => service.serviceId)).not.toContain(proof.replan.missedService.serviceId);
      expect(proof.replan.replacementServices.every((service: any) => service.fromNodeId !== "1070")).toBe(true);
      expect(proof.replan.goalDeadline).toBe(proof.golden.goalDeadline);
    } finally {
      if (previousClientId === undefined) delete process.env.TDX_CLIENT_ID; else process.env.TDX_CLIENT_ID = previousClientId;
      if (previousClientSecret === undefined) delete process.env.TDX_CLIENT_SECRET; else process.env.TDX_CLIENT_SECRET = previousClientSecret;
    }
  });

  it("contains no runtime credential dependency or authorization material", () => {
    const runtimeText = readFileSync("src/data/officialTimetableSnapshot.json", "utf8");
    expect(runtimeText).not.toMatch(/TDX_CLIENT_ID|TDX_CLIENT_SECRET|Authorization|Bearer\s+eyJ/);
  });
});
