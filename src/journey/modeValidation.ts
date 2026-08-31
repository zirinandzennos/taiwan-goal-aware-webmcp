import { validateJourneyConnections, type ConnectionValidationResult } from "./connectionValidator.ts";
import { rankBalanced, rankCheapest, rankFastest } from "./ranking.ts";
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
  reasonCode: string;
}

export interface FormalRecommendationGates {
  fastest: FormalRecommendationGate;
  balanced: FormalRecommendationGate;
  cheapest: FormalRecommendationGate;
  formalRecommendationStatus: "FORMAL_AVAILABLE" | "PARTIAL" | "UNKNOWN_MODE_VALIDATION";
}

export function evaluateFormalRecommendationGates(
  candidates: readonly CandidateJourney[],
  resolutions: readonly CandidateResolution[],
): FormalRecommendationGates {
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
  const availableCount = [fastest, balanced, cheapest].filter((gate) => gate.available).length;
  return {
    fastest,
    balanced,
    cheapest,
    formalRecommendationStatus: availableCount === 3 ? "FORMAL_AVAILABLE" : availableCount > 0 ? "PARTIAL" : "UNKNOWN_MODE_VALIDATION",
  };
}
