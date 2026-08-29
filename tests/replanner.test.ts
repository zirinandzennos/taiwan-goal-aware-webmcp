import { describe, expect, it } from "vitest";
import { planJourney } from "../src/journey/planner";
import { replanJourney } from "../src/journey/replanner";
import {
  syntheticScheduledServices,
  syntheticTransferRules,
} from "../src/journey/syntheticTimetable";
import type {
  JourneyPlanningContext,
  JourneyReplanRequest,
  JourneyRequest,
  ScheduledService,
  TransferRule,
} from "../src/journey/types";

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

function request(
  originId = "kaohsiung-xiaogang",
  destinationId = "taoyuan-bade",
  departAt = "2030-06-15T07:00:00+08:00",
  constraints: JourneyRequest["constraints"] = {},
): JourneyRequest {
  return {
    originId,
    destinationId,
    origin: { text: originId },
    destination: { text: destinationId },
    departAt,
    travelerState: unknownTraveler,
    preferences: {},
    policy: "BALANCED",
    constraints,
    activities: [],
  };
}

const syntheticContext: JourneyPlanningContext = {
  timetable: syntheticScheduledServices,
  transferRules: syntheticTransferRules,
  timetableMode: "SYNTHETIC_FIXED_TIMETABLE",
};

function optionServiceIds(plan: ReturnType<typeof planJourney> | null): string[] {
  if (!plan) return [];
  return [plan.fastest, plan.cheapest, plan.balanced].flatMap((option) => (
    option?.candidate.legs.flatMap((leg) => leg.type === "TRAVEL" ? [leg.serviceId] : []) ?? []
  ));
}

describe("deterministic replanJourney", () => {
  it("derives a new same-origin request that misses the old 07:05 bus", () => {
    const originalRequest = request(undefined, undefined, undefined, { avoidTaxi: true });
    const originalPlan = planJourney(originalRequest, syntheticContext);
    const replan = replanJourney({ originalRequest, currentState: { nodeId: "kaohsiung-xiaogang", at: "2030-06-15T07:12:00+08:00" } }, syntheticContext);
    expect(optionServiceIds(originalPlan)).toContain("bus-xiaogang-0705");
    expect(replan.request).toMatchObject({ originId: "kaohsiung-xiaogang", departAt: "2030-06-15T07:12:00+08:00", constraints: { avoidTaxi: true } });
    expect(optionServiceIds(replan.plan)).not.toContain("bus-xiaogang-0705");
    expect(optionServiceIds(replan.plan)).toContain("bus-xiaogang-0720");
  });

  it("replans only from the current mid-journey node", () => {
    const originalRequest = request();
    const replan = replanJourney({ originalRequest, currentState: { nodeId: "zuoying-thsr", at: "2030-06-15T08:20:00+08:00" } }, syntheticContext);
    expect(replan.request).toMatchObject({ originId: "zuoying-thsr", destinationId: "taoyuan-bade" });
    for (const serviceId of optionServiceIds(replan.plan)) {
      expect(serviceId).not.toMatch(/^(bus-xiaogang|mrt-xiaogang)/);
    }
  });

  it("recalculates downstream transport after a 40-minute stop", () => {
    const originalRequest = request("taoyuan-bus", "taoyuan-bade", "2030-06-15T10:00:00+08:00");
    const originalPlan = planJourney(originalRequest, syntheticContext);
    const replan = replanJourney({ originalRequest, currentState: { nodeId: "taoyuan-bus", at: "2030-06-15T10:40:00+08:00" } }, syntheticContext);
    expect(optionServiceIds(originalPlan)).toContain("bus-taoyuan-1010");
    expect(optionServiceIds(replan.plan)).not.toContain("bus-taoyuan-1010");
    expect(optionServiceIds(replan.plan)).toContain("bus-taoyuan-1922");
  });

  it("preserves deadline and can deteriorate feasibility after a delay", () => {
    const services: ScheduledService[] = [
      { id: "original", mode: "BUS", fromNodeId: "origin", toNodeId: "destination", departureAt: "2030-06-15T07:00:00+08:00", arrivalAt: "2030-06-15T10:10:00+08:00", cost: 10 },
      { id: "delayed", mode: "BUS", fromNodeId: "current", toNodeId: "destination", departureAt: "2030-06-15T09:00:00+08:00", arrivalAt: "2030-06-15T10:26:00+08:00", cost: 10 },
    ];
    const context: JourneyPlanningContext = { timetable: services, transferRules: [], timetableMode: "SYNTHETIC_FIXED_TIMETABLE" };
    const originalRequest = request("origin", "destination", "2030-06-15T07:00:00+08:00", { arriveBy: "2030-06-15T10:30:00+08:00" });
    const originalPlan = planJourney(originalRequest, context);
    const replan = replanJourney({ originalRequest, currentState: { nodeId: "current", at: "2030-06-15T08:59:00+08:00" } }, context);
    expect(originalPlan.status).toBe("FEASIBLE");
    expect(replan.request?.constraints.arriveBy).toBe("2030-06-15T10:30:00+08:00");
    expect(replan.plan?.status).toBe("RISKY");
    expect(replan.plan?.fastest?.candidate.id).toBe("journey:delayed");
    expect(replan.plan?.fastest?.candidate.id).not.toBe(originalPlan.fastest?.candidate.id);
  });

  it("preserves avoidTaxi in every replanned option", () => {
    const originalRequest = request(undefined, undefined, undefined, { avoidTaxi: true });
    const replan = replanJourney({ originalRequest, currentState: { nodeId: "kaohsiung-xiaogang", at: "2030-06-15T07:12:00+08:00" } }, syntheticContext);
    expect(replan.request?.constraints.avoidTaxi).toBe(true);
    for (const option of [replan.plan?.fastest, replan.plan?.cheapest, replan.plan?.balanced]) {
      expect(option?.candidate.legs.some((leg) => leg.type === "TRAVEL" && leg.mode === "TAXI")).toBe(false);
    }
  });

  it("returns structured clarification for an unknown node or invalid timestamp", () => {
    const originalRequest = request();
    expect(replanJourney({ originalRequest, currentState: { nodeId: "missing", at: "2030-06-15T07:00:00+08:00" } }, syntheticContext)).toMatchObject({ request: null, plan: null, reasonCodes: ["CURRENT_NODE_NOT_IN_TIMETABLE"], clarification: { field: "currentState.nodeId" } });
    expect(replanJourney({ originalRequest, currentState: { nodeId: "kaohsiung-xiaogang", at: "banana" } }, syntheticContext)).toMatchObject({ request: null, plan: null, reasonCodes: ["INVALID_CURRENT_TIMESTAMP"], clarification: { field: "currentState.at" } });
  });

  it("does not replan when the destination has already been reached", () => {
    const originalRequest = request();
    expect(replanJourney({ originalRequest, currentState: { nodeId: "taoyuan-bade", at: "2030-06-15T10:40:00+08:00" } }, syntheticContext)).toMatchObject({ request: null, plan: null, alreadyAtDestination: true, reasonCodes: ["ALREADY_AT_DESTINATION"] });
  });

  it("is deterministic and does not mutate trip-scoped inputs", () => {
    const originalRequest = request(undefined, undefined, undefined, { avoidTaxi: true });
    const currentState = { nodeId: "kaohsiung-xiaogang", at: "2030-06-15T07:12:00+08:00" };
    const context = { ...syntheticContext, timetable: [...syntheticContext.timetable], transferRules: [...syntheticContext.transferRules] };
    const requestSnapshot = JSON.stringify(originalRequest);
    const stateSnapshot = JSON.stringify(currentState);
    const contextSnapshot = JSON.stringify(context);
    const previousNow = Date.now;
    Date.now = () => { throw new Error("wall clock must not be read"); };
    try {
      const first = replanJourney({ originalRequest, currentState }, context);
      const second = replanJourney({ originalRequest, currentState }, context);
      expect(first).toEqual(second);
    } finally {
      Date.now = previousNow;
    }
    expect(JSON.stringify(originalRequest)).toBe(requestSnapshot);
    expect(JSON.stringify(currentState)).toBe(stateSnapshot);
    expect(JSON.stringify(context)).toBe(contextSnapshot);
  });
});
