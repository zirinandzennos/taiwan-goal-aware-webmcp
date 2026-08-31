import { generateCandidateJourneys } from "./candidates";
import { evaluateJourneyFeasibility } from "./feasibility";
import { recommendJourneys } from "./ranking";
import type {
  CandidateFeasibility,
  CandidateJourney,
  JourneyOption,
  JourneyPlanResult,
  JourneyPlanningContext,
  JourneyRequest,
  RankedJourney,
} from "./types";

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
  };
}
