# Judging instructions

## Human UI

1. Open https://taiwan-goal-aware-webmcp.netlify.app/
2. Confirm the banner says **Official transportation-data snapshot**, **2026-08-31 to 2026-09-06**, **Asia/Taipei**, and **Not live operational guidance**.
3. Confirm the controls show **Kaohsiung Main Station demo point**, **Xpark entrance demo point**, **Enter Xpark**, and `2026-08-31 11:30`.
4. The fixed demo generates automatically; click **Generate journeys** to repeat it.
5. Observe exactly three cards: Fastest, Balanced, and Cheapest. Confirm the counts are 10 total, 4 feasible, 0 risky, 6 impossible, 0 unknown.
6. Confirm the tie text: Fastest is tied with one other journey, Balanced is unique, and all four valid journeys share the NT$1,341 cheapest fare.
7. Open each card's steps. Confirm the final step is `GOAL_COMPLETION`, then click **Use Balanced journey**.
8. Confirm the selected-plan panel shows current step, next step, planned completion, and step status.
9. Click **Complete current step 8 minutes late**. Confirm the completed step retains actual progress evidence and downstream steps become stale.
10. Click **Replan remaining journey**. Confirm the explicit `REPLAN_UNAVAILABLE_FOR_SNAPSHOT_STATE` blocker; the app preserves evidence and does not fabricate a route outside the snapshot.
11. Change the origin to the unsupported option and generate again. Confirm `UNAVAILABLE` and no prior recommendations are reused.

## WebMCP

In a WebMCP-capable environment, the production page exposes these read-only Site Tools:

- `plan_taiwan_goal_aware_journey`
- `check_taiwan_goal_feasibility`
- `replan_taiwan_journey`

The Journey-first tool and human cards use the same application-service result, request fingerprint, page-state version, and normalized result hash. Tools read state at execution time, register once per page context, reject extra input fields, accept no duplicated itinerary arguments, and are read-only.

Local verification: `npm install`, `npm test`, then `npm run build`. In a WebMCP-capable browser, inspect the three registered Site Tools and run the plan tool before and after changing the origin to verify the state-capture gate.
