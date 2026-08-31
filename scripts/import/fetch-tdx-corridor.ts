import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchTdxMaasRoutes, type TdxMaasQuery } from "../../src/providers/tdx/maas.ts";
import { deduplicateTdxMaasCandidates, normalizeTdxMaasResponse } from "../../src/providers/tdx/normalizeMaas.ts";
import { TdxAuthorizationProvider, tdxCredentialsFromEnvironment } from "../../src/providers/tdx/serverClient.ts";
import { recommendJourneys } from "../../src/journey/ranking.ts";

export const CORRIDOR_PERIOD = { from: "2026-08-31", to: "2026-09-06", timezone: "Asia/Taipei" } as const;
export const CORRIDOR_ORIGIN = { id: "kaohsiung-main-station", name: "Kaohsiung Main Station demo point", lat: 22.6397, lng: 120.3027 } as const;
export const CORRIDOR_DESTINATION = { id: "xpark-entrance", name: "Xpark entrance demo point", lat: 25.0177, lng: 121.2148 } as const;
export const CORRIDOR_DEPART = "2026-08-31T11:30:00";

export function corridorQueries(): TdxMaasQuery[] {
  return ([1, 0.5, 0] as const).map((gc) => ({
    origin: { lat: CORRIDOR_ORIGIN.lat, lng: CORRIDOR_ORIGIN.lng },
    destination: { lat: CORRIDOR_DESTINATION.lat, lng: CORRIDOR_DESTINATION.lng },
    depart: CORRIDOR_DEPART,
    gc,
    top: 10,
    transit: [3, 4, 5, 6, 7],
    transferTimeMinutes: [5, 60],
    firstMileTimeMinutes: 30,
    lastMileTimeMinutes: 30,
  }));
}

export async function acquireCorridorSnapshot(
  authorizationProvider = new TdxAuthorizationProvider(tdxCredentialsFromEnvironment()),
): Promise<Record<string, unknown>> {
  const retrievedAt = new Date().toISOString();
  const authorization = await authorizationProvider.getAuthorizationHeader();
  const queries = corridorQueries();
  const normalized = [];
  const rejectedRoutes = [];
  const queryResults = [];
  for (const query of queries) {
    const response = await fetchTdxMaasRoutes(query, authorization);
    const result = normalizeTdxMaasResponse(response, {
      originId: CORRIDOR_ORIGIN.id,
      destinationId: CORRIDOR_DESTINATION.id,
      retrievedAt,
      dataMode: "SNAPSHOT",
      minimumTransferBufferSec: 180,
      goalCompletionBufferSec: 0,
      earliestDepartureAt: `${CORRIDOR_DEPART}+08:00`,
    });
    normalized.push(...result.candidates);
    rejectedRoutes.push(...result.rejectedRoutes.map((rejected) => ({ gc: query.gc, ...rejected })));
    queryResults.push({ gc: query.gc, returnedRoutes: response.data?.routes?.length ?? 0, normalizedRoutes: result.candidates.length, rejectedRoutes: result.rejectedRoutes.length });
  }
  const candidates = deduplicateTdxMaasCandidates(normalized);
  const provisional = recommendJourneys(candidates);
  return {
    schemaVersion: "1.0.0",
    snapshotPeriod: CORRIDOR_PERIOD,
    retrievedAt,
    notice: "Official TDX MaaS scheduled routing snapshot. Not live data; fares and mode-level verification may be incomplete.",
    origin: CORRIDOR_ORIGIN,
    destination: CORRIDOR_DESTINATION,
    depart: `${CORRIDOR_DEPART}+08:00`,
    queryResults,
    rejectedRoutes,
    candidates,
    formalRecommendationStatus: "UNKNOWN_MODE_VALIDATION",
    provisionalSelections: {
      fastestCandidateId: provisional.fastest?.id ?? null,
      balancedCandidateId: provisional.balanced?.candidate.id ?? null,
      cheapestCandidateId: provisional.cheapest?.id ?? null,
    },
  };
}

async function main(): Promise<void> {
  const snapshot = await acquireCorridorSnapshot();
  const summary = {
    stage: process.argv.includes("--canary") ? "corridor-canary" : "corridor-snapshot",
    queryResults: snapshot.queryResults,
    deduplicatedCandidates: Array.isArray(snapshot.candidates) ? snapshot.candidates.length : 0,
  };
  if (process.argv.includes("--canary")) {
    console.log(JSON.stringify(summary));
    return;
  }

  const outputDirectory = resolve(process.argv[2] ?? "data/snapshots/2026-08-31_2026-09-06");
  await mkdir(outputDirectory, { recursive: true });
  const manifest = {
    snapshotPeriod: CORRIDOR_PERIOD,
    retrievedAt: snapshot.retrievedAt,
    sources: [{ provider: "TDX MaaS", endpoint: "https://tdx.transportdata.tw/api/maas/routing" }],
    queries: corridorQueries().map((query) => ({ ...query, origin: CORRIDOR_ORIGIN.id, destination: CORRIDOR_DESTINATION.id })),
    normalizerVersion: "1.0.0",
    notice: snapshot.notice,
    queryResults: snapshot.queryResults,
    knownGaps: ["Mode-specific timetable validation is not included in this MaaS-only snapshot.", "No candidate is eligible for Cheapest unless costCoverage is COMPLETE.", "GIS route geometry is not included in the MaaS response."],
    formalRecommendationStatus: snapshot.formalRecommendationStatus,
    provisionalSelections: snapshot.provisionalSelections,
  };
  const places = { origin: CORRIDOR_ORIGIN, destination: CORRIDOR_DESTINATION };
  const goalAccess = { goalId: "ENTER_XPARK", destinationId: CORRIDOR_DESTINATION.id, entranceCoordinateIncludedInRouting: true, additionalCompletionBufferSec: 0 };
  await Promise.all([
    writeFile(resolve(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputDirectory, "places.json"), `${JSON.stringify(places, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputDirectory, "goal-access.json"), `${JSON.stringify(goalAccess, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputDirectory, "maas-candidates.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8"),
  ]);
  console.log(JSON.stringify({ ...summary, outputDirectory }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
