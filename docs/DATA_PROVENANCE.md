# Timetable data provenance

## Required snapshot

- Period: 2026-08-31 through 2026-09-06, Asia/Taipei
- Primary demo date: 2026-08-31
- Intended provider: Ministry of Transportation and Communications TDX
- Dataset: THSR daily timetable by train date
- License: Open Government Data License, version 1.0
- Claim boundary: official scheduled timetable only; never historical actual arrivals, delay history, or archived real-time operations

Official dataset metadata: https://data.gov.tw/en/datasets/161163

## Date decision and retrieval evidence

An earlier implementation attempt targeted recent historical dates. The first plan was 2026-08-24 through 2026-08-30; the official supply-date response no longer included its first three dates. A second canary used 2026-08-27, which still appeared in supply-date metadata, but the actual dated endpoint returned HTTP 400 with `TrainDate: 無提供查詢歷史資料`.

TDX's dated timetable endpoint does not provide historical queries. The Challenge therefore froze the official future scheduled timetable for 2026-08-31 through 2026-09-06 while every date was available. No historical row was inferred, backfilled, scraped, or replaced with a regular timetable.

The 2026-08-31 canary returned 161 records whose `TrainDate` matched. The completed seven-day snapshot was retrieved at `2026-08-30T09:02:00.865Z` and contains 12 nodes, 1,141 dated service runs, and 9,481 stop times. Its manifest SHA-256 is `7b3eeeb6abe068c9cb2447e03f3813f2310c059efe5807dba7337f847e327b6c`.

The Taiwan High Speed Rail corporate timetable page shows a schedule effective from 2026-02-02, but the corporate website terms reserve the site's compilation and do not provide the same clear redistribution grant as the TDX open-data listing. It was inspected for source discovery only and was not converted into a committed snapshot.

## Pipeline

- `scripts/import/fetch-tdx-thsr.ts`: obtains one local Client Credentials token, verifies the supply-date gate, and fetches the seven fixed service dates with pagination.
- `scripts/import/normalize-tdx-thsr.ts`: validates provider rows and materializes dated service-run and stop-time records with explicit `+08:00` offsets.
- `scripts/import/build-timetable-db.ts`: loads normalized facts into SQLite and creates `idx_stop_times_node_departure`.
- `scripts/import/export-runtime-timetable.ts`: exports static browser data and a SHA-256 manifest. It expands individual service runs into usable origin/destination service segments; it does not store complete journey answers.

Raw responses, credentials, SQLite files, and local import caches are excluded from Git. The committed public artifacts contain only normalized scheduled facts, manifest metadata, and the dated goal rule needed for deterministic reproduction.

## Golden goal provenance

The 2026-08-31 `ENTER_XPARK` evaluation uses Xpark's published Monday rule: Sunday through Friday hours are 10:00–18:00 and final entry is one hour before closing, producing a general-rule deadline of `2026-08-31T17:00:00+08:00`. Xpark's access page states about nine minutes on foot from THSR Taoyuan Station. Xpark also states that business hours may change under special circumstances, so this is a dated evaluation of a published rule, not a claim about historical actual venue operation.

- Hours: https://www.xpark.com.tw/en/index
- Access: https://www.xpark.com.tw/visit

## Current runtime

The static `officialTimetableSnapshot.json`, manifest, goal reference, browser UI, WebMCP tools, and golden runner operate without credentials or live TDX calls. The primary browser context is `PROVIDER_NORMALIZED` and uses the indexed frozen snapshot. Synthetic timetables remain deterministic test fixtures only. The demonstrated Tainan 11:49 progress update is simulated; all selected THSR services and timestamps are discovered from the frozen official schedule.

## Bounded MaaS corridor snapshot

On 2026-08-31, the credential-gated importer queried official TDX MaaS `/routing` for the fixed Kaohsiung Main Station demo point to the Xpark entrance demo point, departing 2026-08-31 11:30 Asia/Taipei. It made three calls with `gc=1`, `0.5`, and `0`, each with `top=10`, and normalized 30 returned routes. Deterministic signature deduplication retained 10 candidates; connection validation rejected none.

Public output is limited to normalized artifacts under `data/snapshots/2026-08-31_2026-09-06/`: the manifest, places, goal access, enriched canonical candidates, service inventory, mode evidence, fares, and validation summary. Raw responses, access tokens, Client ID, Client Secret, Authorization headers, and cookies are not written.

`npm run journey:validate` does not call MaaS or add candidates. It deduplicates the 28 transit legs into seven validation keys, checks the service date through Rail v2 `TrainDates`, matches Rail v2 OD timetables, applies explicit adult full-fare policies to Rail v2 `ODFare`, and checks Taoyuan 208A through Bus v2 `StopOfRoute`, `DailyStopTimeTable`, and `Schedule`. The Rail policy is THSR adult full fare in a standard reserved seat and TRA adult local/fast-local full fare (`成普`). Bus fare stays `null` because it is not proven by the validated endpoints.

The closure proof resolves the frozen set to four `VALIDATED_FEASIBLE`, zero risky, six `VALIDATED_IMPOSSIBLE`, and zero unknown. Every impossible resolution cites official secondary evidence; no unknown value is silently converted. Formal Fastest winners are `07fb4bb5` and `ab19cfc6`; Balanced is `ab19cfc6`; Cheapest includes all four feasible candidates at NT$1,341. The browser's stable presentation allocator shows `07fb4bb5`, `ab19cfc6`, and `1767bfb5` while retaining the complete formal sets and overlap disclosure. No GIS geometry is claimed.

## Journey-first browser boundary

The Journey-first UI and `plan_taiwan_goal_aware_journey` import the committed MaaS candidates and optimization proof directly. They do not fetch MaaS, Rail, Bus, fares, or venue data at runtime. The result identity includes hashes of both fixed artifacts, the live request fingerprint, and the page-state version. A changed or unsupported request returns `UNSUPPORTED_SNAPSHOT_REQUEST` with no journey payload. The +8-minute progress event is deterministic simulated evidence; product replan returns `REPLAN_UNAVAILABLE_FOR_SNAPSHOT_STATE` rather than claiming live guidance.
