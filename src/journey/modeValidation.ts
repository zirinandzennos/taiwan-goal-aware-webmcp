import { validateJourneyConnections, type ConnectionValidationResult } from "./connectionValidator.ts";
import {
  calculateConnectionRiskPenalty,
  compareCheapest,
  compareFastest,
  rankBalanced,
  rankBalancedJourneys,
  rankCheapest,
  rankFastest,
} from "./ranking.ts";
import type {
  CandidateJourney,
  CostCoverage,
  JourneyStep,
  ModeValidationEvidence,
} from "./types.ts";

export type CandidateTerminalResolution =
  | "VALIDATED_FEASIBLE"
  | "VALIDATED_RISKY"
  | "VALIDATED_IMPOSSIBLE"
  | "UNKNOWN";

export interface CandidateResolution {
  candidateId: string;
  resolution: CandidateTerminalResolution;
  reasonCodes: string[];
  timedLegsComplete: boolean;
  fareComplete: boolean;
  connection: ConnectionValidationResult;
}

export interface RailServiceQuery {
  mode: "THSR" | "TRA";
  serviceDate: string;
  trainNo: string | null;
  serviceRouteName?: string | null;
  originStationId: string;
  destinationStationId: string;
  plannedDeparture: string;
  plannedArrival: string;
}

export interface NormalizedRailTimetable {
  serviceDate: string;
  trainNo: string;
  serviceRouteName?: string | null;
  trainTypeName?: string | null;
  originStationId: string;
  destinationStationId: string;
  originStopSequence: number;
  destinationStopSequence: number;
  departure: string;
  arrival: string;
  cancelled?: boolean;
  overnight?: boolean;
}

export interface NormalizedFareOption {
  fareTwd: number;
  passengerType: string;
  ticketType: string;
  fareClass: string;
  cabinClass: string;
}

export interface FarePolicy {
  passengerType: string;
  ticketType: string;
  fareClass: string;
  cabinClass: string;
}

export interface BusServiceQuery {
  serviceDate: string;
  jurisdiction: "Kaohsiung" | "Taoyuan" | "InterCity" | "UNKNOWN";
  routeName: string;
  routeUid: string | null;
  subRouteUid: string | null;
  direction: number | null;
  boardingStopUid: string | null;
  alightingStopUid: string | null;
  boardingStopName: string;
  alightingStopName: string;
  plannedDeparture: string;
  plannedArrival: string;
}

export interface NormalizedBusRoute {
  routeName: string;
  routeUid: string;
  subRouteUid: string;
  direction: number;
  operator: string | null;
  stops: Array<{ stopUid: string; stopName: string; stopSequence: number }>;
}

export interface NormalizedBusStopTimetable {
  serviceDate: string;
  routeUid: string;
  subRouteUid: string;
  direction: number;
  stopTimes: Array<{ stopUid: string; arrival: string | null; departure: string | null }>;
}

export interface ValidationContext {
  retrievedAt: string;
  endpointName: string;
  sourceUrl: string;
}

function deltaSec(authoritative: string | null, original: string): number | null {
  if (!authoritative) return null;
  return Math.round((Date.parse(authoritative) - Date.parse(original)) / 1000);
}

function evidenceBase(
  query: RailServiceQuery | BusServiceQuery,
  context: ValidationContext,
): Pick<ModeValidationEvidence, "provider" | "serviceDate" | "endpointName" | "retrievedAt" | "timezone" | "originalMaasDeparture" | "originalMaasArrival" | "provenance"> {
  return {
    provider: "TDX",
    serviceDate: query.serviceDate,
    endpointName: context.endpointName,
    retrievedAt: context.retrievedAt,
    timezone: "Asia/Taipei",
    originalMaasDeparture: query.plannedDeparture,
    originalMaasArrival: query.plannedArrival,
    provenance: {
      provider: "TDX",
      apiFamily: "mode" in query ? "Rail" : "Bus",
      apiVersion: "v2",
      sourceUrl: context.sourceUrl,
    },
  };
}

function timeDistanceSec(first: string, second: string): number {
  return Math.abs(Date.parse(first) - Date.parse(second)) / 1000;
}

export function railValidationKey(query: RailServiceQuery): string {
  const identity = query.trainNo ?? `${query.serviceRouteName ?? "?"}|${query.plannedDeparture}|${query.plannedArrival}`;
  return [query.mode, query.serviceDate, identity, query.originStationId, query.destinationStationId].join("|");
}

export function busValidationKey(query: BusServiceQuery): string {
  return [
    query.jurisdiction,
    query.routeUid ?? query.routeName,
    query.subRouteUid ?? "?",
    query.direction ?? "?",
    query.boardingStopUid ?? query.boardingStopName,
    query.alightingStopUid ?? query.alightingStopName,
    query.serviceDate,
    query.plannedDeparture,
  ].join("|");
}

export function validateRailTimetable(
  query: RailServiceQuery,
  records: readonly NormalizedRailTimetable[],
  datePublished: boolean,
  context: ValidationContext,
): ModeValidationEvidence {
  const base = evidenceBase(query, context);
  const normalizedQuery = {
    mode: query.mode,
    serviceDate: query.serviceDate,
    trainNo: query.trainNo,
    serviceRouteName: query.serviceRouteName ?? null,
    originStationId: query.originStationId,
    destinationStationId: query.destinationStationId,
  };
  const unknown = (reasonCode: string): ModeValidationEvidence => ({
    ...base,
    validationStatus: "UNKNOWN",
    normalizedQuery,
    matchedBy: "NONE",
    authoritativeDeparture: null,
    authoritativeArrival: null,
    departureDeltaSec: null,
    arrivalDeltaSec: null,
    dataQuality: "MISSING",
    reasonCode,
    fareTwd: null,
    fareCoverage: "UNKNOWN",
    ticketType: null,
    fareClass: null,
    cabinClass: null,
  });
  if (!datePublished) return unknown("TIMETABLE_DATE_NOT_PUBLISHED");

  const sameOd = records.filter((record) => record.serviceDate === query.serviceDate
    && record.originStationId === query.originStationId
    && record.destinationStationId === query.destinationStationId);
  const matches = query.trainNo
    ? sameOd.filter((record) => record.trainNo === query.trainNo)
    : sameOd.filter((record) => (query.serviceRouteName === null || query.serviceRouteName === undefined || record.serviceRouteName === query.serviceRouteName)
      && timeDistanceSec(record.departure, query.plannedDeparture) <= 600
      && timeDistanceSec(record.arrival, query.plannedArrival) <= 600);
  const rankedMatches = query.trainNo ? matches : [...matches].sort((first, second) => (
    timeDistanceSec(first.departure, query.plannedDeparture) + timeDistanceSec(first.arrival, query.plannedArrival)
    - timeDistanceSec(second.departure, query.plannedDeparture) - timeDistanceSec(second.arrival, query.plannedArrival)
  ));
  if (rankedMatches.length > 1) {
    const firstDistance = timeDistanceSec(rankedMatches[0].departure, query.plannedDeparture) + timeDistanceSec(rankedMatches[0].arrival, query.plannedArrival);
    const secondDistance = timeDistanceSec(rankedMatches[1].departure, query.plannedDeparture) + timeDistanceSec(rankedMatches[1].arrival, query.plannedArrival);
    if (firstDistance === secondDistance) return unknown("AMBIGUOUS_SERVICE_MATCH");
  }
  if (matches.length === 0) {
    if (query.trainNo && sameOd.length > 0) {
      return { ...unknown("TRAIN_NUMBER_NOT_FOUND_FOR_OD"), validationStatus: "MISMATCH" };
    }
    return unknown("INSUFFICIENT_UNIQUE_SERVICE_IDENTITY");
  }
  const match = rankedMatches[0];
  if (match.originStopSequence >= match.destinationStopSequence) {
    return { ...unknown("RAIL_STOP_ORDER_REVERSED"), validationStatus: "MISMATCH" };
  }
  if (match.cancelled) return { ...unknown("RAIL_SERVICE_CANCELLED"), validationStatus: "MISMATCH" };
  return {
    ...base,
    validationStatus: "VERIFIED",
    normalizedQuery: { ...normalizedQuery, matchedTrainNo: match.trainNo },
    matchedBy: query.trainNo ? "TRAIN_NUMBER_AND_OD" : "UNIQUE_TIME_WINDOW",
    authoritativeDeparture: match.departure,
    authoritativeArrival: match.arrival,
    departureDeltaSec: deltaSec(match.departure, query.plannedDeparture),
    arrivalDeltaSec: deltaSec(match.arrival, query.plannedArrival),
    dataQuality: "EXACT_SCHEDULE",
    reasonCode: "RAIL_EXACT_SCHEDULE_VERIFIED",
    fareTwd: null,
    fareCoverage: "UNKNOWN",
    ticketType: null,
    fareClass: null,
    cabinClass: null,
  };
}

export function selectFareByPolicy(
  options: readonly NormalizedFareOption[],
  policy: FarePolicy,
): NormalizedFareOption | null {
  const matches = options.filter((option) => option.passengerType === policy.passengerType
    && option.ticketType === policy.ticketType
    && option.fareClass === policy.fareClass
    && option.cabinClass === policy.cabinClass
    && Number.isFinite(option.fareTwd)
    && option.fareTwd > 0);
  return matches.length === 1 ? matches[0] : null;
}

export function attachFare(
  evidence: ModeValidationEvidence,
  fare: NormalizedFareOption | null,
  unmatchedReasonCode: string,
): ModeValidationEvidence {
  if (!fare) return { ...evidence, fareTwd: null, fareCoverage: "UNKNOWN", reasonCode: evidence.validationStatus === "VERIFIED" ? unmatchedReasonCode : evidence.reasonCode };
  return {
    ...evidence,
    fareTwd: fare.fareTwd,
    fareCoverage: "COMPLETE",
    ticketType: fare.ticketType,
    fareClass: fare.fareClass,
    cabinClass: fare.cabinClass,
  };
}

function uniqueBusRoute(query: BusServiceQuery, routes: readonly NormalizedBusRoute[]): NormalizedBusRoute | null | "AMBIGUOUS" {
  const candidates = routes.filter((route) => route.routeName === query.routeName
    && (query.routeUid === null || route.routeUid === query.routeUid)
    && (query.subRouteUid === null || route.subRouteUid === query.subRouteUid)
    && (query.direction === null || route.direction === query.direction))
    .filter((route) => route.stops.some((stop) => (query.boardingStopUid ? stop.stopUid === query.boardingStopUid : stop.stopName === query.boardingStopName))
      && route.stops.some((stop) => (query.alightingStopUid ? stop.stopUid === query.alightingStopUid : stop.stopName === query.alightingStopName)));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const ordered = candidates.filter((route) => {
    const boarding = route.stops.find((stop) => query.boardingStopUid ? stop.stopUid === query.boardingStopUid : stop.stopName === query.boardingStopName)!;
    const alighting = route.stops.find((stop) => query.alightingStopUid ? stop.stopUid === query.alightingStopUid : stop.stopName === query.alightingStopName)!;
    return boarding.stopSequence < alighting.stopSequence;
  });
  return ordered.length === 1 ? ordered[0] : "AMBIGUOUS";
}

export function validateBusTimetable(
  query: BusServiceQuery,
  routes: readonly NormalizedBusRoute[],
  timetables: readonly NormalizedBusStopTimetable[],
  context: ValidationContext,
): ModeValidationEvidence {
  const base = evidenceBase(query, context);
  const normalizedQuery = {
    jurisdiction: query.jurisdiction,
    routeName: query.routeName,
    routeUid: query.routeUid,
    subRouteUid: query.subRouteUid,
    direction: query.direction,
    boardingStopUid: query.boardingStopUid,
    alightingStopUid: query.alightingStopUid,
    serviceDate: query.serviceDate,
  };
  const unknown = (reasonCode: string, dataQuality: ModeValidationEvidence["dataQuality"] = "MISSING"): ModeValidationEvidence => ({
    ...base,
    validationStatus: "UNKNOWN",
    normalizedQuery,
    matchedBy: "NONE",
    authoritativeDeparture: null,
    authoritativeArrival: null,
    departureDeltaSec: null,
    arrivalDeltaSec: null,
    dataQuality,
    reasonCode,
    fareTwd: null,
    fareCoverage: "UNKNOWN",
    ticketType: null,
    fareClass: null,
    cabinClass: null,
  });
  if (query.jurisdiction === "UNKNOWN") return unknown("BUS_JURISDICTION_UNKNOWN");
  const route = uniqueBusRoute(query, routes);
  if (route === "AMBIGUOUS") return unknown("BUS_ROUTE_DIRECTION_AMBIGUOUS", "ROUTE_ONLY");
  if (!route) return unknown("BUS_ROUTE_OR_STOPS_NOT_MATCHED", "ROUTE_ONLY");
  const boarding = route.stops.find((stop) => query.boardingStopUid ? stop.stopUid === query.boardingStopUid : stop.stopName === query.boardingStopName)!;
  const alighting = route.stops.find((stop) => query.alightingStopUid ? stop.stopUid === query.alightingStopUid : stop.stopName === query.alightingStopName)!;
  if (boarding.stopSequence >= alighting.stopSequence) {
    return { ...unknown("BUS_STOP_ORDER_REVERSED", "ROUTE_ONLY"), validationStatus: "MISMATCH", matchedBy: "ROUTE_DIRECTION_STOPS" };
  }
  const matchingTimetables = timetables.filter((entry) => entry.serviceDate === query.serviceDate
    && entry.routeUid === route.routeUid && entry.subRouteUid === route.subRouteUid && entry.direction === route.direction);
  const completeStopPairs = matchingTimetables.flatMap((entry) => {
    const board = entry.stopTimes.find((stop) => stop.stopUid === boarding.stopUid);
    const alight = entry.stopTimes.find((stop) => stop.stopUid === alighting.stopUid);
    const departure = board?.departure ?? board?.arrival ?? null;
    const arrival = alight?.arrival ?? alight?.departure ?? null;
    return departure && arrival ? [{ departure, arrival }] : [];
  });
  const exact = completeStopPairs.filter((entry) => timeDistanceSec(entry.departure, query.plannedDeparture) <= 120
    && timeDistanceSec(entry.arrival, query.plannedArrival) <= 120);
  if (exact.length !== 1) return unknown(
    exact.length > 1 || completeStopPairs.length > 1 ? "BUS_STOP_LEVEL_TIMING_AMBIGUOUS" : "BUS_STOP_LEVEL_TIMING_UNAVAILABLE",
    completeStopPairs.length > 0 ? "STOP_LEVEL_TIMETABLE" : matchingTimetables.length > 0 ? "ORIGIN_ONLY_SCHEDULE" : "ROUTE_ONLY",
  );
  return {
    ...base,
    validationStatus: "VERIFIED",
    normalizedQuery: { ...normalizedQuery, routeUid: route.routeUid, subRouteUid: route.subRouteUid, direction: route.direction, boardingStopUid: boarding.stopUid, alightingStopUid: alighting.stopUid },
    matchedBy: "ROUTE_DIRECTION_STOPS",
    authoritativeDeparture: exact[0].departure,
    authoritativeArrival: exact[0].arrival,
    departureDeltaSec: deltaSec(exact[0].departure, query.plannedDeparture),
    arrivalDeltaSec: deltaSec(exact[0].arrival, query.plannedArrival),
    dataQuality: "STOP_LEVEL_TIMETABLE",
    reasonCode: "BUS_STOP_LEVEL_TIMETABLE_VERIFIED",
    fareTwd: null,
    fareCoverage: "UNKNOWN",
    ticketType: null,
    fareClass: null,
    cabinClass: null,
  };
}

function at(value: string): number {
  return Date.parse(value);
}

function shifted(value: string, durationSec: number): string {
  return `${new Date(at(value) + durationSec * 1000 + 8 * 60 * 60 * 1000).toISOString().replace("Z", "")}+08:00`;
}

function synchronizeStep(step: JourneyStep, start: string, end: string): JourneyStep {
  return { ...step, plannedStart: start, plannedEnd: end, durationSec: Math.round((at(end) - at(start)) / 1000) };
}

/** Applies authoritative ride times, then rebuilds the explicit timeline without adding a second transfer buffer. */
export function recomputeCandidateWithEvidence(
  candidate: CandidateJourney,
  evidenceByRideStepId: ReadonlyMap<string, ModeValidationEvidence>,
  minimumTransferBufferSec = 180,
): { candidate: CandidateJourney; connection: ConnectionValidationResult } {
  const steps = (candidate.steps ?? []).map((step) => {
    const evidence = evidenceByRideStepId.get(step.id);
    if (step.type !== "RIDE" || !evidence) return { ...step };
    return {
      ...step,
      plannedStart: evidence.authoritativeDeparture ?? step.plannedStart,
      plannedEnd: evidence.authoritativeArrival ?? step.plannedEnd,
      durationSec: Math.round((at(evidence.authoritativeArrival ?? step.plannedEnd) - at(evidence.authoritativeDeparture ?? step.plannedStart)) / 1000),
      costTwd: evidence.fareTwd,
      validationEvidence: evidence,
      timingQuality: evidence.validationStatus === "VERIFIED" ? "SCHEDULED" as const : step.timingQuality,
    };
  });
  const rideIndexes = steps.flatMap((step, index) => step.type === "RIDE" ? [index] : []);
  for (let rideNumber = 0; rideNumber < rideIndexes.length; rideNumber += 1) {
    const rideIndex = rideIndexes[rideNumber];
    const ride = steps[rideIndex];
    if (steps[rideIndex - 1]?.type === "BOARD") steps[rideIndex - 1] = synchronizeStep(steps[rideIndex - 1], ride.plannedStart, ride.plannedStart);
    if (steps[rideIndex + 1]?.type === "ALIGHT") steps[rideIndex + 1] = synchronizeStep(steps[rideIndex + 1], ride.plannedEnd, ride.plannedEnd);

    const nextRideIndex = rideIndexes[rideNumber + 1];
    if (nextRideIndex !== undefined) {
      let cursor = ride.plannedEnd;
      for (let index = rideIndex + 1; index < nextRideIndex; index += 1) {
        if (steps[index].type === "ALIGHT") continue;
        if (steps[index].type === "TRANSFER_WALK") {
          const end = shifted(cursor, steps[index].durationSec);
          steps[index] = synchronizeStep(steps[index], cursor, end);
          cursor = end;
        } else if (steps[index].type === "WAIT") {
          steps[index] = synchronizeStep(steps[index], cursor, steps[nextRideIndex].plannedStart);
        }
      }
    }
  }
  if (rideIndexes.length > 0) {
    const firstRide = steps[rideIndexes[0]];
    for (let index = rideIndexes[0] - 1; index >= 0; index -= 1) {
      if (steps[index].type === "BOARD") continue;
      const start = shifted(firstRide.plannedStart, -steps[index].durationSec);
      steps[index] = synchronizeStep(steps[index], start, firstRide.plannedStart);
      break;
    }
    const lastRideIndex = rideIndexes.at(-1)!;
    let cursor = steps[lastRideIndex].plannedEnd;
    for (let index = lastRideIndex + 1; index < steps.length; index += 1) {
      if (steps[index].type === "ALIGHT") continue;
      const end = shifted(cursor, steps[index].durationSec);
      steps[index] = synchronizeStep(steps[index], cursor, end);
      cursor = end;
    }
  }
  const rides = steps.filter((step) => step.type === "RIDE");
  const costs = rides.map((step) => step.costTwd);
  const known = costs.filter((cost): cost is number => cost !== null);
  const costCoverage: CostCoverage = known.length === costs.length ? "COMPLETE" : known.length === 0 ? "UNKNOWN" : "PARTIAL";
  const totalCost = costCoverage === "COMPLETE" ? known.reduce((sum, cost) => sum + cost, 0) : null;
  const connection = validateJourneyConnections(steps, minimumTransferBufferSec);
  const completed = steps.at(-1)?.plannedEnd ?? candidate.goalCompletionAt ?? candidate.arriveAt;
  const first = steps[0]?.plannedStart ?? candidate.departAt;
  const goalAccess = [...steps].reverse().find((step) => step.type === "GOAL_ACCESS");
  const updated: CandidateJourney = {
    ...candidate,
    steps,
    legs: candidate.legs.map((leg, index) => {
      const ride = rides[index];
      if (!ride) return leg;
      return { ...leg, departAt: ride.plannedStart, arriveAt: ride.plannedEnd, durationMinutes: Math.round(ride.durationSec / 60), estimatedCost: ride.costTwd };
    }),
    departAt: first,
    arriveAt: goalAccess?.plannedEnd ?? completed,
    goalCompletionAt: completed,
    totalDurationMinutes: Math.round((at(completed) - at(first)) / 60_000),
    minimumTransferSlackMinutes: connection.minimumConnectionSlackSec === null ? null : connection.minimumConnectionSlackSec / 60,
    tightTransferCount: connection.transferSlacksSec.filter((slack) => slack < 180).length,
    totalCost,
    estimatedCost: totalCost,
    costCoverage,
    modeValidation: {
      status: rides.every((ride) => ride.validationEvidence?.validationStatus === "VERIFIED") ? "VERIFIED" : rides.some((ride) => ride.validationEvidence?.validationStatus === "VERIFIED") ? "PARTIAL" : "UNVERIFIED",
      reasonCodes: [...new Set(rides.map((ride) => ride.validationEvidence?.reasonCode ?? "MODE_VALIDATION_EVIDENCE_MISSING"))],
    },
  };
  return { candidate: updated, connection };
}

export function resolveCandidate(candidate: CandidateJourney, connection = validateJourneyConnections(candidate.steps ?? [])): CandidateResolution {
  const rides = candidate.steps?.filter((step) => step.type === "RIDE") ?? [];
  const statuses = rides.map((ride) => ride.validationEvidence?.validationStatus ?? "UNKNOWN");
  const reasons = rides.map((ride) => ride.validationEvidence?.reasonCode ?? "MODE_VALIDATION_EVIDENCE_MISSING");
  const timedLegsComplete = statuses.every((status) => status === "VERIFIED");
  const fareComplete = candidate.costCoverage === "COMPLETE" && candidate.totalCost !== null;
  if (statuses.includes("MISMATCH") || connection.status === "IMPOSSIBLE") {
    return { candidateId: candidate.id, resolution: "VALIDATED_IMPOSSIBLE", reasonCodes: [...new Set([...reasons, ...connection.reasonCodes])], timedLegsComplete, fareComplete, connection };
  }
  if (!timedLegsComplete || connection.status === "UNKNOWN") {
    return { candidateId: candidate.id, resolution: "UNKNOWN", reasonCodes: [...new Set([...reasons, ...connection.reasonCodes])], timedLegsComplete, fareComplete, connection };
  }
  return {
    candidateId: candidate.id,
    resolution: connection.status === "RISKY" ? "VALIDATED_RISKY" : "VALIDATED_FEASIBLE",
    reasonCodes: connection.reasonCodes,
    timedLegsComplete,
    fareComplete,
    connection,
  };
}

export interface FormalRecommendationGate {
  available: boolean;
  candidateId: string | null;
  winnerCandidateIds?: string[];
  selectedRepresentativeId?: string | null;
  reasonCode: string;
  unique?: boolean;
  possibleTieCandidateIds?: string[];
  score?: number | null;
  blockers?: BalancedMetricBlocker[];
  metricCompleteness?: BalancedCandidateMetricReport[];
  rankedCandidates?: Array<{
    candidateId: string;
    rank: number;
    score: number;
    scoreBreakdown: import("./types.ts").JourneyScoreBreakdown;
  }>;
  exactWinnerTime?: string | null;
  exactWinnerCostTwd?: number | null;
  competitors?: OptimizationCompetitorProof[];
  assumptions?: string[];
}

export interface FormalRecommendationGates {
  fastest: FormalRecommendationGate;
  balanced: FormalRecommendationGate;
  cheapest: FormalRecommendationGate;
  formalRecommendationStatus:
    | "ALL_PRIMARY_RECOMMENDATIONS_AVAILABLE"
    | "PARTIAL_RECOMMENDATIONS_AVAILABLE"
    | "NO_FORMAL_RECOMMENDATIONS_AVAILABLE";
  availableRecommendations: Array<"FASTEST" | "BALANCED" | "CHEAPEST">;
  unavailableRecommendations: Array<"FASTEST" | "BALANCED" | "CHEAPEST">;
}

export type TimingProof = "EXACT" | "CONSERVATIVE_BOUND" | "UNBOUNDED";
export type CostProof = "EXACT" | "NONNEGATIVE_LOWER_BOUND" | "UNBOUNDED";
export type OptimizationEligibility = "ELIGIBLE" | "PROVEN_IMPOSSIBLE" | "UNRESOLVED";
export type ProofResolutionStatus = "NOT_REQUIRED" | "VERIFIED" | "PROVEN_IMPOSSIBLE" | "UNRESOLVED";

export interface LayeredCandidateResolution {
  candidateId: string;
  primaryProviderValidation: {
    status: CandidateTerminalResolution;
    reasonCodes: string[];
  };
  proofResolution: {
    status: ProofResolutionStatus;
    reasonCodes: string[];
    sourceEvidenceIds: string[];
  };
  effectiveCandidateResolution: {
    status: CandidateTerminalResolution;
    reasonCodes: string[];
  };
  rankingEligible: boolean;
}

export interface EffectiveResolutionCounts {
  feasible: number;
  risky: number;
  impossible: number;
  unknown: number;
  total: number;
}

export type BalancedMetricName =
  | "totalDurationMinutes"
  | "totalCost"
  | "totalWalkingMinutes"
  | "totalWaitingMinutes"
  | "transferCount"
  | "minimumTransferSlackMinutes"
  | "connectionRiskPenalty";

export interface BalancedMetricValue {
  metricName: BalancedMetricName;
  status: "EXACT" | "MISSING";
  source: string;
  value: number | null;
}

export interface BalancedCandidateMetricReport {
  candidateId: string;
  metrics: BalancedMetricValue[];
}

export interface BalancedMetricBlocker {
  reasonCode: "BALANCED_METRIC_MISSING";
  candidateId: string;
  metricName: BalancedMetricName;
  sourceReason: string;
}

export interface TerminalDepartureMismatchInput {
  candidateBoardingStopId: string | null;
  officialTerminalStopId: string | null;
  directionMatched: boolean;
  serviceDateMatched: boolean;
  publishedDepartures: string[];
  candidateBoardingTime: string | null;
}

export interface TerminalDepartureMismatchProof extends TerminalDepartureMismatchInput {
  boardingStopIsPublishedDepartureTerminal: boolean;
  status: "PROVEN_IMPOSSIBLE" | "UNRESOLVED";
  reasonCode: string;
}

export function evaluateTerminalDepartureMismatch(input: TerminalDepartureMismatchInput): TerminalDepartureMismatchProof {
  const boardingStopIsPublishedDepartureTerminal = input.candidateBoardingStopId !== null
    && input.officialTerminalStopId !== null
    && input.candidateBoardingStopId === input.officialTerminalStopId;
  const prerequisitesComplete = boardingStopIsPublishedDepartureTerminal
    && input.directionMatched
    && input.serviceDateMatched
    && input.candidateBoardingTime !== null;
  const exactDepartureExists = input.candidateBoardingTime !== null
    && input.publishedDepartures.includes(input.candidateBoardingTime);
  return {
    ...input,
    boardingStopIsPublishedDepartureTerminal,
    status: prerequisitesComplete && !exactDepartureExists ? "PROVEN_IMPOSSIBLE" : "UNRESOLVED",
    reasonCode: !boardingStopIsPublishedDepartureTerminal
      ? "BOARDING_STOP_NOT_PROVEN_AS_DEPARTURE_TERMINAL"
      : !input.directionMatched
        ? "DIRECTION_NOT_MATCHED"
        : !input.serviceDateMatched
          ? "SERVICE_DATE_NOT_MATCHED"
          : exactDepartureExists
            ? "COMPATIBLE_TERMINAL_DEPARTURE_EXISTS"
            : "NO_COMPATIBLE_TERMINAL_DEPARTURE",
  };
}

/** Proof-only evidence. Bounds never replace display times or unknown journey fares. */
export interface CandidateOptimizationEvidence {
  candidateId: string;
  eligibility: OptimizationEligibility;
  timingProof: TimingProof;
  exactGoalCompletionAt: string | null;
  earliestPossibleGoalCompletionAt: string | null;
  latestPossibleGoalCompletionAt: string | null;
  possibleServiceIds: string[];
  costProof: CostProof;
  exactTotalCostTwd: number | null;
  minimumPossibleTotalCostTwd: number | null;
  sourceEvidenceIds: string[];
  assumptions: string[];
  reasonCodes: string[];
}

export function resolveLayeredCandidateResolutions(
  candidates: readonly CandidateJourney[],
  primaryResolutions: readonly CandidateResolution[],
  optimizationEvidence: readonly CandidateOptimizationEvidence[],
): LayeredCandidateResolution[] {
  const primaryById = new Map(primaryResolutions.map((resolution) => [resolution.candidateId, resolution]));
  const proofById = new Map(optimizationEvidence.map((evidence) => [evidence.candidateId, evidence]));
  return candidates.map((candidate) => {
    const primary = primaryById.get(candidate.id);
    const primaryStatus = primary?.resolution ?? "UNKNOWN";
    const proof = proofById.get(candidate.id);
    const proofStatus: ProofResolutionStatus = primaryStatus === "VALIDATED_FEASIBLE" || primaryStatus === "VALIDATED_RISKY"
      ? "NOT_REQUIRED"
      : proof?.eligibility === "PROVEN_IMPOSSIBLE"
        ? "PROVEN_IMPOSSIBLE"
        : proof?.eligibility === "ELIGIBLE"
          ? "VERIFIED"
          : "UNRESOLVED";
    const effectiveStatus: CandidateTerminalResolution = primaryStatus === "VALIDATED_FEASIBLE"
      || primaryStatus === "VALIDATED_RISKY"
      || primaryStatus === "VALIDATED_IMPOSSIBLE"
      ? primaryStatus
      : proofStatus === "PROVEN_IMPOSSIBLE"
        ? "VALIDATED_IMPOSSIBLE"
        : proofStatus === "VERIFIED"
          ? (primary?.connection.status === "RISKY" ? "VALIDATED_RISKY" : "VALIDATED_FEASIBLE")
          : "UNKNOWN";
    const effectiveReasons = effectiveStatus === primaryStatus
      ? primary?.reasonCodes ?? ["PRIMARY_RESOLUTION_MISSING"]
      : proof?.reasonCodes ?? ["OPTIMIZATION_EVIDENCE_MISSING"];
    return {
      candidateId: candidate.id,
      primaryProviderValidation: {
        status: primaryStatus,
        reasonCodes: primary?.reasonCodes ?? ["PRIMARY_RESOLUTION_MISSING"],
      },
      proofResolution: {
        status: proofStatus,
        reasonCodes: proofStatus === "NOT_REQUIRED" ? ["PRIMARY_PROVIDER_TERMINAL"] : proof?.reasonCodes ?? ["OPTIMIZATION_EVIDENCE_MISSING"],
        sourceEvidenceIds: proof?.sourceEvidenceIds ?? [],
      },
      effectiveCandidateResolution: { status: effectiveStatus, reasonCodes: effectiveReasons },
      rankingEligible: effectiveStatus === "VALIDATED_FEASIBLE" || effectiveStatus === "VALIDATED_RISKY",
    };
  });
}

export function summarizeEffectiveResolutionCounts(
  resolutions: readonly LayeredCandidateResolution[],
): EffectiveResolutionCounts {
  const count = (status: CandidateTerminalResolution) => resolutions.filter(
    (resolution) => resolution.effectiveCandidateResolution.status === status,
  ).length;
  return {
    feasible: count("VALIDATED_FEASIBLE"),
    risky: count("VALIDATED_RISKY"),
    impossible: count("VALIDATED_IMPOSSIBLE"),
    unknown: count("UNKNOWN"),
    total: resolutions.length,
  };
}

export function toEffectiveCandidateResolutions(
  layered: readonly LayeredCandidateResolution[],
  primaryResolutions: readonly CandidateResolution[],
): CandidateResolution[] {
  const primaryById = new Map(primaryResolutions.map((resolution) => [resolution.candidateId, resolution]));
  return layered.map((resolution) => {
    const primary = primaryById.get(resolution.candidateId);
    if (!primary) throw new Error(`Missing primary resolution for ${resolution.candidateId}`);
    const status = resolution.effectiveCandidateResolution.status;
    return {
      ...primary,
      resolution: status,
      reasonCodes: resolution.effectiveCandidateResolution.reasonCodes,
      timedLegsComplete: status === "VALIDATED_IMPOSSIBLE" ? true : primary.timedLegsComplete,
    };
  });
}

function exactMetric(metricName: BalancedMetricName, value: number | null, source: string): BalancedMetricValue {
  return {
    metricName,
    status: typeof value === "number" && Number.isFinite(value) ? "EXACT" : "MISSING",
    source,
    value,
  };
}

export function inspectBalancedMetricCompleteness(
  candidates: readonly CandidateJourney[],
): { reports: BalancedCandidateMetricReport[]; blockers: BalancedMetricBlocker[] } {
  const reports = candidates.map((candidate): BalancedCandidateMetricReport => {
    const slackExact = typeof candidate.minimumTransferSlackMinutes === "number"
      ? Number.isFinite(candidate.minimumTransferSlackMinutes)
      : candidate.minimumTransferSlackMinutes === null && candidate.transferCount === 0;
    const metrics: BalancedMetricValue[] = [
      exactMetric("totalDurationMinutes", candidate.totalDurationMinutes, "canonical journey timeline"),
      exactMetric("totalCost", candidate.costCoverage === "COMPLETE" ? candidate.totalCost : null, "complete canonical ride fares"),
      exactMetric("totalWalkingMinutes", candidate.totalWalkingMinutes, "canonical WALK steps"),
      exactMetric("totalWaitingMinutes", candidate.totalWaitingMinutes, "canonical WAIT steps"),
      exactMetric("transferCount", candidate.transferCount, "canonical journey topology"),
      {
        metricName: "minimumTransferSlackMinutes",
        status: slackExact ? "EXACT" : "MISSING",
        source: candidate.transferCount === 0 ? "direct journey; no transfer" : "canonical connection validation",
        value: candidate.minimumTransferSlackMinutes,
      },
      {
        metricName: "connectionRiskPenalty",
        status: slackExact ? "EXACT" : "MISSING",
        source: "existing BALANCED slack thresholds",
        value: slackExact ? calculateConnectionRiskPenalty(candidate) : null,
      },
    ];
    return { candidateId: candidate.id, metrics };
  });
  const blockers = reports.flatMap((report) => report.metrics.flatMap((metric): BalancedMetricBlocker[] => (
    metric.status === "MISSING"
      ? [{ reasonCode: "BALANCED_METRIC_MISSING", candidateId: report.candidateId, metricName: metric.metricName, sourceReason: metric.source }]
      : []
  )));
  return { reports, blockers };
}

export interface OptimizationCompetitorProof {
  candidateId: string;
  eligibility: OptimizationEligibility;
  exactValue: string | number | null;
  conservativeBound: string | number | null;
  canStillBeatWinner: boolean;
  possibleTie: boolean;
  sourceEvidenceIds: string[];
  reasonCodes: string[];
}

export interface TimingResolutionSummary {
  timingResolutionCounts: { exact: number; unknown: number; total: number };
  nonExclusiveDataQualityTags: { estimatedOnlyBus: number };
}

export function summarizeTimingResolution(rides: readonly JourneyStep[]): TimingResolutionSummary {
  const exact = rides.filter((ride) => ride.type === "RIDE" && ride.validationEvidence?.validationStatus === "VERIFIED").length;
  const total = rides.filter((ride) => ride.type === "RIDE").length;
  return {
    timingResolutionCounts: { exact, unknown: total - exact, total },
    nonExclusiveDataQualityTags: {
      estimatedOnlyBus: rides.filter((ride) => ride.type === "RIDE"
        && ride.validationEvidence?.validationStatus !== "VERIFIED"
        && ride.validationEvidence?.dataQuality === "STOP_LEVEL_TIMETABLE").length,
    },
  };
}

function exactEligibleCandidateIds(
  candidates: readonly CandidateJourney[],
  resolutions: readonly CandidateResolution[],
  evidenceById: ReadonlyMap<string, CandidateOptimizationEvidence>,
  dimension: "time" | "cost",
): string[] {
  const resolutionById = new Map(resolutions.map((resolution) => [resolution.candidateId, resolution]));
  return candidates.flatMap((candidate) => {
    const resolution = resolutionById.get(candidate.id)?.resolution;
    const evidence = evidenceById.get(candidate.id);
    const exact = dimension === "time"
      ? evidence?.timingProof === "EXACT" && evidence.exactGoalCompletionAt !== null
      : evidence?.costProof === "EXACT" && evidence.exactTotalCostTwd !== null;
    return (resolution === "VALIDATED_FEASIBLE" || resolution === "VALIDATED_RISKY") && exact ? [candidate.id] : [];
  });
}

export function evaluateFastestOptimalityProof(
  candidates: readonly CandidateJourney[],
  resolutions: readonly CandidateResolution[],
  optimizationEvidence: readonly CandidateOptimizationEvidence[],
): FormalRecommendationGate {
  const evidenceById = new Map(optimizationEvidence.map((evidence) => [evidence.candidateId, evidence]));
  const eligibleIds = exactEligibleCandidateIds(candidates, resolutions, evidenceById, "time");
  const exactCandidates = candidates.filter((candidate) => eligibleIds.includes(candidate.id));
  const bestTime = Math.min(...exactCandidates.map((candidate) => Date.parse(evidenceById.get(candidate.id)!.exactGoalCompletionAt!)));
  const tiedWinners = exactCandidates
    .filter((candidate) => Date.parse(evidenceById.get(candidate.id)!.exactGoalCompletionAt!) === bestTime)
    .sort(compareFastest);
  const winner = tiedWinners[0];
  if (!winner) return { available: false, candidateId: null, winnerCandidateIds: [], selectedRepresentativeId: null, reasonCode: "WINNER_TIMING_NOT_EXACT", unique: false, possibleTieCandidateIds: [] };
  const winnerTime = evidenceById.get(winner.id)!.exactGoalCompletionAt!;
  const winnerValue = Date.parse(winnerTime);
  const competitors: OptimizationCompetitorProof[] = candidates.filter((candidate) => candidate.id !== winner.id).map((candidate) => {
    const evidence = evidenceById.get(candidate.id);
    const excluded = evidence?.eligibility === "PROVEN_IMPOSSIBLE";
    const exactValue = evidence?.timingProof === "EXACT" ? evidence.exactGoalCompletionAt : null;
    const conservativeBound = evidence?.timingProof === "CONSERVATIVE_BOUND" ? evidence.earliestPossibleGoalCompletionAt : null;
    const comparisonValue = exactValue ?? conservativeBound;
    const comparable = comparisonValue !== null && Number.isFinite(Date.parse(comparisonValue));
    return {
      candidateId: candidate.id,
      eligibility: evidence?.eligibility ?? "UNRESOLVED",
      exactValue,
      conservativeBound,
      canStillBeatWinner: !excluded && (!comparable || Date.parse(comparisonValue!) < winnerValue),
      possibleTie: !excluded && comparable && Date.parse(comparisonValue!) === winnerValue,
      sourceEvidenceIds: evidence?.sourceEvidenceIds ?? [],
      reasonCodes: evidence?.reasonCodes ?? ["OPTIMIZATION_EVIDENCE_MISSING"],
    };
  });
  const blockers = competitors.filter((competitor) => competitor.canStillBeatWinner);
  const winnerCandidateIds = tiedWinners.map((candidate) => candidate.id);
  const ties = [...new Set([
    ...winnerCandidateIds.filter((candidateId) => candidateId !== winner.id),
    ...competitors.filter((competitor) => competitor.possibleTie).map((competitor) => competitor.candidateId),
  ])].sort();
  return blockers.length > 0
    ? { available: false, candidateId: null, winnerCandidateIds: [], selectedRepresentativeId: null, reasonCode: "UNRESOLVED_CANDIDATE_MAY_BE_FASTER", unique: false, possibleTieCandidateIds: ties, exactWinnerTime: winnerTime, competitors }
    : { available: true, candidateId: winner.id, winnerCandidateIds, selectedRepresentativeId: winner.id, reasonCode: "ALL_COMPETITORS_EXACT_BOUNDED_OR_PROVEN_IMPOSSIBLE", unique: winnerCandidateIds.length === 1 && ties.length === 0, possibleTieCandidateIds: ties, exactWinnerTime: winnerTime, competitors };
}

export function evaluateCheapestOptimalityProof(
  candidates: readonly CandidateJourney[],
  resolutions: readonly CandidateResolution[],
  optimizationEvidence: readonly CandidateOptimizationEvidence[],
): FormalRecommendationGate {
  const evidenceById = new Map(optimizationEvidence.map((evidence) => [evidence.candidateId, evidence]));
  const eligibleIds = exactEligibleCandidateIds(candidates, resolutions, evidenceById, "cost");
  const exactCandidates = candidates.filter((candidate) => eligibleIds.includes(candidate.id));
  const bestCost = Math.min(...exactCandidates.map((candidate) => evidenceById.get(candidate.id)!.exactTotalCostTwd!));
  const tiedWinners = exactCandidates
    .filter((candidate) => evidenceById.get(candidate.id)!.exactTotalCostTwd === bestCost)
    .sort(compareCheapest);
  const winner = tiedWinners[0];
  if (!winner) return { available: false, candidateId: null, winnerCandidateIds: [], selectedRepresentativeId: null, reasonCode: "WINNER_COST_NOT_EXACT", unique: false, possibleTieCandidateIds: [] };
  const winnerCost = evidenceById.get(winner.id)!.exactTotalCostTwd!;
  const competitors: OptimizationCompetitorProof[] = candidates.filter((candidate) => candidate.id !== winner.id).map((candidate) => {
    const evidence = evidenceById.get(candidate.id);
    const excluded = evidence?.eligibility === "PROVEN_IMPOSSIBLE";
    const exactValue = evidence?.costProof === "EXACT" ? evidence.exactTotalCostTwd : null;
    const conservativeBound = evidence?.costProof === "NONNEGATIVE_LOWER_BOUND" ? evidence.minimumPossibleTotalCostTwd : null;
    const comparisonValue = exactValue ?? conservativeBound;
    const comparable = typeof comparisonValue === "number" && Number.isFinite(comparisonValue);
    return {
      candidateId: candidate.id,
      eligibility: evidence?.eligibility ?? "UNRESOLVED",
      exactValue,
      conservativeBound,
      canStillBeatWinner: !excluded && (!comparable || comparisonValue! < winnerCost),
      possibleTie: !excluded && comparable && comparisonValue === winnerCost,
      sourceEvidenceIds: evidence?.sourceEvidenceIds ?? [],
      reasonCodes: evidence?.reasonCodes ?? ["OPTIMIZATION_EVIDENCE_MISSING"],
    };
  });
  const blockers = competitors.filter((competitor) => competitor.canStillBeatWinner);
  const winnerCandidateIds = tiedWinners.map((candidate) => candidate.id);
  const ties = [...new Set([
    ...winnerCandidateIds.filter((candidateId) => candidateId !== winner.id),
    ...competitors.filter((competitor) => competitor.possibleTie).map((competitor) => competitor.candidateId),
  ])].sort();
  const assumptions = [...new Set(optimizationEvidence.flatMap((evidence) => evidence.assumptions))];
  return blockers.length > 0
    ? { available: false, candidateId: null, winnerCandidateIds: [], selectedRepresentativeId: null, reasonCode: "INCOMPLETE_FARE_COVERAGE", unique: false, possibleTieCandidateIds: ties, exactWinnerCostTwd: winnerCost, competitors, assumptions }
    : { available: true, candidateId: winner.id, winnerCandidateIds, selectedRepresentativeId: winner.id, reasonCode: "ALL_COMPETITORS_EXACT_BOUNDED_OR_PROVEN_IMPOSSIBLE", unique: winnerCandidateIds.length === 1 && ties.length === 0, possibleTieCandidateIds: ties, exactWinnerCostTwd: winnerCost, competitors, assumptions };
}

export function evaluateBalancedRecommendation(
  candidates: readonly CandidateJourney[],
  effectiveResolutions: readonly CandidateResolution[],
): FormalRecommendationGate {
  const resolutionById = new Map(effectiveResolutions.map((resolution) => [resolution.candidateId, resolution]));
  const unresolved = candidates.filter((candidate) => {
    const status = resolutionById.get(candidate.id)?.resolution;
    return status === undefined || status === "UNKNOWN";
  });
  if (unresolved.length > 0) {
    return {
      available: false,
      candidateId: null,
      winnerCandidateIds: [],
      selectedRepresentativeId: null,
      unique: false,
      reasonCode: "UNRESOLVED_CANDIDATE_MAY_AFFECT_BALANCED",
      blockers: unresolved.map((candidate) => ({
        reasonCode: "BALANCED_METRIC_MISSING",
        candidateId: candidate.id,
        metricName: "totalDurationMinutes",
        sourceReason: "effective candidate resolution is UNKNOWN",
      })),
    };
  }
  const eligible = candidates.filter((candidate) => {
    const status = resolutionById.get(candidate.id)?.resolution;
    return status === "VALIDATED_FEASIBLE" || status === "VALIDATED_RISKY";
  });
  const completeness = inspectBalancedMetricCompleteness(eligible);
  if (completeness.blockers.length > 0) {
    return {
      available: false,
      candidateId: null,
      winnerCandidateIds: [],
      selectedRepresentativeId: null,
      unique: false,
      reasonCode: "BALANCED_METRIC_MISSING",
      blockers: completeness.blockers,
      metricCompleteness: completeness.reports,
    };
  }
  const ranked = rankBalancedJourneys(eligible);
  const bestScore = ranked[0]?.score ?? null;
  const tied = bestScore === null ? [] : ranked.filter((entry) => entry.score === bestScore);
  const selected = tied[0]?.candidate.id ?? null;
  return {
    available: selected !== null,
    candidateId: selected,
    winnerCandidateIds: tied.map((entry) => entry.candidate.id),
    selectedRepresentativeId: selected,
    unique: tied.length === 1,
    score: bestScore,
    reasonCode: selected === null ? "NO_VALIDATED_EFFECTIVE_CANDIDATE" : "BALANCED_METRICS_COMPLETE",
    possibleTieCandidateIds: tied.slice(1).map((entry) => entry.candidate.id),
    metricCompleteness: completeness.reports,
    rankedCandidates: ranked.map((entry) => ({
      candidateId: entry.candidate.id,
      rank: entry.rank,
      score: entry.score,
      scoreBreakdown: entry.scoreBreakdown,
    })),
  };
}

function aggregateRecommendationGates(
  fastest: FormalRecommendationGate,
  balanced: FormalRecommendationGate,
  cheapest: FormalRecommendationGate,
): FormalRecommendationGates {
  const entries = [["FASTEST", fastest], ["BALANCED", balanced], ["CHEAPEST", cheapest]] as const;
  const availableRecommendations = entries.filter(([, gate]) => gate.available).map(([name]) => name);
  const unavailableRecommendations = entries.filter(([, gate]) => !gate.available).map(([name]) => name);
  return {
    fastest,
    balanced,
    cheapest,
    formalRecommendationStatus: availableRecommendations.length === 3
      ? "ALL_PRIMARY_RECOMMENDATIONS_AVAILABLE"
      : availableRecommendations.length > 0
        ? "PARTIAL_RECOMMENDATIONS_AVAILABLE"
        : "NO_FORMAL_RECOMMENDATIONS_AVAILABLE",
    availableRecommendations,
    unavailableRecommendations,
  };
}

export function evaluateFormalRecommendationGates(
  candidates: readonly CandidateJourney[],
  resolutions: readonly CandidateResolution[],
  optimizationEvidence?: readonly CandidateOptimizationEvidence[],
): FormalRecommendationGates {
  if (optimizationEvidence) {
    const layered = resolveLayeredCandidateResolutions(candidates, resolutions, optimizationEvidence);
    const effectiveResolutions = toEffectiveCandidateResolutions(layered, resolutions);
    const fastest = evaluateFastestOptimalityProof(candidates, effectiveResolutions, optimizationEvidence);
    const cheapest = evaluateCheapestOptimalityProof(candidates, effectiveResolutions, optimizationEvidence);
    const balanced = evaluateBalancedRecommendation(candidates, effectiveResolutions);
    return aggregateRecommendationGates(fastest, balanced, cheapest);
  }
  const byId = new Map(resolutions.map((resolution) => [resolution.candidateId, resolution]));
  const effective = candidates.filter((candidate) => {
    const resolution = byId.get(candidate.id)?.resolution;
    return resolution === "VALIDATED_FEASIBLE" || resolution === "VALIDATED_RISKY";
  });
  const unresolved = candidates.filter((candidate) => byId.get(candidate.id)?.resolution === "UNKNOWN" || !byId.has(candidate.id));
  const provisionalFastest = rankFastest(effective);
  const fastestBlocked = unresolved.length > 0 || resolutions.length !== candidates.length || effective.some((candidate) => !byId.get(candidate.id)?.timedLegsComplete);
  const fastest: FormalRecommendationGate = !provisionalFastest
    ? { available: false, candidateId: null, reasonCode: "NO_VALIDATED_EFFECTIVE_CANDIDATE" }
    : fastestBlocked
      ? { available: false, candidateId: null, reasonCode: "UNRESOLVED_CANDIDATE_MAY_BE_FASTER" }
      : { available: true, candidateId: provisionalFastest.id, reasonCode: "ALL_TIMED_CANDIDATES_RESOLVED" };
  const incompleteFare = effective.some((candidate) => candidate.costCoverage !== "COMPLETE" || candidate.totalCost === null);
  const balancedCandidate = !incompleteFare && unresolved.length === 0 ? rankBalanced(effective) : null;
  const cheapestCandidate = !incompleteFare && unresolved.length === 0 ? rankCheapest(effective) : null;
  const balanced: FormalRecommendationGate = balancedCandidate
    ? { available: true, candidateId: balancedCandidate.candidate.id, reasonCode: "BALANCED_METRICS_COMPLETE" }
    : { available: false, candidateId: null, reasonCode: "INCOMPLETE_BALANCED_METRICS" };
  const cheapest: FormalRecommendationGate = cheapestCandidate
    ? { available: true, candidateId: cheapestCandidate.id, reasonCode: "COMPLETE_FARE_COVERAGE" }
    : { available: false, candidateId: null, reasonCode: "INCOMPLETE_FARE_COVERAGE" };
  return aggregateRecommendationGates(fastest, balanced, cheapest);
}
