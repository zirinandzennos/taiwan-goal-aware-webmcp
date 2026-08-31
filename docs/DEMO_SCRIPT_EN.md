# Demo script (2:30–2:45)

| Time | On screen | Narration |
| --- | --- | --- |
| 0:00–0:15 | Title and snapshot notice | “This is an official transportation-data snapshot for 2026-08-31 through 2026-09-06, Asia/Taipei—not live operational guidance.” |
| 0:15–0:35 | Kaohsiung Main Station, Xpark, 11:30 | “The webpage owns the live journey intent. The browser uses a frozen ten-candidate evidence set and makes no provider call.” |
| 0:35–0:58 | Three recommendation cards | “The formal engine produces two tied Fastest winners, one Balanced winner, and four tied Cheapest winners. The UI shows three different valid journeys without rewriting those sets.” |
| 0:58–1:20 | Card metrics, tie labels, and steps | “Every card exposes completion time, fare, walking, waiting, transfers, slack, evidence-backed steps, and the final goal-completion action.” |
| 1:20–1:40 | WebMCP-ready status and Site Tools | “The Journey-first Site Tool reads the same versioned page state and returns the same normalized result hash as the human UI.” |
| 1:40–2:05 | Select Balanced; complete first step 8 minutes late | “Selection becomes explicit product state. This fixed +8-minute event records actual completion evidence and marks every downstream planned step stale.” |
| 2:05–2:25 | Replan blocker | “The frozen snapshot cannot prove the new remainder. The app preserves progress and fails closed instead of inventing a service.” |
| 2:25–2:40 | Change origin; generate | “The request fingerprint changes, the old plan cannot be selected, and the result becomes unavailable rather than stale.” |
| 2:40–2:45 | Final frame | “AI understands the traveler. We calculate how the journey can actually work.” |

Do not script a successful ChatGPT tool invocation unless it has been verified before recording. If invocation remains unavailable, show production Site Tool discovery, live page state, and the deterministic human/UI flow without implying execution occurred.
