import { describe, expect, it } from "vitest";
import { evaluateGoal } from "../src/core/evaluate";
import type { DemoGoal } from "../src/core/types";
import { findDemoGoal } from "../src/data/demoGoals";
function fixture(id: string) { const goal = findDemoGoal(id); if (!goal) throw new Error(`Fixture missing: ${id}`); return goal; }
describe("evaluateGoal", () => {
  it("returns FEASIBLE when hard deadline and buffer are met", () => expect(evaluateGoal(fixture("aquarium-entry-safe")).status).toBe("FEASIBLE"));
  it("returns RISKY when buffer is insufficient", () => expect(evaluateGoal(fixture("aquarium-entry-risky")).status).toBe("RISKY"));
  it("returns IMPOSSIBLE after hard deadline", () => expect(evaluateGoal(fixture("aquarium-entry-missed")).status).toBe("IMPOSSIBLE"));
  it("includes fallback for the missed fixture", () => expect(evaluateGoal(fixture("aquarium-entry-missed")).fallback).toEqual({ label: "Demo evening entry window", arrivalAt: "2030-06-15T17:10:00+08:00" }));
  it("returns UNKNOWN when deadline is missing", () => expect(evaluateGoal(fixture("aquarium-deadline-unknown")).status).toBe("UNKNOWN"));
  it("never returns FEASIBLE when deadline is missing", () => expect(evaluateGoal({ ...fixture("aquarium-entry-safe"), deadlineAt: undefined }).status).toBe("UNKNOWN"));
  it("throws for an invalid timestamp", () => { const invalid: DemoGoal = { ...fixture("aquarium-entry-safe"), arrivalAt: "not-a-date" }; expect(() => evaluateGoal(invalid)).toThrow("Invalid arrivalAt timestamp"); });
});
