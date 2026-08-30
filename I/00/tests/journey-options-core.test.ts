import { describe, expect, it } from "vitest";
import { generateCandidateJourneys } from "../src/journey/candidates";
import { planJourney } from "../src/journey/planner";
import {
  syntheticThreeOptionPlanningContext,
  syntheticThreeOptionRequest,
  SYNTHETIC_THREE_OPTION_NOTICE,
} from "../src/journey/syntheticTimetable";
import type {
  JourneyOption,
  JourneyPlanningContext,
  JourneyRequest,
  ScheduledService,
} from "../src/journey/types";

function generated() {
  return generateCandidateJourneys(
    syntheticThreeOptionRequest,
    syntheticThreeOptionPlanningContext.timetable,
    syntheticThreeOptionPlanningContext.transferRules,
    syntheticThreeOptionPlanningContext.timetableStore,
  );
}

function plan() {
  return planJourney(syntheticThreeOptionRequest, syntheticThreeOptionPlanningContext);
}

function options(result = plan()): JourneyOption[] {
  return [result.fastest, result.balanced, result.cheapest].filter(
    (option): option is JourneyOption => option !== null,
  );
}

function unknownFareFixture(): { request: JourneyRequest; context: JourneyPlanningContext } {
  const service: ScheduledService = {
    id: "official-fare-unavailable",
    mode: "THSR",
    fromNodeId: "fare-origin",
    toNodeId: "fare-destination",
    departureAt: "2030-06-15T08:05:00+08:00",
    arrivalAt: "2030-06-15T08:25:00+08:00",
    cost: 0,
    fareDataAvailable: false,
  };
  const request: JourneyRequest = {
    ...syntheticThreeOptionRequest,
    originId: "fare-origin",
    destinationId: "fare-destination",
    origin: { text: "Fare origin" },
    destination: { text: "Fare destination" },
    originAccess: undefined,
    goal: undefined,
    constraints: { maxTransfers: 0 },
  };
  return {
    request,
    context: {
      timetable: [service],
      transferRules: [],
      timetableMode: "PROVIDER_NORMALIZED",
      dataSnapshot: {
        snapshotId: "official-fare-unavailable-fixture",
        periodStart: "2030-06-15T00:00:00+08:00",
        periodEnd: "2030-06-15T23:59:59+08:00",
        sourceLabel: "Official timetable without licensed fare data",
        actualOperationsClaimed: false,
      },
    },
  };
}

describe("three complete journey options core", () => {
  it("1 generates at least three candidates through timetable search", () => {
    expect(generated().length).toBeGreaterThanOrEqual(3);
  });

  it("2 produces three genuinely distinct objective winners", () => {
    const result = plan();
    expect(new Set([result.fastest?.candidateId, result.balanced?.candidateId, result.cheapest?.candidateId]).size).toBe(3);
    expect(result.overlaps).toEqual([]);
  });

  it("3 gives every option a non-empty ordered step list", () => {
    for (const option of options()) {
      expect(option.steps.length).toBeGreaterThan(0);
      expect(option.steps.map((step) => step.sequence)).toEqual(option.steps.map((_, index) => index));
    }
  });

  it("4 starts every timeline at JourneyRequest.departAt", () => {
    for (const option of options()) expect(option.steps[0].startAt).toBe(syntheticThreeOptionRequest.departAt);
  });

  it("5 ends every option with GOAL_COMPLETE", () => {
    for (const option of options()) expect(option.steps.at(-1)?.kind).toBe("GOAL_COMPLETE");
  });

  it("6 binds goalCompletedAt to the final step endAt", () => {
    for (const option of options()) expect(option.goalCompletedAt).toBe(option.steps.at(-1)?.endAt);
  });

  it("7 includes initial waiting and goal access in complete duration", () => {
    const fastest = plan().fastest;
    expect(fastest).toMatchObject({ totalDurationMinutes: 44, initialWaitingMinutes: 3, totalWalkingMinutes: 13 });
    expect(fastest?.candidate.tightTransferCount).toBe(1);
    expect(fastest?.steps.some((step) => step.kind === "GOAL_ACCESS" && step.durationMinutes === 6)).toBe(true);
  });

  it("8 represents initial WAIT explicitly", () => {
    for (const option of options()) {
      const firstRide = option.steps.findIndex((step) => step.kind === "RIDE");
      expect(option.steps.slice(0, firstRide).some((step) => step.kind === "WAIT")).toBe(true);
    }
  });

  it("9 keeps transfer walking and buffer as separate steps", () => {
    const kinds = plan().cheapest?.steps.map((step) => step.kind) ?? [];
    expect(kinds).toContain("TRANSFER_WALK");
    expect(kinds).toContain("TRANSFER_BUFFER");
  });

  it("10 represents post-transfer WAIT separately", () => {
    const steps = plan().cheapest?.steps ?? [];
    const bufferIndex = steps.findIndex((step) => step.kind === "TRANSFER_BUFFER");
    expect(bufferIndex).toBeGreaterThanOrEqual(0);
    expect(steps[bufferIndex + 1]?.kind).toBe("WAIT");
    expect(steps[bufferIndex + 1]?.durationMinutes).toBe(8);
  });

  it("11 binds every RIDE to a generated scheduled service", () => {
    const serviceIds = new Set(syntheticThreeOptionPlanningContext.timetable.map((service) => service.id));
    for (const option of options()) {
      for (const step of option.steps.filter((item) => item.kind === "RIDE")) {
        expect(step.serviceId && serviceIds.has(step.serviceId)).toBe(true);
      }
    }
  });

  it("12 selects Fastest by earliest goal completion", () => {
    const result = plan();
    const earliest = generated().map((candidate) => Date.parse(candidate.goalCompletedAt ?? candidate.arriveAt));
    expect(Date.parse(result.fastest?.goalCompletedAt ?? "")).toBe(Math.min(...earliest));
    expect(result.fastest?.selectionReasons).toEqual(["EARLIEST_GOAL_COMPLETION"]);
  });

  it("13 selects Cheapest by lowest complete known cost", () => {
    const result = plan();
    const completeCosts = generated().filter((candidate) => candidate.fareCoverage === "COMPLETE").map((candidate) => candidate.totalKnownCost as number);
    expect(result.cheapest?.totalCost).toBe(Math.min(...completeCosts));
    expect(result.cheapest?.selectionReasons).toEqual(["LOWEST_COMPLETE_COST"]);
  });

  it("14 selects Balanced by deterministic trade-off, not insertion order", () => {
    const normal = plan();
    const reversedContext: JourneyPlanningContext = {
      ...syntheticThreeOptionPlanningContext,
      timetable: [...syntheticThreeOptionPlanningContext.timetable].reverse(),
      timetableStore: undefined,
    };
    const reversed = planJourney(syntheticThreeOptionRequest, reversedContext);
    expect(normal.balanced?.candidateId).toBe("journey:challenge-balanced-bus");
    expect(reversed.balanced?.candidateId).toBe(normal.balanced?.candidateId);
    expect(normal.balanced?.selectionReasons).toContain("LOWEST_BALANCED_SCORE");
    expect(normal.balanced?.candidate.transferCount).toBeLessThan(normal.fastest?.candidate.transferCount ?? 0);
    expect(normal.balanced?.candidate.tightTransferCount).toBeLessThan(normal.fastest?.candidate.tightTransferCount ?? 0);
  });

  it("15 represents unavailable official fare as null, never free", () => {
    const fixture = unknownFareFixture();
    const result = planJourney(fixture.request, fixture.context);
    expect(result.fastest).toMatchObject({ totalCost: null, fareCoverage: "UNAVAILABLE" });
    expect(result.fastest?.steps.find((step) => step.kind === "RIDE")?.costContribution).toBeNull();
  });

  it("16 suppresses false Cheapest when all fares are unavailable", () => {
    const fixture = unknownFareFixture();
    const result = planJourney(fixture.request, fixture.context);
    expect(result.cheapest).toBeNull();
    expect(result.optionAvailability.cheapest).toEqual({ available: false, reasonCodes: ["FARE_DATA_UNAVAILABLE"] });
  });

  it("17 returns byte-for-byte equivalent structured results repeatedly", () => {
    const first = JSON.stringify(plan());
    expect(Array.from({ length: 20 }, () => JSON.stringify(plan())).every((value) => value === first)).toBe(true);
  });

  it("18 never reads the wall clock", () => {
    const previousNow = Date.now;
    Date.now = () => { throw new Error("wall clock must not be read"); };
    try {
      expect(plan().candidateCount).toBeGreaterThanOrEqual(3);
    } finally {
      Date.now = previousNow;
    }
  });

  it("19 exposes category, summary, metrics, reasons, and provenance in the primary options", () => {
    expect(options().map((option) => option.category)).toEqual(["FASTEST", "BALANCED", "CHEAPEST"]);
    for (const option of options()) {
      expect(option).toMatchObject({
        optionId: expect.stringMatching(/^option:/),
        summary: expect.stringContaining("journey completes the goal"),
        timetableMode: "SYNTHETIC_FIXED_TIMETABLE",
        dataProvenance: { sourceLabel: SYNTHETIC_THREE_OPTION_NOTICE, actualOperationsClaimed: false },
      });
      expect(option.selectionReasons.length).toBeGreaterThan(0);
    }
  });

  it("20 does not mutate request, timetable, rules, or nested goal data", () => {
    const requestSnapshot = JSON.stringify(syntheticThreeOptionRequest);
    const contextSnapshot = JSON.stringify(syntheticThreeOptionPlanningContext);
    plan();
    expect(JSON.stringify(syntheticThreeOptionRequest)).toBe(requestSnapshot);
    expect(JSON.stringify(syntheticThreeOptionPlanningContext)).toBe(contextSnapshot);
  });
});
