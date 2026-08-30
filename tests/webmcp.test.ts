import { afterEach, describe, expect, it } from "vitest";
import { planJourney } from "../src/journey/planner";
import { replanJourney } from "../src/journey/replanner";
import {
  syntheticScheduledServices,
  syntheticTransferRules,
} from "../src/journey/syntheticTimetable";
import type { JourneyPlanningContext } from "../src/journey/types";
import {
  getCurrentJourneyPageState,
  toJourneyReplanRequest,
  toJourneyRequest,
} from "../src/webmcp/pageState";
import { registerJourneyTool } from "../src/webmcp/registerJourneyTool";
import {
  resetJourneyPageState,
  setJourneyPageState,
  type JourneyPageState,
} from "../src/ui/state";

type ToolResponse = { content: Array<{ type: "text"; text: string }> };
type RegisteredTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: Record<string, never>, options?: { signal?: AbortSignal }) => Promise<ToolResponse>;
};

const originalDocument = globalThis.document;
const syntheticContext: JourneyPlanningContext = {
  timetable: syntheticScheduledServices,
  transferRules: syntheticTransferRules,
  timetableMode: "SYNTHETIC_FIXED_TIMETABLE",
};

const PLAN_INTENT_FIXTURES = [
  "What are the best options for the trip I selected?",
  "Compare the journey I have set up.",
  "What is the fastest and cheapest way for this trip?",
  "Which option is the best balance for my selected journey?",
  "Can this trip actually work?",
];
const REPLAN_INTENT_FIXTURES = [
  "I'm ready to continue now. Recalculate the rest.",
  "I was delayed. What should I take now?",
  "I missed the service. Replan the remaining trip.",
  "Recalculate from where I am now.",
];
const NEGATIVE_INTENT_FIXTURES = [
  "Tell me about Taiwan.",
  "What animals live in aquariums?",
  "Translate this page.",
  "What's the weather?",
  "Change the website background.",
];

afterEach(() => {
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
  resetJourneyPageState();
});

function registerTools(): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { modelContext: { registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool) } },
  });
  expect(registerJourneyTool()).toBe(true);
  return tools;
}

function json(tool: RegisteredTool): Promise<Record<string, any>> {
  return tool.execute({}).then((result) => JSON.parse(result.content[0].text) as Record<string, any>);
}

function updateState(overrides: Partial<JourneyPageState>): void {
  const current = getCurrentJourneyPageState();
  setJourneyPageState({
    ...current,
    ...overrides,
    preferences: { ...current.preferences, ...overrides.preferences },
    constraints: { ...current.constraints, ...overrides.constraints },
  });
}

function selectedCandidateIds(output: Record<string, any>): string[] {
  return output.recommendedJourney ? [output.recommendedJourney.candidateId as string] : [];
}

describe("Taiwan journey WebMCP tools", () => {
  it("registers exactly the two stable read-only tools with narrow metadata", () => {
    const tools = registerTools();
    expect([...tools.keys()]).toEqual(["check_taiwan_goal_feasibility", "replan_taiwan_journey"]);
    for (const tool of tools.values()) {
      expect(tool.inputSchema).toEqual({ type: "object", properties: {}, additionalProperties: false });
      expect(tool.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: false });
    }
    expect(tools.get("check_taiwan_goal_feasibility")?.description).toContain("currently selected on this page");
    expect(tools.get("check_taiwan_goal_feasibility")?.description).toContain("weather");
    expect(tools.get("replan_taiwan_journey")?.description).toContain("location or time has changed");
  });

  it("keeps plan, replan, and negative intent fixtures distinct in metadata tests", () => {
    expect(PLAN_INTENT_FIXTURES).toHaveLength(5);
    expect(REPLAN_INTENT_FIXTURES).toHaveLength(4);
    expect(NEGATIVE_INTENT_FIXTURES).toContain("What's the weather?");
  });

  it("does not crash when document.modelContext is unavailable", () => {
    Object.defineProperty(globalThis, "document", { configurable: true, value: {} });
    expect(registerJourneyTool()).toBe(false);
  });

  it("returns a compact structured error when the planning state is incomplete", async () => {
    const tools = registerTools();
    updateState({ destinationId: "" });
    await expect(json(tools.get("check_taiwan_goal_feasibility")!)).resolves.toEqual({
      status: "UNKNOWN",
      reasonCodes: ["PAGE_JOURNEY_STATE_INCOMPLETE"],
      missingFields: ["destinationId"],
    });
  });

  it("returns a compact structured error when the replan state is incomplete", async () => {
    const tools = registerTools();
    await expect(json(tools.get("replan_taiwan_journey")!)).resolves.toEqual({
      status: "UNKNOWN",
      reasonCodes: ["CURRENT_JOURNEY_STATE_INCOMPLETE"],
      missingFields: ["currentState.nodeId", "currentState.at"],
    });
  });

  it("keeps incomplete original journey state distinct from incomplete replan state", async () => {
    const tools = registerTools();
    updateState({ originId: "" });
    await expect(json(tools.get("replan_taiwan_journey")!)).resolves.toEqual({
      status: "UNKNOWN",
      reasonCodes: ["PAGE_JOURNEY_STATE_INCOMPLETE"],
      missingFields: ["originId"],
    });
  });

  it("reads 07:00 then 07:12 live state without registering the plan tool again", async () => {
    const plan = registerTools().get("check_taiwan_goal_feasibility")!;
    updateState({ preferences: { avoidTaxi: true } });
    const early = await json(plan);
    updateState({ departAt: "2030-06-15T07:12:00+08:00" });
    const late = await json(plan);
    expect(late.candidateCount).toBeLessThan(early.candidateCount);
    expect(selectedCandidateIds(late).join("|")).not.toContain("bus-xiaogang-0705");
  });

  it("reads a changed avoidTaxi preference from the same registered plan tool", async () => {
    const plan = registerTools().get("check_taiwan_goal_feasibility")!;
    const taxiAllowed = await json(plan);
    updateState({ preferences: { avoidTaxi: true } });
    const taxiAvoided = await json(plan);
    expect(selectedCandidateIds(taxiAllowed).join("|")).toContain("taxi-");
    expect(selectedCandidateIds(taxiAvoided).join("|")).not.toContain("taxi-");
  });

  it("reads a changed selected goal from the same registered feasibility tool", async () => {
    const check = registerTools().get("check_taiwan_goal_feasibility")!;
    const verified = await json(check);
    updateState({ goalId: "bade-deadline-unverified" });
    const unknown = await json(check);
    expect(verified.goalId).toBe("bade-evening-appointment");
    expect(unknown).toMatchObject({ goalId: "bade-deadline-unverified", status: "UNKNOWN", reasonCodes: ["GOAL_DEADLINE_UNVERIFIED"] });
  });

  it("replans live state from Zuoying THSR after the 08:30 service has been missed", async () => {
    const replan = registerTools().get("replan_taiwan_journey")!;
    updateState({ currentState: { nodeId: "zuoying-thsr", at: "2030-06-15T08:31:00+08:00" } });
    const output = await json(replan);
    expect(output.currentNodeId).toBe("zuoying-thsr");
    expect(JSON.stringify(output.plan)).not.toContain("thsr-zuoying-0830");
  });

  it("removes the old 10:10 bus after a live 40-minute delay", async () => {
    const replan = registerTools().get("replan_taiwan_journey")!;
    updateState({ currentState: { nodeId: "taoyuan-bus", at: "2030-06-15T10:40:00+08:00" } });
    const output = await json(replan);
    expect(JSON.stringify(output.plan)).not.toContain("bus-taoyuan-1010");
    expect(JSON.stringify(output.plan)).toContain("bus-taoyuan-1922");
  });

  it("maps page state to the existing JourneyRequest contract without a second trip schema", () => {
    updateState({ arriveBy: "2030-06-15T11:00:00+08:00", preferences: { avoidTaxi: true } });
    const request = toJourneyRequest(getCurrentJourneyPageState());
    expect(request).toMatchObject({
      originId: "kaohsiung-xiaogang",
      destinationId: "taoyuan-bade",
      constraints: { arriveBy: "2030-06-15T11:00:00+08:00", avoidTaxi: true },
      policy: "BALANCED",
    });
  });

  it("has plan output parity with planJourney for the same live state", async () => {
    const plan = registerTools().get("check_taiwan_goal_feasibility")!;
    updateState({ preferences: { avoidTaxi: true } });
    const request = toJourneyRequest(getCurrentJourneyPageState());
    if ("missingFields" in request) throw new Error("test state should be complete");
    const domain = planJourney(request, syntheticContext);
    const output = await json(plan);
    const expected = [domain.fastest, domain.balanced, domain.cheapest]
      .find((option) => option?.feasibility.status === domain.status) ?? domain.fastest ?? domain.balanced ?? domain.cheapest;
    expect(output).toMatchObject({
      status: domain.status,
      goalId: domain.goalId,
      recommendedJourney: { candidateId: expected?.candidate.id },
      dataSnapshot: { snapshotId: "synthetic-2030-challenge-fixture" },
    });
  });

  it("has replan output parity with replanJourney for the same live state", async () => {
    const replanTool = registerTools().get("replan_taiwan_journey")!;
    updateState({ currentState: { nodeId: "zuoying-thsr", at: "2030-06-15T08:31:00+08:00" } });
    const request = toJourneyReplanRequest(getCurrentJourneyPageState());
    if ("missingFields" in request) throw new Error("test state should be complete");
    const domain = replanJourney(request, syntheticContext);
    const output = await json(replanTool);
    expect(output).toMatchObject({
      status: domain.plan?.status ?? "UNKNOWN",
      currentNodeId: domain.currentNodeId,
      reasonCodes: domain.reasonCodes,
      dataSnapshot: { snapshotId: "synthetic-2030-challenge-fixture" },
      plan: { goalId: "bade-evening-appointment", fastest: { candidateId: domain.plan?.fastest?.candidate.id } },
    });
  });

  it("honors cancellation before reading state or calling the deterministic engine", async () => {
    const plan = registerTools().get("check_taiwan_goal_feasibility")!;
    const controller = new AbortController();
    controller.abort();
    await expect(plan.execute({}, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not read network or wall clock during WebMCP planning", async () => {
    const plan = registerTools().get("check_taiwan_goal_feasibility")!;
    const originalNow = Date.now;
    const originalFetch = globalThis.fetch;
    Date.now = () => { throw new Error("wall clock must not be read"); };
    globalThis.fetch = (() => { throw new Error("network must not be read"); }) as typeof fetch;
    try {
      await expect(json(plan)).resolves.toMatchObject({ dataSnapshot: { actualOperationsClaimed: false } });
    } finally {
      Date.now = originalNow;
      globalThis.fetch = originalFetch;
    }
  });
});
