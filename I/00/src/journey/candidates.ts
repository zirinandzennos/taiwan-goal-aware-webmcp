import {
  evaluateTransferFeasibility,
  hasValidServiceTimes,
} from "./timetable";
import { createIndexedTimetableStore } from "./timetableStore";
import { TIGHT_TRANSFER_SLACK_MINUTES } from "./policies";
import type {
  CandidateJourney,
  FareCoverage,
  JourneyStep,
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
  connections: Array<{
    rule: TransferRule;
    waitingMinutes: number;
  }>;
  walkingMinutes: number;
  transferMinutes: number;
  waitingMinutes: number;
  minimumTransferSlackMinutes: number | null;
  tightTransferCount: number;
  visitedNodeIds: ReadonlySet<string>;
  usedServiceIds: ReadonlySet<string>;
}

const MINUTE_MS = 60_000;

function addMinutes(timestamp: string, minutes: number): string {
  return new Date(Date.parse(timestamp) + minutes * MINUTE_MS).toISOString();
}

function minutesBetween(startAt: string, endAt: string): number {
  return Math.round((Date.parse(endAt) - Date.parse(startAt)) / MINUTE_MS);
}

function validDuration(value: number | undefined): value is number {
  return Number.isFinite(value) && value !== undefined && value >= 0;
}

function sourceReference(source: { label: string; url?: string }): string {
  return source.url ?? source.label;
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

function buildCandidate(request: JourneyRequest, state: SearchState): CandidateJourney | null {
  const firstService = state.services[0];
  const lastService = state.services[state.services.length - 1];
  if (!firstService || !lastService) return null;
  const candidateId = `journey:${state.services.map((service) => service.id).join(">")}`;
  const originAccess = request.originAccess;
  if (originAccess && (
    originAccess.mode !== "WALK"
    || originAccess.fromNodeId !== request.originId
    || !validDuration(originAccess.durationMinutes)
  )) return null;

  const explicitGoalAccess = request.goal?.completion?.access;
  const compatibilityGoalAccess = request.goal && request.goal.goalActionBufferMinutes !== undefined
    ? {
      mode: "WALK" as const,
      fromNodeId: request.destinationId,
      toNodeId: request.goal.id,
      destinationLabel: request.goal.title,
      durationMinutes: request.goal.goalActionBufferMinutes,
      source: request.goal.source,
    }
    : undefined;
  const goalAccess = explicitGoalAccess ?? compatibilityGoalAccess;
  if (goalAccess && (
    goalAccess.fromNodeId !== request.destinationId
    || !validDuration(goalAccess.durationMinutes)
  )) return null;
  const goalActionDuration = request.goal?.completion?.actionDurationMinutes ?? 0;
  if (!validDuration(goalActionDuration)) return null;

  const steps: JourneyStep[] = [];
  const appendStep = (
    kind: JourneyStep["kind"],
    startAt: string,
    endAt: string,
    values: Omit<JourneyStep, "id" | "sequence" | "kind" | "startAt" | "endAt" | "durationMinutes">,
  ): void => {
    const sequence = steps.length;
    steps.push({
      id: `${candidateId}:step:${String(sequence).padStart(2, "0")}:${kind.toLowerCase()}`,
      sequence,
      kind,
      startAt,
      endAt,
      durationMinutes: minutesBetween(startAt, endAt),
      ...values,
    });
  };

  let cursor = request.departAt;
  if (originAccess) {
    const accessEnd = addMinutes(cursor, originAccess.durationMinutes);
    appendStep("WALK", cursor, accessEnd, {
      fromNodeId: originAccess.fromNodeId,
      toNodeId: originAccess.toNodeId,
      mode: originAccess.mode,
      costContribution: 0,
      sourceClassification: "REQUEST",
      sourceReference: sourceReference(originAccess.source),
    });
    cursor = accessEnd;
  }
  const initialWaitingMinutes = minutesBetween(cursor, firstService.departureAt);
  appendStep("WAIT", cursor, firstService.departureAt, {
    fromNodeId: firstService.fromNodeId,
    toNodeId: firstService.fromNodeId,
    serviceId: firstService.id,
    costContribution: 0,
    sourceClassification: "TIMETABLE",
    sourceReference: firstService.id,
  });

  state.services.forEach((service, index) => {
    appendStep("BOARD", service.departureAt, service.departureAt, {
      fromNodeId: service.fromNodeId,
      toNodeId: service.fromNodeId,
      serviceId: service.id,
      mode: service.mode,
      costContribution: 0,
      sourceClassification: "TIMETABLE",
      sourceReference: service.id,
    });
    appendStep("RIDE", service.departureAt, service.arrivalAt, {
      fromNodeId: service.fromNodeId,
      toNodeId: service.toNodeId,
      serviceId: service.id,
      mode: service.mode,
      costContribution: service.fareDataAvailable === false ? null : service.cost,
      sourceClassification: "TIMETABLE",
      sourceReference: service.id,
    });
    appendStep("ALIGHT", service.arrivalAt, service.arrivalAt, {
      fromNodeId: service.toNodeId,
      toNodeId: service.toNodeId,
      serviceId: service.id,
      mode: service.mode,
      costContribution: 0,
      sourceClassification: "TIMETABLE",
      sourceReference: service.id,
    });

    const connection = state.connections[index];
    const nextService = state.services[index + 1];
    if (!connection || !nextService) return;
    const walkEnd = addMinutes(service.arrivalAt, connection.rule.walkingMinutes);
    appendStep("TRANSFER_WALK", service.arrivalAt, walkEnd, {
      fromNodeId: connection.rule.fromNodeId,
      toNodeId: connection.rule.toNodeId,
      mode: "WALK",
      costContribution: 0,
      sourceClassification: "TRANSFER_RULE",
      sourceReference: `${connection.rule.fromNodeId}->${connection.rule.toNodeId}`,
    });
    const bufferEnd = addMinutes(walkEnd, connection.rule.minimumTransferMinutes);
    appendStep("TRANSFER_BUFFER", walkEnd, bufferEnd, {
      fromNodeId: connection.rule.toNodeId,
      toNodeId: connection.rule.toNodeId,
      costContribution: 0,
      sourceClassification: "TRANSFER_RULE",
      sourceReference: `${connection.rule.fromNodeId}->${connection.rule.toNodeId}`,
    });
    appendStep("WAIT", bufferEnd, nextService.departureAt, {
      fromNodeId: nextService.fromNodeId,
      toNodeId: nextService.fromNodeId,
      serviceId: nextService.id,
      costContribution: 0,
      sourceClassification: "TIMETABLE",
      sourceReference: nextService.id,
    });
  });

  let goalCompletedAt = lastService.arrivalAt;
  if (goalAccess) {
    const accessEnd = addMinutes(goalCompletedAt, goalAccess.durationMinutes);
    appendStep("GOAL_ACCESS", goalCompletedAt, accessEnd, {
      fromNodeId: goalAccess.fromNodeId,
      toNodeId: goalAccess.toNodeId,
      mode: goalAccess.mode,
      costContribution: 0,
      sourceClassification: "GOAL",
      sourceReference: sourceReference(goalAccess.source),
    });
    goalCompletedAt = accessEnd;
  }
  const goalActionEnd = addMinutes(goalCompletedAt, goalActionDuration);
  appendStep("GOAL_COMPLETE", goalCompletedAt, goalActionEnd, {
    fromNodeId: goalAccess?.toNodeId ?? request.destinationId,
    toNodeId: goalAccess?.toNodeId ?? request.destinationId,
    costContribution: 0,
    sourceClassification: request.goal ? "GOAL" : "REQUEST",
    sourceReference: request.goal ? sourceReference(request.goal.source) : request.destination.text,
  });
  goalCompletedAt = goalActionEnd;

  const knownFareCount = state.services.filter((service) => service.fareDataAvailable !== false).length;
  const fareCoverage: FareCoverage = knownFareCount === state.services.length
    ? "COMPLETE"
    : knownFareCount === 0 ? "UNAVAILABLE" : "PARTIAL";
  const totalCost = state.services.reduce((sum, service) => sum + service.cost, 0);
  const totalKnownCost = fareCoverage === "COMPLETE" ? totalCost : null;
  const totalRideMinutes = state.services.reduce(
    (sum, service) => sum + minutesBetween(service.departureAt, service.arrivalAt),
    0,
  );
  const totalTransferBufferMinutes = state.connections.reduce(
    (sum, connection) => sum + connection.rule.minimumTransferMinutes,
    0,
  );
  const totalWalkingMinutes = (originAccess?.mode === "WALK" ? originAccess.durationMinutes : 0)
    + state.walkingMinutes
    + (goalAccess?.mode === "WALK" ? goalAccess.durationMinutes : 0);
  const totalWaitingMinutes = initialWaitingMinutes + state.waitingMinutes;
  const totalDurationMinutes = minutesBetween(request.departAt, goalCompletedAt);

  return {
    id: candidateId,
    originId: request.originId,
    destinationId: request.destinationId,
    legs: state.services.map(serviceToLeg),
    steps,
    journeyStartAt: request.departAt,
    goalCompletedAt,
    departAt: firstService.departureAt,
    arriveAt: lastService.arrivalAt,
    totalDurationMinutes,
    initialWaitingMinutes,
    transferWaitingMinutes: state.waitingMinutes,
    totalWaitingMinutes,
    totalRideMinutes,
    totalTransferBufferMinutes,
    totalTransferMinutes: state.transferMinutes,
    totalWalkingMinutes,
    minimumTransferSlackMinutes: state.minimumTransferSlackMinutes,
    tightTransferCount: state.tightTransferCount,
    totalCost,
    totalKnownCost,
    fareCoverage,
    walkingMinutes: totalWalkingMinutes,
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
      const candidate = buildCandidate(request, state);
      if (candidate) candidates.push(candidate);
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
          connections: [...state.connections, { rule: transferRule, waitingMinutes: additionalWaitingMinutes }],
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

  if (request.originAccess && (
    request.originAccess.mode !== "WALK"
    || request.originAccess.fromNodeId !== request.originId
    || !validDuration(request.originAccess.durationMinutes)
  )) return [];
  const firstNodeId = request.originAccess?.toNodeId ?? request.originId;
  const firstReadyAt = request.originAccess
    ? addMinutes(request.departAt, request.originAccess.durationMinutes)
    : request.departAt;
  for (const firstService of timetableStore.findNextDepartures(firstNodeId, firstReadyAt, departureOptions)) {
    if (!permittedService(firstService)) continue;
    search({
      services: [firstService],
      connections: [],
      walkingMinutes: 0,
      transferMinutes: 0,
      waitingMinutes: 0,
      minimumTransferSlackMinutes: null,
      tightTransferCount: 0,
      visitedNodeIds: new Set([request.originId, firstNodeId, firstService.toNodeId]),
      usedServiceIds: new Set([firstService.id]),
    });
  }

  return candidates.sort(compareCandidates);
}
