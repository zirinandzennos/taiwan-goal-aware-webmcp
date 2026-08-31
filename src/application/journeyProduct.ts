import snapshotJson from "../../data/snapshots/2026-08-31_2026-09-06/maas-candidates.json";
import proofJson from "../../data/snapshots/2026-08-31_2026-09-06/optimization-proof.json";
import {
  evaluateFormalRecommendationGates,
  type CandidateOptimizationEvidence,
  type CandidateResolution,
  type EffectiveResolutionCounts,
  type FormalRecommendationGate,
} from "../journey/modeValidation.ts";
import type { CandidateJourney, JourneyStep, TransportMode } from "../journey/types.ts";
import type { JourneyPageState } from "../ui/state.ts";

export type RecommendationCategory = "FASTEST" | "BALANCED" | "CHEAPEST";
export type ProductPlanStatus = "AVAILABLE" | "UNAVAILABLE";

export interface JourneyPlanIdentity {
  requestFingerprint: string;
  snapshotId: string;
  candidateSetHash: string;
  optimizationProofHash: string;
  pageStateVersion: number;
  dataMode: "SNAPSHOT";
  generatedAt: string;
}

export interface RecommendationPresentation {
  category: RecommendationCategory;
  status: "AVAILABLE" | "UNAVAILABLE";
  formalWinnerCandidateIds: string[];
  formalRepresentativeId: string | null;
  displayCandidateId: string | null;
  tiedWinnerCount: number;
  unique: boolean;
  overlappingCategoryLabels: RecommendationCategory[];
  reasonCode: string;
  score: number | null;
  evidenceIds: string[];
  journey: CandidateJourney | null;
}

export interface JourneyProductPlan {
  status: ProductPlanStatus;
  reasonCode: "ALL_PRIMARY_RECOMMENDATIONS_AVAILABLE" | "UNSUPPORTED_SNAPSHOT_REQUEST";
  identity: JourneyPlanIdentity;
  effectiveCandidateCounts: EffectiveResolutionCounts;
  recommendations: Record<RecommendationCategory, RecommendationPresentation>;
  normalizedResultHash: string;
  snapshotDisclaimer: string;
}

export interface JourneyProductReplanResult {
  status: "UNAVAILABLE";
  reasonCode: "REPLAN_UNAVAILABLE_FOR_SNAPSHOT_STATE";
  previousPlanId: string | null;
  supersededPlanVersion: number | null;
  replanReason: "ACTUAL_STEP_COMPLETION_DELAY";
  actualProgressEvidence: {
    stepId: string;
    actualCompletedAt: string;
    delayMinutes: number;
    currentLocationId: string;
  } | null;
}

type SnapshotShape = {
  retrievedAt: string;
  origin: { id: string; name: string };
  destination: { id: string; name: string };
  depart: string;
  candidates: CandidateJourney[];
  primaryCandidateResolutions: CandidateResolution[];
  effectiveResolutionCounts: EffectiveResolutionCounts;
};

type ProofShape = {
  generatedAt: string;
  candidates: CandidateOptimizationEvidence[];
};

const snapshot = snapshotJson as SnapshotShape;
const proof = proofJson as ProofShape;
const SNAPSHOT_ID = "tdx-maas-20260831-journey-proof-v1";
const SNAPSHOT_DISCLAIMER = "Official transportation-data snapshot · 2026-08-31 to 2026-09-06 · Asia/Taipei · Not live operational guidance";
const SUPPORTED_MODES: TransportMode[] = ["WALK", "TRA", "THSR"];

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, entry]) => [key, normalize(entry)]));
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

/** Small deterministic content identifier suitable for browser and Node parity checks. */
export function deterministicHash(value: unknown): string {
  const text = typeof value === "string" ? value : stableJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function requestIdentityInput(state: JourneyPageState): Record<string, unknown> {
  return {
    originId: state.originId,
    destinationId: state.destinationId,
    goalId: state.goalId,
    departAt: state.departAt,
    allowedModes: [...(state.constraints.allowedModes ?? [])].sort(),
    preferences: state.preferences,
    currentState: state.currentState ?? null,
    currentProgress: state.progress ?? null,
  };
}

export function requestFingerprint(state: JourneyPageState): string {
  return deterministicHash(requestIdentityInput(state));
}

function isSupportedRequest(state: JourneyPageState): boolean {
  const allowedModes = [...(state.constraints.allowedModes ?? [])].sort();
  return state.originId === snapshot.origin.id
    && state.destinationId === snapshot.destination.id
    && state.goalId === "ENTER_XPARK"
    && state.departAt === snapshot.depart
    && stableJson(allowedModes) === stableJson([...SUPPORTED_MODES].sort())
    && state.preferences.avoidTaxi === false
    && state.currentState === undefined
    && state.progress === undefined;
}

function gateForCategory(
  gates: ReturnType<typeof evaluateFormalRecommendationGates>,
  category: RecommendationCategory,
): FormalRecommendationGate {
  if (category === "FASTEST") return gates.fastest;
  if (category === "BALANCED") return gates.balanced;
  return gates.cheapest;
}

export function allocateDisplayCandidates(
  gates: ReturnType<typeof evaluateFormalRecommendationGates>,
): Record<RecommendationCategory, string | null> {
  const used = new Set<string>();
  const choose = (category: RecommendationCategory): string | null => {
    const gate = gateForCategory(gates, category);
    const winners = [...(gate.winnerCandidateIds ?? [])].sort();
    const unused = winners.find((candidateId) => !used.has(candidateId));
    const selected = unused ?? gate.selectedRepresentativeId ?? winners[0] ?? null;
    if (selected) used.add(selected);
    return selected;
  };
  const balanced = choose("BALANCED");
  const fastest = choose("FASTEST");
  const cheapest = choose("CHEAPEST");
  return { FASTEST: fastest, BALANCED: balanced, CHEAPEST: cheapest };
}

function evidenceIds(candidateIds: readonly string[]): string[] {
  const wanted = new Set(candidateIds);
  return [...new Set(proof.candidates
    .filter((candidate) => wanted.has(candidate.candidateId))
    .flatMap((candidate) => candidate.sourceEvidenceIds))].sort();
}

function emptyRecommendations(): Record<RecommendationCategory, RecommendationPresentation> {
  const empty = (category: RecommendationCategory): RecommendationPresentation => ({
    category,
    status: "UNAVAILABLE",
    formalWinnerCandidateIds: [],
    formalRepresentativeId: null,
    displayCandidateId: null,
    tiedWinnerCount: 0,
    unique: false,
    overlappingCategoryLabels: [],
    reasonCode: "UNSUPPORTED_SNAPSHOT_REQUEST",
    score: null,
    evidenceIds: [],
    journey: null,
  });
  return { FASTEST: empty("FASTEST"), BALANCED: empty("BALANCED"), CHEAPEST: empty("CHEAPEST") };
}

function buildIdentity(state: JourneyPageState, pageStateVersion: number): JourneyPlanIdentity {
  return {
    requestFingerprint: requestFingerprint(state),
    snapshotId: SNAPSHOT_ID,
    candidateSetHash: deterministicHash(snapshot.candidates),
    optimizationProofHash: deterministicHash(proofJson),
    pageStateVersion,
    dataMode: "SNAPSHOT",
    generatedAt: proof.generatedAt,
  };
}

export function planJourneyFromPageState(state: JourneyPageState, pageStateVersion: number): JourneyProductPlan {
  const identity = buildIdentity(state, pageStateVersion);
  if (!isSupportedRequest(state)) {
    const unavailable = {
      status: "UNAVAILABLE" as const,
      reasonCode: "UNSUPPORTED_SNAPSHOT_REQUEST" as const,
      identity,
      effectiveCandidateCounts: snapshot.effectiveResolutionCounts,
      recommendations: emptyRecommendations(),
      snapshotDisclaimer: SNAPSHOT_DISCLAIMER,
    };
    return { ...unavailable, normalizedResultHash: deterministicHash(unavailable) };
  }

  const gates = evaluateFormalRecommendationGates(snapshot.candidates, snapshot.primaryCandidateResolutions, proof.candidates);
  const displayIds = allocateDisplayCandidates(gates);
  const candidateById = new Map(snapshot.candidates.map((candidate) => [candidate.id, candidate]));
  const categories: RecommendationCategory[] = ["FASTEST", "BALANCED", "CHEAPEST"];
  const recommendations = Object.fromEntries(categories.map((category) => {
    const gate = gateForCategory(gates, category);
    const winners = [...(gate.winnerCandidateIds ?? [])];
    const displayCandidateId = displayIds[category];
    const overlappingCategoryLabels = categories.filter((other) => {
      const otherWinners = gateForCategory(gates, other).winnerCandidateIds ?? [];
      return displayCandidateId !== null && otherWinners.includes(displayCandidateId);
    });
    const recommendation: RecommendationPresentation = {
      category,
      status: gate.available ? "AVAILABLE" : "UNAVAILABLE",
      formalWinnerCandidateIds: winners,
      formalRepresentativeId: gate.selectedRepresentativeId ?? null,
      displayCandidateId,
      tiedWinnerCount: Math.max(0, winners.length - 1),
      unique: gate.unique ?? false,
      overlappingCategoryLabels,
      reasonCode: gate.reasonCode,
      score: gate.score ?? null,
      evidenceIds: evidenceIds(winners),
      journey: displayCandidateId ? candidateById.get(displayCandidateId) ?? null : null,
    };
    return [category, recommendation];
  })) as unknown as Record<RecommendationCategory, RecommendationPresentation>;
  const available = {
    status: "AVAILABLE" as const,
    reasonCode: "ALL_PRIMARY_RECOMMENDATIONS_AVAILABLE" as const,
    identity,
    effectiveCandidateCounts: snapshot.effectiveResolutionCounts,
    recommendations,
    snapshotDisclaimer: SNAPSHOT_DISCLAIMER,
  };
  return { ...available, normalizedResultHash: deterministicHash(available) };
}

export function compactJourneyProductPlan(plan: JourneyProductPlan): Record<string, unknown> {
  const recommendations = Object.fromEntries((Object.keys(plan.recommendations) as RecommendationCategory[]).map((category) => {
    const recommendation = plan.recommendations[category];
    const journey = recommendation.journey;
    return [category.toLowerCase(), {
      status: recommendation.status,
      winnerCandidateIds: recommendation.formalWinnerCandidateIds,
      formalRepresentativeId: recommendation.formalRepresentativeId,
      displayCandidateId: recommendation.displayCandidateId,
      unique: recommendation.unique,
      tiedWinnerCount: recommendation.tiedWinnerCount,
      journey: journey ? {
        candidateId: journey.id,
        departAt: journey.departAt,
        goalCompletionAt: journey.goalCompletionAt ?? journey.arriveAt,
        totalDurationMinutes: journey.totalDurationMinutes,
        totalCostTwd: journey.totalCost,
        walkingMinutes: journey.totalWalkingMinutes,
        waitingMinutes: journey.totalWaitingMinutes,
        transferCount: journey.transferCount,
        minimumConnectionSlackMinutes: journey.minimumTransferSlackMinutes,
        steps: (journey.steps ?? []).map((step) => ({
          id: step.id,
          type: step.type,
          from: step.from.name,
          to: step.to.name,
          plannedStart: step.plannedStart,
          plannedEnd: step.plannedEnd,
          mode: step.service?.mode ?? null,
          service: step.service?.trainNo ?? step.service?.routeId ?? null,
        })),
      } : null,
      blocker: recommendation.status === "UNAVAILABLE" ? { reasonCode: recommendation.reasonCode } : null,
      proofStatus: recommendation.reasonCode,
      evidenceIds: recommendation.evidenceIds,
    }];
  }));
  return {
    status: plan.status,
    reasonCode: plan.reasonCode,
    requestIdentity: plan.identity,
    normalizedResultHash: plan.normalizedResultHash,
    dataMode: plan.identity.dataMode,
    effectiveCandidateCounts: plan.effectiveCandidateCounts,
    recommendations,
    snapshotDisclaimer: plan.snapshotDisclaimer,
  };
}

export function replanSelectedSnapshotJourney(state: JourneyPageState): JourneyProductReplanResult {
  return {
    status: "UNAVAILABLE",
    reasonCode: "REPLAN_UNAVAILABLE_FOR_SNAPSHOT_STATE",
    previousPlanId: state.latestProductPlan?.normalizedResultHash ?? null,
    supersededPlanVersion: state.latestProductPlan?.identity.pageStateVersion ?? null,
    replanReason: "ACTUAL_STEP_COMPLETION_DELAY",
    actualProgressEvidence: state.progress?.actualProgressEvidence ?? null,
  };
}

export function journeyStepStatus(_step: JourneyStep, index: number, state: JourneyPageState): "COMPLETED" | "CURRENT" | "STALE" | "PLANNED" {
  const progress = state.progress;
  if (!progress) return index === 0 ? "CURRENT" : "PLANNED";
  if (index <= progress.completedStepIndex) return "COMPLETED";
  if (progress.staleFromStepIndex !== null && index >= progress.staleFromStepIndex) return "STALE";
  return index === progress.completedStepIndex + 1 ? "CURRENT" : "PLANNED";
}

export function recommendationTieLabel(recommendation: RecommendationPresentation): string {
  if (recommendation.category === "CHEAPEST" && recommendation.formalWinnerCandidateIds.length === 4) {
    return "All four valid journeys share the same NT$1,341 fare.";
  }
  if (recommendation.unique) return `Unique ${recommendation.category === "BALANCED" ? "Balanced" : recommendation.category.toLowerCase()} recommendation`;
  return `Tied ${recommendation.category.toLowerCase()} with ${recommendation.tiedWinnerCount} other journey${recommendation.tiedWinnerCount === 1 ? "" : "s"}`;
}

export function recommendationBadgeLabel(recommendation: RecommendationPresentation): string {
  return recommendation.category === "BALANCED" ? "RECOMMENDED" : recommendation.status;
}

export const fixedJourneyProductScenario = {
  originId: snapshot.origin.id,
  originName: snapshot.origin.name,
  destinationId: snapshot.destination.id,
  destinationName: snapshot.destination.name,
  departAt: snapshot.depart,
  allowedModes: SUPPORTED_MODES,
  snapshotId: SNAPSHOT_ID,
  disclaimer: SNAPSHOT_DISCLAIMER,
} as const;
