import type { DemoGoal } from "../core/types";
import type { FeasibilityStatus, JourneyGoal } from "../journey/types";
import officialGoalJson from "./officialGoldenGoal.json";

export const demoGoals: readonly DemoGoal[] = [
  { id: "aquarium-entry-safe", title: "Demo Aquarium — Safe", scenarioNow: "2030-06-15T14:00:00+08:00", arrivalAt: "2030-06-15T14:25:00+08:00", deadlineAt: "2030-06-15T15:15:00+08:00", requiredBufferMin: 20 },
  { id: "aquarium-entry-risky", title: "Demo Aquarium — Risky", scenarioNow: "2030-06-15T14:00:00+08:00", arrivalAt: "2030-06-15T15:03:00+08:00", deadlineAt: "2030-06-15T15:15:00+08:00", requiredBufferMin: 20 },
  { id: "aquarium-entry-missed", title: "Demo Aquarium — Missed", scenarioNow: "2030-06-15T14:00:00+08:00", arrivalAt: "2030-06-15T15:26:00+08:00", deadlineAt: "2030-06-15T15:15:00+08:00", requiredBufferMin: 20, fallback: { label: "Demo evening entry window", arrivalAt: "2030-06-15T17:10:00+08:00" } },
  { id: "aquarium-deadline-unknown", title: "Demo Venue — Deadline Unknown", scenarioNow: "2030-06-15T14:00:00+08:00", arrivalAt: "2030-06-15T14:40:00+08:00", requiredBufferMin: 20 },
];

export function findDemoGoal(goalId: string): DemoGoal | undefined {
  return demoGoals.find((goal) => goal.id === goalId);
}

const sharedDemoGoal = {
  goalType: "VENUE_ENTRY" as const,
  destinationId: officialGoalJson.destinationNodeId,
  requiredSafetyBufferMinutes: 15,
  goalActionBufferMinutes: 9,
};

/**
 * Browser goals use the same deterministic Journey Engine and frozen official
 * THSR timetable. Only the first deadline is a published Xpark rule. The
 * remaining deadlines are explicitly synthetic decision fixtures.
 */
export const journeyGoals: readonly JourneyGoal[] = [
  {
    id: officialGoalJson.goalId,
    title: "Enter Xpark before published last admission",
    ...sharedDemoGoal,
    deadlineAt: officialGoalJson.deadlineAt,
    deadlineVerified: true,
    requiredSafetyBufferMinutes: officialGoalJson.requiredSafetyBufferMinutes,
    goalActionBufferMinutes: officialGoalJson.goalActionBufferMinutes,
    source: {
      label: "OFFICIAL PUBLISHED RULE — Xpark last admission and 9-minute THSR access guidance",
      url: officialGoalJson.source.hoursUrl,
      retrievedAt: officialGoalJson.source.retrievedAt,
    },
  },
  {
    id: "DEMO_TIGHT_CUTOFF",
    title: "Synthetic demo: tight venue cutoff",
    ...sharedDemoGoal,
    deadlineAt: "2026-08-31T13:28:00+08:00",
    deadlineVerified: true,
    source: {
      label: "SYNTHETIC DEMO GOAL — fixed cutoff chosen to exercise RISKY; not operational guidance",
    },
  },
  {
    id: "DEMO_MISSED_CUTOFF",
    title: "Synthetic demo: missed venue cutoff",
    ...sharedDemoGoal,
    deadlineAt: "2026-08-31T13:15:00+08:00",
    deadlineVerified: true,
    source: {
      label: "SYNTHETIC DEMO GOAL — fixed cutoff chosen to exercise IMPOSSIBLE; not operational guidance",
    },
  },
  {
    id: "DEMO_UNVERIFIED_CUTOFF",
    title: "Synthetic demo: deadline is unverified",
    ...sharedDemoGoal,
    deadlineAt: null,
    deadlineVerified: false,
    source: {
      label: "SYNTHETIC DEMO GOAL — no trusted cutoff is available; the engine must return UNKNOWN",
    },
  },
];

export interface JourneyScenarioPreset {
  id: string;
  label: string;
  expectedStatus: FeasibilityStatus;
  summary: string;
  goalId: string;
  originId: string;
  departAt: string;
}

/** Judge-facing fixed presets. They change page state; they do not bypass planning. */
export const journeyScenarioPresets: readonly JourneyScenarioPreset[] = [
  {
    id: "official-feasible",
    label: "Published goal",
    expectedStatus: "FEASIBLE",
    summary: "Published Xpark cutoff with a comfortable margin.",
    goalId: officialGoalJson.goalId,
    originId: "1070",
    departAt: "2026-08-31T11:30:00+08:00",
  },
  {
    id: "synthetic-risky",
    label: "Tight cutoff",
    expectedStatus: "RISKY",
    summary: "Same timetable, synthetic deadline, insufficient safety buffer.",
    goalId: "DEMO_TIGHT_CUTOFF",
    originId: "1070",
    departAt: "2026-08-31T11:30:00+08:00",
  },
  {
    id: "synthetic-impossible",
    label: "Missed cutoff",
    expectedStatus: "IMPOSSIBLE",
    summary: "Same timetable, synthetic deadline, goal-ready time is too late.",
    goalId: "DEMO_MISSED_CUTOFF",
    originId: "1070",
    departAt: "2026-08-31T11:30:00+08:00",
  },
  {
    id: "synthetic-unknown",
    label: "Unverified cutoff",
    expectedStatus: "UNKNOWN",
    summary: "No trusted deadline, so the engine refuses to guess.",
    goalId: "DEMO_UNVERIFIED_CUTOFF",
    originId: "1070",
    departAt: "2026-08-31T11:30:00+08:00",
  },
];

export function findJourneyGoal(goalId: string): JourneyGoal | undefined {
  return journeyGoals.find((goal) => goal.id === goalId);
}
