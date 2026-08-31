import { planJourney } from "../journey/planner";
import { replanJourney } from "../journey/replanner";
import { officialJourneyPlanningContext } from "../journey/officialTimetable";
import type { JourneyPlanResult, JourneyReplanResult } from "../journey/types";
import {
  planJourneyFromPageState,
  replanSelectedSnapshotJourney,
  type JourneyProductPlan,
  type JourneyProductReplanResult,
} from "../application/journeyProduct.ts";
import {
  getJourneyPageState,
  getJourneyPageStateVersion,
  markSelectedReplanBlocked,
  storeLatestProductPlan,
} from "./state.ts";
import {
  getCurrentJourneyPageState,
  toJourneyReplanRequest,
  toJourneyRequest,
  type IncompletePageJourneyState,
} from "../webmcp/pageState";

export interface JourneyUiStateError {
  status: "UNKNOWN";
  reasonCodes: string[];
  missingFields: string[];
}

export type HumanPlanExecution =
  | { kind: "PLAN_RESULT"; plan: JourneyPlanResult }
  | { kind: "STATE_ERROR"; error: JourneyUiStateError };

export type HumanReplanExecution =
  | { kind: "REPLAN_RESULT"; replan: JourneyReplanResult }
  | { kind: "STATE_ERROR"; error: JourneyUiStateError };

export type HumanProductPlanExecution = { kind: "PRODUCT_PLAN_RESULT"; plan: JourneyProductPlan };
export type HumanProductReplanExecution = { kind: "PRODUCT_REPLAN_RESULT"; replan: JourneyProductReplanResult };

function isIncompleteState(value: unknown): value is IncompletePageJourneyState {
  return typeof value === "object" && value !== null && "missingFields" in value;
}

function stateError(reasonCode: string, missingFields: string[]): JourneyUiStateError {
  return { status: "UNKNOWN", reasonCodes: [reasonCode], missingFields };
}

/** Uses the same live state mapper and engine entry point as check_taiwan_goal_feasibility. */
export function planCurrentJourney(): HumanPlanExecution {
  const request = toJourneyRequest(getCurrentJourneyPageState());
  if (isIncompleteState(request)) {
    return { kind: "STATE_ERROR", error: stateError("PAGE_JOURNEY_STATE_INCOMPLETE", request.missingFields) };
  }
  return { kind: "PLAN_RESULT", plan: planJourney(request, officialJourneyPlanningContext) };
}

/** Uses the same live state mapper and engine entry point as replan_taiwan_journey. */
export function replanCurrentJourney(): HumanReplanExecution {
  const state = getCurrentJourneyPageState();
  const originalRequest = toJourneyRequest(state);
  if (isIncompleteState(originalRequest)) {
    return { kind: "STATE_ERROR", error: stateError("PAGE_JOURNEY_STATE_INCOMPLETE", originalRequest.missingFields) };
  }
  const replanRequest = toJourneyReplanRequest(state);
  if (isIncompleteState(replanRequest)) {
    return { kind: "STATE_ERROR", error: stateError("CURRENT_JOURNEY_STATE_INCOMPLETE", replanRequest.missingFields) };
  }
  return { kind: "REPLAN_RESULT", replan: replanJourney(replanRequest, officialJourneyPlanningContext) };
}

/** Single application-service path used by the Journey-first Human UI. */
export function planCurrentJourneyProduct(): HumanProductPlanExecution {
  const plan = planJourneyFromPageState(getJourneyPageState(), getJourneyPageStateVersion());
  storeLatestProductPlan(plan);
  return { kind: "PRODUCT_PLAN_RESULT", plan };
}

/** Snapshot progress is retained as evidence; unsupported remainder states fail closed. */
export function replanCurrentJourneyProduct(): HumanProductReplanExecution {
  const replan = replanSelectedSnapshotJourney(getJourneyPageState());
  markSelectedReplanBlocked();
  return { kind: "PRODUCT_REPLAN_RESULT", replan };
}
