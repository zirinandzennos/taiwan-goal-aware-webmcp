import { parseExplicitIsoTimestamp } from "./timetable";
import type { ScheduledService, TimetableDepartureOptions, TimetableStore } from "./types";

function compareDeparture(first: ScheduledService, second: ScheduledService): number {
  return Date.parse(first.departureAt) - Date.parse(second.departureAt) || first.id.localeCompare(second.id);
}
function lowerBound(services: readonly ScheduledService[], readyAtMs: number): number {
  let low = 0;
  let high = services.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (Date.parse(services[middle].departureAt) < readyAtMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

export class IndexedTimetableStore implements TimetableStore {
  readonly #departuresByNode: ReadonlyMap<string, readonly ScheduledService[]>;

  constructor(services: readonly ScheduledService[]) {
    const departuresByNode = new Map<string, ScheduledService[]>();
    for (const service of services) {
      const departures = departuresByNode.get(service.fromNodeId) ?? [];
      departures.push(service);
      departuresByNode.set(service.fromNodeId, departures);
    }
    for (const departures of departuresByNode.values()) departures.sort(compareDeparture);
    this.#departuresByNode = departuresByNode;
  }

  findNextDepartures(nodeId: string, readyAt: string, options: TimetableDepartureOptions = {}): readonly ScheduledService[] {
    const readyAtMs = parseExplicitIsoTimestamp(readyAt);
    if (readyAtMs === null) return [];
    const departures = this.#departuresByNode.get(nodeId) ?? [];
    const start = lowerBound(departures, readyAtMs);
    const limit = Math.max(0, options.limit ?? 24);
    const allowedModes = options.allowedModes ? new Set(options.allowedModes) : null;
    const result: ScheduledService[] = [];
    for (let index = start; index < departures.length && result.length < limit; index += 1) {
      const service = departures[index];
      if (allowedModes && !allowedModes.has(service.mode)) continue;
      result.push(service);
    }
    return result;
  }
}

export function createIndexedTimetableStore(services: readonly ScheduledService[]): TimetableStore {
  return new IndexedTimetableStore(services);
}
