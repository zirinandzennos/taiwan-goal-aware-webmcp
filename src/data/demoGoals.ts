import type { DemoGoal } from "../core/types";
export const demoGoals: readonly DemoGoal[] = [
  { id: "aquarium-entry-safe", title: "Demo Aquarium — Safe", scenarioNow: "2030-06-15T14:00:00+08:00", arrivalAt: "2030-06-15T14:25:00+08:00", deadlineAt: "2030-06-15T15:15:00+08:00", requiredBufferMin: 20 },
  { id: "aquarium-entry-risky", title: "Demo Aquarium — Risky", scenarioNow: "2030-06-15T14:00:00+08:00", arrivalAt: "2030-06-15T15:03:00+08:00", deadlineAt: "2030-06-15T15:15:00+08:00", requiredBufferMin: 20 },
  { id: "aquarium-entry-missed", title: "Demo Aquarium — Missed", scenarioNow: "2030-06-15T14:00:00+08:00", arrivalAt: "2030-06-15T15:26:00+08:00", deadlineAt: "2030-06-15T15:15:00+08:00", requiredBufferMin: 20, fallback: { label: "Demo evening entry window", arrivalAt: "2030-06-15T17:10:00+08:00" } },
  { id: "aquarium-deadline-unknown", title: "Demo Venue — Deadline Unknown", scenarioNow: "2030-06-15T14:00:00+08:00", arrivalAt: "2030-06-15T14:40:00+08:00", requiredBufferMin: 20 }
];
export function findDemoGoal(goalId: string): DemoGoal | undefined { return demoGoals.find((goal) => goal.id === goalId); }
