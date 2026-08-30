import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeTdxThsrRecords } from "./normalize-tdx-thsr.ts";
import type { TdxDailyTimetableRecord, TdxTrainDateList } from "./types.ts";

export const REQUESTED_DATES = ["2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"] as const;
export const TOKEN_ENDPOINT = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
export const SUPPLY_DATE_ENDPOINT = "https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/TrainDates?%24format=JSON";
export const DAILY_TIMETABLE_ENDPOINT_TEMPLATE = "https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/TrainDate/{date}";
const PAGE_SIZE = 1000;

export interface SupplyDateAssessment {
  requestedDates: string[];
  availableDates: string[];
  missingDates: string[];
  supplyStartDate: string;
  supplyEndDate: string;
  updateTime: string;
}

export function authorizationHeader(environment: NodeJS.ProcessEnv = process.env): string {
  const explicit = environment.TDX_AUTHORIZATION?.trim();
  if (explicit) return explicit;
  const apiKey = environment.TDX_API_KEY?.trim();
  if (apiKey) return apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
  throw new Error("TDX credentials missing. Set TDX_AUTHORIZATION or TDX_API_KEY; no fallback may be labeled real data.");
}

export async function resolveAuthorizationHeader(environment: NodeJS.ProcessEnv = process.env, fetchImplementation: typeof fetch = fetch): Promise<string> {
  const explicit = environment.TDX_AUTHORIZATION?.trim();
  if (explicit) return explicit;
  const apiKey = environment.TDX_API_KEY?.trim();
  if (apiKey) return apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
  const clientId = environment.TDX_CLIENT_ID?.trim();
  const clientSecret = environment.TDX_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("TDX credentials missing. Set TDX_CLIENT_ID and TDX_CLIENT_SECRET in the local .env file.");
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret });
  const response = await fetchImplementation(TOKEN_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!response.ok) throw new Error(`TDX token request failed: HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object") throw new Error("TDX token response is not an object");
  const token = (value as { access_token?: unknown }).access_token;
  const tokenType = (value as { token_type?: unknown }).token_type;
  if (typeof token !== "string" || token.length === 0) throw new Error("TDX token response is missing access_token");
  return `${typeof tokenType === "string" && tokenType.length > 0 ? tokenType : "Bearer"} ${token}`;
}
export function supplyDateUrl(): string { return SUPPLY_DATE_ENDPOINT; }
export function dailyTimetableUrl(date: string, skip = 0): string {
  return `${DAILY_TIMETABLE_ENDPOINT_TEMPLATE.replace("{date}", date)}?%24top=${PAGE_SIZE}&%24skip=${skip}&%24format=JSON`;
}

async function fetchJson(url: string, authorization: string, fetchImplementation: typeof fetch): Promise<unknown> {
  const response = await fetchImplementation(url, { headers: { Authorization: authorization, Accept: "application/json" } });
  if (!response.ok) throw new Error(`TDX request failed: HTTP ${response.status} (${url})`);
  return response.json();
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function assessSupplyDates(value: unknown, requestedDates: readonly string[] = REQUESTED_DATES): SupplyDateAssessment {
  if (!value || typeof value !== "object") throw new Error("TDX supply-date response is not an object");
  const payload = value as Partial<TdxTrainDateList>;
  if (!isDate(payload.StartDate) || !isDate(payload.EndDate) || !Array.isArray(payload.TrainDates) || !payload.TrainDates.every(isDate) || typeof payload.UpdateTime !== "string") {
    throw new Error("TDX supply-date response is missing required TrainDateList fields");
  }
  const supplied = new Set(payload.TrainDates);
  const requested = [...requestedDates];
  return {
    requestedDates: requested,
    availableDates: requested.filter((date) => supplied.has(date)),
    missingDates: requested.filter((date) => !supplied.has(date)),
    supplyStartDate: payload.StartDate,
    supplyEndDate: payload.EndDate,
    updateTime: payload.UpdateTime,
  };
}

export async function fetchSupplyDateAssessment(authorization: string, fetchImplementation: typeof fetch = fetch): Promise<SupplyDateAssessment> {
  return assessSupplyDates(await fetchJson(supplyDateUrl(), authorization, fetchImplementation));
}

export async function fetchCompleteDate(date: string, authorization: string, fetchImplementation: typeof fetch = fetch): Promise<TdxDailyTimetableRecord[]> {
  const records: TdxDailyTimetableRecord[] = [];
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const value = await fetchJson(dailyTimetableUrl(date, skip), authorization, fetchImplementation);
    if (!Array.isArray(value)) throw new Error(`TDX ${date} response is not an array`);
    const page = value as TdxDailyTimetableRecord[];
    for (const record of page) {
      if (record?.TrainDate !== date) throw new Error(`TDX ${date} response contains mismatched TrainDate: ${String(record?.TrainDate)}`);
    }
    records.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  if (records.length === 0) throw new Error(`TDX ${date} returned no daily timetable records`);
  return records;
}

export async function acquireRequestedDailyTimetables(authorization: string, fetchImplementation: typeof fetch = fetch): Promise<{ assessment: SupplyDateAssessment; records: TdxDailyTimetableRecord[] }> {
  const assessment = await fetchSupplyDateAssessment(authorization, fetchImplementation);
  if (assessment.missingDates.length > 0) return { assessment, records: [] };
  const records = (await Promise.all(REQUESTED_DATES.map((date) => fetchCompleteDate(date, authorization, fetchImplementation)))).flat();
  return { assessment, records };
}

async function main(): Promise<void> {
  const authorization = await resolveAuthorizationHeader();
  const assessment = await fetchSupplyDateAssessment(authorization);
  console.log(JSON.stringify({ stage: "supply-date", endpoint: supplyDateUrl(), ...assessment }));
  if (assessment.missingDates.length > 0) {
    throw new Error(`TDX supply-date check failed; missing dates: ${assessment.missingDates.join(", ")}`);
  }
  const records = (await Promise.all(REQUESTED_DATES.map((date) => fetchCompleteDate(date, authorization)))).flat();
  const fetchedDates = [...new Set(records.map((record) => record.TrainDate))].sort();
  if (fetchedDates.join(",") !== REQUESTED_DATES.join(",")) throw new Error(`Fetched date set does not match requested period: ${fetchedDates.join(", ")}`);
  const retrievedAt = new Date().toISOString();
  const snapshotId = `tdx-thsr-20260827-20260902-${retrievedAt.slice(0, 10).replaceAll("-", "")}`;
  const snapshot = normalizeTdxThsrRecords(records, { snapshotId, retrievedAt });
  const outputPath = resolve(process.argv[2] ?? ".cache/timetable-import/tdx-thsr-normalized.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ stage: "daily-timetable", outputPath, fetchedDates, dailyEndpointTemplate: DAILY_TIMETABLE_ENDPOINT_TEMPLATE, nodes: snapshot.nodes.length, serviceRuns: snapshot.serviceRuns.length, stopTimes: snapshot.stopTimes.length }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
