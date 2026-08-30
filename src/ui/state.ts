import { journeyGoals } from "../data/demoGoals";
import type {
  JourneyConstraints,
  JourneyCurrentState,
  JourneyPolicyPreset,
  JourneyPreferences,
  TravelerState,
} from "../journey/types";

/** Live page-owned intent shared by the human UI and both WebMCP tools. */
export interface JourneyPageState {
  goalId: string;
  originId: string;
  destinationId: string;
  departAt: string;
  arriveBy?: string;
  preferences: JourneyPreferences & { avoidTaxi: boolean };
  constraints: JourneyConstraints;
  travelerState: TravelerState;
  policy: JourneyPolicyPreset;
  currentState?: JourneyCurrentState;
}

const unknownPageTravelerState: TravelerState = {
  luggage: { value: "UNKNOWN", source: "PAGE_STATE" },
  purpose: { value: "UNKNOWN", source: "PAGE_STATE" },
  speedPriority: { value: "UNKNOWN", source: "PAGE_STATE" },
  costSensitivity: { value: "UNKNOWN", source: "PAGE_STATE" },
  ownsCar: { value: "UNKNOWN", source: "PAGE_STATE" },
  ownsScooter: { value: "UNKNOWN", source: "PAGE_STATE" },
  canUseBike: { value: "UNKNOWN", source: "PAGE_STATE" },
  willingToUseTaxi: { value: "UNKNOWN", source: "PAGE_STATE" },
};

const defaultJourneyPageState: JourneyPageState = {
  goalId: journeyGoals[0].id,
  originId: "1070",
  destinationId: journeyGoals[0].destinationId,
  departAt: "2026-08-31T11:30:00+08:00",
  preferences: { avoidTaxi: true },
  constraints: { allowedModes: ["THSR"], maxTransfers: 0 },
  travelerState: unknownPageTravelerState,
  policy: "DEADLINE_CRITICAL",
};

let journeyPageState = structuredClone(defaultJourneyPageState);

export function setJourneyPageState(state: JourneyPageState): void {
  journeyPageState = structuredClone(state);
}

export function getJourneyPageState(): JourneyPageState {
  return structuredClone(journeyPageState);
}

export function resetJourneyPageState(): void {
  journeyPageState = structuredClone(defaultJourneyPageState);
}

/** Compatibility for the earlier page-state demo; both functions now use the canonical store. */
export function setSelectedGoalId(goalId: string): void {
  setJourneyPageState({ ...getJourneyPageState(), goalId });
}

export function getCurrentPageState(): { selectedGoalId: string } {
  return { selectedGoalId: getJourneyPageState().goalId };
}
