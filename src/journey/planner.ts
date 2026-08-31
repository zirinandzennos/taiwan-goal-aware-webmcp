import { generateCandidateJourneys } from "./candidates";
import { evaluateJourneyFeasibility } from "./feasibility";
import { compareCheapest, compareFastest, rankBalancedJourneys, recommendJourneys } from "./ranking";
import type {
  CandidateFeasibility,
  CandidateJourney,
  JourneyOption,
  JourneyPlanResult,
  JourneyPlanningContext,
  JourneyRequest,
  RankedJourney,
  JourneyRecommendationMetadata,
} from "./types";

function recommendationMetadata(
  winners: readonly CandidateJourney[],
  effectiveCandidateCount: number,
  context: JourneyPlanningContext,
  blockerReasonCode: string | null = null,
): JourneyRecommendationMetadata {
  const selectedRepresentativeId = winners[0]?.id ?? null;
  return {
    status: selectedRepresentativeId === null ? "UNAVAILABLE" : "AVAILABLE",
    winnerCandidateIds: winners.map((candidate) => candidate.id),
    selectedRepresentativeId,
    unique: winners.length === 1,
    proofStatus: "DETERMINISTIC_ENGINE_RESULT",
    evidenceIds: context.dataSnapshot ? [context.dataSnapshot.snapshotId] : [],
    dataMode: context.dataSnapshot ? "SNAPSHOT" : "FIXTURE",
    farePolicy: "COMPLETE_PUBLISHED_FARES_ONLY",
    effectiveCandidateCount,
    blocker: selectedRepresentativeId === null ? { reasonCode: blockerReasonCode ?? "NO_ELIGIBLE_CANDIDATE" } : null,
  };
}

function attachOption(
  candidate: CandidateJourney | null,
  feasibilityByCandidateId: ReadonlyMap<string, CandidateFeasibility>,
): JourneyOption | null {
  if (!candidate) return null;
  const feasibility = feasibilityByCandidateId.get(candidate.id);
  if (!feasibility) throw new Error(`Missing feasibility for generated candidate: ${candidate.id}`);
  return { candidate, feasibility };
}

function attachBalancedOption(
  ranked: RankedJourney | null,
  feasibilityByCandidateId: ReadonlyMap<string, CandidateFeasibility>,
): JourneyOption | null {
  if (!ranked) return null;
  const feasibility = feasibilityByCandidateId.get(ranked.candidate.id);
  if (!feasibility) throw new Error(`Missing feasibility for generated candidate: ${ranked.candidate.id}`);
  return {
    candidate: ranked.candidate,
    feasibility,
    rank: ranked.rank,
    score: ranked.score,
    scoreBreakdown: ranked.scoreBreakdown,
  };
}

/**
 * Pure Journey Engine entry point. It composes existing generation,
 * feasibility, and ranking contracts without altering their algorithms.
 */
export function planJourney(
  request: JourneyRequest,
  context: JourneyPlanningContext,
): JourneyPlanResult {
  const candidates = generateCandidateJourneys(request, context.timetable, context.transferRules, context.timetableStore);
  const feasibility = evaluateJourneyFeasibility(candidates, request, context);
  const feasibilityByCandidateId = new Map(
    feasibility.candidateFeasibilities.map((result) => [result.candidateId, result]),
  );
  const recommendableCandidates = candidates.filter((candidate) => {
    const status = feasibilityByCandidateId.get(candidate.id)?.status;
    return status === "FEASIBLE" || status === "RISKY";
  });
  const recommendations = recommendJourneys(recommendableCandidates);
  const fastestValue = recommendations.fastest?.goalCompletionAt ?? recommendations.fastest?.arriveAt ?? null;
  const fastestWinners = fastestValue === null ? [] : recommendableCandidates
    .filter((candidate) => (candidate.goalCompletionAt ?? candidate.arriveAt) === fastestValue)
    .sort(compareFastest);
  const cheapestValue = recommendations.cheapest?.totalCost ?? null;
  const cheapestWinners = cheapestValue === null ? [] : recommendableCandidates
    .filter((candidate) => (candidate.costCoverage ?? "COMPLETE") === "COMPLETE" && candidate.totalCost === cheapestValue)
    .sort(compareCheapest);
  const balancedRanked = rankBalancedJourneys(recommendableCandidates);
  const balancedScore = balancedRanked[0]?.score ?? null;
  const balancedWinners = balancedScore === null ? [] : balancedRanked
    .filter((entry) => entry.score === balancedScore)
    .map((entry) => entry.candidate);
  const selectionReasonCodes = recommendableCandidates.length > 0 && recommendations.cheapest === null
    ? ["NO_COMPLETE_FARE_CANDIDATE" as const]
    : [];

  return {
    status: feasibility.status,
    candidateCount: candidates.length,
    fastest: attachOption(recommendations.fastest, feasibilityByCandidateId),
    cheapest: attachOption(recommendations.cheapest, feasibilityByCandidateId),
    balanced: attachBalancedOption(recommendations.balanced, feasibilityByCandidateId),
    reasonCodes: feasibility.reasonCodes,
    timetableMode: context.timetableMode,
    ...(request.goal ? { goalId: request.goal.id, goalDeadline: request.goal.deadlineAt } : {}),
    ...(selectionReasonCodes.length > 0 ? { selectionReasonCodes } : {}),
    recommendationMetadata: {
      fastest: recommendationMetadata(fastestWinners, recommendableCandidates.length, context),
      balanced: recommendationMetadata(balancedWinners, recommendableCandidates.length, context),
      cheapest: recommendationMetadata(cheapestWinners, recommendableCandidates.length, context, "NO_COMPLETE_FARE_CANDIDATE"),
    },
  };
}
