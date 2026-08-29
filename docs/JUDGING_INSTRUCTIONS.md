# Judging instructions

## Human UI

1. Open https://taiwan-goal-aware-webmcp.netlify.app/
2. Confirm the **SYNTHETIC FIXED TIMETABLE DEMO** warning.
3. Click **Load demo journey** if needed. The default is Kaohsiung Xiaogang to Bade, Taoyuan at synthetic time `2030-06-15 07:00`.
4. Click **Plan journey**.
5. Observe **Fastest**, **Cheapest**, and **Balanced** recommendations.
6. Change departure time to `07:12` and click **Plan journey** again.
7. Observe that the earlier 07:05 synthetic service is no longer available.
8. Enable **Avoid taxi** and plan again.
9. Confirm the returned options contain no taxi service.
10. Set **Current node** to **Zuoying THSR** and **Current journey time** to `2030-06-15 08:31`.
11. Click **Replan remaining trip**.
12. Observe that completed or missed earlier services are not offered in the new downstream journey.

## WebMCP

In a WebMCP-capable environment, the production page exposes these read-only Site Tools:

- `plan_taiwan_journey`
- `replan_taiwan_journey`

Production Site Tool discovery for these two tools has been verified. Actual ChatGPT Site Tool invocation is intentionally not claimed here because it remains unverified.
