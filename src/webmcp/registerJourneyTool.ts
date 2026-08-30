import { planJourney } from "../journey/planner";
import { replanJourney } from "../journey/replanner";
import { syntheticJourneyPlanningContext } from "../journey/syntheticTimetable";
import type {
  JourneyOption,
  JourneyPlanResult,
  JourneyReplanResult,
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

function serializeOption(option: JourneyOption | null): Record<string, unknown> | null {
  if (!option) return null;
  const { candidate, feasibility } = option;
  return {
    candidateId: candidate.id,
    departureAt: candidate.departAt,
    arrivalAt: candidate.arriveAt,
    durationMinutes: candidate.totalDurationMinutes,
    totalCost: candidate.totalCost,
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
    ...(option.score === undefined ? {} : { score: option.score }),
    ...(option.scoreBreakdown === undefined ? {} : { scoreBreakdown: option.scoreBreakdown }),
  };
}

function serializeGoalCheck(plan: JourneyPlanResult): Record<string, unknown> {
  const options = [plan.fastest, plan.balanced, plan.cheapest].filter((option): option is JourneyOption => option !== null);
  const recommended = options.find((option) => option.feasibility.status === plan.status) ?? options[0] ?? null;
  const feasibility = recommended?.feasibility;
  return {
    status: plan.status,
    goalId: plan.goalId ?? null,
    goalDeadline: plan.goalDeadline ?? feasibility?.deadlineAt ?? null,
    arrivalAt: recommended?.candidate.arriveAt ?? null,
    safetyMarginMinutes: feasibility?.safetyMarginMinutes ?? feasibility?.deadlineMarginMinutes ?? null,
    reasonCodes: plan.reasonCodes,
    candidateCount: plan.candidateCount,
    recommendedJourney: serializeOption(recommended),
    fallbackAvailable: false,
    dataSnapshot: syntheticJourneyPlanningContext.dataSnapshot ?? null,
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
    fastest: serializeOption(plan.fastest),
    cheapest: serializeOption(plan.cheapest),
    balanced: serializeOption(plan.balanced),
  };
}

function serializeReplan(replan: JourneyReplanResult): Record<string, unknown> {
  return {
    status: replan.plan?.status ?? "UNKNOWN",
    timetableMode: replan.plan?.timetableMode ?? syntheticJourneyPlanningContext.timetableMode,
    previousOriginId: replan.previousOriginId,
    currentNodeId: replan.currentNodeId,
    replannedAt: replan.replannedAt,
    alreadyAtDestination: replan.alreadyAtDestination,
    reasonCodes: replan.reasonCodes,
    dataSnapshot: syntheticJourneyPlanningContext.dataSnapshot ?? null,
    ...(replan.clarification === undefined ? {} : { clarification: replan.clarification }),
    plan: replan.plan === null ? null : serializePlan(replan.plan),
  };
}

/** Registers the goal-first and replan read-only WebMCP entry points once per page lifecycle. */
export function registerJourneyTool(): boolean {
  if (!document.modelContext) return false;

  document.modelContext.registerTool({
    name: "check_taiwan_goal_feasibility",
    title: "Check selected Taiwan goal",
    description: "Use this read-only tool when the user wants to know whether the real-world goal currently selected on this page can still be accomplished. It reads the current origin, selected goal, date, departure time, preferences and constraints from live page state, then uses the deterministic Journey Engine. Do not use for general destination information, tourism facts, weather, or trips outside this goal-feasibility context.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async (_input, { signal } = {}) => {
      abortIfNeeded(signal);
      const request = toJourneyRequest(getCurrentJourneyPageState());
      if (isIncompleteState(request)) {
        return incompleteStateResult("PAGE_JOURNEY_STATE_INCOMPLETE", request.missingFields);
      }
      abortIfNeeded(signal);
      return textResult(serializeGoalCheck(planJourney(request, syntheticJourneyPlanningContext)));
    },
  });

  document.modelContext.registerTool({
    name: "replan_taiwan_journey",
    title: "Replan Taiwan journey",
    description: "Use this read-only tool when the traveler is continuing or recalculating the currently configured journey after their location or time has changed. It reads the original journey intent plus the current node and current journey time from the live page, then recalculates the remaining trip with the same deterministic Journey Engine. Use after the traveler is delayed, missed a service, is ready to continue, or wants the remainder recalculated. It is not for planning a new unrelated trip.",
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
      return textResult(serializeReplan(replanJourney(replanRequest, syntheticJourneyPlanningContext)));
    },
  });

  return true;
}
