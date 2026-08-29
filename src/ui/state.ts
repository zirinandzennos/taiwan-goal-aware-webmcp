import { demoGoals } from "../data/demoGoals";
let selectedGoalId = demoGoals[0].id;
export function setSelectedGoalId(goalId: string): void { selectedGoalId = goalId; }
export function getCurrentPageState(): { selectedGoalId: string } { return { selectedGoalId }; }
