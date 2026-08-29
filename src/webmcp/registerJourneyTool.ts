import { planJourney } from "../journey/planner";
import { replanJourney } from "../journey/replanner";
import {
  syntheticScheduledServices,
  syntheticTransferRules,
} from "../journey/syntheticTimetable";
import type {
  JourneyOption,
  JourneyPlanResult,
  JourneyPlanningContext,
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

const SYNTHETIC_CONTEXT: JourneyPlanningContext = {
  timetable: syntheticScheduledServices,
  transferRules: syntheticTransferRules,
  timetableMode: "SYNTHETIC_FIXED_TIMETABLE",
};

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
    ...(option.score === undefined ? {} : { score: option.score }),
    ...(option.scoreBreakdown === undefined ? {} : { scoreBreakdown: option.scoreBreakdown }),
  };
}

function serializePlan(plan: JourneyPlanResult): Record<string, unknown> {
  return {
    status: plan.status,
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
    timetableMode: replan.plan?.timetableMode ?? SYNTHETIC_CONTEXT.timetableMode,
    previousOriginId: replan.previousOriginId,
    currentNodeId: replan.currentNodeId,
    replannedAt: replan.replannedAt,
    alreadyAtDestination: replan.alreadyAtDestination,
    reasonCodes: replan.reasonCodes,
    ...(replan.clarification === undefined ? {} : { clarification: replan.clarification }),
    plan: replan.plan === null ? null : serializePlan(replan.plan),
  };
}

/** Registers the two stable, read-only WebMCP entry points once per page lifecycle. */
export function registerJourneyTool(): boolean {
  if (!document.modelContext) return false;

  document.modelContext.registerTool({
    name: "plan_taiwan_journey",
    title: "Plan Taiwan journey",
    description: "Use this read-only tool when the user wants to plan or compare the Taiwan journey currently configured on this page. It reads the current origin, destination, departure time, constraints and preferences from the live page, deterministically generates executable options from the site's timetable data, and returns Fastest, Cheapest and Balanced options with feasibility status. Do not use for general destination information, tourism facts, weather, or trips outside this journey-planning context.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: async (_input, { signal } = {}) => {
      abortIfNeeded(signal);
      const request = toJourneyRequest(getCurrentJourneyPageState());
      if (isIncompleteState(request)) {
        return incompleteStateResult("PAGE_JOURNEY_STATE_INCOMPLETE", request.missingFields);
      }
      abortIfNeeded(signal);
      return textResult(serializePlan(planJourney(request, SYNTHETIC_CONTEXT)));
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
      return textResult(serializeReplan(replanJourney(replanRequest, SYNTHETIC_CONTEXT)));
    },
  });

  return true;
}
