# Demo script (2:30–2:45)

| Time | On screen | Narration |
| --- | --- | --- |
| 0:00–0:15 | Title and official-snapshot notice | “This demo asks whether a real-world goal can still be accomplished. It uses a frozen official THSR scheduled timetable, not realtime data.” |
| 0:15–0:35 | Zuoying, Xpark goal, and 2026-08-31 11:30 | “The webpage owns the selected goal and journey intent. Users choose normal place and goal labels, not internal node IDs.” |
| 0:35–0:55 | Initial FEASIBLE result | “The deterministic engine finds train 1634, arrives at 13:09, includes the nine-minute final walk, and compares 13:18 with the 17:00 last-admission rule.” |
| 0:55–1:15 | View journey | “The result is calculated from indexed scheduled departures. The itinerary is not hard-coded into the interface.” |
| 1:15–1:35 | WebMCP-ready status and Site Tools | “WebMCP reads the same live page state. `check_taiwan_goal_feasibility` calls the same engine and returns the same result.” |
| 1:35–2:05 | Update progress: Tainan at 11:49; recalculate | “This simulated delay is one minute after train 1634 left Tainan. Replanning creates a fresh JourneyRequest; it never patches the old itinerary.” |
| 2:05–2:30 | Replanned train 0640 and margin | “The departed service disappears. The index discovers train 0640, regenerates the downstream journey, and recalculates goal feasibility.” |
| 2:30–2:45 | Data notice / final result | “The THSR schedule and Xpark rule are sourced facts. The delay event is simulated and clearly separated.” |
| 2:35–2:45 | Title / final result | “AI understands the traveler. We understand the journey.” |

Do not script a successful ChatGPT tool invocation unless it has been verified before recording. If invocation remains unavailable, show production Site Tool discovery, live page state, and the deterministic human/UI flow without implying execution occurred.
