import { afterEach, describe, expect, it } from "vitest";
import {
  allocateDisplayCandidates,
  compactJourneyProductPlan,
  fixedJourneyProductScenario,
  planJourneyFromPageState,
  recommendationBadgeLabel,
  recommendationTieLabel,
  replanSelectedSnapshotJourney,
} from "../src/application/journeyProduct.ts";
import { evaluateFormalRecommendationGates } from "../src/journey/modeValidation.ts";
import snapshot from "../data/snapshots/2026-08-31_2026-09-06/maas-candidates.json";
import proof from "../data/snapshots/2026-08-31_2026-09-06/optimization-proof.json";
import {
  completeSelectedStepEightMinutesLate,
  getJourneyPageState,
  getJourneyPageStateVersion,
  initializeFixedJourneyProductState,
  resetJourneyPageState,
  selectProductJourney,
  storeLatestProductPlan,
  updateJourneyPageInputs,
} from "../src/ui/state.ts";

afterEach(resetJourneyPageState);

function fixedPlan() {
  initializeFixedJourneyProductState(fixedJourneyProductScenario);
  return planJourneyFromPageState(getJourneyPageState(), getJourneyPageStateVersion());
}

describe("Journey-first product application service", () => {
  it("preserves the formal winner sets and allocates three distinct display journeys", () => {
    const plan = fixedPlan();
    expect(plan.status).toBe("AVAILABLE");
    expect(plan.effectiveCandidateCounts).toEqual({ feasible: 4, risky: 0, impossible: 6, unknown: 0, total: 10 });
    expect(plan.recommendations.FASTEST.formalWinnerCandidateIds).toEqual(["journey:tdx-maas:07fb4bb5", "journey:tdx-maas:ab19cfc6"]);
    expect(plan.recommendations.BALANCED.formalWinnerCandidateIds).toEqual(["journey:tdx-maas:ab19cfc6"]);
    expect(plan.recommendations.CHEAPEST.formalWinnerCandidateIds).toEqual(["journey:tdx-maas:07fb4bb5", "journey:tdx-maas:ab19cfc6", "journey:tdx-maas:1767bfb5", "journey:tdx-maas:9bad5bc6"]);
    const displayIds = Object.values(plan.recommendations).map((item) => item.displayCandidateId);
    expect(new Set(displayIds).size).toBe(3);
    for (const recommendation of Object.values(plan.recommendations)) {
      expect(recommendation.formalWinnerCandidateIds).toContain(recommendation.displayCandidateId);
      expect(recommendation.journey?.steps?.at(-1)?.type).toBe("GOAL_COMPLETION");
    }
  });

  it("uses deterministic allocation even when winner input order is shuffled", () => {
    const gates = evaluateFormalRecommendationGates(
      snapshot.candidates as any,
      snapshot.primaryCandidateResolutions as any,
      proof.candidates as any,
    );
    const baseline = allocateDisplayCandidates(gates);
    const shuffled = structuredClone(gates);
    shuffled.fastest.winnerCandidateIds!.reverse();
    shuffled.cheapest.winnerCandidateIds!.reverse();
    expect(allocateDisplayCandidates(shuffled)).toEqual(baseline);
  });

  it("shows exact tie language without inventing a unique winner", () => {
    const plan = fixedPlan();
    expect(recommendationTieLabel(plan.recommendations.FASTEST)).toBe("Tied fastest with 1 other journey");
    expect(recommendationTieLabel(plan.recommendations.BALANCED)).toBe("Unique Balanced recommendation");
    expect(recommendationTieLabel(plan.recommendations.CHEAPEST)).toBe("All four valid journeys share the same NT$1,341 fare.");
    expect(recommendationBadgeLabel(plan.recommendations.BALANCED)).toBe("RECOMMENDED");
  });

  it("changes request identity and withholds old results for an unsupported live intent", () => {
    const first = fixedPlan();
    updateJourneyPageInputs({ originId: "unsupported-origin" });
    const second = planJourneyFromPageState(getJourneyPageState(), getJourneyPageStateVersion());
    expect(second.identity.requestFingerprint).not.toBe(first.identity.requestFingerprint);
    expect(second.status).toBe("UNAVAILABLE");
    expect(Object.values(second.recommendations).every((item) => item.journey === null)).toBe(true);
    expect(() => selectProductJourney("FASTEST")).toThrow(/stale or missing/);
  });

  it("records deterministic +8 minute progress, marks downstream stale, and fails replan closed", () => {
    const plan = fixedPlan();
    storeLatestProductPlan(plan);
    selectProductJourney("BALANCED");
    const firstStep = plan.recommendations.BALANCED.journey!.steps![0];
    completeSelectedStepEightMinutesLate();
    const state = getJourneyPageState();
    expect(Date.parse(state.progress!.actualProgressEvidence.actualCompletedAt) - Date.parse(firstStep.plannedEnd)).toBe(8 * 60_000);
    expect(state.progress).toMatchObject({ completedStepIndex: 0, staleFromStepIndex: 1 });
    expect(state.latestProductPlanStale).toBe(true);
    expect(() => completeSelectedStepEightMinutesLate()).toThrow(/already been recorded/);
    expect(replanSelectedSnapshotJourney(state)).toMatchObject({ status: "UNAVAILABLE", reasonCode: "REPLAN_UNAVAILABLE_FOR_SNAPSHOT_STATE", actualProgressEvidence: { delayMinutes: 8 } });
  });

  it("produces stable compact Human/WebMCP parity content without proof bulk", () => {
    const plan = fixedPlan();
    const compact = compactJourneyProductPlan(plan) as any;
    expect(compact.normalizedResultHash).toBe(plan.normalizedResultHash);
    expect(compact.requestIdentity.requestFingerprint).toBe(plan.identity.requestFingerprint);
    expect(compact.recommendations.balanced.journey.steps.at(-1).type).toBe("GOAL_COMPLETION");
    expect(JSON.stringify(compact)).not.toContain("weightedComponents");
  });
});
