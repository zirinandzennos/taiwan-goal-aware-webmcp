# Test Plan

## A. Deterministic tests

Run `npm test`. The test suite verifies the frozen synthetic fixtures and their deterministic feasibility outcomes.

## B. Browser WebMCP discovery test

1. Enable WebMCP for testing in Chrome.
2. Open the production URL.
3. Confirm that `check_goal_feasibility` is registered.
4. Call `getTools()` and confirm that the tool is returned.

## C. Browser WebMCP execution test

1. Select a fixture on the page.
2. Call `executeTool()` for `check_goal_feasibility`.
3. Confirm that the returned result matches the selected fixture.

## D. Live page-state test

1. Select Demo Aquarium — Risky and execute the tool with empty input; expect `RISKY`.
2. Change the selection to Demo Aquarium — Missed and execute again with empty input; expect `IMPOSSIBLE`.
3. Change the selection to Demo Venue — Deadline Unknown and execute again with empty input; expect `UNKNOWN`.

This verifies that, when `goal_id` is omitted, the tool consumes the current page selection.

## E. Tool-selection eval prompts

These are agent-selection eval cases, not deterministic unit tests.

Positive prompts — `check_goal_feasibility` should be selected:

- "Can I still make the goal I selected on this page?"
- "Do I have enough safety buffer for this selected goal?"
- "Am I too late for the goal I selected?"
- "Is the currently selected goal still achievable?"
- "What happens if this selected option misses the deadline?"

Negative prompts — `check_goal_feasibility` should not be selected:

- "Explain what WebMCP is."
- "Translate the page title into Japanese."
- "What font does this website use?"
- "Tell me about Taiwan."
- "Change the page background."
