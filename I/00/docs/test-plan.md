# Test plan

## Deterministic verification

Run:

```bash
npm test
npm run build
```

The deterministic suite covers official browser snapshot loading, indexed timetable eligibility, transfer feasibility, candidate generation, Fastest/Cheapest/Balanced ranking, feasibility states, replanning, credential-free runtime execution, shared page state, and human/WebMCP parity. Synthetic fixtures remain scoped to unit tests.

## Human UI smoke test

Follow [Judging instructions](JUDGING_INSTRUCTIONS.md): verify the Zuoying 11:30 goal result, open the train 1634 journey, then update progress to Tainan at 11:49 and confirm the regenerated Balanced journey uses train 0640.

## WebMCP verification boundary

The production page should expose `check_taiwan_goal_feasibility` and `replan_taiwan_journey`. Verify discovery and invocation against the deployed build; do not represent ChatGPT invocation as verified until it has executed successfully.
