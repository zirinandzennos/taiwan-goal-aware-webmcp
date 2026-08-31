# Taiwan Goal-aware Journey

> AI understands the traveler. We calculate how the journey can actually work.

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

The public web app holds the current journey state and uses the frozen official TDX THSR scheduled timetable for 2026-08-31 through 2026-09-06. Its primary goal asks whether a traveler leaving THSR Zuoying can enter Xpark before the published final-admission rule. The browser needs no TDX credential or live provider call, and the deterministic engine evaluates the timetable and goal deadline without LLM arithmetic.

## Why WebMCP

The user configures the journey on the webpage. An agent does not need the user to repeat the origin, destination, departure time, constraints, preferences, or current journey state.

The webpage exposes three structured, read-only Journey capabilities:

- `plan_taiwan_goal_aware_journey`
- `check_taiwan_goal_feasibility`
- `replan_taiwan_journey`

Both tools read the current live page state. Human UI actions use that same state and the same Journey Engine entry points.

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
- **Cheapest**: lowest total cost only among candidates whose `costCoverage` is `COMPLETE`; otherwise it is `null`.
- **Balanced**: a deterministic 35/20/15/10/10/10 trade-off across duration, complete known cost, walking, transfers, waiting, and transfer risk.

Balanced scoring uses candidate-set-relative min-max normalization and hand-authored Challenge policy weights. It is not AI or LLM scoring.

## Feasibility

The engine reports one of four deterministic states:

- `FEASIBLE`
- `RISKY`
- `IMPOSSIBLE`
- `UNKNOWN`

`UNKNOWN` is used rather than guessing when required information is unavailable or invalid.

## Replanning

Replanning does not patch an old itinerary:

```text
Current node + current journey time
        ↓
new JourneyRequest
        ↓
same planJourney()
        ↓
new downstream journey
```

This ensures previously completed or missed services are not treated as still available.

## WebMCP tools

`plan_taiwan_goal_aware_journey` is the Journey-first contract: it returns Fastest, Balanced, and Cheapest from live page state, with Cheapest withheld when fare coverage is incomplete. `check_taiwan_goal_feasibility` retains the compact goal-deadline answer, and `replan_taiwan_journey` recalculates the remaining journey. All tools are read-only and accept no duplicated itinerary input.

## Real and simulated data

**REAL scheduled facts:** the primary browser and WebMCP flow use the frozen official TDX THSR scheduled timetable snapshot for 2026-08-31 through 2026-09-06. The golden journey is dated 2026-08-31. Xpark's published last-admission rule and its approximately nine-minute walking reference supply the dated goal rule. This is not realtime data and does not claim historical actual operations.

**SIMULATED:** the delay/current-progress event is a deterministic demonstration input. Any remaining non-THSR connector or synthetic timetable exists only in explicitly scoped tests or secondary fixtures; it is not the primary browser runtime.

The repository now includes a credential-gated TDX pipeline under `scripts/import/`:

1. verify and fetch THSR daily timetable records for 2026-08-31 through 2026-09-06;
2. normalize dated service runs and full offset timestamps;
3. validate them in an indexed SQLite snapshot database; and
4. export a static runtime JSON file plus SHA-256 manifest.

It also includes a bounded Kaohsiung Main Station → Xpark corridor acquisition path. `npm run journey:snapshot` performs three MaaS queries (`gc=1`, `0.5`, `0`; `top=10`), normalizes provider sections into canonical steps, validates every connection, deduplicates candidates, and writes only normalized public artifacts under `data/snapshots/2026-08-31_2026-09-06/`. This MaaS snapshot is not yet the primary browser runtime and does not claim complete fares, mode-specific timetable verification, or route geometry.

`npm run journey:validate` closes mode-level evidence for those same frozen ten candidates without calling MaaS. It uses only official TDX Rail v2 and Bus v2 scheduled data, writes normalized evidence and fare-policy artifacts, recomputes downstream connections with the transfer buffer applied once, and keeps unresolved service identity, ambiguous stop timing, and missing Bus fare as UNKNOWN/null. Formal Fastest, Balanced, and Cheapest are promoted independently; the current snapshot honestly leaves all three blocked.

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

Current local status: 156 deterministic tests pass. The suite covers import normalization, SQLite schema/index validation, frozen real-data lookup, browser runtime loading, binary-search departure lookup, canonical step/connection validation, mode-level Rail/Bus evidence, fare-policy and formal-recommendation gates, TDX token caching, MaaS normalization, transfers, candidates, goal feasibility, delay replanning, shared page state, and human/WebMCP domain parity.

## Challenge scope

Pre-existing work includes the Taiwan Goal-aware Journey concept and research, the goal-aware transportation vision, and long-term architecture ideas.

Challenge-period implementation includes the public web app, deterministic timetable engine, indexed candidate generation, transfer feasibility, ranking, goal-aware feasibility, replanning, WebMCP integration, shared page state, importer architecture, UI, tests, and the earlier public deployment.

See [Challenge scope](docs/CHALLENGE_SCOPE.md) for the explicit boundary.

## Future work

Post-Challenge directions only:

- Resolve the remaining Rail identity, Bus stop-level timing, and Bus fare UNKNOWNs when stronger official evidence becomes available
- TDX GIS route geometry and timeline-map synchronization
- Real-time updates
- Remote MCP
- GPS-aware current state
- Activities, dining, and accommodation

## License

MIT. See [LICENSE](LICENSE).
