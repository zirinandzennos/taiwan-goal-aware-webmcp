import "./productApp.css";
import {
  fixedJourneyProductScenario,
  journeyStepStatus,
  recommendationBadgeLabel,
  recommendationTieLabel,
  type JourneyProductPlan,
  type RecommendationCategory,
  type RecommendationPresentation,
} from "./application/journeyProduct.ts";
import type { CandidateJourney, JourneyStep } from "./journey/types.ts";
import { planCurrentJourneyProduct, replanCurrentJourneyProduct } from "./ui/journeyActions.ts";
import {
  completeSelectedStepEightMinutesLate,
  getJourneyPageState,
  initializeFixedJourneyProductState,
  selectProductJourney,
  updateJourneyPageInputs,
} from "./ui/state.ts";
import { registerJourneyTool } from "./webmcp/registerJourneyTool.ts";

document.body.innerHTML = `
<main class="app-shell">
  <header class="topbar"><div class="brand"><span>台</span><div><p>TAIWAN JOURNEY DESK</p><h1>Taiwan Goal-aware Journey</h1></div></div><div class="system"><i></i><span id="webmcp-status">Checking WebMCP</span></div></header>
  <div class="data-banner"><strong>Official transportation-data snapshot</strong><span>Snapshot period 2026-08-31 to 2026-09-06 · Timezone Asia/Taipei · Not live operational guidance</span></div>
  <section class="planner">
    <section class="controls"><div class="section-head"><div><p class="eyebrow">01 · JOURNEY INTENT</p><h2>Plan the whole journey</h2></div><button id="reset" class="text-button">Reset fixed demo</button></div>
      <div class="fields"><label>From<select id="origin"><option value="kaohsiung-main-station">Kaohsiung Main Station demo point</option><option value="unsupported-origin">Another origin (unsupported snapshot)</option></select></label><label>To<select id="destination"><option value="xpark-entrance">Xpark entrance demo point</option></select></label><label>Goal<select id="goal"><option value="ENTER_XPARK">Enter Xpark</option></select><small>Goal completion is the final journey step.</small></label><label>Depart<input id="depart" type="datetime-local"></label></div>
      <button id="plan" class="primary"><span>Generate journeys</span><span>→</span></button><p id="identity" class="identity">No plan generated yet.</p>
    </section>
    <section class="results"><div class="section-head"><div><p class="eyebrow">02 · FORMAL RECOMMENDATIONS</p><h2>Recommended journeys</h2></div><span id="result-status" class="status neutral">READY</span></div><p id="message" class="message">Generate the fixed-snapshot journey set to compare three formally distinct recommendations.</p><div id="counts" class="counts" hidden></div><div id="cards" class="cards"></div></section>
  </section>
  <section id="selected" class="selected" hidden><div class="section-head"><div><p class="eyebrow">03 · SELECTED JOURNEY</p><h2>Follow the plan</h2></div><span id="selected-status" class="status good">SELECTED</span></div><div class="selected-metrics"><div><span>Recommendation</span><strong id="selected-category">—</strong></div><div><span>Current step</span><strong id="current-step">—</strong></div><div><span>Next step</span><strong id="next-step">—</strong></div><div><span>Planned completion</span><strong id="completion">—</strong></div></div><p id="progress" class="progress">No actual progress evidence yet.</p><div class="actions"><button id="complete-late" class="secondary">Complete current step 8 minutes late</button><button id="replan" class="secondary">Replan remaining journey</button></div><p id="replan-result" class="progress" hidden></p><ol id="selected-steps" class="steps"></ol></section>
  <footer><span>Deterministic Journey Engine · Read-only WebMCP</span><span>Fixed official-data evidence · No network or wall-clock dependency</span></footer>
</main>`;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
}

const origin = required<HTMLSelectElement>("#origin");
const destination = required<HTMLSelectElement>("#destination");
const goal = required<HTMLSelectElement>("#goal");
const depart = required<HTMLInputElement>("#depart");
const cards = required<HTMLElement>("#cards");
const selectedPanel = required<HTMLElement>("#selected");
const selectedSteps = required<HTMLOListElement>("#selected-steps");
const categoryOrder: RecommendationCategory[] = ["FASTEST", "BALANCED", "CHEAPEST"];

function localInput(iso: string): string { return iso.slice(0, 16); }
function taipeiIso(value: string): string { return `${value}:00+08:00`; }
function time(value: string | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" }).format(new Date(value));
}
function shortId(value: string | null): string { return value?.replace("journey:tdx-maas:", "") ?? "—"; }
function stepText(step: JourneyStep): string {
  const service = step.service?.trainNo ?? step.service?.routeId ?? step.service?.mode;
  return `${step.type} · ${step.from.name} → ${step.to.name}${service ? ` · ${service}` : ""}`;
}
function metric(label: string, value: string): HTMLElement {
  const node = document.createElement("div"); node.className = "metric";
  const caption = document.createElement("span"); caption.textContent = label;
  const strong = document.createElement("strong"); strong.textContent = value;
  node.append(caption, strong); return node;
}
function stepList(journey: CandidateJourney, selected = false): HTMLOListElement {
  const list = document.createElement("ol"); list.className = selected ? "steps" : "steps compact";
  const state = getJourneyPageState();
  (journey.steps ?? []).forEach((step, index) => {
    const item = document.createElement("li");
    const status = selected ? journeyStepStatus(step, index, state) : "PLANNED";
    item.className = `step-${status.toLowerCase()}`;
    const title = document.createElement("strong"); title.textContent = `${index + 1}. ${selected ? `${status} · ` : ""}${stepText(step)}`;
    const meta = document.createElement("span"); meta.textContent = `${time(step.plannedStart)}–${time(step.plannedEnd)} · ${Math.round(step.durationSec / 60)} min · NT$${step.costTwd ?? 0} · ${step.timingQuality} · ${step.source.dataMode}`;
    item.append(title, meta); list.append(item);
  });
  return list;
}
function renderCard(recommendation: RecommendationPresentation): HTMLElement {
  const article = document.createElement("article"); article.className = `card ${recommendation.category.toLowerCase()}`;
  const top = document.createElement("div"); top.className = "card-top";
  const title = document.createElement("h3"); title.textContent = recommendation.category[0] + recommendation.category.slice(1).toLowerCase();
  const badge = document.createElement("span"); badge.className = "proof"; badge.textContent = recommendationBadgeLabel(recommendation);
  top.append(title, badge);
  const tie = document.createElement("p"); tie.className = "tie"; tie.textContent = recommendationTieLabel(recommendation);
  article.append(top, tie);
  const journey = recommendation.journey;
  if (!journey) { const blocker = document.createElement("p"); blocker.textContent = recommendation.reasonCode; article.append(blocker); return article; }
  const metrics = document.createElement("div"); metrics.className = "metrics";
  metrics.append(metric("Start", time(journey.departAt)), metric("Complete", time(journey.goalCompletionAt ?? journey.arriveAt)), metric("Duration", `${journey.totalDurationMinutes} min`), metric("Fare", `NT$${journey.totalCost}`), metric("Walk / wait", `${journey.totalWalkingMinutes} / ${journey.totalWaitingMinutes} min`), metric("Transfers", `${journey.transferCount}`), metric("Min slack", `${journey.minimumTransferSlackMinutes} min`), metric("Steps / data", `${journey.steps?.length ?? 0} · SNAPSHOT`));
  const ids = document.createElement("p"); ids.className = "identity"; ids.textContent = `Display ${shortId(recommendation.displayCandidateId)} · formal winners ${recommendation.formalWinnerCandidateIds.map(shortId).join(", ")} · ${recommendation.reasonCode} · ${recommendation.evidenceIds.length} evidence sources`;
  const details = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = `View all ${journey.steps?.length ?? 0} steps`; details.append(summary, stepList(journey));
  const use = document.createElement("button"); use.className = "use"; use.textContent = `Use ${title.textContent} journey`; use.addEventListener("click", () => { selectProductJourney(recommendation.category); renderSelected(); });
  article.append(metrics, ids, details, use); return article;
}
function renderPlan(plan: JourneyProductPlan): void {
  cards.replaceChildren();
  const status = required<HTMLElement>("#result-status"); status.textContent = plan.status; status.className = `status ${plan.status === "AVAILABLE" ? "good" : "unknown"}`;
  required<HTMLElement>("#identity").textContent = `Request ${plan.identity.requestFingerprint} · page v${plan.identity.pageStateVersion} · result ${plan.normalizedResultHash}`;
  const counts = required<HTMLElement>("#counts"); counts.hidden = false; const c = plan.effectiveCandidateCounts; counts.textContent = `${c.total} candidates · ${c.feasible} feasible · ${c.risky} risky · ${c.impossible} impossible · ${c.unknown} unknown`;
  required<HTMLElement>("#message").textContent = plan.status === "AVAILABLE" ? "Three presentation journeys come from unchanged formal winner sets. Ties and overlap remain visible." : "This page intent is outside the fixed evidence snapshot. No earlier recommendation was reused.";
  categoryOrder.forEach((category) => cards.append(renderCard(plan.recommendations[category])));
  if (plan.status === "UNAVAILABLE") selectedPanel.hidden = true;
}
function selectedJourney(): CandidateJourney | null {
  const state = getJourneyPageState(); const selected = state.selectedJourney;
  return selected ? state.latestProductPlan?.recommendations[selected.selectedRecommendationCategory].journey ?? null : null;
}
function renderSelected(): void {
  const state = getJourneyPageState(); const selected = state.selectedJourney; const journey = selectedJourney();
  if (!selected || !journey) { selectedPanel.hidden = true; return; }
  selectedPanel.hidden = false;
  required<HTMLElement>("#selected-status").textContent = selected.executionStatus;
  required<HTMLElement>("#selected-category").textContent = `${selected.selectedRecommendationCategory} · ${shortId(selected.selectedCandidateId)}`;
  const currentIndex = state.progress ? state.progress.completedStepIndex + 1 : selected.currentStepIndex;
  required<HTMLElement>("#current-step").textContent = journey.steps?.[currentIndex]?.type ?? "Complete";
  required<HTMLElement>("#next-step").textContent = journey.steps?.[currentIndex + 1]?.type ?? "Goal complete";
  required<HTMLElement>("#completion").textContent = time(journey.goalCompletionAt ?? journey.arriveAt);
  required<HTMLElement>("#progress").textContent = state.progress ? `Recorded ${state.progress.actualProgressEvidence.stepId} at ${time(state.progress.actualProgressEvidence.actualCompletedAt)} (+${state.progress.actualProgressEvidence.delayMinutes} min). Downstream schedule is stale.` : "No actual progress evidence yet.";
  required<HTMLButtonElement>("#complete-late").disabled = state.progress !== undefined;
  const renderedSteps = stepList(journey, true);
  selectedSteps.replaceChildren(...Array.from(renderedSteps.children));
}
function sync(): void { const state = getJourneyPageState(); origin.value = state.originId; destination.value = state.destinationId; goal.value = state.goalId; depart.value = localInput(state.departAt); }
function inputChanged(): void {
  updateJourneyPageInputs({ originId: origin.value, destinationId: destination.value, goalId: goal.value, departAt: taipeiIso(depart.value) }); cards.replaceChildren(); selectedPanel.hidden = true;
  required<HTMLElement>("#result-status").textContent = "READY"; required<HTMLElement>("#message").textContent = "Inputs changed. Generate a new plan; the previous plan cannot be selected.";
}

initializeFixedJourneyProductState(fixedJourneyProductScenario); sync();
[origin, destination, goal, depart].forEach((control) => control.addEventListener("change", inputChanged));
required<HTMLButtonElement>("#plan").addEventListener("click", () => renderPlan(planCurrentJourneyProduct().plan));
required<HTMLButtonElement>("#reset").addEventListener("click", () => { initializeFixedJourneyProductState(fixedJourneyProductScenario); sync(); renderPlan(planCurrentJourneyProduct().plan); });
required<HTMLButtonElement>("#complete-late").addEventListener("click", () => { completeSelectedStepEightMinutesLate(); renderSelected(); });
required<HTMLButtonElement>("#replan").addEventListener("click", () => { const result = replanCurrentJourneyProduct().replan; const node = required<HTMLElement>("#replan-result"); node.hidden = false; node.textContent = `${result.reasonCode}: progress was preserved; no unsupported remainder route was fabricated.`; renderSelected(); });
required<HTMLElement>("#webmcp-status").textContent = registerJourneyTool() ? "3 Journey tools ready" : "WebMCP unavailable in this browser";
renderPlan(planCurrentJourneyProduct().plan);
