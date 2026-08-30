# Canonical Journey Engine contract

## Why contracts come before timetables

Timetable data, routing algorithms, WebMCP adapters, and real-time providers need one stable vocabulary before any of them are built. `src/journey/types.ts` is that provider-neutral, domain-layer vocabulary. It lets the fixed Challenge dataset and later live providers exchange the same `JourneyRequest`, services, candidates, and result without introducing provider fields into product contracts.

## Responsibility boundary

The AI interprets the user's request, asks follow-up questions when needed, and explains the result. The Journey Engine receives a complete canonical request, produces and evaluates candidates, and returns structured facts. It does not retain a user profile or conversation history.

```text
User
 ↓
AI
 ↓
WebMCP adapter
 ↓
Canonical JourneyRequest
 ↓
Journey Engine
 ↓
Candidate Journeys
 ↓
Hard Constraint Filter
 ↓
Policy Ranking
 ↓
Feasibility Validator
 ↓
JourneyResult
 ↓
AI explains result to user
```

The WebMCP adapter may merge explicit AI arguments with current page state, but it must do so before it creates a `JourneyRequest`. Page-state logic never belongs in the canonical domain request.

## Privacy and unknowns

`TravelerState` is scoped to one trip. It has no name, email, account ID, permanent location history, or conversation history. Each material value is a `KnownUnknown<T>` pairing of a value and a source: `USER_STATED`, `CURRENT_REQUEST`, `PAGE_STATE`, or `UNKNOWN`.

When information is unavailable, use `UNKNOWN` with source `UNKNOWN`. The contract intentionally has no `AI_GUESSED` source.

## Constraints and preferences

`JourneyConstraints` are hard limits: a candidate violating one must be removed before ranking. `PolicyWeights` are ranking preferences. The current deterministic Balanced selector uses the measurable time, cost, transfer, walking, and connection-risk weights with candidate-set-relative min-max normalization. The weights are hand-authored Challenge values, not a trained model. A future learned ranker may replace them without changing request or candidate contracts.

Future ranking modifiers are intentionally documented rather than implemented:

- Large luggage should increase walking and transfer penalties, strongly discourage bikes, and may reward taxi/car first-mile comfort.
- Leisure trips may value meal/rest opportunities and tolerate waiting.
- Business or deadline-critical trips should penalize connection risk more heavily and give leisure detours little value.
- Cheapest trips should penalize taxi/car cost and make public transit, bikes, and walking more competitive.

## Provider boundary

```text
Challenge:
Frozen official TDX scheduled-timetable export
        ↓
Journey Engine

Future:
TDX / realtime providers
        ↓
Same Journey Engine
```

The current Challenge browser uses this contract for frozen scheduled-timetable candidate generation, deterministic ranking, feasibility evaluation, planning, replanning, and WebMCP mapping. Acquisition is an offline credential-gated pipeline; the browser does not collect live timetable data or call external transportation services.
