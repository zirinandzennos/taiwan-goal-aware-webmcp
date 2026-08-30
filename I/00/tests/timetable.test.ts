import { describe, expect, it } from "vitest";
import {
  SYNTHETIC_CHALLENGE_FIXTURE_NOTICE,
  syntheticJourneyNodes,
  syntheticScheduledServices,
  syntheticTransferRules,
} from "../src/journey/syntheticTimetable";
import {
  eligibleFirstServices,
  evaluateTransferFeasibility,
  isServiceAvailableAtDeparture,
} from "../src/journey/timetable";
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

function requestAt(departAt: string): JourneyRequest {
  return {
    originId: "kaohsiung-xiaogang",
    destinationId: "taoyuan-bade",
    origin: { text: "Kaohsiung Xiaogang", canonicalPlaceId: "kaohsiung-xiaogang" },
    destination: { text: "Bade, Taoyuan", canonicalPlaceId: "taoyuan-bade" },
    departAt,
    travelerState: unknownTraveler,
    preferences: { luggage: "NORMAL" },
    policy: "BALANCED",
    constraints: {},
    activities: [],
  };
}

function service(id: string): ScheduledService {
  const result = syntheticScheduledServices.find((candidate) => candidate.id === id);
  if (!result) throw new Error(`Missing synthetic service: ${id}`);
  return result;
}

function rule(fromNodeId: string, toNodeId: string): TransferRule {
  const result = syntheticTransferRules.find((candidate) => candidate.fromNodeId === fromNodeId && candidate.toNodeId === toNodeId);
  if (!result) throw new Error(`Missing synthetic transfer rule: ${fromNodeId} -> ${toNodeId}`);
  return result;
}

describe("deterministic synthetic timetable", () => {
  it("represents a canonical request with explicit origin, destination, and ISO departure", () => {
    expect(requestAt("2030-06-15T07:00:00+08:00")).toMatchObject({ originId: "kaohsiung-xiaogang", destinationId: "taoyuan-bade", departAt: "2030-06-15T07:00:00+08:00" });
  });

  it("keeps a service eligible before it departs and unavailable after it departs", () => {
    const firstBus = service("bus-xiaogang-0705");
    expect(isServiceAvailableAtDeparture(firstBus, "2030-06-15T07:00:00+08:00")).toBe(true);
    expect(isServiceAvailableAtDeparture(firstBus, "2030-06-15T07:12:00+08:00")).toBe(false);
  });

  it("changes eligible first services when departure time changes", () => {
    expect(eligibleFirstServices(syntheticScheduledServices, requestAt("2030-06-15T07:00:00+08:00")).map((candidate) => candidate.id)).toContain("bus-xiaogang-0705");
    const laterEligible = eligibleFirstServices(syntheticScheduledServices, requestAt("2030-06-15T07:12:00+08:00")).map((candidate) => candidate.id);
    expect(laterEligible).not.toContain("bus-xiaogang-0705");
    expect(laterEligible).toContain("bus-xiaogang-0720");
  });

  it("keeps short, medium, and long synthetic transfer preparation explicitly different", () => {
    expect(rule("xiaogang-mrt", "xiaogang-mrt")).toMatchObject({ walkingMinutes: 3, minimumTransferMinutes: 3 });
    expect(rule("zuoying-mrt", "zuoying-thsr")).toMatchObject({ walkingMinutes: 8, minimumTransferMinutes: 5 });
    expect(rule("taoyuan-thsr", "taoyuan-bus")).toMatchObject({ walkingMinutes: 12, minimumTransferMinutes: 5 });
  });

  it("connects when the next service leaves after the transfer-specific walking and buffer", () => {
    expect(evaluateTransferFeasibility(service("mrt-xiaogang-1650"), service("thsr-zuoying-1742"), rule("zuoying-mrt", "zuoying-thsr"))).toMatchObject({ connectable: true, earliestReadyAt: "2030-06-15T09:38:00.000Z", transferMinutes: 13, reasonCode: "CONNECTION_OK" });
  });

  it("rejects a departure that misses the ready time by one minute", () => {
    expect(evaluateTransferFeasibility(service("mrt-xiaogang-1650"), service("thsr-zuoying-1734"), rule("zuoying-mrt", "zuoying-thsr"))).toMatchObject({ connectable: false, earliestReadyAt: "2030-06-15T09:38:00.000Z", reasonCode: "INSUFFICIENT_TRANSFER_TIME" });
  });

  it("accepts a departure exactly at the required ready time", () => {
    const exactNext = { ...service("thsr-zuoying-1742"), departureAt: "2030-06-15T17:38:00+08:00" };
    expect(evaluateTransferFeasibility(service("mrt-xiaogang-1650"), exactNext, rule("zuoying-mrt", "zuoying-thsr"))).toMatchObject({ connectable: true, reasonCode: "CONNECTION_OK" });
  });

  it("uses each rule's own ready-time boundary rather than a global transfer value", () => {
    const previous = { id: "previous", mode: "BUS" as const, fromNodeId: "origin", toNodeId: "arrival", departureAt: "2030-06-15T17:00:00+08:00", arrivalAt: "2030-06-15T17:25:00+08:00", cost: 1 };
    const scenario = (walkingMinutes: number, minimumTransferMinutes: number, departureAt: string) =>
      evaluateTransferFeasibility(
        previous,
        { id: "next", mode: "BUS", fromNodeId: "boarding", toNodeId: "destination", departureAt, arrivalAt: "2030-06-15T18:00:00+08:00", cost: 1 },
        { fromNodeId: "arrival", toNodeId: "boarding", walkingMinutes, minimumTransferMinutes },
      );

    expect(scenario(3, 3, "2030-06-15T17:30:00+08:00")).toMatchObject({ connectable: false, transferMinutes: 6 });
    expect(scenario(3, 3, "2030-06-15T17:31:00+08:00")).toMatchObject({ connectable: true, transferMinutes: 6 });
    expect(scenario(8, 5, "2030-06-15T17:37:00+08:00")).toMatchObject({ connectable: false, transferMinutes: 13 });
    expect(scenario(8, 5, "2030-06-15T17:38:00+08:00")).toMatchObject({ connectable: true, transferMinutes: 13 });
    expect(scenario(12, 5, "2030-06-15T17:41:00+08:00")).toMatchObject({ connectable: false, transferMinutes: 17 });
    expect(scenario(12, 5, "2030-06-15T17:42:00+08:00")).toMatchObject({ connectable: true, transferMinutes: 17 });
  });

  it("can accept a short transfer while rejecting a longer one at the same departure", () => {
    const previous = { id: "previous", mode: "BUS" as const, fromNodeId: "origin", toNodeId: "arrival", departureAt: "2030-06-15T17:00:00+08:00", arrivalAt: "2030-06-15T17:25:00+08:00", cost: 1 };
    const next = { id: "next", mode: "BUS" as const, fromNodeId: "boarding", toNodeId: "destination", departureAt: "2030-06-15T17:32:00+08:00", arrivalAt: "2030-06-15T18:00:00+08:00", cost: 1 };
    expect(evaluateTransferFeasibility(previous, next, { fromNodeId: "arrival", toNodeId: "boarding", walkingMinutes: 3, minimumTransferMinutes: 3 }).connectable).toBe(true);
    expect(evaluateTransferFeasibility(previous, next, { fromNodeId: "arrival", toNodeId: "boarding", walkingMinutes: 10, minimumTransferMinutes: 5 }).connectable).toBe(false);
  });

  it("rejects a transfer when the provided rule does not match the service nodes", () => {
    expect(evaluateTransferFeasibility(service("mrt-xiaogang-1650"), service("bus-taoyuan-1922"), rule("zuoying-mrt", "zuoying-thsr")).reasonCode).toBe("NODE_MISMATCH");
  });

  it("fails closed when no transfer rule exists", () => {
    expect(evaluateTransferFeasibility(service("mrt-xiaogang-1650"), service("thsr-zuoying-1742"), undefined).reasonCode).toBe("TRANSFER_RULE_MISSING");
  });

  it("returns a structured failure for invalid service timestamps", () => {
    expect(evaluateTransferFeasibility({ ...service("mrt-xiaogang-1650"), arrivalAt: "not-a-time" }, service("thsr-zuoying-1742"), rule("zuoying-mrt", "zuoying-thsr")).reasonCode).toBe("INVALID_SERVICE_TIME");
  });

  it("is deterministic and does not read the wall clock", () => {
    const previousNow = Date.now;
    Date.now = () => { throw new Error("wall clock must not be read"); };
    try {
      const first = evaluateTransferFeasibility(service("mrt-xiaogang-1650"), service("thsr-zuoying-1742"), rule("zuoying-mrt", "zuoying-thsr"));
      const second = evaluateTransferFeasibility(service("mrt-xiaogang-1650"), service("thsr-zuoying-1742"), rule("zuoying-mrt", "zuoying-thsr"));
      expect(first).toEqual(second);
    } finally {
      Date.now = previousNow;
    }
  });

  it("ships a compact, clearly synthetic multi-mode Challenge dataset", () => {
    expect(SYNTHETIC_CHALLENGE_FIXTURE_NOTICE).toContain("NOT REAL OPERATIONAL");
    expect(syntheticJourneyNodes).toHaveLength(7);
    expect(syntheticScheduledServices).toHaveLength(18);
    expect(new Set(syntheticScheduledServices.map((candidate) => candidate.mode))).toEqual(new Set(["BUS", "MRT", "THSR", "TAXI"]));
  });
});
