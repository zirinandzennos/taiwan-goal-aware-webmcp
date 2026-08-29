# Test plan

## Deterministic verification

Run:

```bash
npm test
npm run build
```

The deterministic suite covers synthetic timetable eligibility, transfer feasibility, candidate generation, Fastest/Cheapest/Balanced ranking, feasibility states, replanning, shared page state, and human/WebMCP parity.

## Human UI smoke test

Follow [Judging instructions](JUDGING_INSTRUCTIONS.md): plan at 07:00, change to 07:12, enable Avoid taxi, then replan from Zuoying THSR at 08:31.

## WebMCP verification boundary

Production discovery of `plan_taiwan_journey` and `replan_taiwan_journey` has been verified. Actual ChatGPT Site Tool invocation remains PENDING and must not be represented as verified until it has been executed successfully.
