export type FeasibilityStatus = "FEASIBLE" | "RISKY" | "IMPOSSIBLE" | "UNKNOWN";
export interface DemoGoal { id: string; title: string; scenarioNow: string; arrivalAt: string; deadlineAt?: string; requiredBufferMin: number; fallback?: { label: string; arrivalAt: string }; }
export interface FeasibilityResult { goalId: string; status: FeasibilityStatus; arrivalAt: string; deadlineAt: string | null; slackMinutes: number | null; requiredBufferMin: number; reasonCode: string; fallback?: DemoGoal["fallback"]; }
