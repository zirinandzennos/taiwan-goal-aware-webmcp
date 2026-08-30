import { planJourney } from "./planner";
import type {
  FeasibilityStatus,
  JourneyOption,
  JourneyPlanResult,
  JourneyPlanningContext,
  JourneyRequest,
} from "./types";

export interface JourneyFallbackSuggestion {
  strategy: "DEPART_EARLIER";
  originalStatus: Extract<FeasibilityStatus, "RISKY" | "IMPOSSIBLE">;
  requestedDepartAt: string;
  recommendedServiceDepartureAt: string;
  arrivalAt: string;
  goalReadyAt: string | null;
  goalDeadline: string | null;
  safetyMarginMinutes: number | null;
  reasonCodes: string[];
  option: JourneyOption;
}

export function selectRecommendedOption(plan: JourneyPlanResult): JourneyOption | null {
  const options = [plan.balanced, plan.fastest, plan.cheapest]
    .filter((option): option is JourneyOption => option !== null);
  return options.find((option) => option.feasibility.status === plan.status)
    ?? options[0]
    ?? null;
}

function shiftMinutes(iso: string, minutes: number): string | null {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed + minutes * 60_000).toISOString();
}

/**
 * Deterministic Challenge fallback: retry the same goal with an earlier start.
 * It uses the same planner and never invents a journey or changes the deadline.
 */
export function findSaferFallback(
  request: JourneyRequest,
  plan: JourneyPlanResult,
  context: JourneyPlanningContext,
): JourneyFallbackSuggestion | null {
  if (plan.status !== "RISKY" && plan.status !== "IMPOSSIBLE") return null;

  for (const minutesEarlier of [30, 60, 120, 180, 240]) {
    const requestedDepartAt = shiftMinutes(request.departAt, -minutesEarlier);
    if (!requestedDepartAt) return null;
    const fallbackPlan = planJourney({ ...request, departAt: requestedDepartAt }, context);
    if (fallbackPlan.status !== "FEASIBLE") continue;
    const option = selectRecommendedOption(fallbackPlan);
    if (!option || option.feasibility.status !== "FEASIBLE") continue;

    return {
      strategy: "DEPART_EARLIER",
      originalStatus: plan.status,
      requestedDepartAt,
      recommendedServiceDepartureAt: option.candidate.departAt,
      arrivalAt: option.candidate.arriveAt,
      goalReadyAt: option.feasibility.goalReadyAt ?? null,
      goalDeadline: option.feasibility.deadlineAt,
      safetyMarginMinutes: option.feasibility.safetyMarginMinutes
        ?? option.feasibility.deadlineMarginMinutes,
      reasonCodes: option.feasibility.reasonCodes,
      option,
    };
  }

  return null;
}
