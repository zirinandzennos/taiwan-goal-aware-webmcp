# Taiwan Goal-aware Journey

## Tagline

AI understands the traveler. We calculate how the journey can actually work.

## Inspiration

Trip planning becomes fragile when a traveler has to combine multiple services and connections manually. A small delay can invalidate the rest of an itinerary, but the traveler must often notice and recalculate it alone. We wanted to explore whether an AI can use a structured Journey Engine instead of treating a journey as a static route blob.

## What it does

Taiwan Goal-aware Journey is a public WebMCP demo that checks whether a selected real-world goal can still be accomplished. The primary scenario uses a frozen official TDX THSR scheduled timetable for 2026-08-31: Zuoying to Taoyuan for Xpark's published final-admission rule. It creates executable candidates, evaluates goal feasibility, and replans the remaining journey from a new current node and time.

## How we built it

The app is a TypeScript/Vite web application. A credential-gated importer verifies TDX supply dates, normalizes daily THSR timetables, validates an indexed SQLite snapshot, and exports static runtime data plus a SHA-256 manifest. The browser uses that frozen export without credentials or live TDX calls. A shared page-state layer feeds the human UI and WebMCP adapter.

## Why WebMCP

The webpage exposes `check_taiwan_goal_feasibility` and `replan_taiwan_journey` as read-only tools. Rather than asking a traveler to repeat the configured goal and journey, an agent reads the live page state and uses the same deterministic engine as the UI.

## Human + Agent experience

Humans configure and plan the journey directly in the web interface. In a WebMCP-capable environment, an agent can discover the two Site Tools and operate on the same state. Production Site Tool discovery has been verified; actual ChatGPT tool invocation is not claimed because it remains unverified.

## Challenges

The main challenge was keeping every recommendation executable and deterministic while preserving data provenance. Scheduled services, transfer readiness, goal-action time, missed services, and replan state all affect the same engine rather than presentation-only text. The snapshot is official scheduled data, not realtime or historical actual operation data.

## Accomplishments that we're proud of

- A public, self-contained WebMCP demo backed by a frozen official scheduled timetable with no live transit dependency
- Deterministic candidates, transfer checks, ranking, feasibility, and replanning
- Shared human and agent page state with parity tests
- Production discovery of exactly two read-only Journey Site Tools

## What we learned

An AI journey experience needs inspectable domain facts, not just route text. Treating a journey as independently executable steps makes timing changes and missed connections concrete. Freezing a provider-authorized scheduled snapshot makes the Challenge reproducible without presenting it as realtime data.

## What's next

Post-Challenge work may explore other licensed providers, real-time updates, Remote MCP, GPS-aware current state, and goal-related activities. None of those capabilities are included in this Challenge demo.
