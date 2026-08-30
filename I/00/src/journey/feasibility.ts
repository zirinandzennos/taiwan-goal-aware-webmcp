import {
  DEFAULT_ARRIVAL_SAFETY_BUFFER_MINUTES,
  TIGHT_TRANSFER_SLACK_MINUTES,
} from "./policies";
import { parseExplicitIsoTimestamp } from "./timetable";
import type {
  CandidateFeasibility,
  CandidateJourney,
  JourneyFeasibilityContext,
  JourneyFeasibilityReasonCode,
  JourneyFeasibilityResult,
  JourneyRequest,
} from "./types";

interface DeadlineResolution {
  deadlineAt: string | null;
  deadlineMs: number | null;
  unknownReason?: JourneyFeasibilityReasonCode;
}

function resolveDeadline(
  request: JourneyRequest,
  context: JourneyFeasibilityContext | undefined,
): DeadlineResolution {
  if (request.goal) {
    if (!request.goal.deadlineVerified || request.goal.deadlineAt === null) {
      return { deadlineAt: request.goal.deadlineAt, deadlineMs: null, unknownReason: "GOAL_DEADLINE_UNVERIFIED" };
    }
    const deadlineMs = parseExplicitIsoTimestamp(request.goal.deadlineAt);
    if (deadlineMs === null) return { deadlineAt: request.goal.deadlineAt, deadlineMs: null, unknownReason: "INVALID_REQUIRED_TIMESTAMP" };
    return { deadlineAt: request.goal.deadlineAt, deadlineMs };
  }
  const deadlineRequired = request.constraints.arriveBy !== undefined
    || context?.deadlineRequired === true
    || context?.deadlineAt !== undefined;
  if (!deadlineRequired) return { deadlineAt: null, deadlineMs: null };
  if (context?.deadlineAvailability === "UNAVAILABLE") {
    return { deadlineAt: null, deadlineMs: null, unknownReason: "REQUIRED_DEADLINE_UNAVAILABLE" };
  }

  const deadlineAt = request.constraints.arriveBy ?? context?.deadlineAt ?? null;
  if (deadlineAt === null) {
    return { deadlineAt: null, deadlineMs: null, unknownReason: "REQUIRED_DEADLINE_UNAVAILABLE" };
  }

  const deadlineMs = parseExplicitIsoTimestamp(deadlineAt);
  if (deadlineMs === null) {
    return { deadlineAt, deadlineMs: null, unknownReason: "INVALID_REQUIRED_TIMESTAMP" };
  }
  return { deadlineAt, deadlineMs };
}

function unavailableCandidate(
  candidate: CandidateJourney,
  deadline: DeadlineResolution,
  reasonCode: JourneyFeasibilityReasonCode,
): CandidateFeasibility {
  return {
    candidateId: candidate.id,
    status: "UNKNOWN",
    arrivalAt: candidate.arriveAt,
    deadlineAt: deadline.deadlineAt,
    deadlineMarginMinutes: null,
    goalReadyAt: null,
    safetyMarginMinutes: null,
    minimumTransferSlackMinutes: candidate.minimumTransferSlackMinutes,
    reasonCodes: [reasonCode],
  };
}

/**
 * Evaluates a complete candidate against known hard requirements. It never
 * creates routes, ranks options, or interprets an optional deadline as missing.
 */
export function evaluateCandidateFeasibility(
  candidate: CandidateJourney,
  request: JourneyRequest,
  context?: JourneyFeasibilityContext,
): CandidateFeasibility {
  const deadline = resolveDeadline(request, context);
  if (context?.journeyDataAvailability === "UNAVAILABLE") {
    return unavailableCandidate(candidate, deadline, "REQUIRED_JOURNEY_DATA_UNAVAILABLE");
  }
  if (deadline.unknownReason) return unavailableCandidate(candidate, deadline, deadline.unknownReason);

  const arrivalMs = parseExplicitIsoTimestamp(candidate.arriveAt);
  if (arrivalMs === null) return unavailableCandidate(candidate, deadline, "INVALID_REQUIRED_TIMESTAMP");

  const explicitGoalCompletedMs = candidate.goalCompletedAt
    ? parseExplicitIsoTimestamp(candidate.goalCompletedAt)
    : null;
  if (candidate.goalCompletedAt && explicitGoalCompletedMs === null) {
    return unavailableCandidate(candidate, deadline, "INVALID_REQUIRED_TIMESTAMP");
  }
  const compatibilityGoalDuration = request.goal?.completion
    ? request.goal.completion.access.durationMinutes + (request.goal.completion.actionDurationMinutes ?? 0)
    : request.goal?.goalActionBufferMinutes ?? 0;
  const goalReadyMs = explicitGoalCompletedMs ?? arrivalMs + compatibilityGoalDuration * 60_000;
  const goalReadyAt = candidate.goalCompletedAt ?? new Date(goalReadyMs).toISOString();
  const deadlineMarginMinutes = deadline.deadlineMs === null
    ? null
    : Math.round((deadline.deadlineMs - goalReadyMs) / 60_000);
  if (deadlineMarginMinutes !== null && deadlineMarginMinutes < 0) {
    return {
      candidateId: candidate.id,
      status: "IMPOSSIBLE",
      arrivalAt: candidate.arriveAt,
      deadlineAt: deadline.deadlineAt,
      deadlineMarginMinutes,
      goalReadyAt,
      safetyMarginMinutes: deadlineMarginMinutes,
      minimumTransferSlackMinutes: candidate.minimumTransferSlackMinutes,
      reasonCodes: ["ARRIVAL_AFTER_HARD_DEADLINE"],
    };
  }

  const riskCodes: JourneyFeasibilityReasonCode[] = [];
  const requiredSafetyBufferMinutes = request.goal?.requiredSafetyBufferMinutes ?? DEFAULT_ARRIVAL_SAFETY_BUFFER_MINUTES;
  if (deadlineMarginMinutes !== null && deadlineMarginMinutes < requiredSafetyBufferMinutes) {
    riskCodes.push("INSUFFICIENT_ARRIVAL_BUFFER");
  }
  if (
    candidate.tightTransferCount > 0
    || (candidate.minimumTransferSlackMinutes !== null
      && candidate.minimumTransferSlackMinutes < TIGHT_TRANSFER_SLACK_MINUTES)
  ) {
    riskCodes.push("TIGHT_TRANSFER");
  }
  if (riskCodes.length > 0) {
    return {
      candidateId: candidate.id,
      status: "RISKY",
      arrivalAt: candidate.arriveAt,
      deadlineAt: deadline.deadlineAt,
      deadlineMarginMinutes,
      goalReadyAt,
      safetyMarginMinutes: deadlineMarginMinutes,
      minimumTransferSlackMinutes: candidate.minimumTransferSlackMinutes,
      reasonCodes: riskCodes,
    };
  }

  return {
    candidateId: candidate.id,
    status: "FEASIBLE",
    arrivalAt: candidate.arriveAt,
    deadlineAt: deadline.deadlineAt,
    deadlineMarginMinutes,
    goalReadyAt,
    safetyMarginMinutes: deadlineMarginMinutes,
    minimumTransferSlackMinutes: candidate.minimumTransferSlackMinutes,
    reasonCodes: [deadline.deadlineAt === null ? "JOURNEY_MEETS_CONSTRAINTS" : "MEETS_DEADLINE_WITH_BUFFER"],
  };
}

function uniqueReasonCodes(results: readonly CandidateFeasibility[]): JourneyFeasibilityReasonCode[] {
  return [...new Set(results.flatMap((result) => result.reasonCodes))];
}

/**
 * Aggregates candidate facts without treating ranking quality as feasibility.
 * An empty, complete timetable is IMPOSSIBLE; an unavailable timetable is UNKNOWN.
 */
export function evaluateJourneyFeasibility(
  candidates: readonly CandidateJourney[],
  request: JourneyRequest,
  context?: JourneyFeasibilityContext,
): JourneyFeasibilityResult {
  const deadline = resolveDeadline(request, context);
  const candidateFeasibilities = candidates.map((candidate) => evaluateCandidateFeasibility(candidate, request, context));
  if (context?.journeyDataAvailability === "UNAVAILABLE") {
    return { status: "UNKNOWN", candidateFeasibilities, reasonCodes: ["REQUIRED_JOURNEY_DATA_UNAVAILABLE"] };
  }
  if (deadline.unknownReason) {
    return { status: "UNKNOWN", candidateFeasibilities, reasonCodes: [deadline.unknownReason] };
  }
  if (candidates.length === 0) {
    return { status: "IMPOSSIBLE", candidateFeasibilities: [], reasonCodes: ["NO_EXECUTABLE_JOURNEY"] };
  }

  const reasonCodes = uniqueReasonCodes(candidateFeasibilities);
  if (candidateFeasibilities.some((result) => result.status === "FEASIBLE")) {
    return { status: "FEASIBLE", candidateFeasibilities, reasonCodes };
  }
  if (candidateFeasibilities.some((result) => result.status === "RISKY")) {
    return { status: "RISKY", candidateFeasibilities, reasonCodes };
  }
  if (candidateFeasibilities.some((result) => result.status === "UNKNOWN")) {
    return { status: "UNKNOWN", candidateFeasibilities, reasonCodes };
  }
  return { status: "IMPOSSIBLE", candidateFeasibilities, reasonCodes };
}
