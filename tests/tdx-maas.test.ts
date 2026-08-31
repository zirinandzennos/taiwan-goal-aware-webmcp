import { describe, expect, it } from "vitest";
import { buildTdxMaasRoutingUrl, type TdxMaasResponse } from "../src/providers/tdx/maas";
import { deduplicateTdxMaasCandidates, normalizeTdxMaasResponse } from "../src/providers/tdx/normalizeMaas";

const place = (name: string, lat: number, lng: number) => ({ name, type: "station", location: { lat, lng } });
const section = (type: string, start: string, end: string, from: ReturnType<typeof place>, to: ReturnType<typeof place>, mode: string, fareTW = 0) => ({
  type,
  travelSummary: { duration: (Date.parse(`${end}+08:00`) - Date.parse(`${start}+08:00`)) / 1000, length: 0 },
  departure: { time: start, place: from },
  arrival: { time: end, place: to },
  transport: { mode, fareTW, uuid: `${mode}-${start}`, shortName: mode },
});

const response: TdxMaasResponse = {
  result: "success",
  data: {
    routes: [{
      travel_time: 3900,
      start_time: "2026-08-31T11:57:00",
      end_time: "2026-08-31T13:02:00",
      transfers: 1,
      sections: [
        section("pedestrian", "2026-08-31T11:57:00", "2026-08-31T11:58:00", place("Origin", 22.63, 120.30), place("Kaohsiung", 22.64, 120.30), "pedestrian"),
        section("transit", "2026-08-31T11:58:00", "2026-08-31T12:06:00", place("Kaohsiung", 22.64, 120.30), place("Xinzuoying", 22.68, 120.30), "TRA"),
        section("pedestrian", "2026-08-31T12:06:00", "2026-08-31T12:07:00", place("Xinzuoying", 22.68, 120.30), place("Zuoying", 22.69, 120.31), "pedestrian"),
        section("waiting", "2026-08-31T12:07:00", "2026-08-31T12:15:00", place("Zuoying", 22.69, 120.31), place("Zuoying", 22.69, 120.31), "waiting"),
        section("transit", "2026-08-31T12:15:00", "2026-08-31T12:55:00", place("Zuoying", 22.69, 120.31), place("Taoyuan", 25.01, 121.21), "HSR"),
        section("pedestrian", "2026-08-31T12:55:00", "2026-08-31T13:02:00", place("Taoyuan", 25.01, 121.21), place("Goal", 25.02, 121.21), "pedestrian"),
      ],
    }],
  },
};

const options = { originId: "origin", destinationId: "goal", retrievedAt: "2026-08-31T01:00:00Z", dataMode: "SNAPSHOT" as const, earliestDepartureAt: "2026-08-31T11:30:00+08:00" };

describe("TDX MaaS adapter", () => {
  it("builds the documented three-weight routing query without credentials", () => {
    const url = new URL(buildTdxMaasRoutingUrl({ origin: { lat: 1, lng: 2 }, destination: { lat: 3, lng: 4 }, depart: "2026-08-31T12:00:00", gc: 0.5 }));
    expect(url.searchParams.get("gc")).toBe("0.5");
    expect(url.searchParams.get("top")).toBe("10");
    expect(url.searchParams.get("transit")).toBe("3,4,5,6,7");
    expect(url.toString()).not.toContain("client_secret");
  });

  it("normalizes MaaS sections into an explicit canonical timeline", () => {
    const result = normalizeTdxMaasResponse(response, options);
    expect(result.rejectedRoutes).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ costCoverage: "UNKNOWN", transferCount: 1, minimumTransferSlackMinutes: 5 });
    expect(result.candidates[0].steps?.map((item) => item.type)).toEqual([
      "WALK", "BOARD", "RIDE", "ALIGHT", "TRANSFER_WALK", "WAIT", "BOARD", "RIDE", "ALIGHT", "GOAL_ACCESS", "GOAL_COMPLETION",
    ]);
    expect(deduplicateTdxMaasCandidates([...result.candidates, ...result.candidates])).toHaveLength(1);
  });
});
