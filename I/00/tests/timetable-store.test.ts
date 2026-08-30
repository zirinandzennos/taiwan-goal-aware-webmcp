import { describe, expect, it } from "vitest";
import { IndexedTimetableStore } from "../src/journey/timetableStore";
import type { ScheduledService } from "../src/journey/types";

const services: ScheduledService[] = [
  { id: "other", mode: "BUS", fromNodeId: "other", toNodeId: "z", departureAt: "2026-08-24T07:01:00+08:00", arrivalAt: "2026-08-24T07:10:00+08:00", cost: 1 },
  { id: "next", mode: "THSR", fromNodeId: "a", toNodeId: "c", departureAt: "2026-08-24T07:10:00+08:00", arrivalAt: "2026-08-24T08:00:00+08:00", cost: 0 },
  { id: "exact", mode: "BUS", fromNodeId: "a", toNodeId: "b", departureAt: "2026-08-24T07:05:00+08:00", arrivalAt: "2026-08-24T07:20:00+08:00", cost: 1 },
  { id: "tomorrow", mode: "THSR", fromNodeId: "a", toNodeId: "c", departureAt: "2026-08-25T00:01:00+08:00", arrivalAt: "2026-08-25T01:00:00+08:00", cost: 0 },
];

describe("indexed timetable departures", () => {
  const store = new IndexedTimetableStore(services);

  it("includes an exact departure and orders nearest future services", () => {
    expect(store.findNextDepartures("a", "2026-08-24T07:05:00+08:00").map((service) => service.id)).toEqual(["exact", "next", "tomorrow"]);
  });

  it("excludes a service after its departure by one minute", () => {
    expect(store.findNextDepartures("a", "2026-08-24T07:06:00+08:00").map((service) => service.id)).toEqual(["next", "tomorrow"]);
  });

  it("returns empty for a node with no later service", () => {
    expect(store.findNextDepartures("a", "2026-08-25T01:01:00+08:00")).toEqual([]);
  });

  it("handles the date boundary and mode filtering", () => {
    expect(store.findNextDepartures("a", "2026-08-24T23:59:59+08:00", { allowedModes: ["THSR"] }).map((service) => service.id)).toEqual(["tomorrow"]);
  });

  it("keeps repeated node/time lookup bounded on a 5,000-service synthetic volume", () => {
    const startAt = Date.parse("2026-08-24T00:00:00+08:00");
    const volume: ScheduledService[] = Array.from({ length: 5_000 }, (_, index) => ({
      id: `volume-${index}`,
      mode: "THSR",
      fromNodeId: index % 2 === 0 ? "target" : "unrelated",
      toNodeId: "destination",
      departureAt: new Date(startAt + index * 60_000).toISOString(),
      arrivalAt: new Date(startAt + (index + 1) * 60_000).toISOString(),
      cost: 0,
    }));
    const volumeStore = new IndexedTimetableStore(volume);
    const started = performance.now();
    let first = "";
    for (let index = 0; index < 10_000; index += 1) {
      first = volumeStore.findNextDepartures("target", "2026-08-25T00:00:00+08:00", { limit: 8 })[0]?.id ?? "";
    }
    const elapsedMs = Number((performance.now() - started).toFixed(2));
    console.info(JSON.stringify({ benchmark: "indexed-departure-lookup", services: volume.length, queries: 10_000, elapsedMs }));
    expect(first).toBe("volume-1440");
  });
});
