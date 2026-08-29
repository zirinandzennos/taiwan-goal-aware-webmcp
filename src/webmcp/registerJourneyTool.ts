import { evaluateGoal } from "../core/evaluate";
import { findDemoGoal } from "../data/demoGoals";
import { getCurrentPageState } from "../ui/state";
interface JourneyToolInput { goal_id?: string; }
interface ModelContext { registerTool(tool: { name: string; title: string; description: string; inputSchema: Record<string, unknown>; annotations: { readOnlyHint: boolean }; execute: (input: JourneyToolInput) => Promise<{ content: Array<{ type: "text"; text: string }> }>; }): void; }
declare global { interface Document { modelContext?: ModelContext; } }
export function registerJourneyTool(): boolean {
  if (!document.modelContext) return false;
  document.modelContext.registerTool({
    name: "check_goal_feasibility", title: "Check real-world goal feasibility",
    description: "Use this tool when the user asks whether they can still complete the real-world goal currently selected on this page. The tool uses the current page selection when goal_id is omitted. It returns FEASIBLE, RISKY, IMPOSSIBLE, or UNKNOWN with deadline, arrival, safety margin, reason code and fallback. It does not book, purchase, reserve, modify accounts, or perform external side effects.",
    inputSchema: { type: "object", properties: { goal_id: { type: "string", description: "Optional goal ID. Omit to use the goal currently selected on the page." } }, additionalProperties: false }, annotations: { readOnlyHint: true },
    execute: async (input) => { const goalId = input.goal_id ?? getCurrentPageState().selectedGoalId; const goal = findDemoGoal(goalId); return { content: [{ type: "text", text: JSON.stringify(goal ? evaluateGoal(goal) : { error: "GOAL_NOT_FOUND", goalId }) }] }; }
  });
  return true;
}
