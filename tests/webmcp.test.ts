import { afterEach, describe, expect, it } from "vitest";
import { setSelectedGoalId } from "../src/ui/state";
import { registerJourneyTool } from "../src/webmcp/registerJourneyTool";
type RegisteredTool = { name: string; annotations: { readOnlyHint: boolean }; execute: (input: { goal_id?: string }) => Promise<{ content: Array<{ type: "text"; text: string }> }> };
const originalDocument = globalThis.document;
afterEach(() => { Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument }); setSelectedGoalId("aquarium-entry-safe"); });
describe("check_goal_feasibility WebMCP tool", () => {
  it("registers read-only and uses the latest shared selection", async () => { let tool: RegisteredTool | undefined; Object.defineProperty(globalThis, "document", { configurable: true, value: { modelContext: { registerTool: (registered: RegisteredTool) => { tool = registered; } } } }); expect(registerJourneyTool()).toBe(true); expect(tool?.name).toBe("check_goal_feasibility"); expect(tool?.annotations).toEqual({ readOnlyHint: true }); setSelectedGoalId("aquarium-entry-risky"); expect(JSON.parse((await tool!.execute({})).content[0].text)).toMatchObject({ goalId: "aquarium-entry-risky", status: "RISKY" }); });
  it("returns UNKNOWN for an unknown goal_id", async () => { const tool = registerTool(); expect(JSON.parse((await tool.execute({ goal_id: "missing-goal" })).content[0].text)).toEqual({ status: "UNKNOWN", reasonCode: "GOAL_NOT_FOUND", goalId: "missing-goal" }); });
  it("returns UNKNOWN when page state has no selected goal", async () => { const tool = registerTool(); setSelectedGoalId(""); expect(JSON.parse((await tool.execute({})).content[0].text)).toEqual({ status: "UNKNOWN", reasonCode: "NO_GOAL_SELECTED" }); });
  it("does not crash when WebMCP is unavailable", () => { Object.defineProperty(globalThis, "document", { configurable: true, value: {} }); expect(registerJourneyTool()).toBe(false); });
});

function registerTool(): RegisteredTool {
  let tool: RegisteredTool | undefined;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { modelContext: { registerTool: (registered: RegisteredTool) => { tool = registered; } } } });
  expect(registerJourneyTool()).toBe(true);
  return tool!;
}
