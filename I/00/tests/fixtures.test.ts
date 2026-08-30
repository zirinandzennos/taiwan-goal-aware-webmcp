import { describe, expect, it } from "vitest";
import { evaluateGoal } from "../src/core/evaluate";
import { demoGoals } from "../src/data/demoGoals";
const expected = { "aquarium-entry-safe": "FEASIBLE", "aquarium-entry-risky": "RISKY", "aquarium-entry-missed": "IMPOSSIBLE", "aquarium-deadline-unknown": "UNKNOWN" } as const;
describe("synthetic fixtures", () => { it("remain deterministic with all four feasibility states", () => { expect(demoGoals).toHaveLength(4); for (const goal of demoGoals) expect(evaluateGoal(goal).status).toBe(expected[goal.id as keyof typeof expected]); }); });
