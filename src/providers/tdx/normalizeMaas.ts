import { validateJourneyConnections } from "../../journey/connectionValidator.ts";
import type {
  CandidateJourney,
  CostCoverage,
  JourneyPlaceRef,
  JourneyStep,
  TransportMode,
  TravelLeg,
} from "../../journey/types";
import type { TdxMaasResponse, TdxMaasRoute, TdxMaasSection } from "./maas";

export interface TdxMaasNormalizationOptions {
  originId: string;
  destinationId: string;
  retrievedAt: string;
  dataMode: "LIVE" | "SNAPSHOT";
  minimumTransferBufferSec?: number;
  goalCompletionBufferSec?: number;
  earliestDepartureAt?: string;
}

export interface TdxMaasRejectedRoute {
  routeIndex: number;
  reasonCodes: string[];
}

export interface TdxMaasNormalizationResult {
  candidates: CandidateJourney[];
  rejectedRoutes: TdxMaasRejectedRoute[];
}

function explicitTaipeiTimestamp(value: string): string {
  if (/([zZ]|[+-]\d{2}:\d{2})$/.test(value)) return value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)) {
    throw new Error(`TDX MaaS returned an invalid timestamp: ${value}`);
  }
  return `${value}+08:00`;
}

function durationSec(start: string, end: string): number {
  const duration = Math.round((Date.parse(end) - Date.parse(start)) / 1000);
  if (!Number.isFinite(duration) || duration < 0) throw new Error("TDX MaaS section has invalid chronological times");
  return duration;
}

function taipeiTimestampFromMs(value: number): string {
  return `${new Date(value + 8 * 60 * 60 * 1000).toISOString().replace("Z", "")}+08:00`;
}

function placeRef(sectionPlace: TdxMaasSection["departure"]["place"]): JourneyPlaceRef {
  const latitude = sectionPlace.location?.lat;
  const longitude = sectionPlace.location?.lng;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error("TDX MaaS place is missing coordinates");
  const coordinateId = `${Number(latitude).toFixed(6)},${Number(longitude).toFixed(6)}`;
  return {
    id: `tdx-place:${coordinateId}`,
    name: sectionPlace.name?.trim() || coordinateId,
    latitude,
    longitude,
  };
}

function transitMode(value: string): "BUS" | "MRT" | "TRA" | "THSR" {
  const mode = value.trim().toUpperCase();
  if (mode === "HSR" || mode === "THSR") return "THSR";
  if (mode === "TRA") return "TRA";
  if (mode.includes("BUS")) return "BUS";
  if (["MRT", "METRO", "KRTC", "TYMC", "TRTC", "LRT", "KLRT"].some((token) => mode.includes(token))) return "MRT";
  throw new Error(`Unsupported TDX MaaS transit mode: ${value}`);
}

function stepSource(options: TdxMaasNormalizationOptions): JourneyStep["source"] {
  return { provider: "TDX MaaS /routing", retrievedAt: options.retrievedAt, dataMode: options.dataMode };
}

function serviceRef(section: TdxMaasSection): NonNullable<JourneyStep["service"]> {
  const mode = transitMode(section.transport.mode);
  return {
    mode,
    ...(section.transport.uuid ? { tripId: section.transport.uuid } : {}),
    ...(section.transport.shortName ? { routeId: section.transport.shortName } : {}),
    ...(section.transport.number ? { trainNo: section.transport.number } : {}),
  };
}

function knownTransitFare(section: TdxMaasSection): number | null {
  const fare = section.transport.fareTW;
  return typeof fare === "number" && Number.isFinite(fare) && fare > 0 ? fare : null;
}

function createStep(
  id: string,
  type: JourneyStep["type"],
  section: TdxMaasSection,
  options: TdxMaasNormalizationOptions,
  service?: JourneyStep["service"],
  costTwd = 0 as number | null,
): JourneyStep {
  const plannedStart = explicitTaipeiTimestamp(section.departure.time);
  const plannedEnd = explicitTaipeiTimestamp(section.arrival.time);
  return {
    id,
    type,
    from: placeRef(section.departure.place),
    to: placeRef(section.arrival.place),
    plannedStart,
    plannedEnd,
    durationSec: durationSec(plannedStart, plannedEnd),
    ...(service ? { service } : {}),
    costTwd,
    timingQuality: type === "RIDE" || type === "BOARD" || type === "ALIGHT" || type === "WAIT" ? "SCHEDULED" : "ESTIMATED",
    source: stepSource(options),
  };
}

function zeroDurationStep(
  id: string,
  type: "BOARD" | "ALIGHT" | "GOAL_COMPLETION",
  place: JourneyPlaceRef,
  at: string,
  options: TdxMaasNormalizationOptions,
  service?: JourneyStep["service"],
): JourneyStep {
  return {
    id,
    type,
    from: place,
    to: place,
    plannedStart: at,
    plannedEnd: at,
    durationSec: 0,
    ...(service ? { service } : {}),
    costTwd: 0,
    timingQuality: "SCHEDULED",
    source: stepSource(options),
  };
}

function routeSteps(route: TdxMaasRoute, routeIndex: number, options: TdxMaasNormalizationOptions): JourneyStep[] {
  const steps: JourneyStep[] = [];
  route.sections.forEach((section, sectionIndex) => {
    const prefix = `maas:${routeIndex}:${sectionIndex}`;
    const sectionType = section.type.trim().toLowerCase();
    if (sectionType === "transit") {
      const service = serviceRef(section);
      const ride = createStep(`${prefix}:ride`, "RIDE", section, options, service, knownTransitFare(section));
      steps.push(
        zeroDurationStep(`${prefix}:board`, "BOARD", ride.from, ride.plannedStart, options, service),
        ride,
        zeroDurationStep(`${prefix}:alight`, "ALIGHT", ride.to, ride.plannedEnd, options, service),
      );
      return;
    }
    if (sectionType === "waiting") {
      steps.push(createStep(`${prefix}:wait`, "WAIT", section, options));
      return;
    }
    if (sectionType === "pedestrian") {
      const isLast = sectionIndex === route.sections.length - 1;
      const hadTransit = steps.some((step) => step.type === "RIDE");
      steps.push(createStep(`${prefix}:walk`, isLast ? "GOAL_ACCESS" : hadTransit ? "TRANSFER_WALK" : "WALK", section, options));
      return;
    }
    throw new Error(`Unsupported TDX MaaS section type: ${section.type}`);
  });

  const last = steps.at(-1);
  if (!last) throw new Error("TDX MaaS route has no sections");
  const completionSec = Math.max(0, options.goalCompletionBufferSec ?? 0);
  const completionAt = completionSec === 0
    ? last.plannedEnd
    : taipeiTimestampFromMs(Date.parse(last.plannedEnd) + completionSec * 1000);
  const completion = zeroDurationStep(`${last.id}:goal-completion`, "GOAL_COMPLETION", last.to, completionAt, options);
  completion.durationSec = completionSec;
  completion.plannedStart = last.plannedEnd;
  steps.push(completion);
  return steps;
}

function transportMode(mode: NonNullable<JourneyStep["service"]>["mode"]): TransportMode {
  return mode;
}

function candidateSignature(candidate: CandidateJourney): string {
  return candidate.steps
    ?.filter((step) => step.type === "RIDE")
    .map((step) => `${step.service?.mode}:${step.service?.routeId ?? step.service?.tripId ?? "?"}:${step.from.name}:${step.to.name}:${step.plannedStart}`)
    .join("|") ?? candidate.id;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildCandidate(route: TdxMaasRoute, routeIndex: number, options: TdxMaasNormalizationOptions): CandidateJourney {
  const steps = routeSteps(route, routeIndex, options);
  const validation = validateJourneyConnections(steps, options.minimumTransferBufferSec ?? 180);
  const rides = steps.filter((step) => step.type === "RIDE");
  const transitFares = rides.map((step) => step.costTwd);
  const knownFares = transitFares.filter((fare): fare is number => fare !== null);
  const costCoverage: CostCoverage = knownFares.length === transitFares.length
    ? "COMPLETE"
    : knownFares.length === 0 ? "UNKNOWN" : "PARTIAL";
  const legs: TravelLeg[] = rides.map((step) => ({
    type: "TRAVEL",
    mode: transportMode(step.service!.mode),
    fromNodeId: step.from.id,
    toNodeId: step.to.id,
    departAt: step.plannedStart,
    arriveAt: step.plannedEnd,
    durationMinutes: Math.round(step.durationSec / 60),
    serviceId: step.service?.tripId ?? step.id,
    estimatedCost: step.costTwd,
  }));
  const first = steps[0];
  const completion = steps.at(-1)!;
  const totalCost = costCoverage === "COMPLETE" ? knownFares.reduce((sum, fare) => sum + fare, 0) : null;
  const totalWalkingMinutes = Math.round(steps.filter((step) => ["WALK", "TRANSFER_WALK", "GOAL_ACCESS"].includes(step.type)).reduce((sum, step) => sum + step.durationSec, 0) / 60);
  const totalWaitingMinutes = Math.round(steps.filter((step) => step.type === "WAIT").reduce((sum, step) => sum + step.durationSec, 0) / 60);
  const transferCount = Math.max(0, rides.length - 1);
  const minimumTransferSlackMinutes = validation.minimumConnectionSlackSec === null ? null : validation.minimumConnectionSlackSec / 60;
  const candidate: CandidateJourney = {
    id: "pending",
    originId: options.originId,
    destinationId: options.destinationId,
    legs,
    steps,
    departAt: first.plannedStart,
    arriveAt: steps.at(-2)?.plannedEnd ?? completion.plannedStart,
    goalCompletionAt: completion.plannedEnd,
    totalDurationMinutes: Math.round((Date.parse(completion.plannedEnd) - Date.parse(first.plannedStart)) / 60_000),
    totalWaitingMinutes,
    totalTransferMinutes: Math.round((steps.filter((step) => step.type === "TRANSFER_WALK").reduce((sum, step) => sum + step.durationSec, 0) + transferCount * (options.minimumTransferBufferSec ?? 180)) / 60),
    totalWalkingMinutes,
    minimumTransferSlackMinutes,
    tightTransferCount: validation.transferSlacksSec.filter((slack) => slack < 180).length,
    totalCost,
    walkingMinutes: totalWalkingMinutes,
    transferCount,
    estimatedCost: totalCost,
    costCoverage,
    modeValidation: { status: "UNVERIFIED", reasonCodes: ["MODE_SPECIFIC_TIMETABLE_VALIDATION_NOT_RUN"] },
    connectionRiskScore: minimumTransferSlackMinutes === null || minimumTransferSlackMinutes >= 12 ? 0 : minimumTransferSlackMinutes >= 8 ? 0.33 : minimumTransferSlackMinutes >= 3 ? 0.67 : 1,
  };
  candidate.id = `journey:tdx-maas:${stableHash(candidateSignature(candidate))}`;
  return candidate;
}

export function normalizeTdxMaasResponse(
  response: TdxMaasResponse,
  options: TdxMaasNormalizationOptions,
): TdxMaasNormalizationResult {
  if (response.result !== "success" || !Array.isArray(response.data?.routes)) throw new Error("TDX MaaS response has no successful routes array");
  const candidates: CandidateJourney[] = [];
  const rejectedRoutes: TdxMaasRejectedRoute[] = [];
  response.data.routes.forEach((route, routeIndex) => {
    try {
      const candidate = buildCandidate(route, routeIndex, options);
      if (options.earliestDepartureAt && Date.parse(candidate.departAt) < Date.parse(options.earliestDepartureAt)) {
        rejectedRoutes.push({ routeIndex, reasonCodes: ["DEPARTS_BEFORE_REQUEST"] });
        return;
      }
      const validation = validateJourneyConnections(candidate.steps ?? [], options.minimumTransferBufferSec ?? 180);
      if (validation.status === "IMPOSSIBLE" || validation.status === "UNKNOWN") {
        rejectedRoutes.push({ routeIndex, reasonCodes: validation.reasonCodes });
      } else {
        candidates.push(candidate);
      }
    } catch (error) {
      rejectedRoutes.push({ routeIndex, reasonCodes: [error instanceof Error ? error.message : "NORMALIZATION_FAILED"] });
    }
  });
  return { candidates, rejectedRoutes };
}

export function deduplicateTdxMaasCandidates(candidates: readonly CandidateJourney[]): CandidateJourney[] {
  const bySignature = new Map<string, CandidateJourney>();
  for (const candidate of candidates) {
    const signature = candidateSignature(candidate);
    const existing = bySignature.get(signature);
    if (!existing || (candidate.goalCompletionAt ?? candidate.arriveAt) < (existing.goalCompletionAt ?? existing.arriveAt)) {
      bySignature.set(signature, candidate);
    }
  }
  return [...bySignature.values()].sort((first, second) => (first.goalCompletionAt ?? first.arriveAt).localeCompare(second.goalCompletionAt ?? second.arriveAt) || first.id.localeCompare(second.id));
}
