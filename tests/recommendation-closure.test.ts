import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateBalancedRecommendation,
  evaluateFormalRecommendationGates,
  evaluateTerminalDepartureMismatch,
  resolveLayeredCandidateResolutions,
  summarizeEffectiveResolutionCounts,
  toEffectiveCandidateResolutions,
  type CandidateOptimizationEvidence,
  type CandidateResolution,
} from "../src/journey/modeValidation.ts";
import { rankBalancedJourneys } from "../src/journey/ranking.ts";
import type { CandidateJourney } from "../src/journey/types.ts";

const directory = resolve("data/snapshots/2026-08-31_2026-09-06");
const snapshot = JSON.parse(readFileSync(resolve(directory, "maas-candidates.json"), "utf8"));
const proof = JSON.parse(readFileSync(resolve(directory, "optimization-proof.json"), "utf8"));
const candidates = snapshot.candidates as CandidateJourney[];
const primary = snapshot.primaryCandidateResolutions as CandidateResolution[];
const evidence = proof.candidates as CandidateOptimizationEvidence[];

describe("proof-layer recommendation closure", () => {
  it("turns primary UNKNOWN plus proof PROVEN_IMPOSSIBLE into terminal effective impossible", () => {
    const layered = resolveLayeredCandidateResolutions(candidates, primary, evidence);
    const resolved = layered.find((entry) => entry.candidateId === "journey:tdx-maas:6196da5e");
    expect(resolved).toMatchObject({
      primaryProviderValidation: { status: "UNKNOWN" },
      proofResolution: { status: "PROVEN_IMPOSSIBLE" },
      effectiveCandidateResolution: { status: "VALIDATED_IMPOSSIBLE" },
      rankingEligible: false,
    });
  });

  it("closes the fixed set at 4 feasible, 0 risky, 6 impossible, 0 unknown", () => {
    const layered = resolveLayeredCandidateResolutions(candidates, primary, evidence);
    expect(summarizeEffectiveResolutionCounts(layered)).toEqual({ feasible: 4, risky: 0, impossible: 6, unknown: 0, total: 10 });
  });

  it("preserves current Fastest and Cheapest winner sets and closes Balanced", () => {
    const gates = evaluateFormalRecommendationGates(candidates, primary, evidence);
    expect(gates.fastest).toMatchObject({
      available: true,
      winnerCandidateIds: ["journey:tdx-maas:07fb4bb5", "journey:tdx-maas:ab19cfc6"],
      selectedRepresentativeId: "journey:tdx-maas:07fb4bb5",
      unique: false,
    });
    expect(gates.balanced).toMatchObject({
      available: true,
      winnerCandidateIds: ["journey:tdx-maas:ab19cfc6"],
      selectedRepresentativeId: "journey:tdx-maas:ab19cfc6",
      unique: true,
    });
    expect(gates.cheapest).toMatchObject({
      available: true,
      winnerCandidateIds: [
        "journey:tdx-maas:07fb4bb5",
        "journey:tdx-maas:ab19cfc6",
        "journey:tdx-maas:1767bfb5",
        "journey:tdx-maas:9bad5bc6",
      ],
      selectedRepresentativeId: "journey:tdx-maas:07fb4bb5",
      unique: false,
    });
    expect(gates).toMatchObject({
      formalRecommendationStatus: "ALL_PRIMARY_RECOMMENDATIONS_AVAILABLE",
      availableRecommendations: ["FASTEST", "BALANCED", "CHEAPEST"],
      unavailableRecommendations: [],
    });
  });

  it("excludes impossible candidates from Balanced normalization", () => {
    const layered = resolveLayeredCandidateResolutions(candidates, primary, evidence);
    const effective = toEffectiveCandidateResolutions(layered, primary);
    const baseline = evaluateBalancedRecommendation(candidates, effective);
    const impossible = candidates.find((candidate) => candidate.id === "journey:tdx-maas:6196da5e")!;
    const distorted = { ...impossible, totalDurationMinutes: -9999, totalWaitingMinutes: -9999, totalCost: 0 };
    const changed = candidates.map((candidate) => candidate.id === impossible.id ? distorted : candidate);
    expect(evaluateBalancedRecommendation(changed, effective)).toMatchObject({
      selectedRepresentativeId: baseline.selectedRepresentativeId,
      score: baseline.score,
    });
  });

  it("reports the exact candidate and metric when a Balanced input is missing", () => {
    const eligible = candidates.find((candidate) => candidate.id === "journey:tdx-maas:07fb4bb5")!;
    const missing = { ...eligible, totalWaitingMinutes: Number.NaN };
    const resolution = snapshot.candidateResolutions.find((entry: CandidateResolution) => entry.candidateId === eligible.id);
    expect(evaluateBalancedRecommendation([missing], [resolution])).toMatchObject({
      available: false,
      reasonCode: "BALANCED_METRIC_MISSING",
      blockers: [{ candidateId: eligible.id, metricName: "totalWaitingMinutes", reasonCode: "BALANCED_METRIC_MISSING" }],
    });
  });

  it("normalizes zero ranges safely and preserves equal-score ties after shuffling", () => {
    const base = candidates.find((candidate) => candidate.id === "journey:tdx-maas:07fb4bb5")!;
    const first = { ...base, id: "a" };
    const second = { ...base, id: "b" };
    const resolved = (candidateId: string): CandidateResolution => ({
      ...snapshot.candidateResolutions[0], candidateId, resolution: "VALIDATED_FEASIBLE", timedLegsComplete: true,
    });
    const normal = evaluateBalancedRecommendation([second, first], [resolved("b"), resolved("a")]);
    const shuffled = evaluateBalancedRecommendation([first, second], [resolved("a"), resolved("b")]);
    expect(rankBalancedJourneys([first, second]).every((entry) => Number.isFinite(entry.score))).toBe(true);
    expect(normal).toMatchObject({ winnerCandidateIds: ["a", "b"], selectedRepresentativeId: "a", unique: false, score: 0 });
    expect(shuffled).toMatchObject({ winnerCandidateIds: normal.winnerCandidateIds, selectedRepresentativeId: normal.selectedRepresentativeId });
  });
});

describe("208A terminal-departure proof invariant", () => {
  const terminalInput = {
    candidateBoardingStopId: "TAO9677",
    officialTerminalStopId: "TAO9677",
    directionMatched: true,
    serviceDateMatched: true,
    publishedDepartures: ["08:15", "11:40", "14:05", "17:45"],
    candidateBoardingTime: "14:19",
  };

  it("proves mismatch only when boarding is the matched departure terminal", () => {
    expect(evaluateTerminalDepartureMismatch(terminalInput)).toMatchObject({
      boardingStopIsPublishedDepartureTerminal: true,
      status: "PROVEN_IMPOSSIBLE",
      reasonCode: "NO_COMPATIBLE_TERMINAL_DEPARTURE",
    });
  });

  it("does not apply terminal departures to an intermediate boarding stop", () => {
    expect(evaluateTerminalDepartureMismatch({ ...terminalInput, candidateBoardingStopId: "TAO-INTERMEDIATE" })).toMatchObject({
      boardingStopIsPublishedDepartureTerminal: false,
      status: "UNRESOLVED",
      reasonCode: "BOARDING_STOP_NOT_PROVEN_AS_DEPARTURE_TERMINAL",
    });
  });
});
