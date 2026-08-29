import { demoGoals } from "../data/demoGoals";
import type {
  JourneyConstraints,
  JourneyCurrentState,
  JourneyPolicyPreset,
  JourneyPreferences,
  TravelerState,
} from "../journey/types";

let selectedGoalId = demoGoals[0].id;
export function setSelectedGoalId(goalId: string): void { selectedGoalId = goalId; }
export function getCurrentPageState(): { selectedGoalId: string } { return { selectedGoalId }; }

/**
 * Live, page-owned state for the synthetic Journey challenge. A later UI can
 * update this store without changing the WebMCP adapter or journey engine.
 */
export interface JourneyPageState {
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
  originId: "kaohsiung-xiaogang",
  destinationId: "taoyuan-bade",
  departAt: "2030-06-15T07:00:00+08:00",
  preferences: { avoidTaxi: false },
  constraints: {},
  travelerState: unknownPageTravelerState,
  policy: "BALANCED",
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
