# Timetable data provenance

## Required snapshot

- Period: 2026-08-24 00:00 through 2026-08-30 23:59, Asia/Taipei
- Primary demo date: 2026-08-24
- Intended provider: Ministry of Transportation and Communications TDX
- Dataset: THSR daily timetable by train date
- License: Open Government Data License, version 1.0
- Claim boundary: official scheduled timetable only; never historical actual arrivals, delay history, or archived real-time operations

Official dataset metadata: https://data.gov.tw/en/datasets/161163

## Retrieval status

`Needs verification / BLOCKED` as of 2026-08-30.

The official TDX endpoint returned HTTP 401 when called without credentials. No `TDX_API_KEY` or `TDX_AUTHORIZATION` environment variable was available in the workspace. The fetch script therefore exits with an explicit error and does not fall back to synthetic data.

The Taiwan High Speed Rail corporate timetable page shows a schedule effective from 2026-02-02, but the corporate website terms reserve the site's compilation and do not provide the same clear redistribution grant as the TDX open-data listing. It was inspected for source discovery only and was not converted into a committed snapshot.

## Pipeline

- `scripts/import/fetch-tdx-thsr.ts`: fetches the seven fixed service dates using environment-provided authorization.
- `scripts/import/normalize-tdx-thsr.ts`: validates provider rows and materializes dated service-run and stop-time records with explicit `+08:00` offsets.
- `scripts/import/build-timetable-db.ts`: loads normalized facts into SQLite and creates `idx_stop_times_node_departure`.
- `scripts/import/export-runtime-timetable.ts`: exports static browser data and a SHA-256 manifest. It expands individual service runs into usable origin/destination service segments; it does not store complete journey answers.

Raw responses, credentials, SQLite files, and local import caches are excluded from Git. Only normalized factual fields may be considered for a future commit after the authorized fetch and final attribution check.

## Current runtime

The current runtime is `SYNTHETIC_FIXED_TIMETABLE`. Its 2030 values and goal deadlines are deterministic test fixtures, not official transport or venue information. No 2026 real-data golden result, record count, selected service, or performance claim is made until the licensed snapshot has been imported and verified.
