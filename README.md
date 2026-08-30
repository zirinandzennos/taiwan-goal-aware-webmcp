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

The public web app holds the current journey state. The current checked-in runtime still uses a clearly labeled synthetic Kaohsiung Xiaogang to Bade, Taoyuan fixture while the official 2026 snapshot remains credential-blocked. It evaluates technically executable connections and the selected goal's verified hard deadline without LLM arithmetic.

## Why WebMCP

The user configures the journey on the webpage. An agent does not need the user to repeat the origin, destination, departure time, constraints, preferences, or current journey state.

The webpage exposes two structured, read-only Journey capabilities:

- `check_taiwan_goal_feasibility`
- `replan_taiwan_journey`

Both tools read the current live page state. Human UI actions use that same state and the same Journey Engine entry points.

## Journey Engine

Fixed data does **not** mean fixed answers. For example, changing the departure time from 07:00 to 07:12 changes which synthetic services can be caught.

Each transfer uses deterministic, location-specific preparation:

```text
previous arrival
+ transfer-specific walking time
+ mandatory transfer buffer
= ready time
```

The next departure must be at or after ready time. Different transfer locations can therefore have different walking and buffer values.

## Ranking

- **Fastest**: earliest final arrival.
- **Cheapest**: lowest total cost.
- **Balanced**: a deterministic weighted trade-off across duration, cost, transfers, walking, and transfer risk.

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

`check_taiwan_goal_feasibility` reads the selected goal and live journey configuration, then returns a compact status, arrival, deadline, safety margin, recommended executable journey, and data-snapshot metadata. `replan_taiwan_journey` reads the original goal plus current node and time, then recalculates the remaining journey. Both tools are read-only and accept no duplicated itinerary input.

## Demo data

> **SYNTHETIC FIXED TIMETABLE DEMO**
> Not real-time or operational Taiwan transportation information.

The browser runtime currently uses fixed Challenge fixtures. It must not be presented as official or operational data.

The repository now includes a credential-gated TDX pipeline under `scripts/import/`:

1. fetch THSR daily timetable records for 2026-08-24 through 2026-08-30;
2. normalize dated service runs and full offset timestamps;
3. validate them in an indexed SQLite snapshot database; and
4. export a static runtime JSON file plus SHA-256 manifest.

Set `TDX_API_KEY` or `TDX_AUTHORIZATION` locally before running `npm run timetable:fetch`. No credentials, raw provider responses, SQLite databases, or secrets are committed. The fetch command fails closed when credentials are absent.

See [Data provenance](docs/DATA_PROVENANCE.md). The required frozen official snapshot is **not checked in yet**, so the 2026-08-24 real-data golden demo remains blocked.

## Live demo

The prior synthetic deployment is at https://taiwan-goal-aware-webmcp.netlify.app/. It may not include the current local goal-first changes until an authorized deployment occurs.

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

Current local status: 106 deterministic tests pass. The suite covers import normalization, SQLite schema/index validation, binary-search departure lookup, transfers, candidates, goal feasibility, replanning, shared page state, and human/WebMCP domain parity.

## Challenge scope

Pre-existing work includes the Taiwan Goal-aware Journey concept and research, the goal-aware transportation vision, and long-term architecture ideas.

Challenge-period implementation includes the public web app, deterministic timetable engine, indexed candidate generation, transfer feasibility, ranking, goal-aware feasibility, replanning, WebMCP integration, shared page state, importer architecture, UI, tests, and the earlier public deployment.

See [Challenge scope](docs/CHALLENGE_SCOPE.md) for the explicit boundary.

## Future work

Post-Challenge directions only:

- Authorized TDX snapshot retrieval and checked-in 2026-08-24..30 normalized data
- Real-time updates
- Remote MCP
- GPS-aware current state
- Activities, dining, and accommodation

## License

MIT. See [LICENSE](LICENSE).
