# Taiwan Goal-aware Journey

## Tagline

AI understands the traveler. We calculate how the journey can actually work.

## Inspiration

Trip planning becomes fragile when a traveler has to combine multiple services and connections manually. A small delay can invalidate the rest of an itinerary, but the traveler must often notice and recalculate it alone. We wanted to explore whether an AI can use a structured Journey Engine instead of treating a journey as a static route blob.

## What it does

Taiwan Goal-aware Journey is a public WebMCP demo that plans a synthetic journey from Kaohsiung Xiaogang to Bade, Taoyuan. It creates executable candidates from a fixed timetable, evaluates transfer feasibility, recommends Fastest, Cheapest, and Balanced options, and can replan the remaining trip from a new current node and time.

## How we built it

The app is a TypeScript/Vite web application with a deterministic synthetic timetable. The Journey Engine uses canonical request, candidate, transfer, ranking, feasibility, planner, and replanner contracts. A shared page-state layer feeds the human UI and the WebMCP adapter. The public app is deployed on Netlify.

## Why WebMCP

The webpage exposes `plan_taiwan_journey` and `replan_taiwan_journey` as read-only tools. Rather than asking a traveler to repeat the configured journey, an agent can read the current live page state and use the same deterministic engine as the UI.

## Human + Agent experience

Humans configure and plan the journey directly in the web interface. In a WebMCP-capable environment, an agent can discover the two Site Tools and operate on the same state. Production Site Tool discovery has been verified; actual ChatGPT tool invocation is not claimed because it remains unverified.

## Challenges

The main challenge was keeping every recommendation executable and deterministic. Transfer walking, mandatory preparation time, missed services, and replan state all have to affect the same engine rather than being treated as presentation-only details. We also kept the scope deliberately synthetic so that the public demo does not imply operational transit accuracy.

## Accomplishments that we're proud of

- A public, self-contained WebMCP demo with no live transit dependency
- Deterministic candidates, transfer checks, ranking, feasibility, and replanning
- Shared human and agent page state with parity tests
- Production discovery of exactly two read-only Journey Site Tools

## What we learned

An AI journey experience needs inspectable domain facts, not just route text. Treating a journey as independently executable steps makes timing changes and missed connections concrete. A synthetic, deterministic Challenge dataset also makes the behavior testable without pretending it is live transit data.

## What's next

Post-Challenge work may explore TDX and other real transportation providers, real-time updates, Remote MCP, GPS-aware current state, and goal-related activities such as dining or accommodation. None of those capabilities are included in this Challenge demo.
