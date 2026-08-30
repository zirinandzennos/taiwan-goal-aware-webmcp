import { describe, expect, it } from "vitest";
import {
  evaluateCandidateFeasibility,
  evaluateJourneyFeasibility,
} from "../src/journey/feasibility";
import { DEFAULT_ARRIVAL_SAFETY_BUFFER_MINUTES } from "../src/journey/policies";
import type { CandidateJourney, JourneyRequest } from "../src/journey/types";

const unknownTraveler = {
  luggage: { value: "UNKNOWN" as const, source: "UNKNOWN" as const },
  purpose: { value: "UNKNOWN" as const, source: "UNKNOWN" as const },
  speedPriority: { value: "UNKNOWN" as const, source: "UNKNOWN" as const },
  costSensitivity: { value: "UNKNOWN" as const, source: "UNKNOWN" as const },
  ownsCar: { value: "UNKNOWN" as const, source: "UNKNOWN" as const },
  ownsScooter: { value: "UNKNOWN" as const, source: "UNKNOWN" as const },
  canUseBike: { value: "UNKNOWN" as const, source: "UNKNOWN" as const },
  willingToUseTaxi: { value: "UNKNOWN" as const, source: "UNKNOWN" as const },
};

function request(arriveBy?: string): JourneyRequest {
  return {
    originId: "origin",
    destinationId: "destination",
    origin: { text: "Origin" },
    destination: { text: "Destination" },
    departAt: "2030-06-15T07:00:00+08:00",
    travelerState: unknownTraveler,
    preferences: {},
    policy: "BALANCED",
    constraints: arriveBy === undefined ? {} : { arriveBy },
    activities: [],
  };
}

function candidate(overrides: Partial<CandidateJourney> = {}): CandidateJourney {
  const id = overrides.id ?? "candidate";
  const arriveAt = overrides.arriveAt ?? "2030-06-15T10:00:00+08:00";
  return {
    id,
    originId: "origin",
    destinationId: "destination",
    legs: [{ type: "TRAVEL", serviceId: `service-${id}`, mode: "BUS", fromNodeId: "origin", toNodeId: "destination", departAt: "2030-06-15T07:00:00+08:00", arriveAt, durationMinutes: 180, estimatedCost: 100 }],
    departAt: "2030-06-15T07:00:00+08:00",
    arriveAt,
    totalDurationMinutes: 180,
    totalWaitingMinutes: 0,
    totalTransferMinutes: 0,
    totalWalkingMinutes: 0,
    minimumTransferSlackMinutes: null,
    tightTransferCount: 0,
    totalCost: 100,
    walkingMinutes: 0,
    transferCount: 0,
    estimatedCost: 100,
    connectionRiskScore: 0,
    ...overrides,
  };
}

describe("deterministic journey feasibility", () => {
  it("treats a safe journey with no requested deadline as FEASIBLE", () => {
    const result = evaluateCandidateFeasibility(candidate(), request());
    expect(result).toMatchObject({ status: "FEASIBLE", deadlineAt: null, deadlineMarginMinutes: null, reasonCodes: ["JOURNEY_MEETS_CONSTRAINTS"] });
  });

  it("applies exact deterministic deadline boundaries", () => {
    expect(DEFAULT_ARRIVAL_SAFETY_BUFFER_MINUTES).toBe(10);
    expect(evaluateCandidateFeasibility(candidate(), request("2030-06-15T10:10:00+08:00")).status).toBe("FEASIBLE");
    expect(evaluateCandidateFeasibility(candidate(), request("2030-06-15T10:09:00+08:00")).status).toBe("RISKY");
    expect(evaluateCandidateFeasibility(candidate(), request("2030-06-15T10:00:00+08:00")).status).toBe("RISKY");
    expect(evaluateCandidateFeasibility(candidate(), request("2030-06-15T09:59:00+08:00"))).toMatchObject({ status: "IMPOSSIBLE", reasonCodes: ["ARRIVAL_AFTER_HARD_DEADLINE"] });
  });

  it("collects deadline and transfer risks together", () => {
    const result = evaluateCandidateFeasibility(candidate({ minimumTransferSlackMinutes: 4, tightTransferCount: 1 }), request("2030-06-15T10:01:00+08:00"));
    expect(result).toMatchObject({ status: "RISKY", reasonCodes: ["INSUFFICIENT_ARRIVAL_BUFFER", "TIGHT_TRANSFER"] });
  });

  it("treats technically feasible transfer slack below five minutes as RISKY", () => {
    expect(evaluateCandidateFeasibility(candidate({ minimumTransferSlackMinutes: 0, tightTransferCount: 1 }), request()).status).toBe("RISKY");
    expect(evaluateCandidateFeasibility(candidate({ minimumTransferSlackMinutes: 4, tightTransferCount: 1 }), request()).status).toBe("RISKY");
    expect(evaluateCandidateFeasibility(candidate({ minimumTransferSlackMinutes: 5, tightTransferCount: 0 }), request()).status).toBe("FEASIBLE");
  });

  it("returns UNKNOWN for an explicitly required but unavailable or invalid deadline", () => {
    expect(evaluateCandidateFeasibility(candidate(), request(), { deadlineRequired: true, deadlineAvailability: "UNAVAILABLE" })).toMatchObject({ status: "UNKNOWN", reasonCodes: ["REQUIRED_DEADLINE_UNAVAILABLE"] });
    expect(evaluateCandidateFeasibility(candidate(), request("not-a-timestamp"))).toMatchObject({ status: "UNKNOWN", reasonCodes: ["INVALID_REQUIRED_TIMESTAMP"] });
  });

  it("never marks missing required deadlines or missed hard deadlines as FEASIBLE", () => {
    expect(evaluateCandidateFeasibility(candidate(), request(), { deadlineRequired: true }).status).not.toBe("FEASIBLE");
    expect(evaluateCandidateFeasibility(candidate(), request("2030-06-15T09:59:00+08:00")).status).not.toBe("FEASIBLE");
  });

  it("aggregates FEASIBLE, RISKY, IMPOSSIBLE, and UNKNOWN without ranking", () => {
    const safe = candidate({ id: "safe" });
    const risky = candidate({ id: "risky", minimumTransferSlackMinutes: 1, tightTransferCount: 1 });
    const missed = candidate({ id: "missed", arriveAt: "2030-06-15T10:20:00+08:00" });
    expect(evaluateJourneyFeasibility([risky, safe], request()).status).toBe("FEASIBLE");
    expect(evaluateJourneyFeasibility([risky], request()).status).toBe("RISKY");
    expect(evaluateJourneyFeasibility([missed], request("2030-06-15T10:00:00+08:00")).status).toBe("IMPOSSIBLE");
    expect(evaluateJourneyFeasibility([safe], request(), { journeyDataAvailability: "UNAVAILABLE" })).toMatchObject({ status: "UNKNOWN", reasonCodes: ["REQUIRED_JOURNEY_DATA_UNAVAILABLE"] });
  });

  it("distinguishes an empty complete timetable from unavailable required data", () => {
    expect(evaluateJourneyFeasibility([], request())).toEqual({ status: "IMPOSSIBLE", candidateFeasibilities: [], reasonCodes: ["NO_EXECUTABLE_JOURNEY"] });
    expect(evaluateJourneyFeasibility([], request(), { journeyDataAvailability: "UNAVAILABLE" })).toEqual({ status: "UNKNOWN", candidateFeasibilities: [], reasonCodes: ["REQUIRED_JOURNEY_DATA_UNAVAILABLE"] });
  });

  it("returns UNKNOWN instead of throwing for an invalid required candidate timestamp", () => {
    expect(evaluateCandidateFeasibility(candidate({ arriveAt: "invalid" }), request())).toMatchObject({ status: "UNKNOWN", reasonCodes: ["INVALID_REQUIRED_TIMESTAMP"] });
  });

  it("is deterministic and does not consult the wall clock", () => {
    const previousNow = Date.now;
    Date.now = () => { throw new Error("wall clock must not be read"); };
    try {
      const first = evaluateJourneyFeasibility([candidate()], request("2030-06-15T10:10:00+08:00"));
      const repeated = Array.from({ length: 20 }, () => evaluateJourneyFeasibility([candidate()], request("2030-06-15T10:10:00+08:00")));
      expect(repeated.every((result) => JSON.stringify(result) === JSON.stringify(first))).toBe(true);
    } finally {
      Date.now = previousNow;
    }
  });
});
