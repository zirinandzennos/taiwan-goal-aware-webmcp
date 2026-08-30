import { findJourneyGoal } from "../data/demoGoals";
import { buildJourneyExecutionSteps } from "../journey/executionSteps";
import {
  findSaferFallback,
  selectRecommendedOption,
  type JourneyFallbackSuggestion,
} from "../journey/fallback";
import { officialJourneyPlanningContext } from "../journey/officialTimetable";
import { planJourney } from "../journey/planner";
import { replanJourney } from "../journey/replanner";
import type {
  JourneyOption,
  JourneyPlanResult,
  JourneyReplanResult,
  JourneyRequest,
} from "../journey/types";
import {
  getCurrentJourneyPageState,
  toJourneyReplanRequest,
  toJourneyRequest,
  type IncompletePageJourneyState,
} from "./pageState";

interface ToolExecutionOptions {
  signal?: AbortSignal;
}

interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
}

interface RegisteredTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: Record<string, never>, options?: ToolExecutionOptions) => Promise<ToolResponse>;
}

interface ModelContext {
  registerTool(tool: RegisteredTool): void;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

const EMPTY_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

function abortIfNeeded(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Journey tool execution was cancelled.");
  error.name = "AbortError";
  throw error;
}

function textResult(value: unknown): ToolResponse {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function incompleteStateResult(reasonCode: string, missingFields: string[]): ToolResponse {
  return textResult({ status: "UNKNOWN", reasonCodes: [reasonCode], missingFields });
}

function isIncompleteState(value: unknown): value is IncompletePageJourneyState {
  return typeof value === "object" && value !== null && "missingFields" in value;
}

function serializeOption(
  option: JourneyOption | null,
  request: JourneyRequest,
): Record<string, unknown> | null {
  if (!option) return null;
  const { candidate, feasibility } = option;
  return {
    candidateId: candidate.id,
    departureAt: candidate.departAt,
    arrivalAt: candidate.arriveAt,
    goalReadyAt: feasibility.goalReadyAt ?? null,
    durationMinutes: candidate.totalDurationMinutes,
    totalCost: candidate.totalCost,
    transferCount: candidate.transferCount,
    totalWaitingMinutes: candidate.totalWaitingMinutes,
    totalWalkingMinutes: candidate.totalWalkingMinutes,
    minimumTransferSlackMinutes: candidate.minimumTransferSlackMinutes,
    tightTransferCount: candidate.tightTransferCount,
    feasibilityStatus: feasibility.status,
    reasonCodes: feasibility.reasonCodes,
    safetyMarginMinutes: feasibility.safetyMarginMinutes ?? feasibility.deadlineMarginMinutes,
    legs: candidate.legs.filter((leg) => leg.type === "TRAVEL").map((leg) => ({
      serviceId: leg.serviceId,
      mode: leg.mode,
      fromNodeId: leg.fromNodeId,
      toNodeId: leg.toNodeId,
      departureAt: leg.departAt,
      arrivalAt: leg.arriveAt,
    })),
    executionSteps: buildJourneyExecutionSteps(option, request, officialJourneyPlanningContext),
    ...(option.score === undefined ? {} : { score: option.score }),
    ...(option.scoreBreakdown === undefined ? {} : { scoreBreakdown: option.scoreBreakdown }),
  };
}

function serializeFallback(
  fallback: JourneyFallbackSuggestion | null,
  request: JourneyRequest,
): Record<string, unknown> | null {
  if (!fallback) return null;
  return {
    strategy: fallback.strategy,
    originalStatus: fallback.originalStatus,
    requestedDepartAt: fallback.requestedDepartAt,
    recommendedServiceDepartureAt: fallback.recommendedServiceDepartureAt,
    arrivalAt: fallback.arrivalAt,
    goalReadyAt: fallback.goalReadyAt,
    goalDeadline: fallback.goalDeadline,
    safetyMarginMinutes: fallback.safetyMarginMinutes,
    reasonCodes: fallback.reasonCodes,
    recommendedJourney: serializeOption(
      fallback.option,
      { ...request, departAt: fallback.requestedDepartAt },
    ),
  };
}

function serializeGoalCheck(
  plan: JourneyPlanResult,
  request: JourneyRequest,
  fallback: JourneyFallbackSuggestion | null,
): Record<string, unknown> {
  const recommended = selectRecommendedOption(plan);
  const feasibility = recommended?.feasibility;
  const pageState = getCurrentJourneyPageState();
  const goal = findJourneyGoal(plan.goalId ?? pageState.goalId);
  return {
    status: plan.status,
    pageStateUsed: {
      selectedGoalId: pageState.goalId,
      originNodeId: pageState.originId,
      destinationNodeId: pageState.destinationId,
      departAt: pageState.departAt,
      avoidTaxi: pageState.preferences.avoidTaxi,
    },
    goal: goal ? {
      id: goal.id,
      title: goal.title,
      destinationNodeId: goal.destinationId,
      deadlineVerified: goal.deadlineVerified,
      source: goal.source,
    } : { id: plan.goalId ?? pageState.goalId },
    goalDeadline: plan.goalDeadline ?? feasibility?.deadlineAt ?? null,
    arrivalAt: recommended?.candidate.arriveAt ?? null,
    goalReadyAt: feasibility?.goalReadyAt ?? null,
    safetyMarginMinutes: feasibility?.safetyMarginMinutes ?? feasibility?.deadlineMarginMinutes ?? null,
    reasonCodes: feasibility?.reasonCodes ?? plan.reasonCodes,
    recommendedJourney: serializeOption(recommended, request),
    fallback: serializeFallback(fallback, request),
    snapshot: officialJourneyPlanningContext.dataSnapshot ?? null,
  };
}

function serializePlan(plan: JourneyPlanResult, request: JourneyRequest): Record<string, unknown> {
  return {
    status: plan.status,
    goalId: plan.goalId ?? null,
    goalDeadline: plan.goalDeadline ?? null,
    timetableMode: plan.timetableMode,
    candidateCount: plan.candidateCount,
    reasonCodes: plan.reasonCodes,
    fastest: serializeOption(plan.fastest, request),
    cheapest: serializeOption(plan.cheapest, request),
    balanced: serializeOption(plan.balanced, request),
  };
}

function serializeReplan(
  replan: JourneyReplanResult,
  fallback: JourneyFallbackSuggestion | null,
): Record<string, unknown> {
  const request = replan.request;
  const recommended = replan.plan ? selectRecommendedOption(replan.plan) : null;
  return {
    status: replan.plan?.status ?? "UNKNOWN",
    timetableMode: replan.plan?.timetableMode ?? officialJourneyPlanningContext.timetableMode,
    previousOriginId: replan.previousOriginId,
    currentNodeId: replan.currentNodeId,
    replannedAt: replan.replannedAt,
    alreadyAtDestination: replan.alreadyAtDestination,
    reasonCodes: replan.reasonCodes,
    feasibilityReasonCodes: recommended?.feasibility.reasonCodes ?? [],
    goalDeadline: recommended?.feasibility.deadlineAt ?? replan.plan?.goalDeadline ?? null,
    goalReadyAt: recommended?.feasibility.goalReadyAt ?? null,
    safetyMarginMinutes: recommended?.feasibility.safetyMarginMinutes
      ?? recommended?.feasibility.deadlineMarginMinutes
      ?? null,
    recommendedJourney: request ? serializeOption(recommended, request) : null,
    fallback: request ? serializeFallback(fallback, request) : null,
    snapshot: officialJourneyPlanningContext.dataSnapshot ?? null,
    ...(replan.clarification === undefined ? {} : { clarification: replan.clarification }),
    plan: replan.plan === null || request === null ? null : serializePlan(replan.plan, request),
  };
}

/** Registers the goal-first and replan read-only WebMCP entry points once per page lifecycle. */
export function registerJourneyTool(): boolean {
  if (!document.modelContext) return false;

  document.modelContext.registerTool({
    name: "check_taiwan_goal_feasibility",
    title: "Check selected Taiwan goal",
    description: "Use this read-only tool when the user asks whether the real-world goal currently selected on this page can still be accomplished. Read the live origin, goal, departure time and preferences from the page; do not ask the user to repeat them. Return FEASIBLE, RISKY, IMPOSSIBLE or UNKNOWN with deadline, goal-ready time, safety margin, reason code and deterministic fallback when available. Do not use for tourism facts, weather or unrelated trips.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async (_input, { signal } = {}) => {
      abortIfNeeded(signal);
      const request = toJourneyRequest(getCurrentJourneyPageState());
      if (isIncompleteState(request)) {
        return incompleteStateResult("PAGE_JOURNEY_STATE_INCOMPLETE", request.missingFields);
      }
      abortIfNeeded(signal);
      const plan = planJourney(request, officialJourneyPlanningContext);
      const fallback = findSaferFallback(request, plan, officialJourneyPlanningContext);
      return textResult(serializeGoalCheck(plan, request, fallback));
    },
  });

  document.modelContext.registerTool({
    name: "replan_taiwan_journey",
    title: "Replan remaining Taiwan journey",
    description: "Use this read-only tool after the traveler is delayed, misses a service, or changes current location or time. Read the original goal plus current node and time from the live page, create a new remaining JourneyRequest, and recalculate every downstream step with the same deterministic engine. Do not patch the old itinerary and do not use for a new unrelated trip.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async (_input, { signal } = {}) => {
      abortIfNeeded(signal);
      const pageState = getCurrentJourneyPageState();
      const originalRequest = toJourneyRequest(pageState);
      if (isIncompleteState(originalRequest)) {
        return incompleteStateResult("PAGE_JOURNEY_STATE_INCOMPLETE", originalRequest.missingFields);
      }
      const replanRequest = toJourneyReplanRequest(pageState);
      if (isIncompleteState(replanRequest)) {
        return incompleteStateResult("CURRENT_JOURNEY_STATE_INCOMPLETE", replanRequest.missingFields);
      }
      abortIfNeeded(signal);
      const replan = replanJourney(replanRequest, officialJourneyPlanningContext);
      const fallback = replan.plan && replan.request
        ? findSaferFallback(replan.request, replan.plan, officialJourneyPlanningContext)
        : null;
      return textResult(serializeReplan(replan, fallback));
    },
  });

  return true;
}
