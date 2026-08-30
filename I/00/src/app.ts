import "./app.css";
import { findJourneyGoal, journeyGoals } from "./data/demoGoals";
import { findOfficialNode, findOfficialService, officialJourneyNodes } from "./journey/officialTimetable";
import type { JourneyOption, JourneyPlanResult } from "./journey/types";
import { planCurrentJourney, replanCurrentJourney } from "./ui/journeyActions";
import { getJourneyPageState, resetJourneyPageState, setJourneyPageState } from "./ui/state";
import { registerJourneyTool } from "./webmcp/registerJourneyTool";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required UI element is missing: ${selector}`);
  return element;
}

const origin = required<HTMLSelectElement>("#origin-select");
const goal = required<HTMLSelectElement>("#goal-select");
const goalSource = required<HTMLElement>("#goal-source");
const departAt = required<HTMLInputElement>("#depart-at");
const currentNode = required<HTMLSelectElement>("#current-node");
const currentAt = required<HTMLInputElement>("#current-at");
const resultStatus = required<HTMLElement>("#result-status");
const resultMessage = required<HTMLElement>("#result-message");
const arrivalValue = required<HTMLElement>("#arrival-value");
const goalReadyValue = required<HTMLElement>("#goal-ready-value");
const deadlineValue = required<HTMLElement>("#deadline-value");
const marginValue = required<HTMLElement>("#margin-value");
const optionTabs = required<HTMLElement>("#option-tabs");
const journeyDetails = required<HTMLDetailsElement>("#journey-details");
const journeyLegs = required<HTMLOListElement>("#journey-legs");
const progressDetails = required<HTMLDetailsElement>("#progress-details");
const webmcpStatus = required<HTMLElement>("#webmcp-status");

function toLocalInputValue(iso: string | undefined): string { return iso?.slice(0, 16) ?? ""; }
function toExplicitTaipeiIso(value: string): string { return value ? `${value}:00+08:00` : ""; }
function timeOnly(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" }).format(parsed);
}

function reasonText(plan: JourneyPlanResult, option: JourneyOption | null): string {
  const code = option?.feasibility.reasonCodes[0] ?? plan.reasonCodes[0];
  const messages: Record<string, string> = {
    MEETS_DEADLINE_WITH_BUFFER: "Meets the hard goal deadline with buffer.",
    INSUFFICIENT_ARRIVAL_BUFFER: "The journey arrives before the deadline, but the margin is tight.",
    ARRIVAL_AFTER_HARD_DEADLINE: "The earliest executable journey misses the hard deadline.",
    GOAL_DEADLINE_UNVERIFIED: "The goal deadline is not verified, so a safe answer is not possible.",
    NO_EXECUTABLE_JOURNEY: "No executable journey remains from this time and place.",
    REQUIRED_JOURNEY_DATA_UNAVAILABLE: "Required timetable data is unavailable.",
    TIGHT_TRANSFER: "The route works, but at least one transfer has very little slack.",
  };
  return messages[code] ?? "The deterministic engine checked the selected goal against the available timetable.";
}

function setStatus(status: JourneyPlanResult["status"]): void {
  resultStatus.textContent = status;
  resultStatus.className = `status-badge is-${status.toLowerCase()}`;
}

function renderJourney(option: JourneyOption | null): void {
  journeyLegs.replaceChildren();
  if (!option) { journeyDetails.hidden = true; return; }
  for (const leg of option.candidate.legs) {
    if (leg.type !== "TRAVEL") continue;
    const service = findOfficialService(leg.serviceId);
    const from = findOfficialNode(leg.fromNodeId)?.name ?? "Unknown station";
    const to = findOfficialNode(leg.toNodeId)?.name ?? "Unknown station";
    const item = document.createElement("li");
    const title = document.createElement("p");
    title.className = "leg-title";
    title.textContent = `${leg.mode} train ${service?.serviceName ?? "—"} · ${from} → ${to}`;
    const meta = document.createElement("p");
    meta.className = "leg-meta";
    meta.textContent = `${timeOnly(leg.departAt)}–${timeOnly(leg.arriveAt)} · Official scheduled service`;
    item.append(title, meta);
    journeyLegs.append(item);
  }
  journeyDetails.hidden = false;
}

function renderOption(plan: JourneyPlanResult, option: JourneyOption | null): void {
  setStatus(option?.feasibility.status ?? plan.status);
  resultMessage.textContent = reasonText(plan, option);
  arrivalValue.textContent = timeOnly(option?.candidate.arriveAt);
  goalReadyValue.textContent = timeOnly(option?.feasibility.goalReadyAt);
  deadlineValue.textContent = timeOnly(option?.feasibility.deadlineAt ?? plan.goalDeadline);
  const margin = option?.feasibility.safetyMarginMinutes ?? option?.feasibility.deadlineMarginMinutes;
  marginValue.textContent = margin === null || margin === undefined ? "—" : `${margin >= 0 ? "+" : ""}${margin} min`;
  renderJourney(option);
}

function renderPlan(plan: JourneyPlanResult): void {
  const options = [["Balanced", plan.balanced], ["Fastest", plan.fastest], ["Cheapest", plan.cheapest]] as const;
  optionTabs.replaceChildren();
  const available: Array<readonly [string, JourneyOption]> = [];
  const candidateIds = new Set<string>();
  for (const [label, option] of options) {
    if (option && !candidateIds.has(option.candidate.id)) {
      available.push([label, option]);
      candidateIds.add(option.candidate.id);
    }
  }
  optionTabs.hidden = available.length < 2;
  const initial = available.map(([, option]) => option).find((option) => option.feasibility.status === plan.status)
    ?? plan.fastest ?? plan.balanced ?? plan.cheapest;
  for (const [label, option] of available) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `option-tab${option === initial ? " is-active" : ""}`;
    button.textContent = label;
    button.addEventListener("click", () => {
      optionTabs.querySelectorAll("button").forEach((item) => item.classList.toggle("is-active", item === button));
      renderOption(plan, option);
    });
    optionTabs.append(button);
  }
  renderOption(plan, initial);
  progressDetails.hidden = false;
}

function renderStateError(reasonCodes: string[], missingFields: string[]): void {
  setStatus("UNKNOWN");
  resultMessage.textContent = `${reasonCodes.join(", ")}: ${missingFields.join(", ")}`;
  arrivalValue.textContent = goalReadyValue.textContent = deadlineValue.textContent = marginValue.textContent = "—";
  optionTabs.hidden = journeyDetails.hidden = progressDetails.hidden = true;
}

function addOptions(): void {
  for (const node of officialJourneyNodes) {
    origin.add(new Option(`${node.name} THSR`, node.id));
    currentNode.add(new Option(node.name, node.id));
  }
  currentNode.add(new Option("Select current location", ""), 0);
  for (const item of journeyGoals) goal.add(new Option(item.title, item.id));
}

function syncControlsFromState(): void {
  const state = getJourneyPageState();
  origin.value = state.originId;
  goal.value = state.goalId;
  departAt.value = toLocalInputValue(state.departAt);
  currentNode.value = state.currentState?.nodeId ?? "";
  currentAt.value = toLocalInputValue(state.currentState?.at);
  goalSource.textContent = findJourneyGoal(state.goalId)?.source.label ?? "Goal source unavailable";
}

function syncStateFromControls(): void {
  const previous = getJourneyPageState();
  const selectedGoal = findJourneyGoal(goal.value);
  const currentTime = toExplicitTaipeiIso(currentAt.value);
  setJourneyPageState({
    ...previous,
    goalId: goal.value,
    originId: origin.value,
    destinationId: selectedGoal?.destinationId ?? previous.destinationId,
    departAt: toExplicitTaipeiIso(departAt.value),
    currentState: currentNode.value && currentTime ? { nodeId: currentNode.value, at: currentTime } : undefined,
  });
  goalSource.textContent = selectedGoal?.source.label ?? "Goal source unavailable";
}

function executePlan(): void {
  syncStateFromControls();
  const result = planCurrentJourney();
  if (result.kind === "STATE_ERROR") renderStateError(result.error.reasonCodes, result.error.missingFields);
  else renderPlan(result.plan);
}

addOptions();
syncControlsFromState();
for (const control of [origin, goal, departAt, currentNode, currentAt]) control.addEventListener("change", syncStateFromControls);
required<HTMLButtonElement>("#load-demo").addEventListener("click", () => { resetJourneyPageState(); syncControlsFromState(); executePlan(); });
required<HTMLButtonElement>("#plan-button").addEventListener("click", executePlan);
required<HTMLButtonElement>("#replan-button").addEventListener("click", () => {
  syncStateFromControls();
  const result = replanCurrentJourney();
  if (result.kind === "STATE_ERROR") renderStateError(result.error.reasonCodes, result.error.missingFields);
  else if (result.replan.plan) renderPlan(result.replan.plan);
  else renderStateError(result.replan.reasonCodes, [result.replan.clarification?.field ?? "No remaining journey"]);
});

webmcpStatus.textContent = registerJourneyTool() ? "WebMCP ready" : "WebMCP unavailable in this browser";
executePlan();
