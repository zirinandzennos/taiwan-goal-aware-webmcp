import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeTdxThsrRecords } from "./normalize-tdx-thsr.ts";
import type { TdxDailyTimetableRecord } from "./types.ts";

const DATES = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"] as const;
export function authorizationHeader(environment: NodeJS.ProcessEnv = process.env): string {
  const explicit = environment.TDX_AUTHORIZATION?.trim();
  if (explicit) return explicit;
  const apiKey = environment.TDX_API_KEY?.trim();
  if (apiKey) return apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
  throw new Error("TDX credentials missing. Set TDX_AUTHORIZATION or TDX_API_KEY; no fallback may be labeled real data.");
}
export function dailyTimetableUrl(date: string): string { return `https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/TrainDate/${date}?%24format=JSON`; }
async function fetchDate(date: string, authorization: string): Promise<TdxDailyTimetableRecord[]> {
  const response = await fetch(dailyTimetableUrl(date), { headers: { Authorization: authorization, Accept: "application/json" } });
  if (!response.ok) throw new Error(`TDX ${date} request failed: HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (!Array.isArray(value)) throw new Error(`TDX ${date} response is not an array`);
  return value as TdxDailyTimetableRecord[];
}
async function main(): Promise<void> {
  const authorization = authorizationHeader();
  const records = (await Promise.all(DATES.map((date) => fetchDate(date, authorization)))).flat();
  const retrievedAt = new Date().toISOString();
  const snapshotId = `tdx-thsr-20260824-20260830-${retrievedAt.slice(0, 10).replaceAll("-", "")}`;
  const snapshot = normalizeTdxThsrRecords(records, { snapshotId, retrievedAt });
  const outputPath = resolve(process.argv[2] ?? ".cache/timetable-import/tdx-thsr-normalized.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, serviceRuns: snapshot.serviceRuns.length, stopTimes: snapshot.stopTimes.length }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
