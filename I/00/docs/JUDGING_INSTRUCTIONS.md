# Judging instructions

## Human UI

1. Open https://taiwan-goal-aware-webmcp.netlify.app/
2. Confirm the page states **Official scheduled timetable snapshot — 2026-08-31 – 2026-09-06** and **Not realtime data**.
3. Confirm the user-facing controls show **Zuoying THSR**, **Enter Xpark before last admission**, and `2026-08-31 11:30`, without raw node IDs.
4. Click **Can I still make it?**
5. Observe `FEASIBLE`, arrival `13:09`, goal ready `13:18`, last admission `17:00`, and safety margin `+222 min`.
6. Open **View journey** and confirm the engine-selected service is THSR train 1634, `11:35–13:09`.
7. Open **Update progress**. The proof state is Tainan at `2026-08-31 11:49`.
8. Click **Recalculate remaining journey**.
9. Observe that departed train 1634 is gone and the regenerated Balanced journey uses train 0640, `12:48–14:09`, with a recalculated `+162 min` margin.

## WebMCP

In a WebMCP-capable environment, the production page exposes these read-only Site Tools:

- `check_taiwan_goal_feasibility`
- `replan_taiwan_journey`

Both tools read the live page-owned goal state and call the same deterministic engine path as the human buttons. They accept no duplicate journey arguments and are read-only.
