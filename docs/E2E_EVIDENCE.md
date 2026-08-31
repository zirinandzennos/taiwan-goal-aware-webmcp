# Journey-first E2E evidence

Status: **PENDING OWNER-PERFORMED CHROME E2E**

This record separates Chrome WebMCP protocol testing from ChatGPT agent tool-selection testing. Do not mark either section PASS without the listed evidence. Do not commit browser profiles, cookies, tokens, private account details, or full console dumps.

## Chrome WebMCP protocol E2E

- Chrome exact version: PENDING
- Tested URL: PENDING
- Test date/time and timezone: PENDING
- Tested Git commit SHA: PENDING
- Human verifier name or GitHub identity: PENDING
- Available Tools screenshot: PENDING
- Plan tool output screenshot: PENDING
- Three-card screenshot: PENDING
- State-change before/after evidence: PENDING
- Console fatal error count: PENDING

Required checks:

- [ ] Exactly three tools are discovered: `plan_taiwan_goal_aware_journey`, `check_taiwan_goal_feasibility`, and `replan_taiwan_journey`.
- [ ] `plan_taiwan_goal_aware_journey` accepts `{}` and returns `ALL_PRIMARY_RECOMMENDATIONS_AVAILABLE`.
- [ ] Output contains the formal winner arrays, three distinct display candidate IDs, request fingerprint, snapshot ID, effective counts, and ordered steps.
- [ ] Human result hash equals WebMCP result hash: `fnv1a32:f2ad561c`.
- [ ] Changing origin or departure returns `UNAVAILABLE / UNSUPPORTED_SNAPSHOT_REQUEST` without an old journey payload.
- [ ] Restoring fixed state restores the deterministic result.
- [ ] Refresh registers each tool once.
- [ ] Three cards render, Balanced is marked Recommended, every card has 11 steps, tie labels are visible, and every final step is `GOAL_COMPLETION`.
- [ ] Use journey saves the actual display candidate ID.
- [ ] Console has no fatal errors.

## ChatGPT Site Tools agent-selection E2E

Status: **PENDING / ACCOUNT-ENVIRONMENT DEPENDENT**

- ChatGPT app/model/account context: PENDING
- Tested production or preview URL: PENDING
- Prompt: `Plan the journey I selected on this page.`
- Tool selected: PENDING
- Output result: PENDING
- Page-state change and follow-up result: PENDING

Manual Chrome Run Tool evidence must not be reported as agent-selection PASS.

## Replan claim boundary

The deterministic +8-minute product demonstration records actual progress and marks downstream steps stale. The fixed snapshot does not prove a replacement remainder, so the expected result is `REPLAN_UNAVAILABLE_FOR_SNAPSHOT_STATE`. Successful Journey-first MaaS remainder regeneration is not claimed.
