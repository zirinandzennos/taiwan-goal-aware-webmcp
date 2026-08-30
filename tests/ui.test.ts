import { afterEach, describe, expect, it } from "vitest";
import { planCurrentJourney, replanCurrentJourney } from "../src/ui/journeyActions";
import {
  getJourneyPageState,
  resetJourneyPageState,
  setJourneyPageState,
  type JourneyPageState,
} from "../src/ui/state";
import { registerJourneyTool } from "../src/webmcp/registerJourneyTool";

type ToolResponse = { content: Array<{ type: "text"; text: string }> };
type RegisteredTool = {
  name: string;
  execute: (input: Record<string, never>) => Promise<ToolResponse>;
};

const originalDocument = globalThis.document;

afterEach(() => {
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  resetJourneyPageState();
});

function updateState(overrides: Partial<JourneyPageState>): void {
  const current = getJourneyPageState();
  setJourneyPageState({
    ...current,
    ...overrides,
    preferences: { ...current.preferences, ...overrides.preferences },
    constraints: { ...current.constraints, ...overrides.constraints },
  });
}

function registerPlanTool(): RegisteredTool {
  const tools = new Map<string, RegisteredTool>();
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { modelContext: { registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool) } },
  });
  expect(registerJourneyTool()).toBe(true);
  return tools.get("check_taiwan_goal_feasibility")!;
}

function registerReplanTool(): RegisteredTool {
  const tools = new Map<string, RegisteredTool>();
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { modelContext: { registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool) } },
  });
  expect(registerJourneyTool()).toBe(true);
  return tools.get("replan_taiwan_journey")!;
}

async function toolOutput(tool: RegisteredTool): Promise<Record<string, any>> {
  return JSON.parse((await tool.execute({})).content[0].text) as Record<string, any>;
}

function optionIds(plan: Exclude<ReturnType<typeof planCurrentJourney>, { kind: "STATE_ERROR" }> ["plan"]): string[] {
  return [plan.fastest, plan.cheapest, plan.balanced]
    .flatMap((option) => option ? [option.candidate.id] : []);
}

describe("minimal human journey UI execution path", () => {
  it("uses the same live state for a human 07:00 plan and later WebMCP 07:12 plan", async () => {
    const planTool = registerPlanTool();
    updateState({ preferences: { avoidTaxi: true } });
    const human = planCurrentJourney();
    expect(human.kind).toBe("PLAN_RESULT");
    if (human.kind !== "PLAN_RESULT") throw new Error("expected a human plan");
    expect(optionIds(human.plan).join("|")).toContain("bus-xiaogang-0705");

    updateState({ departAt: "2030-06-15T07:12:00+08:00" });
    const agent = await toolOutput(planTool);
    expect(JSON.stringify(agent)).not.toContain("bus-xiaogang-0705");
    expect(JSON.stringify(agent)).toContain("bus-xiaogang-0720");
  });

  it("returns domain-equivalent human and WebMCP plan results", async () => {
    const human = planCurrentJourney();
    const agent = await toolOutput(registerPlanTool());
    if (human.kind !== "PLAN_RESULT") throw new Error("expected a human plan");
    const expected = [human.plan.fastest, human.plan.balanced, human.plan.cheapest]
      .find((option) => option?.feasibility.status === human.plan.status) ?? human.plan.fastest ?? human.plan.balanced ?? human.plan.cheapest;
    expect(human).toMatchObject({ kind: "PLAN_RESULT", plan: {
      status: agent.status,
      goalId: agent.goalId,
    } });
    expect(agent.recommendedJourney.candidateId).toBe(expected?.candidate.id);
  });

  it("applies avoidTaxi identically to human and WebMCP planning", async () => {
    updateState({ preferences: { avoidTaxi: true } });
    const human = planCurrentJourney();
    expect(human.kind).toBe("PLAN_RESULT");
    if (human.kind !== "PLAN_RESULT") throw new Error("expected a human plan");
    for (const option of [human.plan.fastest, human.plan.cheapest, human.plan.balanced]) {
      expect(option?.candidate.legs.some((leg) => leg.type === "TRAVEL" && leg.mode === "TAXI")).toBe(false);
    }
    expect(JSON.stringify(await toolOutput(registerPlanTool()))).not.toContain("taxi-");
  });

  it("replans from the same live state for human and WebMCP paths", async () => {
    updateState({ currentState: { nodeId: "zuoying-thsr", at: "2030-06-15T08:31:00+08:00" } });
    const human = replanCurrentJourney();
    const agent = await toolOutput(registerReplanTool());
    expect(human).toMatchObject({ kind: "REPLAN_RESULT", replan: {
      currentNodeId: "zuoying-thsr",
      plan: { fastest: { candidate: { id: agent.plan.fastest.candidateId } } },
    } });
    expect(JSON.stringify(human)).not.toContain("thsr-zuoying-0830");
    expect(JSON.stringify(agent)).not.toContain("thsr-zuoying-0830");
  });

  it("keeps the empty candidate invariant for the human plan path", () => {
    updateState({ departAt: "2030-06-15T22:00:00+08:00" });
    expect(planCurrentJourney()).toMatchObject({ kind: "PLAN_RESULT", plan: {
      candidateCount: 0,
      fastest: null,
      cheapest: null,
      balanced: null,
      reasonCodes: ["NO_EXECUTABLE_JOURNEY"],
    } });
  });

  it("keeps human planning available when WebMCP is unavailable", () => {
    Object.defineProperty(globalThis, "document", { configurable: true, value: {} });
    expect(registerJourneyTool()).toBe(false);
    expect(planCurrentJourney().kind).toBe("PLAN_RESULT");
    updateState({ currentState: { nodeId: "zuoying-thsr", at: "2030-06-15T08:31:00+08:00" } });
    expect(replanCurrentJourney().kind).toBe("REPLAN_RESULT");
  });
});
