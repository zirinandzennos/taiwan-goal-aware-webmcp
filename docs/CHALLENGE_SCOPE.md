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
- Three read-only WebMCP Site Tools, led by Journey-first `plan_taiwan_goal_aware_journey`, with `check_taiwan_goal_feasibility` and `replan_taiwan_journey`
- Shared live page state for the human UI and WebMCP adapter
- Simplified goal-first UI, deterministic tests, and submission documentation

This document intentionally does not attribute the pre-existing concept or research to the Challenge period.

Post-submission additive work includes the server-only token cache, bounded TDX MaaS corridor importer, canonical step timeline, explicit connection validator, fare-coverage gate, and normalized MaaS snapshot. These additions do not rewrite or replace the verified THSR Journey Engine/runtime.

## Official snapshot boundary

An earlier implementation attempt targeted recent historical dates: first 2026-08-24, then a 2026-08-27 canary. TDX supply metadata may still list recently past dates, but the actual dated timetable endpoint rejects historical queries. The Challenge therefore froze the official future scheduled window 2026-08-31 through 2026-09-06 while it was available. Missing historical dates were not fabricated or replaced with regular-timetable inference; corporate-site samples remain reference-only and are not the runtime redistribution source.

The real-data golden date is 2026-08-31. The primary browser and WebMCP runtime use this frozen official scheduled timetable, not historical actual operations, archived delays, or train performance. Synthetic fixtures remain test-only or explicitly secondary. The Tainan current-time update is a simulated delay input. This repository does not claim live real-time transit, Remote MCP, GPS, bookings, payment, or operational transportation data.
