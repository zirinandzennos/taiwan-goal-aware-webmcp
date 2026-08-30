import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
interface Row { [key: string]: unknown }
interface SourceCounts { nodes: number; serviceRuns: number; stopTimes: number; transferRules: number; }

function sourceCounts(databasePath: string): SourceCounts {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const count = (table: string): number => Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
    return { nodes: count("nodes"), serviceRuns: count("service_runs"), stopTimes: count("stop_times"), transferRules: count("transfer_rules") };
  } finally { database.close(); }
}

export function exportRuntimeTimetable(databasePath: string): Record<string, unknown> {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const metadata = database.prepare("SELECT snapshot_id AS snapshotId, source, provider, dataset, retrieved_at AS retrievedAt, period_start AS periodStart, period_end AS periodEnd, timezone, license, attribution, normalization_version AS normalizationVersion FROM snapshots LIMIT 1").get() as Row;
    const nodes = database.prepare("SELECT id, name, type AS kind, latitude, longitude FROM nodes ORDER BY id").all() as Row[];
    const runs = database.prepare("SELECT id, operator, mode, route_id AS routeId, service_number AS serviceNumber FROM service_runs ORDER BY id").all() as Row[];
    const stopQuery = database.prepare("SELECT stop_sequence AS stopSequence, node_id AS nodeId, arrival_at AS arrivalAt, departure_at AS departureAt FROM stop_times WHERE service_run_id = ? ORDER BY stop_sequence");
    const services: Row[] = [];
    for (const run of runs) {
      const stops = stopQuery.all(run.id as string) as Row[];
      for (let fromIndex = 0; fromIndex < stops.length - 1; fromIndex += 1) for (let toIndex = fromIndex + 1; toIndex < stops.length; toIndex += 1) {
        const from = stops[fromIndex]; const to = stops[toIndex];
        services.push({ id: `${run.id}:${from.nodeId}-${to.nodeId}`, serviceRunId: run.id, mode: run.mode, fromNodeId: from.nodeId, toNodeId: to.nodeId, departureAt: from.departureAt, arrivalAt: to.arrivalAt, cost: 0, fareDataAvailable: false, routeId: run.routeId, operator: run.operator, serviceName: run.serviceNumber });
      }
    }
    const transferRules = database.prepare("SELECT from_node_id AS fromNodeId, to_node_id AS toNodeId, walking_minutes AS walkingMinutes, minimum_transfer_minutes AS minimumTransferMinutes FROM transfer_rules ORDER BY from_node_id, to_node_id").all() as Row[];
    return { metadata, nodes, services, transferRules };
  } finally { database.close(); }
}
async function main(): Promise<void> {
  const databasePath = resolve(process.argv[2] ?? ".cache/timetable-import/timetable.sqlite");
  const outputPath = resolve(process.argv[3] ?? "src/data/officialTimetableSnapshot.json");
  const manifestPath = resolve(process.argv[4] ?? "src/data/officialTimetableManifest.json");
  const runtime = exportRuntimeTimetable(databasePath);
  const body = `${JSON.stringify(runtime, null, 2)}\n`;
  const counts = { ...sourceCounts(databasePath), services: (runtime.services as unknown[]).length };
  const manifest = { ...(runtime.metadata as Record<string, unknown>), counts, runtimeSha256: createHash("sha256").update(body).digest("hex"), factualFieldsOnly: true, actualOperationsClaimed: false };
  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestSha256 = createHash("sha256").update(manifestBody).digest("hex");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, body, "utf8");
  await writeFile(manifestPath, manifestBody, "utf8");
  console.log(JSON.stringify({ outputPath, manifestPath, counts, manifestSha256 }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
