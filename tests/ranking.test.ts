import { describe, expect, it } from "vitest";
import {
  rankBalanced,
  rankBalancedJourneys,
  rankCheapest,
  rankFastest,
  recommendJourneys,
} from "../src/journey/ranking";
import type { CandidateJourney } from "../src/journey/types";

function candidate(overrides: Partial<CandidateJourney>): CandidateJourney {
  const id = overrides.id ?? "candidate";
  return {
    id,
    originId: "origin",
    destinationId: "destination",
    legs: [{ type: "TRAVEL", serviceId: `service-${id}`, mode: "BUS", fromNodeId: "origin", toNodeId: "destination", departAt: "2030-06-15T07:00:00+08:00", arriveAt: "2030-06-15T09:00:00+08:00", durationMinutes: 120, estimatedCost: 100 }],
    departAt: "2030-06-15T07:00:00+08:00",
    arriveAt: "2030-06-15T09:00:00+08:00",
    totalDurationMinutes: 120,
    totalWaitingMinutes: 0,
    totalTransferMinutes: 0,
    totalWalkingMinutes: 0,
    minimumTransferSlackMinutes: null,
    tightTransferCount: 0,
    totalCost: 100,
    walkingMinutes: 0,
    transferCount: 0,
    estimatedCost: 100,
    connectionRiskScore: 0,
    ...overrides,
  };
}

const candidateA = candidate({
  id: "A-fast-expensive",
  arriveAt: "2030-06-15T09:00:00+08:00",
  totalDurationMinutes: 120,
  totalCost: 1_000,
  transferCount: 2,
  totalWalkingMinutes: 30,
  walkingMinutes: 30,
  totalTransferMinutes: 40,
  minimumTransferSlackMinutes: 5,
});
const candidateB = candidate({
  id: "B-slow-cheap",
  arriveAt: "2030-06-15T10:00:00+08:00",
  totalDurationMinutes: 180,
  totalCost: 100,
  transferCount: 4,
  totalWalkingMinutes: 25,
  walkingMinutes: 25,
  totalTransferMinutes: 50,
  minimumTransferSlackMinutes: 1,
  tightTransferCount: 1,
});
const candidateC = candidate({
  id: "C-balanced",
  arriveAt: "2030-06-15T09:10:00+08:00",
  totalDurationMinutes: 130,
  totalCost: 400,
  transferCount: 1,
  totalWalkingMinutes: 5,
  walkingMinutes: 5,
  totalTransferMinutes: 10,
  minimumTransferSlackMinutes: 20,
});

describe("deterministic candidate ranking", () => {
  it("selects earliest final arrival rather than shortest duration", () => {
    const shorterButLater = candidate({ id: "shorter-but-later", arriveAt: "2030-06-15T10:10:00+08:00", totalDurationMinutes: 90 });
    expect(rankFastest([shorterButLater, candidateA])?.id).toBe("A-fast-expensive");
  });

  it("resolves fastest ties by cost, transfers, walking, then lexical ID", () => {
    const lexicalA = candidate({ id: "a", arriveAt: "2030-06-15T09:00:00+08:00" });
    const lexicalB = candidate({ id: "b", arriveAt: "2030-06-15T09:00:00+08:00" });
    expect(rankFastest([lexicalB, lexicalA])?.id).toBe("a");
  });

  it("selects lowest cost and resolves ties deterministically", () => {
    const cheapEarly = candidate({ id: "cheap-early", totalCost: 50, arriveAt: "2030-06-15T09:00:00+08:00" });
    const cheapLate = candidate({ id: "cheap-late", totalCost: 50, arriveAt: "2030-06-15T09:30:00+08:00" });
    expect(rankCheapest([candidateA, cheapLate, cheapEarly])?.id).toBe("cheap-early");
  });

  it("scores the five measurable BALANCED dimensions and selects C naturally", () => {
    const balanced = rankBalanced([candidateA, candidateB, candidateC]);
    expect(balanced?.candidate.id).toBe("C-balanced");
    expect(balanced?.scoreBreakdown).toMatchObject({ durationPenalty: expect.any(Number), costPenalty: expect.any(Number), transferPenalty: 0, walkingPenalty: 0, riskPenalty: 0 });
    expect(balanced?.score).toBeLessThan(rankBalancedJourneys([candidateA, candidateB, candidateC])[1].score);
  });

  it("treats direct journeys as safe in the transfer-risk dimension", () => {
    const direct = candidate({ id: "direct", minimumTransferSlackMinutes: null, transferCount: 0 });
    const tight = candidate({ id: "tight", minimumTransferSlackMinutes: 1, transferCount: 1 });
    const safe = candidate({ id: "safe", minimumTransferSlackMinutes: 20, transferCount: 1 });
    const scored = rankBalancedJourneys([tight, direct, safe]);
    expect(scored.find((entry) => entry.candidate.id === "direct")?.scoreBreakdown.riskPenalty).toBe(0);
    expect(scored.find((entry) => entry.candidate.id === "tight")?.scoreBreakdown.riskPenalty).toBe(1);
    expect(scored.find((entry) => entry.candidate.id === "safe")?.scoreBreakdown.riskPenalty).toBe(0);
  });

  it("is input-order independent and does not mutate candidates or legs", () => {
    const original = [candidateA, candidateB, candidateC];
    const snapshot = JSON.stringify(original);
    const normal = recommendJourneys(original);
    const reversed = recommendJourneys([...original].reverse());
    const shuffled = recommendJourneys([candidateB, candidateA, candidateC]);
    expect(normal.fastest?.id).toBe(reversed.fastest?.id);
    expect(normal.cheapest?.id).toBe(shuffled.cheapest?.id);
    expect(normal.balanced?.candidate.id).toBe(reversed.balanced?.candidate.id);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("returns structured null recommendations for an empty candidate set", () => {
    expect(recommendJourneys([])).toEqual({ fastest: null, cheapest: null, balanced: null });
  });
});
