export interface TdxMaasLocation {
  lat: number;
  lng: number;
}

export interface TdxMaasPlace {
  name?: string;
  type?: string;
  location: TdxMaasLocation;
}

export interface TdxMaasEndpoint {
  time: string;
  place: TdxMaasPlace;
}

export interface TdxMaasTransport {
  mode: string;
  name?: string;
  category?: string;
  headsign?: string;
  shortName?: string;
  longName?: string;
  number?: string;
  type?: string;
  city?: string;
  fareTW?: number;
  uuid?: string;
}

export interface TdxMaasSection {
  type: string;
  travelSummary: { duration: number; length: number };
  departure: TdxMaasEndpoint;
  arrival: TdxMaasEndpoint;
  transport: TdxMaasTransport;
}

export interface TdxMaasRoute {
  travel_time: number;
  start_time: string;
  end_time: string;
  transfers: number;
  sections: TdxMaasSection[];
}

export interface TdxMaasResponse {
  result: string;
  data?: { routes?: TdxMaasRoute[] };
  error?: { code?: number; msg?: string };
}

export interface TdxMaasQuery {
  origin: TdxMaasLocation;
  destination: TdxMaasLocation;
  depart: string;
  gc: 0 | 0.5 | 1;
  top?: number;
  transit?: readonly number[];
  transferTimeMinutes?: readonly [number, number];
  firstMileTimeMinutes?: number;
  lastMileTimeMinutes?: number;
}

export const TDX_MAAS_ROUTING_ENDPOINT = "https://tdx.transportdata.tw/api/maas/routing";

export function buildTdxMaasRoutingUrl(query: TdxMaasQuery): string {
  const parameters = new URLSearchParams({
    origin: `${query.origin.lat},${query.origin.lng}`,
    destination: `${query.destination.lat},${query.destination.lng}`,
    gc: String(query.gc),
    top: String(Math.min(10, Math.max(1, query.top ?? 10))),
    transit: (query.transit ?? [3, 4, 5, 6, 7]).join(","),
    transfer_time: (query.transferTimeMinutes ?? [5, 60]).join(","),
    depart: query.depart,
    first_mile_mode: "0",
    first_mile_time: String(query.firstMileTimeMinutes ?? 30),
    last_mile_mode: "0",
    last_mile_time: String(query.lastMileTimeMinutes ?? 30),
  });
  return `${TDX_MAAS_ROUTING_ENDPOINT}?${parameters}`;
}

export async function fetchTdxMaasRoutes(
  query: TdxMaasQuery,
  authorization: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<TdxMaasResponse> {
  const response = await fetchImplementation(buildTdxMaasRoutingUrl(query), {
    headers: { Authorization: authorization, Accept: "application/json" },
  });
  const value = await response.json() as TdxMaasResponse;
  if (!response.ok || value.result !== "success" || !Array.isArray(value.data?.routes)) {
    throw new Error(`TDX MaaS routing failed: HTTP ${response.status}; ${value.error?.code ?? "UNKNOWN"}`);
  }
  return value;
}
