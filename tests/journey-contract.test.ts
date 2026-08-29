import { describe, expect, it } from "vitest";
import { POLICY_WEIGHTS } from "../src/journey/policies";
import type {
  ClarificationRequest,
  JourneyCandidate,
  JourneyRequest,
  TravelerState,
} from "../src/journey/types";

const unknownTraveler: TravelerState = {
  luggage: { value: "UNKNOWN", source: "UNKNOWN" },
  purpose: { value: "UNKNOWN", source: "UNKNOWN" },
  speedPriority: { value: "UNKNOWN", source: "UNKNOWN" },
  costSensitivity: { value: "UNKNOWN", source: "UNKNOWN" },
  ownsCar: { value: "UNKNOWN", source: "UNKNOWN" },
  ownsScooter: { value: "UNKNOWN", source: "UNKNOWN" },
  canUseBike: { value: "UNKNOWN", source: "UNKNOWN" },
  willingToUseTaxi: { value: "UNKNOWN", source: "UNKNOWN" },
};

describe("Journey Engine contracts", () => {
  it("provides all five inspectable policy presets", () => {
    expect(Object.keys(POLICY_WEIGHTS)).toEqual(["FASTEST", "BALANCED", "CHEAPEST", "LEISURE", "DEADLINE_CRITICAL"]);
    expect(Object.values(POLICY_WEIGHTS).every((weights) => Object.values(weights).reduce((sum, weight) => sum + weight, 0) === 100)).toBe(true);
  });

  it("represents unknown trip state without persistent identity", () => {
    expect(unknownTraveler.luggage).toEqual({ value: "UNKNOWN", source: "UNKNOWN" });
    expect(Object.keys(unknownTraveler)).not.toContain("accountId");
    expect(Object.keys(unknownTraveler)).not.toContain("email");
  });

  it("represents a resolved journey request with large luggage and leisure preferences", () => {
    const request: JourneyRequest = {
      originId: "fengshan-kaohsiung",
      destinationId: "bade-taoyuan",
      origin: { text: "Fengshan, Kaohsiung" },
      destination: { text: "Bade, Taoyuan" },
      departAt: "2030-06-15T07:00:00+08:00",
      travelerState: { ...unknownTraveler, luggage: { value: "LARGE", source: "USER_STATED" }, purpose: { value: "LEISURE", source: "CURRENT_REQUEST" } },
      preferences: { luggage: "BULKY" },
      policy: "CHEAPEST",
      constraints: { maxWalkingMinutes: 20, avoidTaxi: false },
      activities: [{ type: "MEAL", durationMinutes: 30, preferredLocation: "Taichung" }],
    };

    expect(request).toMatchObject({ origin: { text: "Fengshan, Kaohsiung" }, destination: { text: "Bade, Taoyuan" }, policy: "CHEAPEST", travelerState: { luggage: { value: "LARGE", source: "USER_STATED" }, purpose: { value: "LEISURE" } } });
  });

  it("represents travel and activity legs in one candidate", () => {
    const candidate: JourneyCandidate = {
      id: "candidate-1",
      originId: "kaohsiung",
      destinationId: "taichung",
      legs: [
        { type: "TRAVEL", mode: "THSR", fromNodeId: "kaohsiung", toNodeId: "taichung", departAt: "2030-06-15T08:00:00+08:00", arriveAt: "2030-06-15T09:00:00+08:00", durationMinutes: 60, serviceId: "thsr-1", estimatedCost: 700 },
        { type: "ACTIVITY", activityType: "MEAL", locationNodeId: "taichung", startAt: "2030-06-15T09:00:00+08:00", endAt: "2030-06-15T09:30:00+08:00", durationMinutes: 30 },
      ],
      departAt: "2030-06-15T08:00:00+08:00",
      arriveAt: "2030-06-15T09:30:00+08:00",
      totalDurationMinutes: 90,
      totalWaitingMinutes: 0,
      totalTransferMinutes: 0,
      totalWalkingMinutes: 0,
      minimumTransferSlackMinutes: null,
      tightTransferCount: 0,
      totalCost: 700,
      walkingMinutes: 5,
      transferCount: 0,
      estimatedCost: 700,
      connectionRiskScore: 0.1,
    };

    expect(candidate.legs.map((leg) => leg.type)).toEqual(["TRAVEL", "ACTIVITY"]);
  });

  it("represents a clarification request without selecting one", () => {
    const clarification: ClarificationRequest = {
      field: "travelerState.luggage",
      question: "Does the traveler have large luggage?",
      reason: "The cheaper journey requires substantially more walking.",
    };
    expect(clarification.field).toBe("travelerState.luggage");
  });
});
