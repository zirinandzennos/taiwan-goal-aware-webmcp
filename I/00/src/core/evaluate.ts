import type { DemoGoal, FeasibilityResult } from "./types";
function parseTimestamp(value: string, field: string): number { const parsed = Date.parse(value); if (Number.isNaN(parsed)) throw new Error(`Invalid ${field} timestamp: ${value}`); return parsed; }
export function evaluateGoal(goal: DemoGoal): FeasibilityResult {
  const arrivalMs = parseTimestamp(goal.arrivalAt, "arrivalAt");
  if (!goal.deadlineAt) return { goalId: goal.id, status: "UNKNOWN", arrivalAt: goal.arrivalAt, deadlineAt: null, slackMinutes: null, requiredBufferMin: goal.requiredBufferMin, reasonCode: "GOAL_DEADLINE_UNVERIFIED", fallback: goal.fallback };
  const deadlineMs = parseTimestamp(goal.deadlineAt, "deadlineAt"); const slackMinutes = Math.round((deadlineMs - arrivalMs) / 60_000);
  if (arrivalMs > deadlineMs) return { goalId: goal.id, status: "IMPOSSIBLE", arrivalAt: goal.arrivalAt, deadlineAt: goal.deadlineAt, slackMinutes, requiredBufferMin: goal.requiredBufferMin, reasonCode: "ARRIVAL_AFTER_HARD_DEADLINE", fallback: goal.fallback };
  if (slackMinutes < goal.requiredBufferMin) return { goalId: goal.id, status: "RISKY", arrivalAt: goal.arrivalAt, deadlineAt: goal.deadlineAt, slackMinutes, requiredBufferMin: goal.requiredBufferMin, reasonCode: "INSUFFICIENT_SAFETY_BUFFER", fallback: goal.fallback };
  return { goalId: goal.id, status: "FEASIBLE", arrivalAt: goal.arrivalAt, deadlineAt: goal.deadlineAt, slackMinutes, requiredBufferMin: goal.requiredBufferMin, reasonCode: "MEETS_HARD_DEADLINE_WITH_BUFFER", fallback: goal.fallback };
}
