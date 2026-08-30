import { afterEach, describe, expect, it } from "vitest";
import { officialJourneyPlanningContext } from "../src/journey/officialTimetable";
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

describe("official browser journey execution path", () => {
  it("loads the official snapshot and 2026-08-31 primary page state", () => {
    expect(officialJourneyPlanningContext).toMatchObject({
      timetableMode: "PROVIDER_NORMALIZED",
      dataSnapshot: { snapshotId: "tdx-thsr-20260831-20260906-20260830", periodStart: "2026-08-31", periodEnd: "2026-09-06", actualOperationsClaimed: false },
    });
    expect(getJourneyPageState()).toMatchObject({
      goalId: "ENTER_XPARK", originId: "1070", destinationId: "1020", departAt: "2026-08-31T11:30:00+08:00",
      currentState: { nodeId: "1060", at: "2026-08-31T11:49:00+08:00" },
    });
  });

  it("changes the computed service after departAt moves past train 1634", async () => {
    const planTool = registerPlanTool();
    const early = await toolOutput(planTool);
    updateState({ departAt: "2026-08-31T11:36:00+08:00" });
    const late = await toolOutput(planTool);
    expect(JSON.stringify(early)).toContain("THSR_1634_20260831:1070-1020");
    expect(JSON.stringify(late)).not.toContain("THSR_1634_20260831:1070-1020");
    expect(late.recommendedJourney.candidateId).not.toBe(early.recommendedJourney.candidateId);
  });

  it("returns domain-equivalent human and WebMCP plan results", async () => {
    const human = planCurrentJourney();
    const agent = await toolOutput(registerPlanTool());
    if (human.kind !== "PLAN_RESULT") throw new Error("expected a human plan");
    const expected = human.plan.balanced ?? human.plan.fastest ?? human.plan.cheapest;
    expect(human).toMatchObject({ kind: "PLAN_RESULT", plan: {
      status: agent.status,
      goalId: agent.goal.id,
    } });
    expect(agent.recommendedJourney.candidateId).toBe(expected?.candidate.id);
    expect(agent).toMatchObject({ arrivalAt: "2026-08-31T13:09:00+08:00", goalReadyAt: "2026-08-31T05:18:00.000Z", safetyMarginMinutes: 222 });
  });

  it("uses the provider-normalized THSR context without browser credentials", async () => {
    const previousId = process.env.TDX_CLIENT_ID;
    const previousSecret = process.env.TDX_CLIENT_SECRET;
    delete process.env.TDX_CLIENT_ID;
    delete process.env.TDX_CLIENT_SECRET;
    try {
      const human = planCurrentJourney();
      expect(human).toMatchObject({ kind: "PLAN_RESULT", plan: { status: "FEASIBLE", timetableMode: "PROVIDER_NORMALIZED", balanced: { candidate: { legs: [{ serviceId: "THSR_1634_20260831:1070-1020" }] } } } });
      expect(JSON.stringify(await toolOutput(registerPlanTool()))).not.toContain("synthetic-2030-challenge-fixture");
    } finally {
      if (previousId === undefined) delete process.env.TDX_CLIENT_ID; else process.env.TDX_CLIENT_ID = previousId;
      if (previousSecret === undefined) delete process.env.TDX_CLIENT_SECRET; else process.env.TDX_CLIENT_SECRET = previousSecret;
    }
  });

  it("replans from Tainan identically and discovers 0640 after departed 1634", async () => {
    const human = replanCurrentJourney();
    const agent = await toolOutput(registerReplanTool());
    expect(human).toMatchObject({ kind: "REPLAN_RESULT", replan: {
      currentNodeId: "1060",
      replannedAt: "2026-08-31T11:49:00+08:00",
      plan: { balanced: { candidate: { id: agent.plan.balanced.candidateId, legs: [{ serviceId: "THSR_0640_20260831:1060-1020" }] } } },
    } });
    expect(agent).toMatchObject({
      status: "FEASIBLE",
      safetyMarginMinutes: 162,
      recommendedJourney: { legs: [{ serviceId: "THSR_0640_20260831:1060-1020" }] },
    });
    expect(JSON.stringify(human)).not.toContain("THSR_1634_20260831:1060-1020");
    expect(JSON.stringify(agent)).not.toContain("THSR_1634_20260831:1060-1020");
  });

  it("keeps the empty candidate invariant for the human plan path", () => {
    updateState({ departAt: "2026-09-06T23:59:00+08:00" });
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
    expect(replanCurrentJourney().kind).toBe("REPLAN_RESULT");
  });
});
