import type {
  ActivityLeg,
  JourneyOption,
  JourneyPlanningContext,
  JourneyRequest,
  TransportMode,
  TravelLeg,
} from "./types";

export type JourneyExecutionStepType =
  | "WAIT"
  | "TRAVEL"
  | "TRANSFER_WALK"
  | "TRANSFER_BUFFER"
  | "ACTIVITY"
  | "GOAL_ACTION";

export interface JourneyExecutionStep {
  id: string;
  type: JourneyExecutionStepType;
  label: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  fromNodeId?: string;
  toNodeId?: string;
  locationNodeId?: string;
  serviceId?: string;
  mode?: TransportMode;
}

function parsed(iso: string): number | null {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

function durationMinutes(startAt: string, endAt: string): number {
  const start = parsed(startAt);
  const end = parsed(endAt);
  if (start === null || end === null) return 0;
  return Math.max(0, Math.round((end - start) / 60_000));
}

function plusMinutes(startAt: string, minutes: number): string {
  const start = parsed(startAt);
  if (start === null) return startAt;
  return new Date(start + minutes * 60_000).toISOString();
}

function occursAfter(laterAt: string, earlierAt: string): boolean {
  const later = parsed(laterAt);
  const earlier = parsed(earlierAt);
  return later !== null && earlier !== null && later > earlier;
}

function waitStep(id: string, startAt: string, endAt: string, locationNodeId?: string): JourneyExecutionStep {
  return {
    id,
    type: "WAIT",
    label: "Wait for the next scheduled service",
    startAt,
    endAt,
    durationMinutes: durationMinutes(startAt, endAt),
    ...(locationNodeId ? { locationNodeId } : {}),
  };
}

function travelStep(leg: TravelLeg, index: number): JourneyExecutionStep {
  return {
    id: `travel-${index}-${leg.serviceId}`,
    type: "TRAVEL",
    label: "Take the scheduled service",
    startAt: leg.departAt,
    endAt: leg.arriveAt,
    durationMinutes: leg.durationMinutes,
    fromNodeId: leg.fromNodeId,
    toNodeId: leg.toNodeId,
    serviceId: leg.serviceId,
    mode: leg.mode,
  };
}

function activityStep(leg: ActivityLeg, index: number): JourneyExecutionStep {
  return {
    id: `activity-${index}-${leg.locationNodeId}`,
    type: "ACTIVITY",
    label: `Complete ${leg.activityType.toLowerCase()} activity`,
    startAt: leg.startAt,
    endAt: leg.endAt,
    durationMinutes: leg.durationMinutes,
    locationNodeId: leg.locationNodeId,
  };
}

/**
 * Converts a candidate into explicit executable steps without changing the
 * planner contract. Waiting, transfer walking, mandatory buffer, and the
 * final goal-action time are no longer hidden inside aggregate totals.
 */
export function buildJourneyExecutionSteps(
  option: JourneyOption,
  request: JourneyRequest,
  context: JourneyPlanningContext,
): JourneyExecutionStep[] {
  const steps: JourneyExecutionStep[] = [];
  const legs = option.candidate.legs;
  let cursorAt = request.departAt;
  let cursorNodeId = request.originId;

  for (let index = 0; index < legs.length; index += 1) {
    const leg = legs[index];
    const legStartAt = leg.type === "TRAVEL" ? leg.departAt : leg.startAt;
    if (occursAfter(legStartAt, cursorAt)) {
      steps.push(waitStep(`wait-${index}`, cursorAt, legStartAt, cursorNodeId));
    }

    if (leg.type === "ACTIVITY") {
      steps.push(activityStep(leg, index));
      cursorAt = leg.endAt;
      cursorNodeId = leg.locationNodeId;
      continue;
    }

    steps.push(travelStep(leg, index));
    cursorAt = leg.arriveAt;
    cursorNodeId = leg.toNodeId;

    const next = legs[index + 1];
    if (!next || next.type !== "TRAVEL") continue;
    const transferRule = context.transferRules.find((rule) => (
      rule.fromNodeId === leg.toNodeId && rule.toNodeId === next.fromNodeId
    ));
    if (!transferRule) continue;

    if (transferRule.walkingMinutes > 0) {
      const endAt = plusMinutes(cursorAt, transferRule.walkingMinutes);
      steps.push({
        id: `transfer-walk-${index}`,
        type: "TRANSFER_WALK",
        label: "Walk to the next boarding point",
        startAt: cursorAt,
        endAt,
        durationMinutes: transferRule.walkingMinutes,
        fromNodeId: transferRule.fromNodeId,
        toNodeId: transferRule.toNodeId,
      });
      cursorAt = endAt;
      cursorNodeId = transferRule.toNodeId;
    }

    if (transferRule.minimumTransferMinutes > 0) {
      const endAt = plusMinutes(cursorAt, transferRule.minimumTransferMinutes);
      steps.push({
        id: `transfer-buffer-${index}`,
        type: "TRANSFER_BUFFER",
        label: "Keep the mandatory transfer buffer",
        startAt: cursorAt,
        endAt,
        durationMinutes: transferRule.minimumTransferMinutes,
        locationNodeId: transferRule.toNodeId,
      });
      cursorAt = endAt;
    }
  }

  const goalActionMinutes = request.goal?.goalActionBufferMinutes ?? 0;
  if (goalActionMinutes > 0) {
    const endAt = plusMinutes(cursorAt, goalActionMinutes);
    steps.push({
      id: "goal-action",
      type: "GOAL_ACTION",
      label: "Reach the goal entrance and complete the required final action",
      startAt: cursorAt,
      endAt,
      durationMinutes: goalActionMinutes,
      locationNodeId: request.destinationId,
    });
  }

  return steps;
}
