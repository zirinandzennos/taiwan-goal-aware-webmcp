import { generateCandidateJourneys } from "./candidates";
import { evaluateJourneyFeasibility } from "./feasibility";
import { candidateHasCompleteFare, recommendJourneys } from "./ranking";
import type {
  CandidateFeasibility,
  CandidateJourney,
  JourneyOption,
  JourneyPlanResult,
  JourneyPlanningContext,
  JourneyRequest,
  JourneyOptionCategory,
  JourneyOptionOverlap,
  JourneySelectionReason,
  RankedJourney,
} from "./types";

function attachOption(
  candidate: CandidateJourney | null,
  category: JourneyOptionCategory,
  selectionReasons: JourneySelectionReason[],
  feasibilityByCandidateId: ReadonlyMap<string, CandidateFeasibility>,
  context: JourneyPlanningContext,
): JourneyOption | null {
  if (!candidate) return null;
  const feasibility = feasibilityByCandidateId.get(candidate.id);
  if (!feasibility) throw new Error(`Missing feasibility for generated candidate: ${candidate.id}`);
  if (!candidate.steps || !candidate.journeyStartAt || !candidate.goalCompletedAt) {
    throw new Error(`Generated candidate is missing executable journey fields: ${candidate.id}`);
  }
  const fareCoverage = candidate.fareCoverage ?? "COMPLETE";
  const totalCost = fareCoverage === "COMPLETE"
    ? candidate.totalKnownCost ?? candidate.totalCost
    : null;
  const readableCategory = category === "BALANCED" ? "Balanced" : category[0] + category.slice(1).toLowerCase();
  return {
    optionId: `option:${category.toLowerCase()}:${candidate.id}`,
    category,
    candidateId: candidate.id,
    summary: `${readableCategory} journey completes the goal at ${candidate.goalCompletedAt}.`,
    steps: candidate.steps,
    journeyStartAt: candidate.journeyStartAt,
    goalCompletedAt: candidate.goalCompletedAt,
    totalDurationMinutes: candidate.totalDurationMinutes,
    initialWaitingMinutes: candidate.initialWaitingMinutes ?? 0,
    transferWaitingMinutes: candidate.transferWaitingMinutes ?? candidate.totalWaitingMinutes,
    totalWaitingMinutes: candidate.totalWaitingMinutes,
    totalRideMinutes: candidate.totalRideMinutes ?? 0,
    totalWalkingMinutes: candidate.totalWalkingMinutes,
    totalTransferBufferMinutes: candidate.totalTransferBufferMinutes ?? 0,
    transferCount: candidate.transferCount,
    minimumConnectionSlackMinutes: candidate.minimumTransferSlackMinutes,
    totalCost,
    fareCoverage,
    selectionReasons,
    timetableMode: context.timetableMode,
    dataProvenance: {
      ...(context.dataSnapshot?.snapshotId ? { snapshotId: context.dataSnapshot.snapshotId } : {}),
      sourceLabel: context.dataSnapshot?.sourceLabel ?? context.timetableMode,
      actualOperationsClaimed: context.dataSnapshot?.actualOperationsClaimed ?? false,
    },
    candidate,
    feasibility,
  };
}

function attachBalancedOption(
  ranked: RankedJourney | null,
  fastest: CandidateJourney | null,
  feasibilityByCandidateId: ReadonlyMap<string, CandidateFeasibility>,
  context: JourneyPlanningContext,
): JourneyOption | null {
  if (!ranked) return null;
  const reasons: JourneySelectionReason[] = ["LOWEST_BALANCED_SCORE"];
  if (!ranked.scoreBreakdown.costDimensionIncluded) reasons.push("FARE_COST_DIMENSION_EXCLUDED");
  if (fastest && ranked.candidate.id !== fastest.id) {
    if (ranked.candidate.transferCount < fastest.transferCount) reasons.push("FEWER_TRANSFERS_THAN_FASTEST");
    if (
      ranked.candidate.minimumTransferSlackMinutes !== null
      && (
        fastest.minimumTransferSlackMinutes === null
        || ranked.candidate.minimumTransferSlackMinutes > fastest.minimumTransferSlackMinutes
      )
    ) reasons.push("MORE_CONNECTION_SLACK_THAN_FASTEST");
    if (ranked.candidate.totalDurationMinutes - fastest.totalDurationMinutes <= 30) {
      reasons.push("MODEST_TIME_INCREASE");
    }
    if (ranked.candidate.totalWalkingMinutes < fastest.totalWalkingMinutes) {
      reasons.push("LOWER_WALKING_THAN_FASTEST");
    }
  }
  const option = attachOption(
    ranked.candidate,
    "BALANCED",
    reasons,
    feasibilityByCandidateId,
    context,
  );
  if (!option) return null;
  return {
    ...option,
    rank: ranked.rank,
    score: ranked.score,
    scoreBreakdown: ranked.scoreBreakdown,
  };
}

function overlaps(options: readonly JourneyOption[]): JourneyOptionOverlap[] {
  const categoriesByCandidate = new Map<string, JourneyOptionCategory[]>();
  for (const option of options) {
    const categories = categoriesByCandidate.get(option.candidateId) ?? [];
    categories.push(option.category);
    categoriesByCandidate.set(option.candidateId, categories);
  }
  return [...categoriesByCandidate.entries()]
    .filter(([, categories]) => categories.length > 1)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([candidateId, categories]) => ({ candidateId, categories }));
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
  const recommendations = recommendJourneys(candidates);
  const fastest = attachOption(
    recommendations.fastest,
    "FASTEST",
    ["EARLIEST_GOAL_COMPLETION"],
    feasibilityByCandidateId,
    context,
  );
  const balanced = attachBalancedOption(
    recommendations.balanced,
    recommendations.fastest,
    feasibilityByCandidateId,
    context,
  );
  const cheapest = attachOption(
    recommendations.cheapest,
    "CHEAPEST",
    ["LOWEST_COMPLETE_COST"],
    feasibilityByCandidateId,
    context,
  );
  const availableOptions = [fastest, balanced, cheapest].filter((option): option is JourneyOption => option !== null);
  const hasCompleteFareCandidate = candidates.some(candidateHasCompleteFare);

  return {
    status: feasibility.status,
    candidateCount: candidates.length,
    fastest,
    balanced,
    cheapest,
    optionAvailability: {
      fastest: { available: fastest !== null, reasonCodes: fastest ? [] : ["NO_EXECUTABLE_JOURNEY"] },
      balanced: { available: balanced !== null, reasonCodes: balanced ? [] : ["NO_EXECUTABLE_JOURNEY"] },
      cheapest: {
        available: cheapest !== null,
        reasonCodes: cheapest
          ? []
          : candidates.length > 0 && !hasCompleteFareCandidate
            ? ["FARE_DATA_UNAVAILABLE"]
            : ["NO_EXECUTABLE_JOURNEY"],
      },
    },
    overlaps: overlaps(availableOptions),
    reasonCodes: feasibility.reasonCodes,
    timetableMode: context.timetableMode,
    ...(request.goal ? { goalId: request.goal.id, goalDeadline: request.goal.deadlineAt } : {}),
  };
}
