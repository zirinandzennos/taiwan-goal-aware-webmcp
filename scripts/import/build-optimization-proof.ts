import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  evaluateFormalRecommendationGates,
  summarizeTimingResolution,
  type CandidateOptimizationEvidence,
  type CandidateResolution,
} from "../../src/journey/modeValidation.ts";
import type { CandidateJourney, JourneyStep } from "../../src/journey/types.ts";

const SNAPSHOT_DIRECTORY = "data/snapshots/2026-08-31_2026-09-06";
const SECONDARY_RETRIEVED_AT = "2026-08-31T03:48:16.171Z";
const STANDARD_FARE_ASSUMPTIONS = [
  "STANDARD_ADULT_FARE",
  "NO_REBATE",
  "NO_CREDIT",
  "NO_NEGATIVE_FARE",
];

type JsonObject = Record<string, any>;

function sourceIdsFor(candidateId: string, railInvalid: Set<string>, busInvalid: Set<string>, hasBus: boolean): string[] {
  const ids = ["TDX-MODE-VALIDATION-20260831"];
  if (railInvalid.has(candidateId)) ids.push("TDX-RAIL-V2-THSR-1070-1010-20260831", "THSRC-NORMAL-TIMETABLE-20260202", "THSRC-SUMMER-2026-SPECIAL-TIMETABLE");
  if (busInvalid.has(candidateId)) ids.push("TAOYUAN-EBUS-208A-20260831");
  if (hasBus) ids.push("TAOYUAN-EBUS-208A-FARE-1848-1108");
  return ids;
}

function enrichBusFare(candidate: CandidateJourney, fareTwd: number): CandidateJourney {
  const steps = (candidate.steps ?? []).map((step): JourneyStep => {
    if (step.type !== "RIDE" || step.service?.mode !== "BUS" || step.service.routeId !== "208A") return step;
    return {
      ...step,
      costTwd: fareTwd,
      fareEvidence: {
        provider: "Taoyuan City Government Department of Transportation",
        endpointName: "QUERY_FARES",
        retrievedAt: SECONDARY_RETRIEVED_AT,
        sourceUrl: "https://ebus.tycg.gov.tw/ebus/graphql",
        routeId: "208A",
        direction: 0,
        boardingStopId: step.service.boardingStopId ?? "TAO9677",
        alightingStopId: step.service.alightingStopId ?? "TAO2938",
        passengerType: "ADULT",
        ticketType: "FULL_FARE",
        fareTwd,
      },
      validationEvidence: step.validationEvidence ? {
        ...step.validationEvidence,
        fareTwd,
        fareCoverage: "COMPLETE",
        ticketType: "FULL_FARE",
        fareClass: "ADULT",
        cabinClass: "STANDARD",
      } : step.validationEvidence,
    };
  });
  const rideCosts = steps.filter((step) => step.type === "RIDE").map((step) => step.costTwd);
  const totalCost = rideCosts.every((cost): cost is number => cost !== null)
    ? rideCosts.reduce((sum, cost) => sum + cost, 0)
    : null;
  let travelIndex = 0;
  const legs = candidate.legs.map((leg) => {
    if (leg.type !== "TRAVEL") return leg;
    const ride = steps.filter((step) => step.type === "RIDE")[travelIndex++];
    return { ...leg, estimatedCost: ride?.costTwd ?? null };
  });
  return {
    ...candidate,
    steps,
    legs,
    totalCost,
    estimatedCost: totalCost,
    costCoverage: totalCost === null ? "PARTIAL" : "COMPLETE",
  };
}

function buildOptimizationEvidence(
  candidates: readonly CandidateJourney[],
  resolutions: readonly CandidateResolution[],
  railInvalid: Set<string>,
  busInvalid: Set<string>,
): CandidateOptimizationEvidence[] {
  const resolutionById = new Map(resolutions.map((resolution) => [resolution.candidateId, resolution]));
  return candidates.map((candidate) => {
    const hasBus = candidate.steps?.some((step) => step.type === "RIDE" && step.service?.mode === "BUS") ?? false;
    const provenImpossible = railInvalid.has(candidate.id) || busInvalid.has(candidate.id);
    const exactEligible = !provenImpossible
      && resolutionById.get(candidate.id)?.resolution === "VALIDATED_FEASIBLE"
      && resolutionById.get(candidate.id)?.timedLegsComplete === true;
    const reasons = [
      ...(railInvalid.has(candidate.id) ? ["RAIL_NO_APPLICABLE_SERVICE_ON_SNAPSHOT_DATE"] : []),
      ...(busInvalid.has(candidate.id) ? ["BUS_NO_COMPATIBLE_FIXED_SCHEDULE"] : []),
      ...(exactEligible ? ["EXACT_VALIDATED_JOURNEY"] : []),
    ];
    return {
      candidateId: candidate.id,
      eligibility: provenImpossible ? "PROVEN_IMPOSSIBLE" : exactEligible ? "ELIGIBLE" : "UNRESOLVED",
      timingProof: exactEligible ? "EXACT" : "UNBOUNDED",
      exactGoalCompletionAt: exactEligible ? candidate.goalCompletionAt ?? candidate.arriveAt : null,
      earliestPossibleGoalCompletionAt: exactEligible ? candidate.goalCompletionAt ?? candidate.arriveAt : null,
      latestPossibleGoalCompletionAt: exactEligible ? candidate.goalCompletionAt ?? candidate.arriveAt : null,
      possibleServiceIds: provenImpossible ? [] : (candidate.steps ?? []).flatMap((step) => step.type === "RIDE"
        ? [step.service?.trainNo ?? step.service?.tripId ?? step.service?.routeId ?? step.id]
        : []),
      costProof: candidate.totalCost === null ? "UNBOUNDED" : "EXACT",
      exactTotalCostTwd: candidate.totalCost,
      minimumPossibleTotalCostTwd: candidate.totalCost,
      sourceEvidenceIds: sourceIdsFor(candidate.id, railInvalid, busInvalid, hasBus),
      assumptions: STANDARD_FARE_ASSUMPTIONS,
      reasonCodes: reasons.length > 0 ? reasons : ["OPTIMIZATION_EVIDENCE_INCOMPLETE"],
    };
  });
}

export async function buildOptimizationProof(snapshotDirectory = SNAPSHOT_DIRECTORY): Promise<JsonObject> {
  const directory = resolve(snapshotDirectory);
  const candidatePath = resolve(directory, "maas-candidates.json");
  const summaryPath = resolve(directory, "validation-summary.json");
  const faresPath = resolve(directory, "fares.json");
  const manifestPath = resolve(directory, "manifest.json");
  const officialPath = resolve(directory, "official-secondary-evidence.json");
  const [snapshot, summary, fares, manifest, official] = await Promise.all([
    readFile(candidatePath, "utf8").then(JSON.parse),
    readFile(summaryPath, "utf8").then(JSON.parse),
    readFile(faresPath, "utf8").then(JSON.parse),
    readFile(manifestPath, "utf8").then(JSON.parse),
    readFile(officialPath, "utf8").then(JSON.parse),
  ]);
  const railInvalid = new Set<string>(official.conclusions.railNoApplicableServiceCandidateIds);
  const busInvalid = new Set<string>(official.conclusions.busNoCompatibleTimingCandidateIds);
  const busFareIds = new Set<string>(official.conclusions.busFareCandidateIds);
  const busFareTwd = Number(official.conclusions.busFullAdultFareTwd);
  const candidates = (snapshot.candidates as CandidateJourney[]).map((candidate) => busFareIds.has(candidate.id) ? enrichBusFare(candidate, busFareTwd) : candidate);
  const resolutions = (snapshot.candidateResolutions as CandidateResolution[]).map((resolution) => ({
    ...resolution,
    fareComplete: candidates.find((candidate) => candidate.id === resolution.candidateId)?.costCoverage === "COMPLETE",
  }));
  const optimizationEvidence = buildOptimizationEvidence(candidates, resolutions, railInvalid, busInvalid);
  const gates = evaluateFormalRecommendationGates(candidates, resolutions, optimizationEvidence);
  const rides = candidates.flatMap((candidate) => candidate.steps?.filter((step) => step.type === "RIDE") ?? []);
  const timingSummary = summarizeTimingResolution(rides);
  const proof = {
    schemaVersion: "1.0.0",
    serviceDate: "2026-08-31",
    generatedAt: SECONDARY_RETRIEVED_AT,
    timezone: "Asia/Taipei",
    candidateCount: candidates.length,
    transitLegCount: rides.length,
    originalTimingResolutionCounts: timingSummary.timingResolutionCounts,
    originalNonExclusiveDataQualityTags: timingSummary.nonExclusiveDataQualityTags,
    unknownTimedLegDisposition: {
      conservativeBound: official.conclusions.boundedUnknownTimedLegs,
      unbounded: official.conclusions.unboundedUnknownTimedLegs,
      provenImpossibleByCompleteOfficialMatchSet: official.conclusions.provenImpossibleUnknownTimedLegs,
    },
    fareProofCounts: {
      exact: optimizationEvidence.filter((entry) => entry.costProof === "EXACT").length,
      lowerBoundOnly: optimizationEvidence.filter((entry) => entry.costProof === "NONNEGATIVE_LOWER_BOUND").length,
      unknown: optimizationEvidence.filter((entry) => entry.costProof === "UNBOUNDED").length,
    },
    candidates: optimizationEvidence,
    formalProofs: gates,
    balancedPolicyChanged: false,
  };
  const updatedSnapshot = {
    ...snapshot,
    candidates,
    candidateResolutions: resolutions,
    formalRecommendationStatus: gates.formalRecommendationStatus,
    formalRecommendations: gates,
  };
  const updatedSummary = {
    ...summary,
    totals: {
      ...summary.totals,
      fareCompleteCandidates: candidates.filter((candidate) => candidate.costCoverage === "COMPLETE").length,
      fareIncompleteCandidates: candidates.filter((candidate) => candidate.costCoverage !== "COMPLETE").length,
    },
    ...timingSummary,
    candidateResolutions: resolutions,
    formalRecommendations: gates,
  };
  delete updatedSummary.totals.exactScheduleVerifiedLegs;
  delete updatedSummary.totals.estimatedOnlyLegs;
  delete updatedSummary.totals.unknownLegs;
  const updatedFares = {
    ...fares,
    retrievedAt: SECONDARY_RETRIEVED_AT,
    policies: {
      ...fares.policies,
      BUS: {
        status: "COMPLETE",
        passengerType: "ADULT",
        ticketType: "FULL_FARE",
        discounts: "NONE",
        sourceEvidenceId: "TAOYUAN-EBUS-208A-FARE-1848-1108",
      },
    },
    services: fares.services.map((service: JsonObject) => service.validationKey.startsWith("Taoyuan|208A|") ? {
      ...service,
      fareTwd: busFareTwd,
      fareCoverage: "COMPLETE",
      ticketType: "FULL_FARE",
      fareClass: "ADULT",
      cabinClass: "STANDARD",
      sourceEvidenceId: "TAOYUAN-EBUS-208A-FARE-1848-1108",
    } : service),
    candidates: candidates.map((candidate) => ({ candidateId: candidate.id, totalJourneyCostTwd: candidate.totalCost, fareCoverage: candidate.costCoverage })),
  };
  const artifactNames = [...new Set([...(manifest.artifacts ?? []), "official-secondary-evidence.json", "optimization-proof.json"])];
  const updatedManifest = {
    ...manifest,
    retrievedAt: SECONDARY_RETRIEVED_AT,
    artifacts: artifactNames,
    knownGaps: [
      "The four 208A legs have no compatible fixed schedule at the MaaS boarding time; their exact adult OD fare is independently verified.",
      "The 12:15 Zuoying-to-Banqiao leg has no applicable TDX/THSRC service on Monday 2026-08-31.",
      "Formal Balanced remains unavailable because no safe optimistic bound exists for the unchanged score formula.",
    ],
    formalRecommendationStatus: gates.formalRecommendationStatus,
    formalRecommendations: gates,
    optimizationProofArtifact: "optimization-proof.json",
    officialSecondaryEvidenceArtifact: "official-secondary-evidence.json",
  };
  await Promise.all([
    writeFile(candidatePath, `${JSON.stringify(updatedSnapshot, null, 2)}\n`, "utf8"),
    writeFile(summaryPath, `${JSON.stringify(updatedSummary, null, 2)}\n`, "utf8"),
    writeFile(faresPath, `${JSON.stringify(updatedFares, null, 2)}\n`, "utf8"),
    writeFile(manifestPath, `${JSON.stringify(updatedManifest, null, 2)}\n`, "utf8"),
    writeFile(resolve(directory, "optimization-proof.json"), `${JSON.stringify(proof, null, 2)}\n`, "utf8"),
  ]);
  return proof;
}

async function main(): Promise<void> {
  const proof = await buildOptimizationProof(process.argv[2] ?? SNAPSHOT_DIRECTORY);
  console.log(JSON.stringify(proof.formalProofs));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
