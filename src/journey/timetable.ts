import type {
  JourneyRequest,
  ScheduledService,
  TransferRule,
} from "./types";

export type TransferReasonCode =
  | "CONNECTION_OK"
  | "INSUFFICIENT_TRANSFER_TIME"
  | "NODE_MISMATCH"
  | "TRANSFER_RULE_MISSING"
  | "INVALID_SERVICE_TIME";

export interface TransferFeasibilityResult {
  connectable: boolean;
  previousArrivalAt: string;
  earliestReadyAt: string | null;
  nextDepartureAt: string;
  transferMinutes: number | null;
  reasonCode: TransferReasonCode;
}

const ISO_8601_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function parseExplicitIsoTimestamp(value: string): number | null {
  if (!ISO_8601_WITH_OFFSET.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

/** Validates both service timestamps without consulting the wall clock. */
export function hasValidServiceTimes(service: ScheduledService): boolean {
  const departure = parseExplicitIsoTimestamp(service.departureAt);
  const arrival = parseExplicitIsoTimestamp(service.arrivalAt);
  return departure !== null && arrival !== null && arrival >= departure;
}

/** Returns true only when this service has not departed at the requested time. */
export function isServiceAvailableAtDeparture(
  service: ScheduledService,
  departAt: string,
): boolean {
  const serviceDeparture = parseExplicitIsoTimestamp(service.departureAt);
  const requestDeparture = parseExplicitIsoTimestamp(departAt);
  return serviceDeparture !== null
    && requestDeparture !== null
    && serviceDeparture >= requestDeparture;
}

/**
 * Selects only potential first-leg services. It deliberately does not build or
 * rank a journey; future candidate generation owns that responsibility.
 */
export function eligibleFirstServices(
  services: readonly ScheduledService[],
  request: JourneyRequest,
): ScheduledService[] {
  return services.filter((service) => (
    service.fromNodeId === request.originId
    && isServiceAvailableAtDeparture(service, request.departAt)
  ));
}

/**
 * Evaluates one service-to-service transfer using an explicit policy. Missing
 * data fails closed: the engine never assumes a transfer is safe.
 */
export function evaluateTransferFeasibility(
  previousService: ScheduledService,
  nextService: ScheduledService,
  transferRule: TransferRule | undefined,
): TransferFeasibilityResult {
  const previousArrivalAt = previousService.arrivalAt;
  const nextDepartureAt = nextService.departureAt;
  const previousArrival = parseExplicitIsoTimestamp(previousArrivalAt);
  const nextDeparture = parseExplicitIsoTimestamp(nextDepartureAt);

  if (previousArrival === null || nextDeparture === null) {
    return {
      connectable: false,
      previousArrivalAt,
      earliestReadyAt: null,
      nextDepartureAt,
      transferMinutes: null,
      reasonCode: "INVALID_SERVICE_TIME",
    };
  }

  if (!transferRule) {
    return {
      connectable: false,
      previousArrivalAt,
      earliestReadyAt: null,
      nextDepartureAt,
      transferMinutes: null,
      reasonCode: "TRANSFER_RULE_MISSING",
    };
  }

  if (
    previousService.toNodeId !== transferRule.fromNodeId
    || nextService.fromNodeId !== transferRule.toNodeId
  ) {
    return {
      connectable: false,
      previousArrivalAt,
      earliestReadyAt: null,
      nextDepartureAt,
      transferMinutes: null,
      reasonCode: "NODE_MISMATCH",
    };
  }

  const transferMinutes = transferRule.walkingMinutes + transferRule.minimumTransferMinutes;
  const earliestReadyMs = previousArrival + transferMinutes * 60_000;
  const earliestReadyAt = new Date(earliestReadyMs).toISOString();
  const connectable = nextDeparture >= earliestReadyMs;

  return {
    connectable,
    previousArrivalAt,
    earliestReadyAt,
    nextDepartureAt,
    transferMinutes,
    reasonCode: connectable ? "CONNECTION_OK" : "INSUFFICIENT_TRANSFER_TIME",
  };
}
