import { planJourney } from "./planner";
import { parseExplicitIsoTimestamp } from "./timetable";
import type {
  JourneyPlanningContext,
  JourneyReplanRequest,
  JourneyReplanResult,
  JourneyRequest,
} from "./types";

function knownNodeIds(context: JourneyPlanningContext): ReadonlySet<string> {
  return new Set(context.timetable.flatMap((service) => [service.fromNodeId, service.toNodeId]));
}

function deriveRemainingRequest(replanRequest: JourneyReplanRequest): JourneyRequest {
  const { originalRequest, currentState } = replanRequest;
  return {
    ...originalRequest,
    originId: currentState.nodeId,
    origin: { text: currentState.nodeId, canonicalPlaceId: currentState.nodeId },
    departAt: currentState.at,
  };
}

/**
 * Replans only the remaining trip. It never patches old candidate legs: every
 * valid replan is a newly derived request passed through the same planJourney.
 */
export function replanJourney(
  replanRequest: JourneyReplanRequest,
  context: JourneyPlanningContext,
): JourneyReplanResult {
  const { originalRequest, currentState } = replanRequest;
  const baseResult = {
    previousOriginId: originalRequest.originId,
    currentNodeId: currentState.nodeId,
    replannedAt: currentState.at,
  };

  if (parseExplicitIsoTimestamp(currentState.at) === null) {
    return {
      ...baseResult,
      request: null,
      plan: null,
      alreadyAtDestination: false,
      reasonCodes: ["INVALID_CURRENT_TIMESTAMP"],
      clarification: {
        field: "currentState.at",
        question: "What is the current time at this journey node?",
        reason: "INVALID_CURRENT_TIMESTAMP",
      },
    };
  }
  if (currentState.nodeId === originalRequest.destinationId) {
    return {
      ...baseResult,
      request: null,
      plan: null,
      alreadyAtDestination: true,
      reasonCodes: ["ALREADY_AT_DESTINATION"],
    };
  }
  if (!knownNodeIds(context).has(currentState.nodeId)) {
    return {
      ...baseResult,
      request: null,
      plan: null,
      alreadyAtDestination: false,
      reasonCodes: ["CURRENT_NODE_NOT_IN_TIMETABLE"],
      clarification: {
        field: "currentState.nodeId",
        question: "Which known timetable node are you currently at?",
        reason: "CURRENT_NODE_NOT_IN_TIMETABLE",
      },
    };
  }

  const request = deriveRemainingRequest(replanRequest);
  return {
    ...baseResult,
    request,
    plan: planJourney(request, context),
    alreadyAtDestination: false,
    reasonCodes: [],
  };
}
