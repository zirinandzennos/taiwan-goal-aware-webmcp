import {
  evaluateTransferFeasibility,
  hasValidServiceTimes,
} from "./timetable";
import { createIndexedTimetableStore } from "./timetableStore";
import { TIGHT_TRANSFER_SLACK_MINUTES } from "./policies";
import type {
  CandidateJourney,
  JourneyRequest,
  JourneyStep,
  ScheduledService,
  TimetableStore,
  TransferRule,
  TravelLeg,
} from "./types";

/** Challenge-safe bound used only when the request does not set maxTransfers. */
export const DEFAULT_MAX_TRANSFERS = 4;

interface SearchState {
  services: ScheduledService[];
  walkingMinutes: number;
  transferMinutes: number;
  waitingMinutes: number;
  minimumTransferSlackMinutes: number | null;
  tightTransferCount: number;
  visitedNodeIds: ReadonlySet<string>;
  usedServiceIds: ReadonlySet<string>;
  connections: SearchConnection[];
}

interface SearchConnection {
  rule: TransferRule;
  earliestReadyAt: string;
}

function addMinutes(value: string, minutes: number): string {
  return new Date(Date.parse(value) + minutes * 60_000).toISOString();
}

function place(nodeId: string) {
  return { id: nodeId, name: nodeId };
}

function supportedTransitMode(mode: ScheduledService["mode"]): "BUS" | "MRT" | "TRA" | "THSR" | null {
  return mode === "BUS" || mode === "MRT" || mode === "TRA" || mode === "THSR" ? mode : null;
}

function buildSteps(request: JourneyRequest, state: SearchState): JourneyStep[] {
  const steps: JourneyStep[] = [];
  state.services.forEach((service, index) => {
    const source = service.source ?? {
      provider: "Canonical timetable fixture",
      retrievedAt: request.departAt,
      dataMode: "FIXTURE" as const,
    };
    const from = place(service.fromNodeId);
    const to = place(service.toNodeId);
    const mode = supportedTransitMode(service.mode);
    const serviceRef = mode ? {
      mode,
      ...(service.routeId ? { routeId: service.routeId } : {}),
      tripId: service.id,
      ...(service.serviceName ? { trainNo: service.serviceName } : {}),
    } : undefined;
    const common = { timingQuality: service.timingQuality ?? "SCHEDULED" as const, source };
    steps.push({ id: `${service.id}:board`, type: "BOARD", from, to: from, plannedStart: service.departureAt, plannedEnd: service.departureAt, durationSec: 0, ...(serviceRef ? { service: serviceRef } : {}), costTwd: 0, ...common });
    steps.push({ id: `${service.id}:ride`, type: "RIDE", from, to, plannedStart: service.departureAt, plannedEnd: service.arrivalAt, durationSec: Math.round((Date.parse(service.arrivalAt) - Date.parse(service.departureAt)) / 1000), ...(serviceRef ? { service: serviceRef } : {}), costTwd: service.fareDataAvailable === false ? null : service.cost, ...common });
    steps.push({ id: `${service.id}:alight`, type: "ALIGHT", from: to, to, plannedStart: service.arrivalAt, plannedEnd: service.arrivalAt, durationSec: 0, ...(serviceRef ? { service: serviceRef } : {}), costTwd: 0, ...common });

    const next = state.services[index + 1];
    const connection = state.connections[index];
    if (!next || !connection) return;
    const walkEnd = addMinutes(service.arrivalAt, connection.rule.walkingMinutes);
    if (connection.rule.walkingMinutes > 0) {
      steps.push({ id: `${service.id}:transfer-walk`, type: "TRANSFER_WALK", from: to, to: place(next.fromNodeId), plannedStart: service.arrivalAt, plannedEnd: walkEnd, durationSec: connection.rule.walkingMinutes * 60, costTwd: 0, timingQuality: "ESTIMATED", source });
    }
    if (Date.parse(next.departureAt) > Date.parse(connection.earliestReadyAt)) {
      steps.push({ id: `${service.id}:wait`, type: "WAIT", from: place(next.fromNodeId), to: place(next.fromNodeId), plannedStart: connection.earliestReadyAt, plannedEnd: next.departureAt, durationSec: Math.round((Date.parse(next.departureAt) - Date.parse(connection.earliestReadyAt)) / 1000), costTwd: 0, ...common });
    }
  });

  const lastService = state.services.at(-1)!;
  const goalAccessMinutes = Math.max(0, request.goal?.goalActionBufferMinutes ?? 0);
  const goalAccessEnd = addMinutes(lastService.arrivalAt, goalAccessMinutes);
  const destination = place(request.destinationId);
  const source = lastService.source ?? { provider: "Canonical timetable fixture", retrievedAt: request.departAt, dataMode: "FIXTURE" as const };
  if (goalAccessMinutes > 0) {
    steps.push({ id: `${lastService.id}:goal-access`, type: "GOAL_ACCESS", from: destination, to: destination, plannedStart: lastService.arrivalAt, plannedEnd: goalAccessEnd, durationSec: goalAccessMinutes * 60, costTwd: 0, timingQuality: "ESTIMATED", source });
  }
  steps.push({ id: `${lastService.id}:goal-completion`, type: "GOAL_COMPLETION", from: destination, to: destination, plannedStart: goalAccessEnd, plannedEnd: goalAccessEnd, durationSec: 0, costTwd: 0, timingQuality: "ESTIMATED", source });
  return steps;
}

function serviceToLeg(service: ScheduledService): TravelLeg {
  return {
    type: "TRAVEL",
    serviceId: service.id,
    mode: service.mode,
    fromNodeId: service.fromNodeId,
    toNodeId: service.toNodeId,
    departAt: service.departureAt,
    arriveAt: service.arrivalAt,
    durationMinutes: Math.round((Date.parse(service.arrivalAt) - Date.parse(service.departureAt)) / 60_000),
    estimatedCost: service.cost,
  };
}

function buildCandidate(request: JourneyRequest, state: SearchState): CandidateJourney {
  const firstService = state.services[0];
  const lastService = state.services[state.services.length - 1];
  const totalDurationMinutes = Math.round((Date.parse(lastService.arrivalAt) - Date.parse(firstService.departureAt)) / 60_000)
    + Math.max(0, request.goal?.goalActionBufferMinutes ?? 0);
  const totalCost = state.services.reduce((sum, service) => sum + service.cost, 0);
  const knownFareCount = state.services.filter((service) => service.fareDataAvailable !== false).length;
  const costCoverage = knownFareCount === state.services.length
    ? "COMPLETE" as const
    : knownFareCount === 0 ? "UNKNOWN" as const : "PARTIAL" as const;

  const steps = buildSteps(request, state);
  return {
    id: `journey:${state.services.map((service) => service.id).join(">")}`,
    originId: request.originId,
    destinationId: request.destinationId,
    legs: state.services.map(serviceToLeg),
    departAt: firstService.departureAt,
    arriveAt: lastService.arrivalAt,
    totalDurationMinutes,
    totalWaitingMinutes: state.waitingMinutes,
    totalTransferMinutes: state.transferMinutes,
    totalWalkingMinutes: state.walkingMinutes,
    minimumTransferSlackMinutes: state.minimumTransferSlackMinutes,
    tightTransferCount: state.tightTransferCount,
    totalCost,
    walkingMinutes: state.walkingMinutes,
    transferCount: state.services.length - 1,
    estimatedCost: totalCost,
    costCoverage,
    goalCompletionAt: steps.at(-1)?.plannedEnd ?? lastService.arrivalAt,
    steps,
    modeValidation: { status: "VERIFIED", reasonCodes: ["SCHEDULED_SERVICE_CHAIN_VALIDATED"] },
    connectionRiskScore: 0,
  };
}

function compareCandidates(first: CandidateJourney, second: CandidateJourney): number {
  return first.departAt.localeCompare(second.departAt)
    || first.arriveAt.localeCompare(second.arriveAt)
    || first.id.localeCompare(second.id);
}

/**
 * Builds complete, provider-neutral service chains. It deliberately neither
 * ranks candidates nor assigns goal-feasibility statuses.
 */
export function generateCandidateJourneys(
  request: JourneyRequest,
  timetable: readonly ScheduledService[],
  transferRules: readonly TransferRule[],
  timetableStore: TimetableStore = createIndexedTimetableStore(timetable),
): CandidateJourney[] {
  const maxTransfers = Math.max(0, request.constraints.maxTransfers ?? DEFAULT_MAX_TRANSFERS);
  const candidates: CandidateJourney[] = [];
  const permittedService = (service: ScheduledService): boolean => (
    hasValidServiceTimes(service)
    && !(request.constraints.avoidTaxi === true && service.mode === "TAXI")
    && !(request.constraints.forbiddenModes?.includes(service.mode) ?? false)
  );
  const departureOptions = {
    limit: 32,
    ...(request.constraints.allowedModes ? { allowedModes: request.constraints.allowedModes } : {}),
  };

  const search = (state: SearchState): void => {
    const currentService = state.services[state.services.length - 1];
    if (currentService.toNodeId === request.destinationId) {
      candidates.push(buildCandidate(request, state));
      return;
    }

    if (state.services.length - 1 >= maxTransfers) return;

    const outgoingTransferRules = transferRules.filter((rule) => rule.fromNodeId === currentService.toNodeId);
    for (const transferRule of outgoingTransferRules) {
      const readyAt = new Date(Date.parse(currentService.arrivalAt) + (transferRule.walkingMinutes + transferRule.minimumTransferMinutes) * 60_000).toISOString();
      for (const nextService of timetableStore.findNextDepartures(transferRule.toNodeId, readyAt, departureOptions)) {
        if (!permittedService(nextService)) continue;
        if (state.usedServiceIds.has(nextService.id)) continue;
        if (state.visitedNodeIds.has(nextService.toNodeId)) continue;
        const transfer = evaluateTransferFeasibility(currentService, nextService, transferRule);
        if (!transfer.connectable || transfer.transferMinutes === null || transfer.earliestReadyAt === null) continue;

        const additionalWaitingMinutes = Math.round((Date.parse(nextService.departureAt) - Date.parse(transfer.earliestReadyAt)) / 60_000);
        search({
          services: [...state.services, nextService],
          walkingMinutes: state.walkingMinutes + transferRule.walkingMinutes,
          transferMinutes: state.transferMinutes + transfer.transferMinutes,
          waitingMinutes: state.waitingMinutes + additionalWaitingMinutes,
          minimumTransferSlackMinutes: state.minimumTransferSlackMinutes === null
            ? additionalWaitingMinutes
            : Math.min(state.minimumTransferSlackMinutes, additionalWaitingMinutes),
          tightTransferCount: state.tightTransferCount + (additionalWaitingMinutes < TIGHT_TRANSFER_SLACK_MINUTES ? 1 : 0),
          visitedNodeIds: new Set([...state.visitedNodeIds, nextService.toNodeId]),
          usedServiceIds: new Set([...state.usedServiceIds, nextService.id]),
          connections: [...state.connections, { rule: transferRule, earliestReadyAt: transfer.earliestReadyAt }],
        });
      }
    }
  };

  for (const firstService of timetableStore.findNextDepartures(request.originId, request.departAt, departureOptions)) {
    if (!permittedService(firstService)) continue;
    search({
      services: [firstService],
      walkingMinutes: 0,
      transferMinutes: 0,
      waitingMinutes: 0,
      minimumTransferSlackMinutes: null,
      tightTransferCount: 0,
      visitedNodeIds: new Set([request.originId, firstService.toNodeId]),
      usedServiceIds: new Set([firstService.id]),
      connections: [],
    });
  }

  return candidates.sort(compareCandidates);
}
