# Taiwan Goal-aware Journey

> AI understands the traveler. We calculate how the journey can actually work.

## The problem

Travelers often have to manually combine schedules, transfers, and constraints, then recalculate every downstream connection when timing changes. Traditional route planners primarily answer: "How do I get there?"

This Challenge project explores a different question: **Can an AI directly use a Journey Engine that calculates how the trip can actually work?**

## What the Challenge version does

```text
Journey requirements
        ↓
Synthetic fixed timetable
        ↓
Executable service connections
        ↓
Candidate journeys
        ↓
Fastest / Cheapest / Balanced
        ↓
Feasibility verification
        ↓
WebMCP
```

The public web app holds the current journey state. It plans a synthetic Kaohsiung Xiaogang to Bade, Taoyuan journey, evaluates technically executable connections, and returns deterministic recommendations.

## Why WebMCP

The user configures the journey on the webpage. An agent does not need the user to repeat the origin, destination, departure time, constraints, preferences, or current journey state.

The webpage exposes two structured, read-only Journey capabilities:

- `plan_taiwan_journey`
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

`plan_taiwan_journey` reads the live journey configuration and plans it. `replan_taiwan_journey` reads the original journey plus current node and time, then recalculates the remaining journey. Both tools are read-only and accept no user data beyond the webpage's current state.

## Demo data

> **SYNTHETIC FIXED TIMETABLE DEMO**
> Not real-time or operational Taiwan transportation information.

All timetable values, transfer rules, and services are fixed Challenge fixtures. This project does not connect to TDX, real Taiwan schedules, or operational transit systems.

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

Current Challenge status: 93 deterministic tests pass. The suite covers timetable eligibility, transfers, candidates, ranking, feasibility, replanning, shared page state, and human/WebMCP domain parity.

## Challenge scope

Pre-existing work includes the Taiwan Goal-aware Journey concept and research, the goal-aware transportation vision, and long-term architecture ideas.

Challenge-period implementation includes the public web app, deterministic timetable engine, candidate generation, transfer feasibility, ranking, feasibility model, replanning, WebMCP integration, shared page state, UI, tests, and public deployment.

See [Challenge scope](docs/CHALLENGE_SCOPE.md) for the explicit boundary.

## Future work

Post-Challenge directions only:

- TDX and real transportation data
- Real-time updates
- Remote MCP
- GPS-aware current state
- Activities, dining, and accommodation

## License

MIT. See [LICENSE](LICENSE).
