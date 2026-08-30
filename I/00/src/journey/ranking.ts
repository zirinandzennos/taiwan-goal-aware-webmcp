import { POLICY_WEIGHTS } from "./policies";
import type {
  CandidateJourney,
  JourneyRecommendations,
  JourneyScoreBreakdown,
  RankedJourney,
} from "./types";

type NumericMetric = (candidate: CandidateJourney) => number;
const BALANCED_WAITING_WEIGHT = 10;

function timestamp(value: string): number {
  return Date.parse(value);
}

export function candidateGoalCompletedAt(candidate: CandidateJourney): string {
  return candidate.goalCompletedAt ?? candidate.arriveAt;
}

export function candidateHasCompleteFare(candidate: CandidateJourney): boolean {
  return (candidate.fareCoverage ?? "COMPLETE") === "COMPLETE";
}

function comparableCost(candidate: CandidateJourney): number {
  return candidate.totalKnownCost ?? candidate.totalCost;
}

function compareFastest(first: CandidateJourney, second: CandidateJourney): number {
  return timestamp(candidateGoalCompletedAt(first)) - timestamp(candidateGoalCompletedAt(second))
    || first.totalDurationMinutes - second.totalDurationMinutes
    || first.transferCount - second.transferCount
    || first.totalWalkingMinutes - second.totalWalkingMinutes
    || first.id.localeCompare(second.id);
}

function compareCheapest(first: CandidateJourney, second: CandidateJourney): number {
  return comparableCost(first) - comparableCost(second)
    || timestamp(candidateGoalCompletedAt(first)) - timestamp(candidateGoalCompletedAt(second))
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

function riskPenalty(candidates: readonly CandidateJourney[]): NumericMetric {
  const slacks = candidates
    .map((candidate) => candidate.minimumTransferSlackMinutes)
    .filter((slack): slack is number => slack !== null);
  if (slacks.length === 0) {
    return minMaxPenalty(candidates, (candidate) => candidate.tightTransferCount);
  }
  const minimum = Math.min(...slacks);
  const maximum = Math.max(...slacks);
  const range = maximum - minimum;
  const rawRisk = (candidate: CandidateJourney): number => {
    const slackRisk = candidate.minimumTransferSlackMinutes === null || range === 0
      ? 0
      : (maximum - candidate.minimumTransferSlackMinutes) / range;
    return candidate.tightTransferCount * 2 + slackRisk;
  };
  return minMaxPenalty(candidates, rawRisk);
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
    costDimensionIncluded: boolean;
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
  const weightedWaiting = waitingPenalty * BALANCED_WAITING_WEIGHT;

  return {
    durationPenalty,
    costPenalty,
    transferPenalty,
    walkingPenalty,
    riskPenalty: riskPenaltyValue,
    waitingPenalty,
    costDimensionIncluded: penalties.costDimensionIncluded,
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
  return candidates.filter(candidateHasCompleteFare).sort(compareCheapest)[0] ?? null;
}

/**
 * Scores the five measurable BALANCED dimensions using candidate-set-relative
 * min-max penalties. Comfort and leisure have no deterministic metric in this
 * package, so their existing preset weights are intentionally not scored yet.
 */
export function rankBalancedJourneys(candidates: readonly CandidateJourney[]): RankedJourney[] {
  if (candidates.length === 0) return [];
  const costDimensionIncluded = candidates.every(candidateHasCompleteFare);
  const penalties = {
    duration: minMaxPenalty(candidates, (candidate) => candidate.totalDurationMinutes),
    cost: costDimensionIncluded
      ? minMaxPenalty(candidates, comparableCost)
      : () => 0,
    transfers: minMaxPenalty(candidates, (candidate) => candidate.transferCount),
    walking: minMaxPenalty(candidates, (candidate) => candidate.totalWalkingMinutes),
    risk: riskPenalty(candidates),
    waiting: minMaxPenalty(candidates, (candidate) => candidate.totalWaitingMinutes),
    costDimensionIncluded,
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
