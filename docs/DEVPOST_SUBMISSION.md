# Taiwan Goal-aware Journey

## Tagline

AI understands the traveler. We calculate how the journey can actually work.

## Inspiration

Trip planning becomes fragile when a traveler has to combine multiple services and connections manually. A small delay can invalidate the rest of an itinerary, but the traveler must often notice and recalculate it alone. We wanted to explore whether an AI can use a structured Journey Engine instead of treating a journey as a static route blob.

## What it does

Taiwan Goal-aware Journey is a public Journey-first WebMCP demo that compares three complete, evidence-backed journeys from Kaohsiung Main Station to Xpark. The fixed 2026-08-31 official-data snapshot contains ten candidates with terminal resolutions: four feasible and six impossible. The product exposes formal Fastest, Balanced, and Cheapest winner sets, full ordered steps through goal completion, explicit selection, progress, and fail-closed replanning.

## How we built it

The app is a TypeScript/Vite web application. Credential-gated importers acquire official TDX data, but the browser imports only committed normalized candidates and proof. A shared application service reads versioned live page state, recomputes formal recommendation gates, allocates three distinct presentation journeys without altering winner sets, and produces a deterministic request fingerprint and result hash for both UI and WebMCP.

## Why WebMCP

The webpage exposes `plan_taiwan_goal_aware_journey`, `check_taiwan_goal_feasibility`, and `replan_taiwan_journey` as read-only tools. Rather than asking a traveler to repeat the configured journey, an agent reads state at execution time. The Journey-first tool returns compact recommendation, identity, step, blocker, proof-status, and evidence fields without returning the full proof artifact.

## Human + Agent experience

Humans compare three cards, select one journey, and record progress directly in the interface. In a WebMCP-capable environment, an agent can discover three Site Tools and operate on the same state. Production invocation is claimed only if the final deployment verification reports it as passed.

## Challenges

The main challenge was keeping every recommendation executable and deterministic while preserving data provenance. Scheduled services, transfer readiness, goal-action time, missed services, and replan state all affect the same engine rather than presentation-only text. The snapshot is official scheduled data, not realtime or historical actual operation data.

## Accomplishments that we're proud of

- A public, self-contained WebMCP demo backed by a frozen official scheduled timetable with no live transit dependency
- Deterministic candidates, terminal evidence resolution, transfer checks, formal ranking, and exact tie disclosure
- Shared human and agent application result with request/version/stale gates and parity tests
- Exactly three read-only Journey Site Tools with compact Journey-first output

## What we learned

An AI journey experience needs inspectable domain facts, not just route text. Treating a journey as independently executable steps makes timing changes and missed connections concrete. Freezing a provider-authorized scheduled snapshot makes the Challenge reproducible without presenting it as realtime data.

## What's next

The current Journey-first demo tracks progress, detects stale downstream steps, and refuses to fabricate a replacement when the frozen snapshot cannot prove one. Successful MaaS remainder regeneration is the next adapter step. Later work may explore other licensed providers, real-time updates, Remote MCP, GPS-aware current state, and goal-related activities. None of those capabilities are included in this Challenge demo.
