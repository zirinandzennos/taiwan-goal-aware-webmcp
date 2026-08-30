import type { DemoGoal } from "../core/types";
import type { JourneyGoal } from "../journey/types";
export const demoGoals: readonly DemoGoal[] = [
  { id: "aquarium-entry-safe", title: "Demo Aquarium — Safe", scenarioNow: "2030-06-15T14:00:00+08:00", arrivalAt: "2030-06-15T14:25:00+08:00", deadlineAt: "2030-06-15T15:15:00+08:00", requiredBufferMin: 20 },
  { id: "aquarium-entry-risky", title: "Demo Aquarium — Risky", scenarioNow: "2030-06-15T14:00:00+08:00", arrivalAt: "2030-06-15T15:03:00+08:00", deadlineAt: "2030-06-15T15:15:00+08:00", requiredBufferMin: 20 },
  { id: "aquarium-entry-missed", title: "Demo Aquarium — Missed", scenarioNow: "2030-06-15T14:00:00+08:00", arrivalAt: "2030-06-15T15:26:00+08:00", deadlineAt: "2030-06-15T15:15:00+08:00", requiredBufferMin: 20, fallback: { label: "Demo evening entry window", arrivalAt: "2030-06-15T17:10:00+08:00" } },
  { id: "aquarium-deadline-unknown", title: "Demo Venue — Deadline Unknown", scenarioNow: "2030-06-15T14:00:00+08:00", arrivalAt: "2030-06-15T14:40:00+08:00", requiredBufferMin: 20 }
];
export function findDemoGoal(goalId: string): DemoGoal | undefined { return demoGoals.find((goal) => goal.id === goalId); }

/** Goal fixtures remain synthetic until the licensed 2026 timetable snapshot is imported. */
export const journeyGoals: readonly JourneyGoal[] = [
  {
    id: "bade-evening-appointment",
    title: "Reach the Bade appointment by 20:30",
    goalType: "APPOINTMENT_CUTOFF",
    destinationId: "taoyuan-bade",
    deadlineAt: "2030-06-15T20:30:00+08:00",
    deadlineVerified: true,
    requiredSafetyBufferMinutes: 15,
    goalActionBufferMinutes: 5,
    source: { label: "Synthetic test goal — not a real venue deadline" },
  },
  {
    id: "bade-last-entry",
    title: "Enter the Bade venue before 20:00",
    goalType: "VENUE_ENTRY",
    destinationId: "taoyuan-bade",
    deadlineAt: "2030-06-15T20:00:00+08:00",
    deadlineVerified: true,
    requiredSafetyBufferMinutes: 15,
    goalActionBufferMinutes: 5,
    source: { label: "Synthetic test goal — not a real venue deadline" },
  },
  {
    id: "bade-deadline-unverified",
    title: "Reach the Bade venue (deadline unverified)",
    goalType: "VENUE_ENTRY",
    destinationId: "taoyuan-bade",
    deadlineAt: null,
    deadlineVerified: false,
    requiredSafetyBufferMinutes: 15,
    source: { label: "Synthetic test goal with intentionally unavailable deadline" },
  },
];

export function findJourneyGoal(goalId: string): JourneyGoal | undefined {
  return journeyGoals.find((goal) => goal.id === goalId);
}
