import "./style.css";
import { syntheticJourneyNodes } from "./journey/syntheticTimetable";
import type { JourneyOption, JourneyPlanResult } from "./journey/types";
import { planCurrentJourney, replanCurrentJourney } from "./ui/journeyActions";
import {
  getJourneyPageState,
  resetJourneyPageState,
  setJourneyPageState,
} from "./ui/state";
import { registerJourneyTool } from "./webmcp/registerJourneyTool";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required UI element is missing: ${selector}`);
  return element;
}

const origin = required<HTMLSelectElement>("#origin-select");
const destination = required<HTMLSelectElement>("#destination-select");
const departAt = required<HTMLInputElement>("#depart-at");
const arriveBy = required<HTMLInputElement>("#arrive-by");
const avoidTaxi = required<HTMLInputElement>("#avoid-taxi");
const currentNode = required<HTMLSelectElement>("#current-node");
const currentAt = required<HTMLInputElement>("#current-at");
const resultHeading = required<HTMLElement>("#result-heading");
const resultStatus = required<HTMLElement>("#result-status");
const resultMessage = required<HTMLElement>("#result-message");
const optionCards = required<HTMLElement>("#option-cards");
const webmcpStatus = required<HTMLElement>("#webmcp-status");

function toLocalInputValue(iso: string | undefined): string {
  return iso?.slice(0, 16) ?? "";
}

function toExplicitTaipeiIso(value: string): string {
  return value ? `${value}:00+08:00` : "";
}

function addNodeOptions(select: HTMLSelectElement, includeEmpty: boolean): void {
  if (includeEmpty) select.add(new Option("Select current node", ""));
  for (const node of syntheticJourneyNodes) {
    select.add(new Option(node.name, node.id));
  }
}

function syncControlsFromState(): void {
  const state = getJourneyPageState();
  origin.value = state.originId;
  destination.value = state.destinationId;
  departAt.value = toLocalInputValue(state.departAt);
  arriveBy.value = toLocalInputValue(state.arriveBy);
  avoidTaxi.checked = state.preferences.avoidTaxi;
  currentNode.value = state.currentState?.nodeId ?? "";
  currentAt.value = toLocalInputValue(state.currentState?.at);
}

function syncStateFromControls(): void {
  const previous = getJourneyPageState();
  const currentNodeId = currentNode.value;
  const currentTime = toExplicitTaipeiIso(currentAt.value);
  setJourneyPageState({
    ...previous,
    originId: origin.value,
    destinationId: destination.value,
    departAt: toExplicitTaipeiIso(departAt.value),
    ...(arriveBy.value ? { arriveBy: toExplicitTaipeiIso(arriveBy.value) } : { arriveBy: undefined }),
    preferences: { ...previous.preferences, avoidTaxi: avoidTaxi.checked },
    currentState: currentNodeId && currentTime ? { nodeId: currentNodeId, at: currentTime } : undefined,
  });
}

function text(label: string, value: string): HTMLElement {
  const row = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  row.append(strong, value);
  return row;
}

function renderOption(label: string, option: JourneyOption | null): void {
  if (!option) return;
  const { candidate, feasibility } = option;
  const card = document.createElement("article");
  card.className = "option-card";
  const title = document.createElement("h3");
  title.textContent = label;
  card.append(title);
  card.append(
    text("Route", candidate.id),
    text("Departure", candidate.departAt),
    text("Arrival", candidate.arriveAt),
    text("Duration", `${candidate.totalDurationMinutes} min`),
    text("Cost", String(candidate.totalCost)),
    text("Transfers", String(candidate.transferCount)),
    text("Walking", `${candidate.totalWalkingMinutes} min`),
    text("Minimum transfer slack", candidate.minimumTransferSlackMinutes === null ? "No transfer" : `${candidate.minimumTransferSlackMinutes} min`),
    text("Feasibility", feasibility.status),
    text("Reason codes", feasibility.reasonCodes.join(", ") || "None"),
  );
  if (option.score !== undefined) card.append(text("Balanced score", String(option.score)));
  optionCards.append(card);
}

function renderPlan(label: "PLAN RESULT" | "REPLAN RESULT", plan: JourneyPlanResult): void {
  resultHeading.textContent = label;
  resultStatus.textContent = `Overall status: ${plan.status}`;
  optionCards.replaceChildren();
  if (plan.candidateCount === 0) {
    resultMessage.textContent = plan.status === "IMPOSSIBLE"
      ? "No executable journey found."
      : "Journey data is unavailable or incomplete; route mechanics cannot be verified.";
    return;
  }
  resultMessage.textContent = plan.status === "UNKNOWN"
    ? "Route mechanics are known, but feasibility cannot be reliably verified."
    : `Executable candidates: ${plan.candidateCount}. ${plan.reasonCodes.join(", ")}`;
  renderOption("FASTEST", plan.fastest);
  renderOption("CHEAPEST", plan.cheapest);
  renderOption("BALANCED", plan.balanced);
}

function renderStateError(reasonCodes: string[], missingFields: string[]): void {
  resultHeading.textContent = "RESULT";
  resultStatus.textContent = "Overall status: UNKNOWN";
  resultMessage.textContent = `${reasonCodes.join(", ")}: ${missingFields.join(", ")}`;
  optionCards.replaceChildren();
}

addNodeOptions(origin, false);
addNodeOptions(destination, false);
addNodeOptions(currentNode, true);
syncControlsFromState();

for (const control of [origin, destination, departAt, arriveBy, avoidTaxi, currentNode, currentAt]) {
  control.addEventListener(control instanceof HTMLInputElement && control.type === "checkbox" ? "change" : "input", syncStateFromControls);
  control.addEventListener("change", syncStateFromControls);
}

required<HTMLButtonElement>("#load-demo").addEventListener("click", () => {
  resetJourneyPageState();
  syncControlsFromState();
});

required<HTMLButtonElement>("#plan-button").addEventListener("click", () => {
  syncStateFromControls();
  const result = planCurrentJourney();
  if (result.kind === "STATE_ERROR") renderStateError(result.error.reasonCodes, result.error.missingFields);
  else renderPlan("PLAN RESULT", result.plan);
});

required<HTMLButtonElement>("#replan-button").addEventListener("click", () => {
  syncStateFromControls();
  const result = replanCurrentJourney();
  if (result.kind === "STATE_ERROR") renderStateError(result.error.reasonCodes, result.error.missingFields);
  else if (result.replan.plan) renderPlan("REPLAN RESULT", result.replan.plan);
  else renderStateError(result.replan.reasonCodes, [result.replan.clarification?.field ?? "No remaining journey"]);
});

webmcpStatus.textContent = registerJourneyTool()
  ? "WebMCP: Ready"
  : "WebMCP: Not available in this browser";
