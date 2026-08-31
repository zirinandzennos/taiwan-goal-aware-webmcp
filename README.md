# Taiwan Goal-aware Journey

> AI understands the traveler. We calculate how the journey can actually work.

Maps tell you how to get there. Taiwan Goal-aware Journey tells an agent which complete journey can still accomplish the goal.

## The problem

Travelers often have to manually combine schedules, transfers, and constraints, then recalculate every downstream connection when timing changes. Traditional route planners primarily answer: "How do I get there?"

This Challenge project explores a different question: **Can an AI directly use a Journey Engine that calculates how the trip can actually work?**

## What the Challenge version does

```text
Selected real-world goal
        ↓
Goal hard deadline
        ↓
Page-owned journey state
        ↓
TimetableStore node/time index
        ↓
Executable service connections
        ↓
Goal feasibility + recommendations
        ↓
WebMCP
```

The public web app holds the current journey state and uses the fixed official-data corridor snapshot for 2026-08-31 through 2026-09-06. Its primary flow compares complete Kaohsiung Main Station → Xpark journeys and includes `GOAL_COMPLETION` as the final step. The browser needs no TDX credential or provider call, and the deterministic engine evaluates the frozen candidates, official evidence, connections, fares, and goal completion without LLM arithmetic.

## Why WebMCP

The user configures the journey on the webpage. An agent does not need the user to repeat the origin, destination, departure time, constraints, preferences, or current journey state.

The webpage exposes three structured, read-only Journey capabilities:

- `plan_taiwan_goal_aware_journey`
- `check_taiwan_goal_feasibility`
- `replan_taiwan_journey`

All three tools read the current live page state. The three-card human UI and Journey-first WebMCP tool call one shared application service and expose the same request fingerprint and normalized result hash.

## Journey Engine

Fixed data does **not** mean fixed answers. For example, moving the 2026-08-31 departure time past 11:35 removes THSR train 1634 from the indexed next departures.

Each transfer uses deterministic, location-specific preparation:

```text
previous arrival
+ transfer-specific walking time
+ mandatory transfer buffer
= ready time
```

The next departure must be at or after ready time. Different transfer locations can therefore have different walking and buffer values.

## Ranking

- **Fastest**: earliest goal-completion time, not merely arrival at a rail station.
- **Cheapest**: lowest total cost only among candidates whose `costCoverage` is `COMPLETE`.
- **Balanced**: a deterministic 35/20/15/10/10/10 trade-off across duration, complete known cost, walking, transfers, waiting, and transfer risk.

Balanced scoring uses candidate-set-relative min-max normalization and hand-authored Challenge policy weights. It is not AI or LLM scoring.

## Feasibility

The engine reports one of four deterministic states:

- `FEASIBLE`
- `RISKY`
- `IMPOSSIBLE`
- `UNKNOWN`

`UNKNOWN` is used rather than guessing when required information is unavailable or invalid.

## Progress and replanning boundary

The earlier indexed THSR compatibility flow can regenerate a remaining journey from a supported node and time. The current Journey-first +8-minute demonstration deliberately uses the fixed MaaS evidence boundary: it records the completed step, marks every downstream step stale, and returns `REPLAN_UNAVAILABLE_FOR_SNAPSHOT_STATE` because that remainder is not proven by the snapshot.

```text
Current node + current journey time
        → supported compatibility state: same planJourney(), new downstream journey
        → unsupported product state: explicit blocker, no fabricated journey
```

Successful remainder regeneration for the Journey-first MaaS product flow is not claimed in the current submission candidate.

## WebMCP tools

`plan_taiwan_goal_aware_journey` is the Journey-first contract: it returns compact Fastest, Balanced, and Cheapest recommendations, their unchanged formal winner sets, the selected presentation candidate, ordered steps, proof status, evidence IDs, and request identity. `check_taiwan_goal_feasibility` retains the compact goal-deadline answer. `replan_taiwan_journey` returns a snapshot-safe result or an explicit blocker. All tools are read-only and accept no duplicated itinerary input.

## Real and simulated data

**REAL scheduled facts:** the primary browser and WebMCP flow use the frozen official TDX THSR scheduled timetable snapshot for 2026-08-31 through 2026-09-06. The golden journey is dated 2026-08-31. Xpark's published last-admission rule and its approximately nine-minute walking reference supply the dated goal rule. This is not realtime data and does not claim historical actual operations.

**SIMULATED:** the delay/current-progress event is a deterministic demonstration input. Any remaining non-THSR connector or synthetic timetable exists only in explicitly scoped tests or secondary fixtures; it is not the primary browser runtime.

The repository now includes a credential-gated TDX pipeline under `scripts/import/`:

1. verify and fetch THSR daily timetable records for 2026-08-31 through 2026-09-06;
2. normalize dated service runs and full offset timestamps;
3. validate them in an indexed SQLite snapshot database; and
4. export a static runtime JSON file plus SHA-256 manifest.

It also includes the bounded Kaohsiung Main Station → Xpark corridor used by the Journey-first runtime. `npm run journey:snapshot` is the credential-gated acquisition command; the public browser only imports the committed normalized snapshot and never calls MaaS. No GIS route geometry is claimed.

The frozen ten candidates have terminal effective resolutions: four `VALIDATED_FEASIBLE`, zero risky, six `VALIDATED_IMPOSSIBLE`, and zero unknown. The impossible outcomes are supported by explicit official secondary proof; unresolved facts were not guessed. Formal Fastest has two tied winners, Balanced has one winner, and Cheapest has four tied winners at NT$1,341. The presentation allocator shows three distinct journeys without changing those sets.

Set `TDX_CLIENT_ID` and `TDX_CLIENT_SECRET` only in the Git-ignored local `.env` before running `npm run timetable:fetch`. No credentials, raw provider responses, SQLite databases, or secrets are committed. The fetch command fails closed when credentials are absent.

See [Data provenance](docs/DATA_PROVENANCE.md). The frozen official scheduled window is 2026-08-31 through 2026-09-06, with 2026-08-31 as the real-data golden date. `npm run timetable:golden` reproduces the goal and delay/replan proof from static public files without TDX credentials.

## Live demo

https://taiwan-goal-aware-webmcp.netlify.app/

## Local development

```bash
npm install
npm run dev
```

## Testing

```bash
npm test
npm run build
```

Current local status: 185 deterministic tests pass. The suite additionally covers stable three-card allocation, exact tie disclosure, request identity/versioning, stale-result rejection, deterministic progress evidence, safe replan blocking, single WebMCP registration, and Human/WebMCP normalized-result parity.

## Challenge scope

Pre-existing work includes the Taiwan Goal-aware Journey concept and research, the goal-aware transportation vision, and long-term architecture ideas.

Challenge-period implementation includes the public web app, deterministic timetable engine, indexed candidate generation, transfer feasibility, ranking, goal-aware feasibility, the earlier supported THSR replan path, Journey-first stale-plan detection and fail-closed blocker, WebMCP integration, shared page state, importer architecture, UI, tests, and the earlier public deployment.

See [Challenge scope](docs/CHALLENGE_SCOPE.md) for the explicit boundary.

## Future work

Post-Challenge directions only:

- TDX GIS route geometry and timeline-map synchronization
- Real-time updates
- Remote MCP
- GPS-aware current state
- Activities, dining, and accommodation

## License

MIT. See [LICENSE](LICENSE).
