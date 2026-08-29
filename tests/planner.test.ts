import { describe, expect, it } from "vitest";
import { planJourney } from "../src/journey/planner";
import {
  syntheticScheduledServices,
  syntheticTransferRules,
} from "../src/journey/syntheticTimetable";
import type {
  JourneyPlanningContext,
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

function requestAt(
  departAt: string,
  constraints: JourneyRequest["constraints"] = {},
): JourneyRequest {
  return {
    originId: "kaohsiung-xiaogang",
    destinationId: "taoyuan-bade",
    origin: { text: "Kaohsiung Xiaogang" },
    destination: { text: "Bade, Taoyuan" },
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

function directService(id: string, arrivalAt: string, cost: number): ScheduledService {
  return { id, mode: "BUS", fromNodeId: "origin", toNodeId: "destination", departureAt: "2030-06-15T07:00:00+08:00", arrivalAt, cost };
}

function directRequest(arriveBy?: string): JourneyRequest {
  return {
    ...requestAt("2030-06-15T07:00:00+08:00", arriveBy ? { arriveBy } : {}),
    originId: "origin",
    destinationId: "destination",
    origin: { text: "Origin" },
    destination: { text: "Destination" },
  };
}

function directContext(timetable: readonly ScheduledService[]): JourneyPlanningContext {
  return { timetable, transferRules: [], timetableMode: "SYNTHETIC_FIXED_TIMETABLE" };
}

function optionServiceIds(option: ReturnType<typeof planJourney>["fastest"]): string[] {
  return option?.candidate.legs.flatMap((leg) => leg.type === "TRAVEL" ? [leg.serviceId] : []) ?? [];
}

describe("planJourney orchestration", () => {
  it("integrates real synthetic generation, metrics, feasibility, and ranking", () => {
    const result = planJourney(requestAt("2030-06-15T07:00:00+08:00"), syntheticContext);
    expect(result).toMatchObject({ status: "FEASIBLE", timetableMode: "SYNTHETIC_FIXED_TIMETABLE" });
    expect(result.candidateCount).toBeGreaterThan(0);
    expect(result.fastest).not.toBeNull();
    expect(result.cheapest).not.toBeNull();
    expect(result.balanced).not.toBeNull();
    expect(result.balanced?.scoreBreakdown).toBeDefined();
  });

  it("changes selected options when departure time makes the early bus unavailable", () => {
    const early = planJourney(requestAt("2030-06-15T07:00:00+08:00", { avoidTaxi: true }), syntheticContext);
    const late = planJourney(requestAt("2030-06-15T07:12:00+08:00", { avoidTaxi: true }), syntheticContext);
    expect(optionServiceIds(early.fastest).concat(optionServiceIds(early.cheapest), optionServiceIds(early.balanced))).toContain("bus-xiaogang-0705");
    expect(optionServiceIds(late.fastest).concat(optionServiceIds(late.cheapest), optionServiceIds(late.balanced))).not.toContain("bus-xiaogang-0705");
  });

  it("propagates avoidTaxi to every selected option", () => {
    const result = planJourney(requestAt("2030-06-15T07:00:00+08:00", { avoidTaxi: true }), syntheticContext);
    for (const option of [result.fastest, result.cheapest, result.balanced]) {
      expect(option?.candidate.legs.some((leg) => leg.type === "TRAVEL" && leg.mode === "TAXI")).toBe(false);
    }
  });

  it("retains ranked options with their different feasibility outcomes", () => {
    const context = directContext([
      directService("fast-expensive", "2030-06-15T09:50:00+08:00", 1_000),
      directService("cheap-late", "2030-06-15T10:20:00+08:00", 100),
    ]);
    const result = planJourney(directRequest("2030-06-15T10:15:00+08:00"), context);
    expect(result.status).toBe("FEASIBLE");
    expect(result.fastest).toMatchObject({ candidate: { id: "journey:fast-expensive" }, feasibility: { status: "FEASIBLE" } });
    expect(result.cheapest).toMatchObject({ candidate: { id: "journey:cheap-late" }, feasibility: { status: "IMPOSSIBLE" } });
    expect(result.balanced).toMatchObject({ candidate: { id: "journey:fast-expensive" }, feasibility: { status: "FEASIBLE" } });
  });

  it("returns a RISKY option when a technically executable transfer has zero slack", () => {
    const timetable: ScheduledService[] = [
      { id: "first", mode: "BUS", fromNodeId: "origin", toNodeId: "transfer", departureAt: "2030-06-15T07:00:00+08:00", arrivalAt: "2030-06-15T08:00:00+08:00", cost: 10 },
      { id: "second", mode: "BUS", fromNodeId: "transfer", toNodeId: "destination", departureAt: "2030-06-15T08:00:00+08:00", arrivalAt: "2030-06-15T09:00:00+08:00", cost: 10 },
    ];
    const rules: TransferRule[] = [{ fromNodeId: "transfer", toNodeId: "transfer", walkingMinutes: 0, minimumTransferMinutes: 0 }];
    const result = planJourney(directRequest(), { timetable, transferRules: rules, timetableMode: "SYNTHETIC_FIXED_TIMETABLE" });
    expect(result).toMatchObject({ status: "RISKY", fastest: { feasibility: { status: "RISKY", reasonCodes: ["TIGHT_TRANSFER"] } } });
  });

  it("keeps useful ranked options when a required deadline is unavailable", () => {
    const result = planJourney(requestAt("2030-06-15T07:00:00+08:00"), { ...syntheticContext, deadlineRequired: true, deadlineAvailability: "UNAVAILABLE" });
    expect(result.status).toBe("UNKNOWN");
    expect(result.fastest?.feasibility).toMatchObject({ status: "UNKNOWN", reasonCodes: ["REQUIRED_DEADLINE_UNAVAILABLE"] });
    expect(result.cheapest).not.toBeNull();
    expect(result.balanced).not.toBeNull();
  });

  it("distinguishes complete and unavailable empty networks", () => {
    expect(planJourney(requestAt("2030-06-15T07:00:00+08:00"), { timetable: [], transferRules: [], timetableMode: "SYNTHETIC_FIXED_TIMETABLE" })).toMatchObject({ status: "IMPOSSIBLE", candidateCount: 0, fastest: null, cheapest: null, balanced: null, reasonCodes: ["NO_EXECUTABLE_JOURNEY"] });
    expect(planJourney(requestAt("2030-06-15T07:00:00+08:00"), { timetable: [], transferRules: [], timetableMode: "SYNTHETIC_FIXED_TIMETABLE", journeyDataAvailability: "UNAVAILABLE" })).toMatchObject({ status: "UNKNOWN", candidateCount: 0, fastest: null, cheapest: null, balanced: null, reasonCodes: ["REQUIRED_JOURNEY_DATA_UNAVAILABLE"] });
  });

  it("is deterministic and does not mutate request or context", () => {
    const request = requestAt("2030-06-15T07:00:00+08:00", { avoidTaxi: true });
    const context = { ...syntheticContext, timetable: [...syntheticContext.timetable], transferRules: [...syntheticContext.transferRules] };
    const requestSnapshot = JSON.stringify(request);
    const contextSnapshot = JSON.stringify(context);
    const previousNow = Date.now;
    Date.now = () => { throw new Error("wall clock must not be read"); };
    try {
      const first = planJourney(request, context);
      const second = planJourney(request, context);
      expect(first).toEqual(second);
    } finally {
      Date.now = previousNow;
    }
    expect(JSON.stringify(request)).toBe(requestSnapshot);
    expect(JSON.stringify(context)).toBe(contextSnapshot);
  });
});
