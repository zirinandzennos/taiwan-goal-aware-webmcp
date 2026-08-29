# Judging

- Live URL: https://taiwan-goal-aware-webmcp.netlify.app
- Repository URL: https://github.com/zirinandzennos/taiwan-goal-aware-webmcp
- Primary WebMCP tool: `check_goal_feasibility`
- Synthetic-data warning: all goals, venues, times, arrivals, deadlines, buffers, and fallbacks are self-authored synthetic demo data, not real travel information.

## Judge test

1. Open the live site in a WebMCP-enabled Chrome.
2. Select "Demo Aquarium — Risky".
3. Do not click Check feasibility.
4. Discover `check_goal_feasibility`.
5. Execute it with empty input.
6. Verify status is `RISKY`.
7. Change selection to Missed.
8. Execute again.
9. Verify status is `IMPOSSIBLE`.
10. Change to Deadline Unknown.
11. Verify `UNKNOWN`.

This demonstrates WebMCP because the tool consumes current live page state without requiring the selected goal to be repeated as an argument.
