import { NORMALIZATION_VERSION, SNAPSHOT_PERIOD_END, SNAPSHOT_PERIOD_START, SNAPSHOT_TIMEZONE, type NormalizedNode, type NormalizedServiceRun, type NormalizedStopTime, type NormalizedTimetableSnapshot, type SnapshotMetadata, type TdxDailyTimetableRecord } from "./types.ts";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(\d{2}):(\d{2}):(\d{2})$/;
const FIRST_DATE = "2026-08-27";
const LAST_DATE = "2026-09-02";

function assertDateInSnapshot(date: string): void {
  if (!DATE_PATTERN.test(date) || date < FIRST_DATE || date > LAST_DATE) throw new Error(`Service date outside fixed snapshot period: ${date}`);
}
function parseClockSeconds(time: string | null | undefined): number {
  if (typeof time !== "string") throw new Error(`Invalid provider time: ${String(time)}`);
  const match = TIME_PATTERN.exec(time);
  if (!match) throw new Error(`Invalid provider time: ${time}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (hours > 23 || minutes > 59 || seconds > 59) throw new Error(`Invalid provider time: ${time}`);
  return hours * 60 * 60 + minutes * 60 + seconds;
}

function toTaipeiTimestamp(date: string, time: string, dayOffset = 0): string {
  const clockSeconds = parseClockSeconds(time);
  const taipeiMidnightUtc = Date.parse(`${date}T00:00:00+08:00`);
  const timestamp = taipeiMidnightUtc + (dayOffset * 24 * 60 * 60 + clockSeconds) * 1000;
  const local = new Date(timestamp + 8 * 60 * 60 * 1000);
  return `${local.toISOString().slice(0, 19)}+08:00`;
}

function localizedStationName(stop: TdxDailyTimetableRecord["StopTimes"][number]): string {
  return stop.StationName?.En?.trim() || stop.StationName?.Zh_tw?.trim() || `THSR station ${stop.StationID}`;
}

export function normalizeTdxThsrRecords(records: readonly TdxDailyTimetableRecord[], metadataOverrides: Pick<SnapshotMetadata, "snapshotId" | "retrievedAt">): NormalizedTimetableSnapshot {
  const nodes = new Map<string, NormalizedNode>();
  const serviceRuns = new Map<string, NormalizedServiceRun>();
  const stopTimes = new Map<string, NormalizedStopTime>();
  for (const record of records) {
    assertDateInSnapshot(record.TrainDate);
    const trainNo = record.DailyTrainInfo?.TrainNo?.trim();
    if (!trainNo) throw new Error("TDX record is missing DailyTrainInfo.TrainNo");
    if (!Array.isArray(record.StopTimes) || record.StopTimes.length < 2) throw new Error(`TDX train ${trainNo} has fewer than two stop times`);
    const serviceRunId = `THSR_${trainNo}_${record.TrainDate.replaceAll("-", "")}`;
    if (serviceRuns.has(serviceRunId)) throw new Error(`Duplicate service run: ${serviceRunId}`);
    serviceRuns.set(serviceRunId, { id: serviceRunId, serviceDate: record.TrainDate, operator: "THSR", mode: "THSR", routeId: "THSR_WESTERN_CORRIDOR", serviceNumber: trainNo, sourceSnapshotId: metadataOverrides.snapshotId });

    let previousDepartureMs = -Infinity;
    let dayOffset = 0;
    let previousDepartureClock: number | null = null;
    for (let index = 0; index < record.StopTimes.length; index += 1) {
      const stop = record.StopTimes[index];
      if (!Number.isInteger(stop.StopSequence) || stop.StopSequence < 1 || !stop.StationID?.trim()) throw new Error(`Invalid stop row for ${serviceRunId}`);
      if (stop.StopSequence !== index + 1) throw new Error(`Unordered stop sequence for ${serviceRunId}: expected ${index + 1}, received ${stop.StopSequence}`);
      const arrivalClock = parseClockSeconds(stop.ArrivalTime);
      const departureClock = parseClockSeconds(stop.DepartureTime);
      if (previousDepartureClock !== null && arrivalClock < previousDepartureClock) {
        if (record.DailyTrainInfo.Overnight !== true) throw new Error(`Unexpected cross-midnight arrival for ${serviceRunId}`);
        dayOffset += 1;
      }
      const arrivalAt = toTaipeiTimestamp(record.TrainDate, stop.ArrivalTime as string, dayOffset);
      if (departureClock < arrivalClock) {
        if (record.DailyTrainInfo.Overnight !== true) throw new Error(`Unexpected cross-midnight departure for ${serviceRunId}`);
        dayOffset += 1;
      }
      const departureAt = toTaipeiTimestamp(record.TrainDate, stop.DepartureTime, dayOffset);
      const arrivalMs = Date.parse(arrivalAt);
      const departureMs = Date.parse(departureAt);
      if (!arrivalAt.endsWith("+08:00") || !departureAt.endsWith("+08:00")) throw new Error(`Missing Asia/Taipei offset for ${serviceRunId}`);
      if (arrivalMs < previousDepartureMs || departureMs < arrivalMs) throw new Error(`Non-monotonic stop times for ${serviceRunId}`);
      previousDepartureMs = departureMs;
      previousDepartureClock = departureClock;
      nodes.set(stop.StationID, { id: stop.StationID, name: localizedStationName(stop), type: "THSR_STATION", operator: "THSR" });
      const stopKey = `${serviceRunId}:${stop.StopSequence}`;
      if (stopTimes.has(stopKey)) throw new Error(`Duplicate stop time: ${stopKey}`);
      stopTimes.set(stopKey, { serviceRunId, stopSequence: stop.StopSequence, nodeId: stop.StationID, arrivalAt, departureAt });
    }
  }
  return {
    metadata: { ...metadataOverrides, source: "https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/TrainDates; https://tdx.transportdata.tw/api/basic/v2/Rail/THSR/DailyTimetable/TrainDate/{date}", provider: "Ministry of Transportation and Communications TDX", dataset: "THSR daily timetable by train date", periodStart: SNAPSHOT_PERIOD_START, periodEnd: SNAPSHOT_PERIOD_END, timezone: SNAPSHOT_TIMEZONE, license: "Open Government Data License, version 1.0", attribution: "Ministry of Transportation and Communications TDX; Taiwan High Speed Rail scheduled timetable", normalizationVersion: NORMALIZATION_VERSION },
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    serviceRuns: [...serviceRuns.values()].sort((a, b) => a.id.localeCompare(b.id)),
    stopTimes: [...stopTimes.values()].sort((a, b) => a.serviceRunId.localeCompare(b.serviceRunId) || a.stopSequence - b.stopSequence),
    transferRules: [],
  };
}
