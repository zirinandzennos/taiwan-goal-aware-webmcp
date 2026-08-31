import { planJourney } from "../journey/planner";
import { replanJourney } from "../journey/replanner";
import { officialJourneyPlanningContext } from "../journey/officialTimetable";
import { findJourneyGoal } from "../data/demoGoals";
import type {
  JourneyOption,
  JourneyPlanResult,
  JourneyRecommendationMetadata,
  JourneyReplanResult,
} from "../journey/types";
import {
  getCurrentJourneyPageState,
  toJourneyReplanRequest,
  toJourneyRequest,
  type IncompletePageJourneyState,
} from "./pageState";
import {
  compactJourneyProductPlan,
  planJourneyFromPageState,
  replanSelectedSnapshotJourney,
} from "../application/journeyProduct.ts";
import {
  getJourneyPageState,
  getJourneyPageStateVersion,
} from "../ui/state.ts";

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

const registeredContexts = new WeakSet<object>();

function requireEmptyInput(input: Record<string, never>): void {
  if (Object.keys(input).length === 0) return;
  throw new TypeError("Journey tools read live page state and do not accept input fields.");
}

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

function serializeOption(option: JourneyOption | null): Record<string, unknown> | null {
  if (!option) return null;
  const { candidate, feasibility } = option;
  return {
    candidateId: candidate.id,
    departureAt: candidate.departAt,
    arrivalAt: candidate.arriveAt,
    durationMinutes: candidate.totalDurationMinutes,
    totalCost: candidate.totalCost,
    costCoverage: candidate.costCoverage ?? "COMPLETE",
    goalCompletionAt: candidate.goalCompletionAt ?? feasibility.goalReadyAt ?? candidate.arriveAt,
    modeValidation: candidate.modeValidation ?? null,
    transferCount: candidate.transferCount,
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
    ...(candidate.steps === undefined ? {} : { steps: candidate.steps }),
    ...(option.score === undefined ? {} : { score: option.score }),
    ...(option.scoreBreakdown === undefined ? {} : { scoreBreakdown: option.scoreBreakdown }),
  };
}

function recommendedOption(plan: JourneyPlanResult): JourneyOption | null {
  const options = [plan.balanced, plan.fastest, plan.cheapest].filter((option): option is JourneyOption => option !== null);
  return options.find((option) => option.feasibility.status === plan.status) ?? options[0] ?? null;
}

function serializeGoalCheck(plan: JourneyPlanResult): Record<string, unknown> {
  const recommended = recommendedOption(plan);
  const feasibility = recommended?.feasibility;
  const pageGoal = getCurrentJourneyPageState().goalId;
  const goal = findJourneyGoal(plan.goalId ?? pageGoal);
  return {
    status: plan.status,
    goal: goal ? {
      id: goal.id,
      title: goal.title,
      destinationNodeId: goal.destinationId,
      source: goal.source,
    } : { id: plan.goalId ?? pageGoal },
    goalDeadline: plan.goalDeadline ?? feasibility?.deadlineAt ?? null,
    arrivalAt: recommended?.candidate.arriveAt ?? null,
    goalReadyAt: feasibility?.goalReadyAt ?? null,
    safetyMarginMinutes: feasibility?.safetyMarginMinutes ?? feasibility?.deadlineMarginMinutes ?? null,
    reasonCodes: plan.reasonCodes,
    selectionReasonCodes: plan.selectionReasonCodes ?? [],
    recommendedJourney: serializeOption(recommended),
    snapshot: officialJourneyPlanningContext.dataSnapshot ?? null,
  };
}

function serializePlan(plan: JourneyPlanResult): Record<string, unknown> {
  return {
    status: plan.status,
    goalId: plan.goalId ?? null,
    goalDeadline: plan.goalDeadline ?? null,
    timetableMode: plan.timetableMode,
    candidateCount: plan.candidateCount,
    reasonCodes: plan.reasonCodes,
    selectionReasonCodes: plan.selectionReasonCodes ?? [],
    fastest: serializeOption(plan.fastest),
    cheapest: serializeOption(plan.cheapest),
    balanced: serializeOption(plan.balanced),
  };
}

function serializeRecommendation(
  option: JourneyOption | null,
  metadata: JourneyRecommendationMetadata | undefined,
): Record<string, unknown> {
  const fallbackId = option?.candidate.id ?? null;
  return {
    status: metadata?.status ?? (fallbackId === null ? "UNAVAILABLE" : "AVAILABLE"),
    winnerCandidateIds: metadata?.winnerCandidateIds ?? (fallbackId === null ? [] : [fallbackId]),
    selectedRepresentativeId: metadata?.selectedRepresentativeId ?? fallbackId,
    unique: metadata?.unique ?? fallbackId !== null,
    journey: serializeOption(option),
    blocker: metadata?.blocker ?? (fallbackId === null ? { reasonCode: "NO_ELIGIBLE_CANDIDATE" } : null),
    proofStatus: metadata?.proofStatus ?? "DETERMINISTIC_ENGINE_RESULT",
    evidenceIds: metadata?.evidenceIds ?? [],
    dataMode: metadata?.dataMode ?? "SNAPSHOT",
    farePolicy: metadata?.farePolicy ?? "COMPLETE_PUBLISHED_FARES_ONLY",
    effectiveCandidateCount: metadata?.effectiveCandidateCount ?? planCandidateCount(option),
  };
}

function planCandidateCount(option: JourneyOption | null): number {
  return option === null ? 0 : 1;
}

function serializeGoalAwareJourneyPlan(plan: JourneyPlanResult): Record<string, unknown> {
  const pageState = getCurrentJourneyPageState();
  return {
    requestId: `req:${pageState.goalId}:${pageState.originId}:${pageState.departAt}`,
    generatedAt: officialJourneyPlanningContext.dataSnapshot?.retrievedAt ?? null,
    dataMode: "SNAPSHOT",
    status: plan.status,
    candidateCount: plan.candidateCount,
    selectionReasonCodes: plan.selectionReasonCodes ?? [],
    journeys: {
      fastest: serializeOption(plan.fastest),
      balanced: serializeOption(plan.balanced),
      cheapest: serializeOption(plan.cheapest),
    },
    recommendations: {
      fastest: serializeRecommendation(plan.fastest, plan.recommendationMetadata?.fastest),
      balanced: serializeRecommendation(plan.balanced, plan.recommendationMetadata?.balanced),
      cheapest: serializeRecommendation(plan.cheapest, plan.recommendationMetadata?.cheapest),
    },
    snapshot: officialJourneyPlanningContext.dataSnapshot ?? null,
  };
}

function serializeReplan(replan: JourneyReplanResult): Record<string, unknown> {
  const recommended = replan.plan ? recommendedOption(replan.plan) : null;
  return {
    status: replan.plan?.status ?? "UNKNOWN",
    timetableMode: replan.plan?.timetableMode ?? officialJourneyPlanningContext.timetableMode,
    previousOriginId: replan.previousOriginId,
    currentNodeId: replan.currentNodeId,
    replannedAt: replan.replannedAt,
    alreadyAtDestination: replan.alreadyAtDestination,
    reasonCodes: replan.reasonCodes,
    goalDeadline: recommended?.feasibility.deadlineAt ?? replan.plan?.goalDeadline ?? null,
    goalReadyAt: recommended?.feasibility.goalReadyAt ?? null,
    safetyMarginMinutes: recommended?.feasibility.safetyMarginMinutes ?? recommended?.feasibility.deadlineMarginMinutes ?? null,
    recommendedJourney: serializeOption(recommended),
    snapshot: officialJourneyPlanningContext.dataSnapshot ?? null,
    ...(replan.clarification === undefined ? {} : { clarification: replan.clarification }),
    plan: replan.plan === null ? null : serializePlan(replan.plan),
  };
}

/** Registers the goal-first and replan read-only WebMCP entry points once per page lifecycle. */
export function registerJourneyTool(): boolean {
  if (!document.modelContext) return false;
  if (registeredContexts.has(document.modelContext)) return true;

  document.modelContext.registerTool({
    name: "plan_taiwan_goal_aware_journey",
    title: "Plan goal-aware Taiwan journey",
    description: "WHEN: compare the Fastest, Balanced, and Cheapest journeys for the live controls on this page. RETURNS: compact fixed-snapshot recommendations, formal winner sets, request identity, ordered steps, evidence IDs, and explicit blockers. STATE: captured at execution time. DOES NOT DO: network fetches, live operations, invented routes, ticketing, or general tourism advice.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async (input, { signal } = {}) => {
      abortIfNeeded(signal);
      requireEmptyInput(input);
      const productState = getJourneyPageState();
      const plan = planJourneyFromPageState(productState, getJourneyPageStateVersion());
      abortIfNeeded(signal);
      return textResult(compactJourneyProductPlan(plan));
    },
  });

  document.modelContext.registerTool({
    name: "check_taiwan_goal_feasibility",
    title: "Check selected Taiwan goal",
    description: "WHEN: check whether the goal currently selected on this page remains feasible. RETURNS: deterministic goal timing and blocker evidence from live page state. STATE: captured at execution time. DOES NOT DO: weather, general destination information, live operations, or trips outside this page.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async (input, { signal } = {}) => {
      abortIfNeeded(signal);
      requireEmptyInput(input);
      const request = toJourneyRequest(getCurrentJourneyPageState());
      if (isIncompleteState(request)) {
        return incompleteStateResult("PAGE_JOURNEY_STATE_INCOMPLETE", request.missingFields);
      }
      abortIfNeeded(signal);
      return textResult(serializeGoalCheck(planJourney(request, officialJourneyPlanningContext)));
    },
  });

  document.modelContext.registerTool({
    name: "replan_taiwan_journey",
    title: "Replan Taiwan journey",
    description: "WHEN: the selected journey has actual progress or delay evidence, or its location or time has changed, and the remainder needs recalculation. RETURNS: either a snapshot-safe replan result or an explicit blocker preserving the previous plan and progress evidence. STATE: captured at execution time. DOES NOT DO: fabricate services outside the frozen snapshot or plan an unrelated trip.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async (input, { signal } = {}) => {
      abortIfNeeded(signal);
      requireEmptyInput(input);
      const productState = getJourneyPageState();
      if (productState.latestProductPlan || productState.selectedJourney || productState.progress) {
        abortIfNeeded(signal);
        return textResult(replanSelectedSnapshotJourney(productState));
      }
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
      return textResult(serializeReplan(replanJourney(replanRequest, officialJourneyPlanningContext)));
    },
  });

  registeredContexts.add(document.modelContext);

  return true;
}
