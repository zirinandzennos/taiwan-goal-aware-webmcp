import { POLICY_WEIGHTS } from "./policies.ts";
import type {
  CandidateJourney,
  JourneyRecommendations,
  JourneyScoreBreakdown,
  RankedJourney,
} from "./types";

type NumericMetric = (candidate: CandidateJourney) => number;

function timestamp(value: string): number {
  return Date.parse(value);
}

function completeTotalCost(candidate: CandidateJourney): number {
  if ((candidate.costCoverage ?? "COMPLETE") !== "COMPLETE" || candidate.totalCost === null) {
    throw new Error(`Candidate ${candidate.id} does not have a complete fare`);
  }
  return candidate.totalCost;
}

export function compareFastest(first: CandidateJourney, second: CandidateJourney): number {
  return timestamp(first.goalCompletionAt ?? first.arriveAt) - timestamp(second.goalCompletionAt ?? second.arriveAt)
    || ((first.totalCost ?? Number.POSITIVE_INFINITY) - (second.totalCost ?? Number.POSITIVE_INFINITY))
    || first.transferCount - second.transferCount
    || first.totalWalkingMinutes - second.totalWalkingMinutes
    || first.id.localeCompare(second.id);
}

export function compareCheapest(first: CandidateJourney, second: CandidateJourney): number {
  return completeTotalCost(first) - completeTotalCost(second)
    || timestamp(first.arriveAt) - timestamp(second.arriveAt)
    || first.transferCount - second.transferCount
    || first.totalWalkingMinutes - second.totalWalkingMinutes
    || first.id.localeCompare(second.id);
}

function minMaxPenalty(candidates: readonly CandidateJourney[], metric: NumericMetric): NumericMetric {
  const values = candidates.map(metric);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) return () => 0;
  return (candidate) => (metric(candidate) - minimum) / (maximum - minimum);
}

export function calculateConnectionRiskPenalty(candidate: CandidateJourney): number {
  const slack = candidate.minimumTransferSlackMinutes;
  if (slack === null || slack >= 12) return 0;
  if (slack >= 8) return 0.33;
  if (slack >= 3) return 0.67;
  return 1;
}

function riskPenalty(candidates: readonly CandidateJourney[]): NumericMetric {
  return calculateConnectionRiskPenalty;
}

function completeCostPenalty(candidates: readonly CandidateJourney[]): NumericMetric {
  const complete = candidates.filter((candidate) => (candidate.costCoverage ?? "COMPLETE") === "COMPLETE");
  if (complete.length === 0) return () => 0;
  const knownPenalty = minMaxPenalty(complete, completeTotalCost);
  return (candidate) => (candidate.costCoverage ?? "COMPLETE") === "COMPLETE" ? knownPenalty(candidate) : 1;
}

function scoreCandidate(
  candidate: CandidateJourney,
  penalties: {
    duration: NumericMetric;
    cost: NumericMetric;
    transfers: NumericMetric;
    walking: NumericMetric;
    risk: NumericMetric;
    waiting: NumericMetric;
  },
): JourneyScoreBreakdown {
  const weights = POLICY_WEIGHTS.BALANCED;
  const durationPenalty = penalties.duration(candidate);
  const costPenalty = penalties.cost(candidate);
  const transferPenalty = penalties.transfers(candidate);
  const walkingPenalty = penalties.walking(candidate);
  const riskPenaltyValue = penalties.risk(candidate);
  const waitingPenalty = penalties.waiting(candidate);
  const weightedDuration = durationPenalty * weights.travelTime;
  const weightedCost = costPenalty * weights.monetaryCost;
  const weightedTransfers = transferPenalty * weights.transfers;
  const weightedWalking = walkingPenalty * weights.walking;
  const weightedRisk = riskPenaltyValue * weights.connectionRisk;
  const weightedWaiting = waitingPenalty * weights.waiting;

  return {
    durationPenalty,
    costPenalty,
    transferPenalty,
    walkingPenalty,
    riskPenalty: riskPenaltyValue,
    waitingPenalty,
    weightedDuration,
    weightedCost,
    weightedTransfers,
    weightedWalking,
    weightedRisk,
    weightedWaiting,
    totalScore: weightedDuration + weightedCost + weightedTransfers + weightedWalking + weightedRisk + weightedWaiting,
  };
}

/** Selects the earliest final arrival with deterministic, non-insertion-order ties. */
export function rankFastest(candidates: readonly CandidateJourney[]): CandidateJourney | null {
  return [...candidates].sort(compareFastest)[0] ?? null;
}

/** Selects the lowest total cost with deterministic, non-insertion-order ties. */
export function rankCheapest(candidates: readonly CandidateJourney[]): CandidateJourney | null {
  return candidates
    .filter((candidate) => (candidate.costCoverage ?? "COMPLETE") === "COMPLETE")
    .sort(compareCheapest)[0] ?? null;
}

/**
 * Scores the five measurable BALANCED dimensions using candidate-set-relative
 * min-max penalties. Comfort and leisure have no deterministic metric in this
 * package, so their existing preset weights are intentionally not scored yet.
 */
export function rankBalancedJourneys(candidates: readonly CandidateJourney[]): RankedJourney[] {
  if (candidates.length === 0) return [];
  const penalties = {
    duration: minMaxPenalty(candidates, (candidate) => candidate.totalDurationMinutes),
    cost: completeCostPenalty(candidates),
    transfers: minMaxPenalty(candidates, (candidate) => candidate.transferCount),
    walking: minMaxPenalty(candidates, (candidate) => candidate.totalWalkingMinutes),
    risk: riskPenalty(candidates),
    waiting: minMaxPenalty(candidates, (candidate) => candidate.totalWaitingMinutes),
  };

  return candidates
    .map((candidate) => ({ candidate, scoreBreakdown: scoreCandidate(candidate, penalties) }))
    .sort((first, second) => (
      first.scoreBreakdown.totalScore - second.scoreBreakdown.totalScore
      || compareFastest(first.candidate, second.candidate)
    ))
    .map((entry, index) => ({
      candidate: entry.candidate,
      rank: index + 1,
      score: entry.scoreBreakdown.totalScore,
      scoreBreakdown: entry.scoreBreakdown,
    }));
}

export function rankBalanced(candidates: readonly CandidateJourney[]): RankedJourney | null {
  return rankBalancedJourneys(candidates)[0] ?? null;
}

/** Ranking only: an empty result means no candidate, not an IMPOSSIBLE verdict. */
export function recommendJourneys(candidates: readonly CandidateJourney[]): JourneyRecommendations {
  return {
    fastest: rankFastest(candidates),
    cheapest: rankCheapest(candidates),
    balanced: rankBalanced(candidates),
  };
}
