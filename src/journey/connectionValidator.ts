import type { FeasibilityStatus, JourneyStep } from "./types";

export type ConnectionReasonCode =
  | "CONNECTIONS_VALID"
  | "INVALID_STEP_TIMESTAMP"
  | "STEP_TIMELINE_OVERLAP"
  | "TRANSFER_BUFFER_NOT_MET"
  | "TIGHT_TRANSFER";

export interface ConnectionValidationResult {
  status: FeasibilityStatus;
  minimumConnectionSlackSec: number | null;
  transferSlacksSec: number[];
  diagnostics: ConnectionDiagnostic[];
  reasonCodes: ConnectionReasonCode[];
}

export interface ConnectionDiagnostic {
  previousRideStepId: string;
  nextRideStepId: string;
  requiredReadyAt: string;
  nextDepartureAt: string;
  connectionSlackSec: number;
  appliedTransferBufferSec: number;
  transferBufferApplicationCount: 1;
}

function timestampAt(ms: number): string {
  return `${new Date(ms + 8 * 60 * 60 * 1000).toISOString().replace("Z", "")}+08:00`;
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Validates the explicit step timeline. Walking time and the mandatory buffer
 * are subtracted before connection slack is reported, so WAIT is never
 * mistaken for transfer preparation.
 */
export function validateJourneyConnections(
  steps: readonly JourneyStep[],
  minimumTransferBufferSec = 180,
): ConnectionValidationResult {
  for (let index = 0; index < steps.length; index += 1) {
    const start = timestamp(steps[index].plannedStart);
    const end = timestamp(steps[index].plannedEnd);
    if (start === null || end === null || end < start) {
      return { status: "UNKNOWN", minimumConnectionSlackSec: null, transferSlacksSec: [], diagnostics: [], reasonCodes: ["INVALID_STEP_TIMESTAMP"] };
    }
    if (index > 0) {
      const previousEnd = timestamp(steps[index - 1].plannedEnd)!;
      if (start < previousEnd) {
        return { status: "IMPOSSIBLE", minimumConnectionSlackSec: null, transferSlacksSec: [], diagnostics: [], reasonCodes: ["STEP_TIMELINE_OVERLAP"] };
      }
    }
  }

  const rideIndexes = steps.flatMap((step, index) => step.type === "RIDE" ? [index] : []);
  const transferSlacksSec: number[] = [];
  const diagnostics: ConnectionDiagnostic[] = [];
  for (let ride = 1; ride < rideIndexes.length; ride += 1) {
    const previousRide = steps[rideIndexes[ride - 1]];
    const nextRide = steps[rideIndexes[ride]];
    const previousArrival = timestamp(previousRide.plannedEnd)!;
    const nextDeparture = timestamp(nextRide.plannedStart)!;
    const between = steps.slice(rideIndexes[ride - 1] + 1, rideIndexes[ride]);
    const transferWalkSec = between
      .filter((step) => step.type === "TRANSFER_WALK")
      .reduce((sum, step) => sum + step.durationSec, 0);
    const alightSec = between
      .filter((step) => step.type === "ALIGHT")
      .reduce((sum, step) => sum + step.durationSec, 0);
    const preparationSec = alightSec + transferWalkSec + minimumTransferBufferSec;
    const slackSec = Math.round((nextDeparture - previousArrival) / 1000) - preparationSec;
    transferSlacksSec.push(slackSec);
    diagnostics.push({
      previousRideStepId: previousRide.id,
      nextRideStepId: nextRide.id,
      requiredReadyAt: timestampAt(previousArrival + preparationSec * 1000),
      nextDepartureAt: nextRide.plannedStart,
      connectionSlackSec: slackSec,
      appliedTransferBufferSec: minimumTransferBufferSec,
      transferBufferApplicationCount: 1,
    });
    if (slackSec < 0) {
      return {
        status: "IMPOSSIBLE",
        minimumConnectionSlackSec: Math.min(...transferSlacksSec),
        transferSlacksSec,
        diagnostics,
        reasonCodes: ["TRANSFER_BUFFER_NOT_MET"],
      };
    }
  }

  const minimumConnectionSlackSec = transferSlacksSec.length > 0 ? Math.min(...transferSlacksSec) : null;
  if (minimumConnectionSlackSec !== null && minimumConnectionSlackSec < 180) {
    return { status: "RISKY", minimumConnectionSlackSec, transferSlacksSec, diagnostics, reasonCodes: ["TIGHT_TRANSFER"] };
  }
  return { status: "FEASIBLE", minimumConnectionSlackSec, transferSlacksSec, diagnostics, reasonCodes: ["CONNECTIONS_VALID"] };
}
