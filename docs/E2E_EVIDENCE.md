# Journey-first E2E evidence

Status: **LOCAL CHROME PROTOCOL E2E PASSED; CHATGPT AGENT-SELECTION E2E PENDING**

This record separates Chrome WebMCP protocol testing from ChatGPT agent tool-selection testing. Do not mark either section PASS without the listed evidence. Do not commit browser profiles, cookies, tokens, private account details, or full console dumps.

## Chrome WebMCP protocol E2E

Status: **PASS — LOCAL CHROME PROTOCOL E2E**

- Chrome exact version: `152.0.7977.65 (Official Build) (64-bit)`
- Operating system: `Windows 11 25H2 (Build 26200.9278)`
- Tested URL: `http://127.0.0.1:4173/`
- Test date/time: `2026-09-01 Asia/Taipei`
- Tested Git commit SHA: `cdb75d707838eec024c3549150168df48825e9e6`
- Human verifier: `zirinandzennos`
- Console fatal errors: `0`

### Tool discovery

PASS.

Exactly three WebMCP tools were discovered:

- `check_taiwan_goal_feasibility`
- `plan_taiwan_goal_aware_journey`
- `replan_taiwan_journey`

No duplicate tool registrations were observed after page refresh.

### Plan tool — fixed snapshot

PASS.

`plan_taiwan_goal_aware_journey` was manually executed through the
Chrome DevTools WebMCP panel with `{}`.

Result:

- status: `AVAILABLE`
- reasonCode: `ALL_PRIMARY_RECOMMENDATIONS_AVAILABLE`
- requestFingerprint: `fnv1a32:076821af`
- normalizedResultHash: `fnv1a32:f2ad561c`
- snapshotId: `tdx-maas-20260831-journey-proof-v1`
- feasible / risky / impossible / unknown: `4 / 0 / 6 / 0`

Formal recommendations:

- Fastest: available, 2-way tie
- Balanced: available, unique
- Cheapest: available, 4-way tie

Display journeys were distinct:

- Fastest: `journey:tdx-maas:07fb4bb5`
- Balanced: `journey:tdx-maas:ab19cfc6`
- Cheapest: `journey:tdx-maas:1767bfb5`

Each displayed journey contains 11 executable steps and ends in
`GOAL_COMPLETION`.

### Live page-state freshness

PASS.

Without re-registering the tool, the departure time was changed from the
fixed snapshot request.

The next WebMCP execution returned:

- status: `UNAVAILABLE`
- reasonCode: `UNSUPPORTED_SNAPSHOT_REQUEST`
- requestFingerprint: `fnv1a32:58f6f502`
- normalizedResultHash: `fnv1a32:024e5624`
- pageStateVersion: `2`

All recommendation winner arrays were empty, all display candidate IDs were
null, and no stale journey payload was returned.

After `Reset fixed demo`, executing the same already-registered tool restored:

- status: `AVAILABLE`
- reasonCode: `ALL_PRIMARY_RECOMMENDATIONS_AVAILABLE`
- requestFingerprint: `fnv1a32:076821af`
- normalizedResultHash: `fnv1a32:f2ad561c`

This verifies execution-time live page-state capture rather than
registration-time state capture.

### Human UI

PASS.

Three recommendation cards rendered simultaneously:

- Fastest — `Tied fastest with 1 other journey`
- Balanced — `RECOMMENDED` / `Unique Balanced recommendation`
- Cheapest — `All four valid journeys share the same NT$1,341 fare.`

The Balanced journey was selected and the UI preserved the actual candidate:

`journey:tdx-maas:ab19cfc6`

### Progress and stale-plan handling

PASS.

The first step was completed 8 minutes later than planned.

Observed behavior:

- Step 1 became `COMPLETED`
- Steps 2–11 became `STALE`
- actual progress evidence was preserved
- current step advanced to `BOARD`
- downstream schedule was explicitly marked stale

`Replan remaining journey` returned:

`REPLAN_UNAVAILABLE_FOR_SNAPSHOT_STATE`

The existing progress was preserved and no unsupported replacement route
was fabricated.

Successful Journey-first remainder regeneration is **not claimed**.

### Refresh

PASS.

After refreshing the page:

- exactly three WebMCP tools were discovered
- each tool appeared once
- no duplicate-registration error occurred
- the fixed deterministic journey state remained usable

### Console

PASS.

Chrome Console filtered to Errors showed:

- fatal application errors: `0`
- unhandled application errors: `0`
- WebMCP execution errors: `0`

### Evidence boundary

Manual Chrome WebMCP execution verifies protocol discovery, execution,
live-state behavior, UI behavior, and deterministic results.

It does **not** count as ChatGPT agent tool-selection E2E.

### Public HTTPS Draft regression

Status: **PASS**

- Draft URL:
  `https://journey-e2e-afa8fb6--taiwan-goal-aware-webmcp.netlify.app`
- Immutable deploy URL:
  `https://6a96c2f354ea3ceb0d441556--taiwan-goal-aware-webmcp.netlify.app`
- Tested feature commit:
  `afa8fb6bb7b84acb922c2da6dc60cf9f008ef310`
- HTTPS: PASS
- Login required: NO
- WebMCP tools discovered: 3
- Plan tool execution: PASS
- Fixed-state result:
  `AVAILABLE / ALL_PRIMARY_RECOMMENDATIONS_AVAILABLE`
- Fixed-state request fingerprint:
  `fnv1a32:076821af`
- Fixed-state normalized result hash:
  `fnv1a32:f2ad561c`

Live-state mutation without re-registration returned:

- `UNAVAILABLE`
- `UNSUPPORTED_SNAPSHOT_REQUEST`
- empty winner arrays
- null journey payloads

After `Reset fixed demo`, the same tool returned the original deterministic
result again:

- request fingerprint: `fnv1a32:076821af`
- normalized result hash: `fnv1a32:f2ad561c`

This verifies that the public HTTPS deployment preserves WebMCP discovery,
execution-time page-state capture, fail-closed unsupported-state behavior,
and deterministic restoration.

## ChatGPT Site Tools agent-selection E2E

Status: **BLOCKED — BROWSER BRIDGE / ENVIRONMENT**

Test URL:
`https://journey-e2e-afa8fb6--taiwan-goal-aware-webmcp.netlify.app`

Prompt:
`Plan the journey I selected on this page.`

Observed behavior:

ChatGPT did not execute the page WebMCP tool. It explicitly reported:

`The browser bridge prevented me from executing the page’s WebMCP action directly.`

Therefore:

- Agent tool selection: BLOCKED
- Site Tool invocation: NOT EXECUTED
- Current-page-state use through WebMCP: NOT PROVEN
- Product failure: NO
- Chrome WebMCP fallback: PASS

ChatGPT produced a page-equivalent answer through regular browsing/page
context, but this result is not counted as WebMCP agent-selection evidence.

Per the official Challenge testing path, the public project remains testable
through WebMCP-enabled Chrome, which passed discovery, execution, live-state
mutation, fail-closed behavior, and deterministic restoration.

Manual Chrome Run Tool evidence must not be reported as agent-selection PASS.

## Replan claim boundary

The deterministic +8-minute product demonstration records actual progress and marks downstream steps stale. The fixed snapshot does not prove a replacement remainder, so the expected result is `REPLAN_UNAVAILABLE_FOR_SNAPSHOT_STATE`. Successful Journey-first MaaS remainder regeneration is not claimed.
