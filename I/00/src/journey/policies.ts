import type { JourneyPolicyPreset } from "./types";

/** Challenge deterministic policy, not a universal transportation standard. */
export const DEFAULT_ARRIVAL_SAFETY_BUFFER_MINUTES = 10;

/** A technically feasible transfer below this slack is treated as tight. */
export const TIGHT_TRANSFER_SLACK_MINUTES = 5;

/**
 * Hand-authored Challenge v0 policy weights. They are not trained by an ML
 * model. Each preset sums to 100 so its trade-offs are easy to inspect.
 * Hard constraints are evaluated before any future weighted ranking. A learned
 * ranker may replace these weights without changing journey request/candidate contracts.
 */
export interface PolicyWeights {
  travelTime: number;
  monetaryCost: number;
  walking: number;
  transfers: number;
  connectionRisk: number;
  comfort: number;
  leisureOpportunity: number;
}

export const POLICY_WEIGHTS: Readonly<Record<JourneyPolicyPreset, PolicyWeights>> = {
  FASTEST: { travelTime: 45, monetaryCost: 5, walking: 5, transfers: 10, connectionRisk: 15, comfort: 10, leisureOpportunity: 10 },
  BALANCED: { travelTime: 25, monetaryCost: 15, walking: 10, transfers: 10, connectionRisk: 15, comfort: 15, leisureOpportunity: 10 },
  CHEAPEST: { travelTime: 10, monetaryCost: 40, walking: 15, transfers: 10, connectionRisk: 10, comfort: 5, leisureOpportunity: 10 },
  LEISURE: { travelTime: 10, monetaryCost: 10, walking: 10, transfers: 5, connectionRisk: 10, comfort: 20, leisureOpportunity: 35 },
  DEADLINE_CRITICAL: { travelTime: 30, monetaryCost: 5, walking: 5, transfers: 15, connectionRisk: 35, comfort: 10, leisureOpportunity: 0 },
};
