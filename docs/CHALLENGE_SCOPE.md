# Challenge work boundary

## Pre-existing work

- Taiwan Goal-aware Journey concept and research
- Goal-aware transportation vision
- Goal Deadline concept
- Long-term architecture ideas, including possible Remote MCP and live-provider directions

## Implemented during the WebMCP Challenge

- Public web application and public deployment
- Deterministic synthetic fixed timetable retained as a test fallback
- Credential-gated TDX THSR fetch and normalization pipeline
- SQLite import/validation schema with `(node_id, departure_at)` index
- Static runtime timetable and SHA-256 manifest exporter
- Indexed `TimetableStore.findNextDepartures()` lookup
- Canonical Journey contracts and candidate generation
- Transfer feasibility with transfer-specific walking and mandatory buffers
- Deterministic Fastest, Cheapest, and Balanced ranking
- `FEASIBLE`, `RISKY`, `IMPOSSIBLE`, and `UNKNOWN` feasibility model
- `planJourney()` orchestration and deterministic `replanJourney()`
- Goal-aware hard-deadline integration with action and safety buffers
- Two read-only WebMCP Site Tools, led by `check_taiwan_goal_feasibility`
- Shared live page state for the human UI and WebMCP adapter
- Simplified goal-first UI, deterministic tests, and submission documentation

This document intentionally does not attribute the pre-existing concept or research to the Challenge period.

## Current boundary and blocker

The official scheduled-timetable pipeline is implemented, but the normalized 2026-08-24 through 2026-08-30 snapshot is not checked in. The TDX endpoint returned HTTP 401 without credentials, and no `TDX_API_KEY` or `TDX_AUTHORIZATION` environment variable was available. The THSR corporate timetable page was not used as a redistribution source because its website terms do not provide the same clear open-data license.

Therefore the checked-in runtime remains synthetic and the real-data golden demo is not complete. This repository does not claim live real-time transit, historical actual operations, Remote MCP, GPS, bookings, payment, or operational transportation data.
