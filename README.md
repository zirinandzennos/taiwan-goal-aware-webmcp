# Taiwan Goal-aware Journey — WebMCP Challenge

> Can I still accomplish my real-world goal?

Traditional route planners answer: “How do I get there?” This prototype asks: “Can I still accomplish the actual goal?”

This is an offline WebMCP demonstration. A person selects a goal on the page; an AI agent can inspect that current selection through WebMCP without requiring the person to repeat it. A deterministic engine returns `FEASIBLE`, `RISKY`, `IMPOSSIBLE`, or `UNKNOWN`.

Live demo: [https://taiwan-goal-aware-webmcp.netlify.app](https://taiwan-goal-aware-webmcp.netlify.app)

## What it does

- Provides four frozen, self-authored synthetic goal fixtures.
- Displays arrival, hard deadline, safety margin, reason code, and fallback where applicable.
- Uses shared `selectedGoalId` state for the UI and WebMCP tool.
- Has no backend, API keys, location collection, external requests, bookings, or side effects.

## Why WebMCP

The one read-only tool is `check_goal_feasibility`. With no `goal_id`, it reads the currently selected live page goal. Changing the dropdown changes the state used on the next execution. The tool returns compact structured JSON and never purchases, books, reserves, or modifies accounts.

If `document.modelContext` is unavailable, the site shows **“WebMCP unavailable in this browser”** while the human button still works.

## Synthetic demo disclaimer

All venues, times, arrivals, deadlines, buffers, and fallbacks are self-authored synthetic demo data. They are **not real travel information** and must not be used for operational decisions.

## Local development

```bash
npm ci
npm run dev
```

## Verify

```bash
npm test
npm run build
```

## WebMCP testing

Open the site in a WebMCP-enabled browser or ChatGPT Site Tools environment. Select a fixture, then ask whether the currently selected real-world goal can still be completed. The agent should select `check_goal_feasibility` without asking for the goal again. Change the dropdown and repeat to confirm the new page state is used.

## Verified WebMCP behavior

- Demo Aquarium — Safe → `FEASIBLE`
- Demo Aquarium — Risky → `RISKY`
- Demo Aquarium — Missed → `IMPOSSIBLE`
- Demo Venue — Deadline Unknown → `UNKNOWN`

When `goal_id` is omitted, changing the page selection changes the result that WebMCP returns.

Chrome WebMCP verification:

1. Enable WebMCP for testing in Chrome.
2. Open the production URL.
3. Confirm that `check_goal_feasibility` is registered.
4. Call `getTools()`.
5. Call `executeTool()`.

ChatGPT Desktop can show and discover the Site Tool in the browser UI, but invocation was not completed in the current local session/environment. This repository does not claim ChatGPT Desktop invocation success.

## Challenge work boundary

The Taiwan Goal-aware Journey Engine concept, goal-feasibility research, Goal Deadline concept, and proposed future Remote MCP + WebMCP architecture pre-date the Challenge implementation. This Challenge-period work is the web application, WebMCP registration, page-state integration, deterministic synthetic demo engine, fixtures, tests, and documentation. See [docs/challenge-scope.md](docs/challenge-scope.md).

## License

MIT. See [LICENSE](LICENSE).
