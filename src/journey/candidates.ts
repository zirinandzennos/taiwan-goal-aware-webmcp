import {
  evaluateTransferFeasibility,
  hasValidServiceTimes,
} from "./timetable";
import { createIndexedTimetableStore } from "./timetableStore";
import { TIGHT_TRANSFER_SLACK_MINUTES } from "./policies";
import type {
  CandidateJourney,
  JourneyRequest,
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
  const totalDurationMinutes = Math.round((Date.parse(lastService.arrivalAt) - Date.parse(firstService.departureAt)) / 60_000);
  const totalCost = state.services.reduce((sum, service) => sum + service.cost, 0);

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
    });
  }

  return candidates.sort(compareCandidates);
}
