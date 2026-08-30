import { describe, expect, it } from "vitest";
import { evaluateCandidateFeasibility, evaluateJourneyFeasibility } from "../src/journey/feasibility";
import type { CandidateJourney, JourneyGoal, JourneyRequest } from "../src/journey/types";

const baseGoal: JourneyGoal = {
  id: "appointment",
  title: "Reach the appointment",
  goalType: "APPOINTMENT_CUTOFF",
  destinationId: "destination",
  deadlineAt: "2026-08-24T10:20:00+08:00",
  deadlineVerified: true,
  requiredSafetyBufferMinutes: 10,
  goalActionBufferMinutes: 5,
  source: { label: "Verified test source" },
};

const request: JourneyRequest = {
  originId: "origin",
  destinationId: "destination",
  origin: { text: "Origin" },
  destination: { text: "Destination" },
  departAt: "2026-08-24T09:00:00+08:00",
  travelerState: {
    luggage: { value: "NONE", source: "CURRENT_REQUEST" }, purpose: { value: "ERRAND", source: "CURRENT_REQUEST" },
    speedPriority: { value: "HIGH", source: "CURRENT_REQUEST" }, costSensitivity: { value: "LOW", source: "CURRENT_REQUEST" },
    ownsCar: { value: "NO", source: "CURRENT_REQUEST" }, ownsScooter: { value: "NO", source: "CURRENT_REQUEST" },
    canUseBike: { value: "NO", source: "CURRENT_REQUEST" }, willingToUseTaxi: { value: "NO", source: "CURRENT_REQUEST" },
  },
  preferences: {}, policy: "DEADLINE_CRITICAL", constraints: {}, activities: [], goal: baseGoal,
};

const candidate: CandidateJourney = {
  id: "candidate", originId: "origin", destinationId: "destination",
  legs: [{ type: "TRAVEL", mode: "THSR", fromNodeId: "origin", toNodeId: "destination", departAt: "2026-08-24T09:00:00+08:00", arriveAt: "2026-08-24T10:00:00+08:00", durationMinutes: 60, serviceId: "service", estimatedCost: 0 }],
  departAt: "2026-08-24T09:00:00+08:00", arriveAt: "2026-08-24T10:00:00+08:00",
  totalDurationMinutes: 60, totalWaitingMinutes: 0, totalTransferMinutes: 0, totalWalkingMinutes: 0,
  minimumTransferSlackMinutes: null, tightTransferCount: 0, totalCost: 0, walkingMinutes: 0,
  transferCount: 0, estimatedCost: 0, connectionRiskScore: 0,
};

describe("goal-aware feasibility", () => {
  it("adds the goal action buffer before measuring the verified safety margin", () => {
    expect(evaluateCandidateFeasibility(candidate, request)).toMatchObject({
      status: "FEASIBLE",
      goalReadyAt: "2026-08-24T02:05:00.000Z",
      safetyMarginMinutes: 15,
    });
  });

  it("returns RISKY and IMPOSSIBLE at deterministic goal boundaries", () => {
    const risky = { ...request, goal: { ...baseGoal, deadlineAt: "2026-08-24T10:14:00+08:00" } };
    const impossible = { ...request, goal: { ...baseGoal, deadlineAt: "2026-08-24T10:04:00+08:00" } };
    expect(evaluateCandidateFeasibility(candidate, risky)).toMatchObject({ status: "RISKY", safetyMarginMinutes: 9 });
    expect(evaluateCandidateFeasibility(candidate, impossible)).toMatchObject({ status: "IMPOSSIBLE", safetyMarginMinutes: -1 });
  });

  it("fails closed to UNKNOWN for an unverified deadline or unavailable journey data", () => {
    const unverified = { ...request, goal: { ...baseGoal, deadlineAt: null, deadlineVerified: false } };
    expect(evaluateCandidateFeasibility(candidate, unverified)).toMatchObject({ status: "UNKNOWN", reasonCodes: ["GOAL_DEADLINE_UNVERIFIED"] });
    expect(evaluateJourneyFeasibility([candidate], request, { journeyDataAvailability: "UNAVAILABLE" })).toMatchObject({ status: "UNKNOWN", reasonCodes: ["REQUIRED_JOURNEY_DATA_UNAVAILABLE"] });
    expect(evaluateJourneyFeasibility([], request)).toMatchObject({ status: "IMPOSSIBLE", reasonCodes: ["NO_EXECUTABLE_JOURNEY"] });
  });
});
