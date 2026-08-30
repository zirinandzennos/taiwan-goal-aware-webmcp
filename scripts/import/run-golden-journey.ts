import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { planJourney } from "../../src/journey/planner.ts";
import { replanJourney } from "../../src/journey/replanner.ts";
import { createIndexedTimetableStore } from "../../src/journey/timetableStore.ts";
import type { JourneyGoal, JourneyOption, JourneyPlanningContext, JourneyRequest, JourneyPlanResult, ScheduledService, TravelerState } from "../../src/journey/types.ts";

interface OfficialService extends ScheduledService { serviceRunId: string; serviceName: string; }
interface OfficialRuntime {
  metadata: { snapshotId: string; periodStart: string; periodEnd: string; source: string; };
  services: OfficialService[];
  transferRules: JourneyPlanningContext["transferRules"];
}
interface GoldenGoalData {
  goalId: string;
  destinationNodeId: string;
  deadlineAt: string;
  requiredSafetyBufferMinutes: number;
  goalActionBufferMinutes: number;
  source: { hoursUrl: string; accessUrl: string; retrievedAt: string; };
  caveat: string;
}

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

function selectedOption(plan: JourneyPlanResult | null): JourneyOption | null {
  return plan?.balanced ?? plan?.fastest ?? plan?.cheapest ?? null;
}

function taipeiTimestamp(timestamp: number): string {
  const local = new Date(timestamp + 8 * 60 * 60 * 1000);
  return `${local.toISOString().slice(0, 19)}+08:00`;
}

function serviceDetails(option: JourneyOption | null, servicesById: ReadonlyMap<string, OfficialService>): Array<Record<string, unknown>> {
  if (!option) return [];
  return option.candidate.legs.flatMap((leg) => {
    if (leg.type !== "TRAVEL") return [];
    const service = servicesById.get(leg.serviceId);
    if (!service) throw new Error(`Frozen runtime service is missing: ${leg.serviceId}`);
    return [{ serviceId: service.id, serviceRunId: service.serviceRunId, trainNo: service.serviceName, fromNodeId: service.fromNodeId, toNodeId: service.toNodeId, departureAt: service.departureAt, arrivalAt: service.arrivalAt }];
  });
}

export function runOfficialGoldenJourney(): Record<string, unknown> {
  const runtime = JSON.parse(readFileSync(resolve("src/data/officialTimetableSnapshot.json"), "utf8")) as OfficialRuntime;
  const goalData = JSON.parse(readFileSync(resolve("src/data/officialGoldenGoal.json"), "utf8")) as GoldenGoalData;
  const servicesById = new Map(runtime.services.map((service) => [service.id, service]));
  const timetableStore = createIndexedTimetableStore(runtime.services);
  const goal: JourneyGoal = {
    id: goalData.goalId,
    title: "Enter Xpark by final admission",
    goalType: "VENUE_ENTRY",
    destinationId: goalData.destinationNodeId,
    deadlineAt: goalData.deadlineAt,
    deadlineVerified: true,
    requiredSafetyBufferMinutes: goalData.requiredSafetyBufferMinutes,
    goalActionBufferMinutes: goalData.goalActionBufferMinutes,
    source: { label: `Xpark official published hours and ${goalData.goalActionBufferMinutes}-minute THSR access guidance`, url: goalData.source.hoursUrl, retrievedAt: goalData.source.retrievedAt },
  };
  const request: JourneyRequest = {
    originId: "1070",
    destinationId: goal.destinationId,
    origin: { text: "THSR Zuoying", canonicalPlaceId: "1070" },
    destination: { text: "THSR Taoyuan for Xpark", canonicalPlaceId: goal.destinationId },
    departAt: "2026-08-31T11:30:00+08:00",
    travelerState: unknownTraveler,
    preferences: {},
    policy: "BALANCED",
    constraints: { allowedModes: ["THSR"], maxTransfers: 0 },
    activities: [],
    goal,
  };
  const context: JourneyPlanningContext = {
    timetable: runtime.services,
    timetableStore,
    transferRules: runtime.transferRules,
    timetableMode: "PROVIDER_NORMALIZED",
    dataSnapshot: { snapshotId: runtime.metadata.snapshotId, periodStart: runtime.metadata.periodStart, periodEnd: runtime.metadata.periodEnd, sourceLabel: runtime.metadata.source, actualOperationsClaimed: false },
  };
  const plan = planJourney(request, context);
  const option = selectedOption(plan);
  if (!option) throw new Error("Golden request produced no selected journey");
  const originalServices = serviceDetails(option, servicesById);
  const originalFirst = servicesById.get(option.candidate.legs[0].type === "TRAVEL" ? option.candidate.legs[0].serviceId : "");
  if (!originalFirst) throw new Error("Golden journey has no first scheduled service");
  const missedService = runtime.services
    .filter((service) => service.serviceRunId === originalFirst.serviceRunId && service.toNodeId === request.destinationId && service.fromNodeId !== request.originId && Date.parse(service.departureAt) > Date.parse(originalFirst.departureAt) && Date.parse(service.departureAt) < Date.parse(originalFirst.arrivalAt))
    .sort((first, second) => Date.parse(first.departureAt) - Date.parse(second.departureAt))[0];
  if (!missedService) throw new Error(`No intermediate node exists for selected run ${originalFirst.serviceRunId}`);
  const currentAt = taipeiTimestamp(Date.parse(missedService.departureAt) + 60_000);
  const replan = replanJourney({ originalRequest: request, currentState: { nodeId: missedService.fromNodeId, at: currentAt } }, context);
  const replannedOption = selectedOption(replan.plan);
  const replacementServices = serviceDetails(replannedOption, servicesById);
  return {
    snapshotId: runtime.metadata.snapshotId,
    request,
    goalCaveat: goalData.caveat,
    golden: { status: plan.status, candidateCount: plan.candidateCount, selected: originalServices, finalArrivalAt: option.candidate.arriveAt, goalDeadline: option.feasibility.deadlineAt, goalReadyAt: option.feasibility.goalReadyAt, safetyMarginMinutes: option.feasibility.safetyMarginMinutes, reasonCodes: option.feasibility.reasonCodes },
    replan: { nodeId: missedService.fromNodeId, currentAt, missedService: { serviceId: missedService.id, serviceRunId: missedService.serviceRunId, trainNo: missedService.serviceName, departureAt: missedService.departureAt, arrivalAt: missedService.arrivalAt }, status: replan.plan?.status ?? null, goalDeadline: replannedOption?.feasibility.deadlineAt ?? replan.plan?.goalDeadline ?? null, safetyMarginMinutes: replannedOption?.feasibility.safetyMarginMinutes ?? null, reasonCodes: replannedOption?.feasibility.reasonCodes ?? replan.plan?.reasonCodes ?? [], replacementServices },
  };
}
