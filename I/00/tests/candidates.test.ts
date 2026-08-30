import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_TRANSFERS, generateCandidateJourneys } from "../src/journey/candidates";
import {
  syntheticScheduledServices,
  syntheticTransferRules,
} from "../src/journey/syntheticTimetable";
import type { JourneyRequest, ScheduledService, TransferRule } from "../src/journey/types";

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

function requestAt(
  departAt: string,
  constraints: JourneyRequest["constraints"] = {},
): JourneyRequest {
  return {
    originId: "kaohsiung-xiaogang",
    destinationId: "taoyuan-bade",
    origin: { text: "Kaohsiung Xiaogang", canonicalPlaceId: "kaohsiung-xiaogang" },
    destination: { text: "Bade, Taoyuan", canonicalPlaceId: "taoyuan-bade" },
    departAt,
    travelerState: unknownTraveler,
    preferences: {},
    policy: "BALANCED",
    constraints,
    activities: [],
  };
}

function generated(request: JourneyRequest): ReturnType<typeof generateCandidateJourneys> {
  return generateCandidateJourneys(request, syntheticScheduledServices, syntheticTransferRules);
}

function serviceIds(candidate: ReturnType<typeof generated>[number]): string[] {
  return candidate.legs.map((leg) => leg.type === "TRAVEL" ? leg.serviceId : "ACTIVITY");
}

describe("candidate journey generation", () => {
  it("builds complete service chains from the canonical timetable", () => {
    const candidates = generated(requestAt("2030-06-15T07:00:00+08:00", { avoidTaxi: true }));
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates.every((candidate) => candidate.originId === "kaohsiung-xiaogang" && candidate.destinationId === "taoyuan-bade")).toBe(true);
    expect(candidates.every((candidate) => {
      const finalLeg = candidate.legs.at(-1);
      return finalLeg?.type === "TRAVEL" && finalLeg.toNodeId === "taoyuan-bade";
    })).toBe(true);
  });

  it("uses valid transfer feasibility rather than raw arrival/departure comparison", () => {
    const request = { ...requestAt("2030-06-15T16:45:00+08:00", { avoidTaxi: true }), originId: "xiaogang-mrt", destinationId: "taoyuan-thsr", origin: { text: "Xiaogang MRT" }, destination: { text: "Taoyuan THSR" } };
    const candidateServiceIds = generated(request).map(serviceIds);
    expect(candidateServiceIds.some((ids) => ids.includes("thsr-zuoying-1734"))).toBe(false);
    expect(candidateServiceIds.some((ids) => ids.includes("thsr-zuoying-1742"))).toBe(true);
  });

  it("changes complete candidates when the requested departure changes", () => {
    const early = generated(requestAt("2030-06-15T07:00:00+08:00", { avoidTaxi: true })).map(serviceIds);
    const late = generated(requestAt("2030-06-15T07:12:00+08:00", { avoidTaxi: true })).map(serviceIds);
    expect(early.some((ids) => ids[0] === "bus-xiaogang-0705")).toBe(true);
    expect(late.some((ids) => ids[0] === "bus-xiaogang-0705")).toBe(false);
    expect(late.some((ids) => ids[0] === "bus-xiaogang-0720")).toBe(true);
  });

  it("enforces avoidTaxi during search while preserving non-taxi candidates", () => {
    const withTaxi = generated(requestAt("2030-06-15T07:00:00+08:00", { avoidTaxi: false }));
    const withoutTaxi = generated(requestAt("2030-06-15T07:00:00+08:00", { avoidTaxi: true }));
    expect(withTaxi.some((candidate) => candidate.legs.some((leg) => leg.type === "TRAVEL" && leg.mode === "TAXI"))).toBe(true);
    expect(withoutTaxi.every((candidate) => candidate.legs.every((leg) => leg.type !== "TRAVEL" || leg.mode !== "TAXI"))).toBe(true);
    expect(withoutTaxi.length).toBeGreaterThan(0);
    expect(withTaxi.length).toBeGreaterThan(withoutTaxi.length);
  });

  it("uses legs minus one as transfer count and rejects paths above maxTransfers", () => {
    const unrestricted = generated(requestAt("2030-06-15T07:00:00+08:00", { avoidTaxi: true }));
    expect(unrestricted.some((candidate) => candidate.transferCount === candidate.legs.length - 1)).toBe(true);
    expect(generated(requestAt("2030-06-15T07:00:00+08:00", { avoidTaxi: true, maxTransfers: 2 }))).toEqual([]);
  });

  it("uses a centralized default max-transfer bound", () => {
    expect(DEFAULT_MAX_TRANSFERS).toBe(4);
  });

  it("rejects chains whose needed transfer rule is missing", () => {
    const rulesWithoutFinalTransfer = syntheticTransferRules.filter((rule) => !(rule.fromNodeId === "taoyuan-thsr" && rule.toNodeId === "taoyuan-bus"));
    expect(generateCandidateJourneys(requestAt("2030-06-15T07:00:00+08:00", { avoidTaxi: true }), syntheticScheduledServices, rulesWithoutFinalTransfer)).toEqual([]);
  });

  it("does not create candidates from invalid service times", () => {
    const invalidTimetable = syntheticScheduledServices.map((service) => service.id === "bus-xiaogang-0705" ? { ...service, arrivalAt: "invalid" } : service);
    expect(generateCandidateJourneys(requestAt("2030-06-15T07:00:00+08:00", { avoidTaxi: true }), invalidTimetable, syntheticTransferRules).every((candidate) => !serviceIds(candidate).includes("bus-xiaogang-0705"))).toBe(true);
  });

  it("protects against node and service cycles", () => {
    const cycleServices: ScheduledService[] = [
      { id: "a-to-b", mode: "BUS", fromNodeId: "a", toNodeId: "b", departureAt: "2030-06-15T07:00:00+08:00", arrivalAt: "2030-06-15T07:10:00+08:00", cost: 1 },
      { id: "b-to-a", mode: "BUS", fromNodeId: "b", toNodeId: "a", departureAt: "2030-06-15T07:15:00+08:00", arrivalAt: "2030-06-15T07:25:00+08:00", cost: 1 },
      { id: "b-to-d", mode: "BUS", fromNodeId: "b", toNodeId: "d", departureAt: "2030-06-15T07:20:00+08:00", arrivalAt: "2030-06-15T07:30:00+08:00", cost: 1 },
    ];
    const cycleRules: TransferRule[] = [{ fromNodeId: "b", toNodeId: "b", walkingMinutes: 0, minimumTransferMinutes: 0 }];
    const cycleRequest = { ...requestAt("2030-06-15T06:50:00+08:00"), originId: "a", destinationId: "d", origin: { text: "A" }, destination: { text: "D" } };
    expect(generateCandidateJourneys(cycleRequest, cycleServices, cycleRules).map(serviceIds)).toEqual([["a-to-b", "b-to-d"]]);
  });

  it("calculates candidate metrics from the generated service chain", () => {
    const candidate = generated(requestAt("2030-06-15T07:00:00+08:00", { avoidTaxi: true })).find((item) => item.id === "journey:bus-xiaogang-0705>mrt-xiaogang-0725>thsr-zuoying-0830>bus-taoyuan-1922");
    expect(candidate).toMatchObject({ departAt: "2030-06-15T07:05:00+08:00", arriveAt: "2030-06-15T19:52:00+08:00", journeyStartAt: "2030-06-15T07:00:00+08:00", goalCompletedAt: "2030-06-15T11:52:00.000Z", totalDurationMinutes: 772, initialWaitingMinutes: 5, transferWaitingMinutes: 561, totalTransferMinutes: 36, totalWaitingMinutes: 566, totalWalkingMinutes: 23, minimumTransferSlackMinutes: 4, tightTransferCount: 1, totalCost: 1_400, totalKnownCost: 1_400, fareCoverage: "COMPLETE", transferCount: 3, walkingMinutes: 23 });
  });

  it("has deterministic candidate IDs, content, order, and no wall-clock dependency", () => {
    const previousNow = Date.now;
    Date.now = () => { throw new Error("wall clock must not be read"); };
    try {
      const first = generated(requestAt("2030-06-15T07:00:00+08:00"));
      const repeated = Array.from({ length: 100 }, () => generated(requestAt("2030-06-15T07:00:00+08:00")));
      expect(repeated.every((result) => JSON.stringify(result) === JSON.stringify(first))).toBe(true);
      expect(first.map((candidate) => candidate.id)).toEqual([...first].sort((a, b) => a.departAt.localeCompare(b.departAt) || a.arriveAt.localeCompare(b.arriveAt) || a.id.localeCompare(b.id)).map((candidate) => candidate.id));
    } finally {
      Date.now = previousNow;
    }
  });
});
