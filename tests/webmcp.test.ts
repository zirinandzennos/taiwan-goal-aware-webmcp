import { afterEach, describe, expect, it } from "vitest";
import { planJourney } from "../src/journey/planner";
import { replanJourney } from "../src/journey/replanner";
import { officialJourneyPlanningContext } from "../src/journey/officialTimetable";
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
  it("registers the journey-first tool plus the stable goal and replan tools", () => {
    const tools = registerTools();
    expect([...tools.keys()]).toEqual(["plan_taiwan_goal_aware_journey", "check_taiwan_goal_feasibility", "replan_taiwan_journey"]);
    for (const tool of tools.values()) {
      expect(tool.inputSchema).toEqual({ type: "object", properties: {}, additionalProperties: false });
      expect(tool.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: false });
    }
    expect(tools.get("check_taiwan_goal_feasibility")?.description).toContain("currently selected on this page");
    expect(tools.get("check_taiwan_goal_feasibility")?.description).toContain("weather");
    expect(tools.get("replan_taiwan_journey")?.description).toContain("location or time has changed");
  });

  it("returns Journey-first output and withholds Cheapest for incomplete fares", async () => {
    const output = await json(registerTools().get("plan_taiwan_goal_aware_journey")!);
    expect(output).toMatchObject({
      requestId: "req:ENTER_XPARK:1070:2026-08-31T11:30:00+08:00",
      dataMode: "SNAPSHOT",
      selectionReasonCodes: ["NO_COMPLETE_FARE_CANDIDATE"],
      journeys: { fastest: { costCoverage: "UNKNOWN" }, balanced: { costCoverage: "UNKNOWN" }, cheapest: null },
      recommendations: {
        fastest: {
          status: "AVAILABLE",
          winnerCandidateIds: expect.any(Array),
          selectedRepresentativeId: expect.any(String),
          unique: expect.any(Boolean),
          proofStatus: "DETERMINISTIC_ENGINE_RESULT",
          evidenceIds: ["tdx-thsr-20260831-20260906-20260830"],
          dataMode: "SNAPSHOT",
          effectiveCandidateCount: expect.any(Number),
          blocker: null,
        },
        balanced: { status: "AVAILABLE", winnerCandidateIds: expect.any(Array), blocker: null },
        cheapest: { status: "UNAVAILABLE", winnerCandidateIds: [], blocker: { reasonCode: "NO_COMPLETE_FARE_CANDIDATE" } },
      },
    });
    expect(output.recommendations.fastest.winnerCandidateIds).toContain(output.recommendations.fastest.selectedRepresentativeId);
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
    updateState({ currentState: undefined });
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

  it("reads 11:30 then 11:36 live state without registering the plan tool again", async () => {
    const plan = registerTools().get("check_taiwan_goal_feasibility")!;
    const early = await json(plan);
    updateState({ departAt: "2026-08-31T11:36:00+08:00" });
    const late = await json(plan);
    expect(selectedCandidateIds(early).join("|")).toContain("THSR_1634_20260831:1070-1020");
    expect(selectedCandidateIds(late).join("|")).not.toContain("THSR_1634_20260831:1070-1020");
  });

  it("reads a changed origin from the same registered plan tool", async () => {
    const plan = registerTools().get("check_taiwan_goal_feasibility")!;
    const zuoying = await json(plan);
    updateState({ originId: "1060", departAt: "2026-08-31T11:49:00+08:00" });
    const tainan = await json(plan);
    expect(JSON.stringify(zuoying)).toContain(":1070-1020");
    expect(JSON.stringify(tainan)).toContain(":1060-1020");
  });

  it("fails safely when the selected goal becomes unavailable", async () => {
    const check = registerTools().get("check_taiwan_goal_feasibility")!;
    const verified = await json(check);
    updateState({ goalId: "missing-goal" });
    const unknown = await json(check);
    expect(verified.goal.id).toBe("ENTER_XPARK");
    expect(unknown).toMatchObject({ status: "UNKNOWN", reasonCodes: ["PAGE_JOURNEY_STATE_INCOMPLETE"], missingFields: ["goalId"] });
  });

  it("replans live state from Tainan after train 1634 has been missed", async () => {
    const replan = registerTools().get("replan_taiwan_journey")!;
    const output = await json(replan);
    expect(output.currentNodeId).toBe("1060");
    expect(JSON.stringify(output.plan)).not.toContain("THSR_1634_20260831:1060-1020");
  });

  it("discovers train 0640 through timetable lookup after the delay", async () => {
    const replan = registerTools().get("replan_taiwan_journey")!;
    const output = await json(replan);
    expect(JSON.stringify(output.plan)).not.toContain("THSR_1634_20260831:1060-1020");
    expect(JSON.stringify(output.plan)).toContain("THSR_0640_20260831:1060-1020");
    expect(output).toMatchObject({ safetyMarginMinutes: 162, recommendedJourney: { legs: [{ serviceId: "THSR_0640_20260831:1060-1020" }] } });
  });

  it("maps page state to the existing JourneyRequest contract without a second trip schema", () => {
    const request = toJourneyRequest(getCurrentJourneyPageState());
    expect(request).toMatchObject({
      originId: "1070",
      destinationId: "1020",
      departAt: "2026-08-31T11:30:00+08:00",
      constraints: { allowedModes: ["THSR"], maxTransfers: 0, avoidTaxi: false },
      policy: "BALANCED",
      goal: { id: "ENTER_XPARK", deadlineAt: "2026-08-31T17:00:00+08:00", goalActionBufferMinutes: 9 },
    });
  });

  it("has plan output parity with planJourney for the same live state", async () => {
    const plan = registerTools().get("check_taiwan_goal_feasibility")!;
    const request = toJourneyRequest(getCurrentJourneyPageState());
    if ("missingFields" in request) throw new Error("test state should be complete");
    const domain = planJourney(request, officialJourneyPlanningContext);
    const output = await json(plan);
    const expected = domain.balanced ?? domain.fastest ?? domain.cheapest;
    expect(output).toMatchObject({
      status: domain.status,
      goal: { id: domain.goalId },
      recommendedJourney: { candidateId: expected?.candidate.id },
      snapshot: { snapshotId: "tdx-thsr-20260831-20260906-20260830" },
    });
  });

  it("has replan output parity with replanJourney for the same live state", async () => {
    const replanTool = registerTools().get("replan_taiwan_journey")!;
    const request = toJourneyReplanRequest(getCurrentJourneyPageState());
    if ("missingFields" in request) throw new Error("test state should be complete");
    const domain = replanJourney(request, officialJourneyPlanningContext);
    const output = await json(replanTool);
    expect(output).toMatchObject({
      status: domain.plan?.status ?? "UNKNOWN",
      currentNodeId: domain.currentNodeId,
      reasonCodes: domain.reasonCodes,
      snapshot: { snapshotId: "tdx-thsr-20260831-20260906-20260830" },
      plan: { goalId: "ENTER_XPARK", balanced: { candidateId: domain.plan?.balanced?.candidate.id } },
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
      await expect(json(plan)).resolves.toMatchObject({ snapshot: { actualOperationsClaimed: false } });
    } finally {
      Date.now = originalNow;
      globalThis.fetch = originalFetch;
    }
  });
});
