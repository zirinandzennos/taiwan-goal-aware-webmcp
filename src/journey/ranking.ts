import { POLICY_WEIGHTS } from "./policies";
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

function compareFastest(first: CandidateJourney, second: CandidateJourney): number {
  return timestamp(first.arriveAt) - timestamp(second.arriveAt)
    || first.totalCost - second.totalCost
    || first.transferCount - second.transferCount
    || first.totalWalkingMinutes - second.totalWalkingMinutes
    || first.id.localeCompare(second.id);
}

function compareCheapest(first: CandidateJourney, second: CandidateJourney): number {
  return first.totalCost - second.totalCost
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

function riskPenalty(candidates: readonly CandidateJourney[]): NumericMetric {
  const slacks = candidates
    .map((candidate) => candidate.minimumTransferSlackMinutes)
    .filter((slack): slack is number => slack !== null);
  if (slacks.length === 0) return () => 0;
  const minimum = Math.min(...slacks);
  const maximum = Math.max(...slacks);
  if (minimum === maximum) return () => 0;

  return (candidate) => {
    if (candidate.minimumTransferSlackMinutes === null) return 0;
    return (maximum - candidate.minimumTransferSlackMinutes) / (maximum - minimum);
  };
}

function scoreCandidate(
  candidate: CandidateJourney,
  penalties: {
    duration: NumericMetric;
    cost: NumericMetric;
    transfers: NumericMetric;
    walking: NumericMetric;
    risk: NumericMetric;
  },
): JourneyScoreBreakdown {
  const weights = POLICY_WEIGHTS.BALANCED;
  const durationPenalty = penalties.duration(candidate);
  const costPenalty = penalties.cost(candidate);
  const transferPenalty = penalties.transfers(candidate);
  const walkingPenalty = penalties.walking(candidate);
  const riskPenaltyValue = penalties.risk(candidate);
  const weightedDuration = durationPenalty * weights.travelTime;
  const weightedCost = costPenalty * weights.monetaryCost;
  const weightedTransfers = transferPenalty * weights.transfers;
  const weightedWalking = walkingPenalty * weights.walking;
  const weightedRisk = riskPenaltyValue * weights.connectionRisk;

  return {
    durationPenalty,
    costPenalty,
    transferPenalty,
    walkingPenalty,
    riskPenalty: riskPenaltyValue,
    weightedDuration,
    weightedCost,
    weightedTransfers,
    weightedWalking,
    weightedRisk,
    totalScore: weightedDuration + weightedCost + weightedTransfers + weightedWalking + weightedRisk,
  };
}

/** Selects the earliest final arrival with deterministic, non-insertion-order ties. */
export function rankFastest(candidates: readonly CandidateJourney[]): CandidateJourney | null {
  return [...candidates].sort(compareFastest)[0] ?? null;
}

/** Selects the lowest total cost with deterministic, non-insertion-order ties. */
export function rankCheapest(candidates: readonly CandidateJourney[]): CandidateJourney | null {
  return [...candidates].sort(compareCheapest)[0] ?? null;
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
    cost: minMaxPenalty(candidates, (candidate) => candidate.totalCost),
    transfers: minMaxPenalty(candidates, (candidate) => candidate.transferCount),
    walking: minMaxPenalty(candidates, (candidate) => candidate.totalWalkingMinutes),
    risk: riskPenalty(candidates),
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
