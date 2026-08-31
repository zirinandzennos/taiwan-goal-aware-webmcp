import { journeyGoals } from "../data/demoGoals";
import type {
  JourneyConstraints,
  JourneyCurrentState,
  JourneyPolicyPreset,
  JourneyPreferences,
  TravelerState,
} from "../journey/types";
import type {
  JourneyProductPlan,
  RecommendationCategory,
} from "../application/journeyProduct.ts";

export interface SelectedJourneyState {
  selectedRecommendationCategory: RecommendationCategory;
  selectedCandidateId: string;
  selectedPlanVersion: number;
  selectedAt: string;
  currentStepId: string;
  currentStepIndex: number;
  executionStatus: "SELECTED" | "IN_PROGRESS" | "REPLAN_BLOCKED";
  staleFromStepIndex: number | null;
}

export interface JourneyProgressState {
  completedStepIndex: number;
  staleFromStepIndex: number | null;
  actualProgressEvidence: {
    stepId: string;
    actualCompletedAt: string;
    delayMinutes: number;
    currentLocationId: string;
  };
}

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
  latestProductPlan?: JourneyProductPlan;
  latestProductPlanStale?: boolean;
  selectedJourney?: SelectedJourneyState;
  progress?: JourneyProgressState;
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
  destinationId: "1020",
  departAt: "2026-08-31T11:30:00+08:00",
  preferences: { avoidTaxi: false },
  constraints: { allowedModes: ["THSR"], maxTransfers: 0 },
  travelerState: unknownPageTravelerState,
  policy: "BALANCED",
  currentState: { nodeId: "1060", at: "2026-08-31T11:49:00+08:00" },
};

let journeyPageState = structuredClone(defaultJourneyPageState);
let pageStateVersion = 1;

function planningInput(state: JourneyPageState): string {
  return JSON.stringify({
    goalId: state.goalId,
    originId: state.originId,
    destinationId: state.destinationId,
    departAt: state.departAt,
    arriveBy: state.arriveBy ?? null,
    preferences: state.preferences,
    constraints: state.constraints,
    travelerState: state.travelerState,
    policy: state.policy,
    currentState: state.currentState ?? null,
    progress: state.progress ?? null,
  });
}

export function setJourneyPageState(state: JourneyPageState): void {
  const changed = planningInput(state) !== planningInput(journeyPageState);
  journeyPageState = structuredClone(state);
  if (changed) {
    pageStateVersion += 1;
    if (journeyPageState.latestProductPlan) journeyPageState.latestProductPlanStale = true;
  }
}

export function getJourneyPageState(): JourneyPageState {
  return structuredClone(journeyPageState);
}

export function resetJourneyPageState(): void {
  journeyPageState = structuredClone(defaultJourneyPageState);
  pageStateVersion = 1;
}

export function getJourneyPageStateVersion(): number {
  return pageStateVersion;
}

export function initializeFixedJourneyProductState(scenario: {
  originId: string;
  destinationId: string;
  departAt: string;
  allowedModes: readonly import("../journey/types.ts").TransportMode[];
}): void {
  journeyPageState = {
    ...structuredClone(defaultJourneyPageState),
    originId: scenario.originId,
    destinationId: scenario.destinationId,
    departAt: scenario.departAt,
    constraints: { allowedModes: [...scenario.allowedModes], maxTransfers: 3 },
    currentState: undefined,
  };
  pageStateVersion = 1;
}

export function updateJourneyPageInputs(
  patch: Partial<Pick<JourneyPageState, "goalId" | "originId" | "destinationId" | "departAt" | "arriveBy" | "preferences" | "constraints" | "travelerState" | "policy" | "currentState">>,
): void {
  const current = getJourneyPageState();
  const next: JourneyPageState = {
    ...current,
    ...structuredClone(patch),
    ...(patch.preferences ? { preferences: { ...current.preferences, ...structuredClone(patch.preferences) } } : {}),
    ...(patch.constraints ? { constraints: { ...current.constraints, ...structuredClone(patch.constraints) } } : {}),
  };
  delete next.latestProductPlan;
  delete next.latestProductPlanStale;
  delete next.selectedJourney;
  delete next.progress;
  setJourneyPageState(next);
}

export function storeLatestProductPlan(plan: JourneyProductPlan): void {
  if (plan.identity.pageStateVersion !== pageStateVersion) throw new Error("Cannot store a stale journey plan");
  journeyPageState.latestProductPlan = structuredClone(plan);
  journeyPageState.latestProductPlanStale = false;
  delete journeyPageState.selectedJourney;
  delete journeyPageState.progress;
}

export function selectProductJourney(category: RecommendationCategory): void {
  const plan = journeyPageState.latestProductPlan;
  if (!plan || journeyPageState.latestProductPlanStale || plan.identity.pageStateVersion !== pageStateVersion) {
    throw new Error("A stale or missing journey plan cannot be selected");
  }
  const recommendation = plan.recommendations[category];
  const candidateId = recommendation.displayCandidateId;
  const firstStep = recommendation.journey?.steps?.[0];
  if (!candidateId || !recommendation.formalWinnerCandidateIds.includes(candidateId) || !firstStep) {
    throw new Error("Selected display journey is not an available formal winner");
  }
  journeyPageState.selectedJourney = {
    selectedRecommendationCategory: category,
    selectedCandidateId: candidateId,
    selectedPlanVersion: pageStateVersion,
    selectedAt: plan.identity.generatedAt,
    currentStepId: firstStep.id,
    currentStepIndex: 0,
    executionStatus: "SELECTED",
    staleFromStepIndex: null,
  };
}

export function completeSelectedStepEightMinutesLate(): void {
  const selected = journeyPageState.selectedJourney;
  const plan = journeyPageState.latestProductPlan;
  if (!selected || !plan) throw new Error("Select a journey before updating progress");
  if (journeyPageState.progress) throw new Error("The demonstrated progress event has already been recorded");
  const journey = plan.recommendations[selected.selectedRecommendationCategory].journey;
  const step = journey?.steps?.[selected.currentStepIndex];
  if (!step) throw new Error("Selected journey step is unavailable");
  const actualCompletedAt = new Date(Date.parse(step.plannedEnd) + 8 * 60_000).toISOString();
  const staleFromStepIndex = selected.currentStepIndex + 1 < (journey.steps?.length ?? 0)
    ? selected.currentStepIndex + 1
    : null;
  journeyPageState.progress = {
    completedStepIndex: selected.currentStepIndex,
    staleFromStepIndex,
    actualProgressEvidence: {
      stepId: step.id,
      actualCompletedAt,
      delayMinutes: 8,
      currentLocationId: step.to.id,
    },
  };
  journeyPageState.currentState = { nodeId: step.to.id, at: actualCompletedAt };
  journeyPageState.latestProductPlanStale = true;
  journeyPageState.selectedJourney = {
    ...selected,
    executionStatus: "IN_PROGRESS",
    staleFromStepIndex,
  };
  pageStateVersion += 1;
}

export function markSelectedReplanBlocked(): void {
  if (!journeyPageState.selectedJourney) return;
  journeyPageState.selectedJourney.executionStatus = "REPLAN_BLOCKED";
}

/** Compatibility for the earlier page-state demo; both functions now use the canonical store. */
export function setSelectedGoalId(goalId: string): void {
  setJourneyPageState({ ...getJourneyPageState(), goalId });
}

export function getCurrentPageState(): { selectedGoalId: string } {
  return { selectedGoalId: getJourneyPageState().goalId };
}
