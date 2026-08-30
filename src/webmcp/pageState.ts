import { getJourneyPageState } from "../ui/state";
import { findJourneyGoal } from "../data/demoGoals";
import type { JourneyReplanRequest, JourneyRequest } from "../journey/types";
import type { JourneyPageState } from "../ui/state";

export interface IncompletePageJourneyState {
  missingFields: string[];
}

function missingRequiredFields(state: JourneyPageState, includeCurrentState: boolean): string[] {
  const fields = [
    ["goalId", state.goalId],
    ["originId", state.originId],
    ["destinationId", state.destinationId],
    ["departAt", state.departAt],
  ] as const;
  const missing: string[] = fields
    .filter(([, value]) => value.trim().length === 0)
    .map(([field]) => field);

  if (includeCurrentState) {
    if (!state.currentState?.nodeId.trim()) missing.push("currentState.nodeId");
    if (!state.currentState?.at.trim()) missing.push("currentState.at");
  }
  return missing;
}

/** Reads the page-owned state at execution time; it does not query or mutate the DOM. */
export function getCurrentJourneyPageState(): JourneyPageState {
  return getJourneyPageState();
}

export function toJourneyRequest(
  state: JourneyPageState,
): JourneyRequest | IncompletePageJourneyState {
  const missingFields = missingRequiredFields(state, false);
  const goal = findJourneyGoal(state.goalId);
  if (!goal) missingFields.push("goalId");
  if (missingFields.length > 0) return { missingFields };

  return {
    originId: state.originId,
    destinationId: goal!.destinationId,
    origin: { text: state.originId, canonicalPlaceId: state.originId },
    destination: { text: goal!.destinationId, canonicalPlaceId: goal!.destinationId },
    departAt: state.departAt,
    travelerState: state.travelerState,
    preferences: state.preferences,
    policy: state.policy,
    constraints: {
      ...state.constraints,
      ...(state.arriveBy === undefined ? {} : { arriveBy: state.arriveBy }),
      avoidTaxi: state.preferences.avoidTaxi,
    },
    activities: [],
    goal: structuredClone(goal!),
  };
}

export function toJourneyReplanRequest(
  state: JourneyPageState,
): JourneyReplanRequest | IncompletePageJourneyState {
  const request = toJourneyRequest(state);
  if ("missingFields" in request) return request;

  const missingFields = missingRequiredFields(state, true);
  if (missingFields.length > 0) return { missingFields };

  return {
    originalRequest: request,
    currentState: state.currentState!,
  };
}
