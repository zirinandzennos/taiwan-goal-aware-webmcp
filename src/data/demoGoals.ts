import type { DemoGoal } from "../core/types";
import type { JourneyGoal } from "../journey/types";
import officialGoalJson from "./officialGoldenGoal.json";
export const demoGoals: readonly DemoGoal[] = [
  { id: "aquarium-entry-safe", title: "Demo Aquarium — Safe", scenarioNow: "2030-06-15T14:00:00+08:00", arrivalAt: "2030-06-15T14:25:00+08:00", deadlineAt: "2030-06-15T15:15:00+08:00", requiredBufferMin: 20 },
  { id: "aquarium-entry-risky", title: "Demo Aquarium — Risky", scenarioNow: "2030-06-15T14:00:00+08:00", arrivalAt: "2030-06-15T15:03:00+08:00", deadlineAt: "2030-06-15T15:15:00+08:00", requiredBufferMin: 20 },
  { id: "aquarium-entry-missed", title: "Demo Aquarium — Missed", scenarioNow: "2030-06-15T14:00:00+08:00", arrivalAt: "2030-06-15T15:26:00+08:00", deadlineAt: "2030-06-15T15:15:00+08:00", requiredBufferMin: 20, fallback: { label: "Demo evening entry window", arrivalAt: "2030-06-15T17:10:00+08:00" } },
  { id: "aquarium-deadline-unknown", title: "Demo Venue — Deadline Unknown", scenarioNow: "2030-06-15T14:00:00+08:00", arrivalAt: "2030-06-15T14:40:00+08:00", requiredBufferMin: 20 }
];
export function findDemoGoal(goalId: string): DemoGoal | undefined { return demoGoals.find((goal) => goal.id === goalId); }

/** Primary browser goal backed by the frozen official schedule and dated Xpark rule. */
export const journeyGoals: readonly JourneyGoal[] = [
  {
    id: officialGoalJson.goalId,
    title: "Enter Xpark before last admission",
    goalType: "VENUE_ENTRY",
    destinationId: officialGoalJson.destinationNodeId,
    deadlineAt: officialGoalJson.deadlineAt,
    deadlineVerified: true,
    requiredSafetyBufferMinutes: officialGoalJson.requiredSafetyBufferMinutes,
    goalActionBufferMinutes: officialGoalJson.goalActionBufferMinutes,
    source: {
      label: "Xpark official published last-admission rule and 9-minute THSR access guidance",
      url: officialGoalJson.source.hoursUrl,
      retrievedAt: officialGoalJson.source.retrievedAt,
    },
  },
];

export function findJourneyGoal(goalId: string): JourneyGoal | undefined {
  return journeyGoals.find((goal) => goal.id === goalId);
}
