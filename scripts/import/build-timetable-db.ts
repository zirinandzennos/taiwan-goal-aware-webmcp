import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { NormalizedTimetableSnapshot } from "./types.ts";

export function buildTimetableDatabase(snapshot: NormalizedTimetableSnapshot, outputPath: string): void {
  const database = new DatabaseSync(outputPath);
  try {
    database.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE snapshots (snapshot_id TEXT PRIMARY KEY, source TEXT NOT NULL, provider TEXT NOT NULL, dataset TEXT NOT NULL, retrieved_at TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, timezone TEXT NOT NULL, license TEXT NOT NULL, attribution TEXT NOT NULL, normalization_version TEXT NOT NULL);
      CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, operator TEXT NOT NULL, latitude REAL, longitude REAL);
      CREATE TABLE service_runs (id TEXT PRIMARY KEY, service_date TEXT NOT NULL, operator TEXT NOT NULL, mode TEXT NOT NULL, route_id TEXT NOT NULL, service_number TEXT, source_snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id));
      CREATE TABLE stop_times (service_run_id TEXT NOT NULL REFERENCES service_runs(id), stop_sequence INTEGER NOT NULL, node_id TEXT NOT NULL REFERENCES nodes(id), arrival_at TEXT NOT NULL, departure_at TEXT NOT NULL, PRIMARY KEY(service_run_id, stop_sequence));
      CREATE INDEX idx_stop_times_node_departure ON stop_times(node_id, departure_at);
      CREATE TABLE transfer_rules (from_node_id TEXT NOT NULL REFERENCES nodes(id), to_node_id TEXT NOT NULL REFERENCES nodes(id), walking_minutes INTEGER NOT NULL, minimum_transfer_minutes INTEGER NOT NULL, PRIMARY KEY(from_node_id, to_node_id));`);
    database.exec("BEGIN");
    const m = snapshot.metadata;
    database.prepare("INSERT INTO snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(m.snapshotId, m.source, m.provider, m.dataset, m.retrievedAt, m.periodStart, m.periodEnd, m.timezone, m.license, m.attribution, m.normalizationVersion);
    const insertNode = database.prepare("INSERT INTO nodes VALUES (?, ?, ?, ?, ?, ?)");
    for (const node of snapshot.nodes) insertNode.run(node.id, node.name, node.type, node.operator, node.latitude ?? null, node.longitude ?? null);
    const insertRun = database.prepare("INSERT INTO service_runs VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const run of snapshot.serviceRuns) insertRun.run(run.id, run.serviceDate, run.operator, run.mode, run.routeId, run.serviceNumber, run.sourceSnapshotId);
    const insertStop = database.prepare("INSERT INTO stop_times VALUES (?, ?, ?, ?, ?)");
    for (const stop of snapshot.stopTimes) insertStop.run(stop.serviceRunId, stop.stopSequence, stop.nodeId, stop.arrivalAt, stop.departureAt);
    const insertTransfer = database.prepare("INSERT INTO transfer_rules VALUES (?, ?, ?, ?)");
    for (const rule of snapshot.transferRules) insertTransfer.run(rule.fromNodeId, rule.toNodeId, rule.walkingMinutes, rule.minimumTransferMinutes);
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* transaction may not have started */ }
    throw error;
  } finally { database.close(); }
}
async function main(): Promise<void> {
  const inputPath = resolve(process.argv[2] ?? ".cache/timetable-import/tdx-thsr-normalized.json");
  const outputPath = resolve(process.argv[3] ?? ".cache/timetable-import/timetable.sqlite");
  buildTimetableDatabase(JSON.parse(await readFile(inputPath, "utf8")) as NormalizedTimetableSnapshot, outputPath);
  console.log(JSON.stringify({ outputPath }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
