import { describe, expect, it } from "vitest";
import {
  attachFare,
  busValidationKey,
  evaluateFormalRecommendationGates,
  railValidationKey,
  recomputeCandidateWithEvidence,
  resolveCandidate,
  selectFareByPolicy,
  validateBusTimetable,
  validateRailTimetable,
  type BusServiceQuery,
  type CandidateResolution,
  type NormalizedBusRoute,
  type NormalizedBusStopTimetable,
  type NormalizedFareOption,
  type NormalizedRailTimetable,
  type RailServiceQuery,
} from "../src/journey/modeValidation.ts";
import type { CandidateJourney, JourneyStep, ModeValidationEvidence } from "../src/journey/types.ts";

const context = {
  retrievedAt: "2026-08-31T03:00:00Z",
  endpointName: "fixture",
  sourceUrl: "https://tdx.transportdata.tw/api/basic/fixture",
};

const railQuery: RailServiceQuery = {
  mode: "THSR",
  serviceDate: "2026-08-31",
  trainNo: "0640",
  serviceRouteName: "左營-南港",
  originStationId: "1070",
  destinationStationId: "1020",
  plannedDeparture: "2026-08-31T12:35:00+08:00",
  plannedArrival: "2026-08-31T14:09:00+08:00",
};

const railRecord: NormalizedRailTimetable = {
  serviceDate: "2026-08-31",
  trainNo: "0640",
  serviceRouteName: "左營-南港",
  originStationId: "1070",
  destinationStationId: "1020",
  originStopSequence: 1,
  destinationStopSequence: 6,
  departure: "2026-08-31T12:35:00+08:00",
  arrival: "2026-08-31T14:09:00+08:00",
};

const busQuery: BusServiceQuery = {
  serviceDate: "2026-08-31",
  jurisdiction: "Taoyuan",
  routeName: "208A",
  routeUid: null,
  subRouteUid: null,
  direction: null,
  boardingStopUid: null,
  alightingStopUid: null,
  boardingStopName: "捷運高鐵桃園站",
  alightingStopName: "福德宮",
  plannedDeparture: "2026-08-31T14:19:00+08:00",
  plannedArrival: "2026-08-31T14:24:30+08:00",
};

function busRoute(jurisdiction = "Taoyuan"): NormalizedBusRoute {
  return {
    routeName: "208A",
    routeUid: `${jurisdiction}-208A`,
    subRouteUid: `${jurisdiction}-208A-0`,
    direction: 0,
    operator: "fixture",
    stops: [
      { stopUid: "board", stopName: "捷運高鐵桃園站", stopSequence: 1 },
      { stopUid: "alight", stopName: "福德宮", stopSequence: 2 },
    ],
  };
}

const busTimetable: NormalizedBusStopTimetable = {
  serviceDate: "2026-08-31",
  routeUid: "Taoyuan-208A",
  subRouteUid: "Taoyuan-208A-0",
  direction: 0,
  stopTimes: [
    { stopUid: "board", arrival: "2026-08-31T14:19:00+08:00", departure: "2026-08-31T14:19:00+08:00" },
    { stopUid: "alight", arrival: "2026-08-31T14:24:30+08:00", departure: "2026-08-31T14:24:30+08:00" },
  ],
};

describe("Rail v2 validation", () => {
  it("matches exact date, train number and OD", () => {
    expect(validateRailTimetable(railQuery, [railRecord], true, context)).toMatchObject({ validationStatus: "VERIFIED", matchedBy: "TRAIN_NUMBER_AND_OD" });
  });

  it("marks a wrong train number as a mismatch", () => {
    expect(validateRailTimetable({ ...railQuery, trainNo: "9999" }, [railRecord], true, context)).toMatchObject({ validationStatus: "MISMATCH", reasonCode: "TRAIN_NUMBER_NOT_FOUND_FOR_OD" });
  });

  it("rejects reversed stop order", () => {
    expect(validateRailTimetable(railQuery, [{ ...railRecord, originStopSequence: 6, destinationStopSequence: 1 }], true, context)).toMatchObject({ validationStatus: "MISMATCH", reasonCode: "RAIL_STOP_ORDER_REVERSED" });
  });

  it("records an authoritative MaaS time delta", () => {
    expect(validateRailTimetable(railQuery, [{ ...railRecord, arrival: "2026-08-31T14:10:00+08:00" }], true, context)).toMatchObject({ validationStatus: "VERIFIED", arrivalDeltaSec: 60 });
  });

  it("returns UNKNOWN when the timetable date is unpublished", () => {
    expect(validateRailTimetable(railQuery, [railRecord], false, context)).toMatchObject({ validationStatus: "UNKNOWN", reasonCode: "TIMETABLE_DATE_NOT_PUBLISHED" });
  });

  it("matches a missing train number only through a unique time window", () => {
    expect(validateRailTimetable({ ...railQuery, trainNo: null }, [railRecord], true, context)).toMatchObject({ validationStatus: "VERIFIED", matchedBy: "UNIQUE_TIME_WINDOW" });
  });

  it("keeps tied duplicate time-window matches UNKNOWN", () => {
    expect(validateRailTimetable({ ...railQuery, trainNo: null }, [railRecord, { ...railRecord, trainNo: "0642" }], true, context)).toMatchObject({ validationStatus: "UNKNOWN", reasonCode: "AMBIGUOUS_SERVICE_MATCH" });
  });

  it("selects the uniquely closest service inside the bounded time window", () => {
    const nearby = { ...railRecord, trainNo: "0826", departure: "2026-08-31T12:25:00+08:00", arrival: "2026-08-31T14:18:00+08:00" };
    expect(validateRailTimetable({ ...railQuery, trainNo: null }, [nearby, railRecord], true, context)).toMatchObject({ validationStatus: "VERIFIED", normalizedQuery: { matchedTrainNo: "0640" } });
  });

  it("treats a cancelled service as a mismatch", () => {
    expect(validateRailTimetable(railQuery, [{ ...railRecord, cancelled: true }], true, context)).toMatchObject({ validationStatus: "MISMATCH", reasonCode: "RAIL_SERVICE_CANCELLED" });
  });

  it("preserves an overnight record on the stated service date", () => {
    expect(validateRailTimetable(railQuery, [{ ...railRecord, overnight: true }], true, context).validationStatus).toBe("VERIFIED");
  });

  it("deduplicates a train-number key and a time-window key deterministically", () => {
    expect(railValidationKey(railQuery)).toBe("THSR|2026-08-31|0640|1070|1020");
    expect(railValidationKey({ ...railQuery, trainNo: null })).toContain("2026-08-31T12:35:00+08:00|2026-08-31T14:09:00+08:00");
  });
});

describe("explicit fare policies", () => {
  const policy = { passengerType: "ADULT", ticketType: "FULL", fareClass: "STANDARD", cabinClass: "RESERVED" };
  const intended: NormalizedFareOption = { ...policy, fareTwd: 1_330 };

  it("selects only the intended fare record", () => {
    expect(selectFareByPolicy([intended, { ...intended, cabinClass: "BUSINESS", fareTwd: 2_000 }], policy)).toEqual(intended);
  });

  it("keeps an unmatched fare policy null", () => {
    expect(selectFareByPolicy([{ ...intended, cabinClass: "BUSINESS" }], policy)).toBeNull();
  });

  it("never promotes a zero fare", () => {
    expect(selectFareByPolicy([{ ...intended, fareTwd: 0 }], policy)).toBeNull();
  });

  it("attaches complete policy metadata", () => {
    const evidence = validateRailTimetable(railQuery, [railRecord], true, context);
    expect(attachFare(evidence, intended, "NO_FARE")).toMatchObject({ fareTwd: 1330, fareCoverage: "COMPLETE", ticketType: "FULL" });
  });
});

describe("Bus v2 validation", () => {
  it("matches a Taoyuan route, direction and stop sequence", () => {
    expect(validateBusTimetable(busQuery, [busRoute()], [busTimetable], context)).toMatchObject({ validationStatus: "VERIFIED", dataQuality: "STOP_LEVEL_TIMETABLE" });
  });

  it("matches the same normalized contract for Kaohsiung", () => {
    const query = { ...busQuery, jurisdiction: "Kaohsiung" as const };
    const route = busRoute("Kaohsiung");
    const timetable = { ...busTimetable, routeUid: route.routeUid, subRouteUid: route.subRouteUid };
    expect(validateBusTimetable(query, [route], [timetable], context).validationStatus).toBe("VERIFIED");
  });

  it("keeps a wrong direction unknown", () => {
    expect(validateBusTimetable({ ...busQuery, direction: 1 }, [busRoute()], [busTimetable], context)).toMatchObject({ validationStatus: "UNKNOWN", reasonCode: "BUS_ROUTE_OR_STOPS_NOT_MATCHED" });
  });

  it("marks reversed stop order as a mismatch", () => {
    const route = busRoute();
    route.stops.reverse();
    route.stops[0].stopSequence = 1;
    route.stops[1].stopSequence = 2;
    expect(validateBusTimetable(busQuery, [route], [busTimetable], context)).toMatchObject({ validationStatus: "MISMATCH", reasonCode: "BUS_STOP_ORDER_REVERSED" });
  });

  it("keeps missing stop-level timing unknown", () => {
    expect(validateBusTimetable(busQuery, [busRoute()], [], context)).toMatchObject({ validationStatus: "UNKNOWN", reasonCode: "BUS_STOP_LEVEL_TIMING_UNAVAILABLE", dataQuality: "ROUTE_ONLY" });
  });

  it("keeps route-name ambiguity unknown", () => {
    expect(validateBusTimetable(busQuery, [busRoute(), { ...busRoute(), subRouteUid: "another" }], [], context)).toMatchObject({ validationStatus: "UNKNOWN", reasonCode: "BUS_ROUTE_DIRECTION_AMBIGUOUS" });
  });

  it("does not turn origin-only or frequency evidence into an exact schedule", () => {
    const originOnly = { ...busTimetable, stopTimes: [{ stopUid: "board", arrival: null, departure: "2026-08-31T14:19:00+08:00" }] };
    expect(validateBusTimetable(busQuery, [busRoute()], [originOnly], context)).toMatchObject({ validationStatus: "UNKNOWN", dataQuality: "ORIGIN_ONLY_SCHEDULE" });
  });

  it("does not accept ETA as fixed snapshot evidence", () => {
    expect(validateBusTimetable(busQuery, [busRoute()], [], context).validationStatus).toBe("UNKNOWN");
  });

  it("keeps provider failure/no records unknown instead of impossible", () => {
    expect(validateBusTimetable(busQuery, [], [], context)).toMatchObject({ validationStatus: "UNKNOWN" });
  });

  it("builds a key containing jurisdiction, service day and planned departure", () => {
    expect(busValidationKey(busQuery)).toContain("Taoyuan|208A|?|?|捷運高鐵桃園站|福德宮|2026-08-31|2026-08-31T14:19:00+08:00");
  });
});

const source = { provider: "fixture", retrievedAt: context.retrievedAt, dataMode: "FIXTURE" as const };
const place = { id: "station", name: "Station" };
const step = (id: string, type: JourneyStep["type"], start: string, end: string): JourneyStep => ({
  id, type, from: place, to: place, plannedStart: start, plannedEnd: end,
  durationSec: (Date.parse(end) - Date.parse(start)) / 1000,
  costTwd: type === "RIDE" ? null : 0, timingQuality: "SCHEDULED", source,
  ...(type === "RIDE" || type === "BOARD" || type === "ALIGHT" ? { service: { mode: "THSR" as const } } : {}),
});

function candidate(id: string, completion = "2026-08-31T14:20:00+08:00"): CandidateJourney {
  return {
    id, originId: "origin", destinationId: "goal", legs: [], departAt: "2026-08-31T12:00:00+08:00", arriveAt: completion,
    goalCompletionAt: completion, totalDurationMinutes: 140, totalWaitingMinutes: 0, totalTransferMinutes: 0,
    totalWalkingMinutes: 0, minimumTransferSlackMinutes: null, tightTransferCount: 0, totalCost: null,
    walkingMinutes: 0, transferCount: 0, estimatedCost: null, costCoverage: "UNKNOWN", connectionRiskScore: 0,
  };
}

function verifiedEvidence(overrides: Partial<ModeValidationEvidence> = {}): ModeValidationEvidence {
  return {
    validationStatus: "VERIFIED", provider: "TDX", serviceDate: "2026-08-31", endpointName: "fixture", normalizedQuery: {},
    retrievedAt: context.retrievedAt, timezone: "Asia/Taipei", matchedBy: "TRAIN_NUMBER_AND_OD",
    authoritativeDeparture: "2026-08-31T12:20:00+08:00", authoritativeArrival: "2026-08-31T12:40:00+08:00",
    originalMaasDeparture: "2026-08-31T12:20:00+08:00", originalMaasArrival: "2026-08-31T12:40:00+08:00",
    departureDeltaSec: 0, arrivalDeltaSec: 0, dataQuality: "EXACT_SCHEDULE", reasonCode: "VERIFIED",
    fareTwd: null, fareCoverage: "UNKNOWN", ticketType: null, fareClass: null, cabinClass: null,
    provenance: { provider: "TDX", apiFamily: "Rail", apiVersion: "v2", sourceUrl: context.sourceUrl }, ...overrides,
  };
}

describe("authoritative recomputation and formal gates", () => {
  it("recomputes downstream connection and keeps transfer buffer application count at one", () => {
    const base = candidate("c");
    base.steps = [
      step("ride-1", "RIDE", "2026-08-31T12:00:00+08:00", "2026-08-31T12:10:00+08:00"),
      step("alight-1", "ALIGHT", "2026-08-31T12:10:00+08:00", "2026-08-31T12:10:00+08:00"),
      step("walk", "TRANSFER_WALK", "2026-08-31T12:10:00+08:00", "2026-08-31T12:12:00+08:00"),
      step("wait", "WAIT", "2026-08-31T12:12:00+08:00", "2026-08-31T12:15:00+08:00"),
      step("board-2", "BOARD", "2026-08-31T12:15:00+08:00", "2026-08-31T12:15:00+08:00"),
      step("ride-2", "RIDE", "2026-08-31T12:15:00+08:00", "2026-08-31T12:30:00+08:00"),
      step("alight-2", "ALIGHT", "2026-08-31T12:30:00+08:00", "2026-08-31T12:30:00+08:00"),
      step("goal", "GOAL_ACCESS", "2026-08-31T12:30:00+08:00", "2026-08-31T12:35:00+08:00"),
      step("complete", "GOAL_COMPLETION", "2026-08-31T12:35:00+08:00", "2026-08-31T12:35:00+08:00"),
    ];
    const evidence = new Map([
      ["ride-1", verifiedEvidence({ authoritativeDeparture: "2026-08-31T12:00:00+08:00", authoritativeArrival: "2026-08-31T12:10:01+08:00" })],
      ["ride-2", verifiedEvidence({ authoritativeDeparture: "2026-08-31T12:15:00+08:00", authoritativeArrival: "2026-08-31T12:30:00+08:00" })],
    ]);
    const result = recomputeCandidateWithEvidence(base, evidence);
    expect(result.connection.status).toBe("IMPOSSIBLE");
    expect(result.connection.diagnostics[0]).toMatchObject({ connectionSlackSec: -1, appliedTransferBufferSec: 180, transferBufferApplicationCount: 1 });
    expect(result.candidate.steps?.map((item) => item.type)).toContain("GOAL_COMPLETION");
  });

  it("returns UNKNOWN rather than IMPOSSIBLE for missing evidence", () => {
    const base = candidate("unknown");
    base.steps = [step("ride", "RIDE", "2026-08-31T12:00:00+08:00", "2026-08-31T12:30:00+08:00")];
    expect(resolveCandidate(base)).toMatchObject({ resolution: "UNKNOWN", timedLegsComplete: false });
  });

  it("blocks formal Fastest when an unresolved candidate may be faster", () => {
    const known = candidate("known", "2026-08-31T14:20:00+08:00");
    const unknown = candidate("unknown", "2026-08-31T14:10:00+08:00");
    const resolutions: CandidateResolution[] = [
      { candidateId: "known", resolution: "VALIDATED_FEASIBLE", reasonCodes: [], timedLegsComplete: true, fareComplete: false, connection: { status: "FEASIBLE", minimumConnectionSlackSec: null, transferSlacksSec: [], diagnostics: [], reasonCodes: ["CONNECTIONS_VALID"] } },
      { candidateId: "unknown", resolution: "UNKNOWN", reasonCodes: [], timedLegsComplete: false, fareComplete: false, connection: { status: "UNKNOWN", minimumConnectionSlackSec: null, transferSlacksSec: [], diagnostics: [], reasonCodes: ["INVALID_STEP_TIMESTAMP"] } },
    ];
    expect(evaluateFormalRecommendationGates([known, unknown], resolutions).fastest).toMatchObject({ available: false, reasonCode: "UNRESOLVED_CANDIDATE_MAY_BE_FASTER" });
  });

  it("allows formal Fastest while incomplete fare blocks Balanced and Cheapest", () => {
    const first = candidate("first", "2026-08-31T14:10:00+08:00");
    const second = candidate("second", "2026-08-31T14:20:00+08:00");
    const resolved = (id: string): CandidateResolution => ({ candidateId: id, resolution: "VALIDATED_FEASIBLE", reasonCodes: [], timedLegsComplete: true, fareComplete: false, connection: { status: "FEASIBLE", minimumConnectionSlackSec: null, transferSlacksSec: [], diagnostics: [], reasonCodes: ["CONNECTIONS_VALID"] } });
    const gates = evaluateFormalRecommendationGates([first, second], [resolved("first"), resolved("second")]);
    expect(gates.fastest).toMatchObject({ available: true, candidateId: "first" });
    expect(gates.balanced).toMatchObject({ available: false, reasonCode: "INCOMPLETE_BALANCED_METRICS" });
    expect(gates.cheapest).toMatchObject({ available: false, reasonCode: "INCOMPLETE_FARE_COVERAGE" });
  });

  it("never converts an unknown journey fare to zero", () => {
    expect(candidate("unknown")).toMatchObject({ totalCost: null, estimatedCost: null, costCoverage: "UNKNOWN" });
  });
});
