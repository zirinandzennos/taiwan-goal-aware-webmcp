import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  attachFare,
  busValidationKey,
  evaluateFormalRecommendationGates,
  railValidationKey,
  recomputeCandidateWithEvidence,
  resolveCandidate,
  selectFareByPolicy,
  validateBusTimetable,
  validateRailTimetable,
  type BusServiceQuery,
  type NormalizedBusRoute,
  type NormalizedBusStopTimetable,
  type NormalizedFareOption,
  type NormalizedRailTimetable,
  type RailServiceQuery,
  type ValidationContext,
} from "../../src/journey/modeValidation.ts";
import { rankBalanced, rankFastest } from "../../src/journey/ranking.ts";
import type { CandidateJourney, JourneyStep, ModeValidationEvidence } from "../../src/journey/types.ts";
import { TdxAuthorizationProvider, tdxCredentialsFromEnvironment } from "../../src/providers/tdx/serverClient.ts";

const API_BASE = "https://tdx.transportdata.tw/api/basic";
const SNAPSHOT_DIRECTORY = "data/snapshots/2026-08-31_2026-09-06";
const SERVICE_DATE = "2026-08-31";
const TIMEZONE = "Asia/Taipei";
const VALIDATOR_VERSION = "1.0.0";
const NORMALIZER_VERSION = "1.1.0";

type JsonObject = Record<string, any>;

interface SnapshotDocument extends JsonObject {
  candidates: CandidateJourney[];
  retrievedAt: string;
}

interface RideReference {
  candidateId: string;
  step: JourneyStep;
  query: RailServiceQuery | BusServiceQuery;
  validationKey: string;
}

const stationIds: Record<string, string> = {
  "TRA:高雄": "4400",
  "TRA:新左營": "4340",
  "THSR:左營": "1070",
  "THSR:板橋": "1010",
  "THSR:桃園": "1020",
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function sourceUrl(path: string): string {
  return `${API_BASE}${path.split("?")[0]}`;
}

function taipeiTimestamp(serviceDate: string, time: string, nextDay = false): string {
  const day = new Date(`${serviceDate}T00:00:00+08:00`);
  if (nextDay) day.setUTCDate(day.getUTCDate() + 1);
  return `${new Date(day.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)}T${time}:00+08:00`;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function fetchJson(
  path: string,
  authorizationProvider: TdxAuthorizationProvider,
  fetchImplementation: typeof fetch = fetch,
): Promise<any> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const authorization = await authorizationProvider.getAuthorizationHeader();
    const separator = path.includes("?") ? "&" : "?";
    const response = await fetchImplementation(`${API_BASE}${path}${separator}%24format=JSON`, {
      headers: { Authorization: authorization },
    });
    if (response.ok) {
      const value = await response.json();
      await sleep(1_500);
      return value;
    }
    if (response.status !== 429) throw new Error(`TDX ${path} failed: HTTP ${response.status}`);
    await sleep(5_000 * (attempt + 1));
  }
  throw new Error(`TDX ${path} remained rate limited after bounded retries`);
}

function railQuery(step: JourneyStep): RailServiceQuery {
  const mode = step.service?.mode;
  if (mode !== "THSR" && mode !== "TRA") throw new Error(`Not a rail ride: ${step.id}`);
  const originStationId = stationIds[`${mode}:${step.from.name}`];
  const destinationStationId = stationIds[`${mode}:${step.to.name}`];
  if (!originStationId || !destinationStationId) throw new Error(`Unmapped ${mode} OD: ${step.from.name} -> ${step.to.name}`);
  return {
    mode,
    serviceDate: SERVICE_DATE,
    trainNo: step.validationEvidence?.matchedBy === "UNIQUE_TIME_WINDOW" ? null : step.service?.trainNo ?? null,
    serviceRouteName: step.service?.routeId ?? null,
    originStationId,
    destinationStationId,
    plannedDeparture: step.validationEvidence?.originalMaasDeparture ?? step.plannedStart,
    plannedArrival: step.validationEvidence?.originalMaasArrival ?? step.plannedEnd,
  };
}

function busQuery(step: JourneyStep): BusServiceQuery {
  return {
    serviceDate: SERVICE_DATE,
    jurisdiction: "Taoyuan",
    routeName: step.service?.routeId ?? "208A",
    routeUid: null,
    subRouteUid: null,
    direction: null,
    boardingStopUid: null,
    alightingStopUid: null,
    boardingStopName: step.from.name === "捷運高鐵桃園站" ? "高鐵桃園站" : step.from.name,
    alightingStopName: step.to.name,
    plannedDeparture: step.validationEvidence?.originalMaasDeparture ?? step.plannedStart,
    plannedArrival: step.validationEvidence?.originalMaasArrival ?? step.plannedEnd,
  };
}

function rideReferences(candidates: readonly CandidateJourney[]): RideReference[] {
  return candidates.flatMap((candidate) => (candidate.steps ?? [])
    .filter((step) => step.type === "RIDE")
    .map((step) => {
      const query = step.service?.mode === "BUS" ? busQuery(step) : railQuery(step);
      return {
        candidateId: candidate.id,
        step,
        query,
        validationKey: "mode" in query ? railValidationKey(query) : busValidationKey(query),
      };
    }));
}

function normalizeRailRecords(raw: readonly JsonObject[], query: RailServiceQuery): NormalizedRailTimetable[] {
  return raw.flatMap((entry) => {
    const info = entry.DailyTrainInfo;
    const origin = entry.OriginStopTime;
    const destination = entry.DestinationStopTime;
    const trainNo = stringValue(info?.TrainNo);
    const departureTime = stringValue(origin?.DepartureTime);
    const arrivalTime = stringValue(destination?.ArrivalTime);
    if (!trainNo || !departureTime || !arrivalTime) return [];
    const overnight = Boolean(info?.Overnight) || arrivalTime < departureTime;
    const startName = stringValue(info?.StartingStationName?.Zh_tw);
    const endName = stringValue(info?.EndingStationName?.Zh_tw);
    return [{
      serviceDate: query.serviceDate,
      trainNo,
      serviceRouteName: startName && endName ? `${startName}-${endName}` : null,
      trainTypeName: stringValue(info?.TrainTypeName?.Zh_tw),
      originStationId: String(origin.StationID),
      destinationStationId: String(destination.StationID),
      originStopSequence: Number(origin.StopSequence),
      destinationStopSequence: Number(destination.StopSequence),
      departure: taipeiTimestamp(query.serviceDate, departureTime),
      arrival: taipeiTimestamp(query.serviceDate, arrivalTime, overnight),
      cancelled: Number(info?.SuspendedFlag ?? origin?.SuspendedFlag ?? destination?.SuspendedFlag ?? 0) !== 0,
      overnight,
    }];
  });
}

function thsrFareOptions(raw: readonly JsonObject[]): NormalizedFareOption[] {
  return raw.flatMap((od) => (od.Fares ?? []).flatMap((fare: JsonObject) => {
    if (fare.TicketType !== 1 || fare.FareClass !== 1 || fare.CabinClass !== 1) return [];
    return [{ fareTwd: Number(fare.Price), passengerType: "ADULT", ticketType: "FULL_FARE", fareClass: "ADULT", cabinClass: "STANDARD_RESERVED" }];
  }));
}

function traFareOptions(raw: readonly JsonObject[]): NormalizedFareOption[] {
  return raw.flatMap((od) => (od.Fares ?? []).flatMap((fare: JsonObject) => fare.TicketType === "成普"
    ? [{ fareTwd: Number(fare.Price), passengerType: "ADULT", ticketType: "FULL_FARE", fareClass: "LOCAL", cabinClass: "STANDARD" }]
    : []));
}

function normalizeBusRoutes(raw: readonly JsonObject[]): NormalizedBusRoute[] {
  return raw.map((entry) => ({
    routeName: String(entry.RouteName?.Zh_tw ?? ""),
    routeUid: String(entry.RouteUID),
    subRouteUid: String(entry.SubRouteUID),
    direction: Number(entry.Direction),
    operator: stringValue(entry.Operators?.[0]?.OperatorName?.Zh_tw),
    stops: (entry.Stops ?? []).map((stop: JsonObject) => ({
      stopUid: String(stop.StopUID),
      stopName: String(stop.StopName?.Zh_tw ?? ""),
      stopSequence: Number(stop.StopSequence),
    })),
  }));
}

function normalizeBusTimetables(raw: readonly JsonObject[], route: NormalizedBusRoute): NormalizedBusStopTimetable[] {
  const lastStopId = route.stops.at(-1)?.stopUid.replace(/^TAO/, "");
  return raw.filter((entry) => String(entry.RouteUID) === route.routeUid
    && String(entry.SubRouteUID) === route.subRouteUid
    && String(entry.DestinationStopID) === lastStopId)
    .flatMap((entry) => {
      const boarding = (entry.Stops ?? []).find((stop: JsonObject) => stop.StopUID === "TAO9677");
      const alighting = (entry.Stops ?? []).find((stop: JsonObject) => stop.StopUID === "TAO2938");
      if (!boarding || !alighting) return [];
      const bySequence = new Map<number, { board: JsonObject[]; alight: JsonObject[] }>();
      for (const item of boarding.TimeTables ?? []) {
        const group = bySequence.get(Number(item.Sequence)) ?? { board: [], alight: [] };
        group.board.push(item);
        bySequence.set(Number(item.Sequence), group);
      }
      for (const item of alighting.TimeTables ?? []) {
        const group = bySequence.get(Number(item.Sequence)) ?? { board: [], alight: [] };
        group.alight.push(item);
        bySequence.set(Number(item.Sequence), group);
      }
      return [...bySequence.values()].flatMap((group) => group.board.flatMap((board) => group.alight.map((alight) => ({
        serviceDate: SERVICE_DATE,
        routeUid: route.routeUid,
        subRouteUid: route.subRouteUid,
        direction: route.direction,
        stopTimes: [
          { stopUid: "TAO9677", arrival: taipeiTimestamp(SERVICE_DATE, board.ArrivalTime), departure: taipeiTimestamp(SERVICE_DATE, board.DepartureTime) },
          { stopUid: "TAO2938", arrival: taipeiTimestamp(SERVICE_DATE, alight.ArrivalTime), departure: taipeiTimestamp(SERVICE_DATE, alight.DepartureTime) },
        ],
      }))));
    });
}

function enrichedService(step: JourneyStep, evidence: ModeValidationEvidence): JourneyStep["service"] {
  const service = { ...step.service };
  if (service.mode === "THSR" || service.mode === "TRA") {
    const query = railQuery(step);
    return {
      ...service,
      operator: service.mode === "THSR" ? "台灣高速鐵路" : "國營臺灣鐵路股份有限公司",
      trainNo: stringValue(evidence.normalizedQuery.matchedTrainNo) ?? service.trainNo,
      boardingStopId: query.originStationId,
      alightingStopId: query.destinationStationId,
    };
  }
  return {
    ...service,
    operator: "統聯客運",
    jurisdiction: "Taoyuan",
    routeUid: "TAO2081",
    subRouteUid: "TAO2081",
    direction: 0,
    boardingStopId: "TAO9677",
    alightingStopId: "TAO2938",
    trainNo: undefined,
  };
}

function coverageInventory(candidates: readonly CandidateJourney[], references: readonly RideReference[], retrievedAt: string): JsonObject {
  const byStep = new Map(references.map((reference) => [`${reference.candidateId}|${reference.step.id}`, reference]));
  const entries = candidates.map((candidate) => ({
    candidateId: candidate.id,
    rides: (candidate.steps ?? []).filter((step) => step.type === "RIDE").map((step) => {
      const reference = byStep.get(`${candidate.id}|${step.id}`)!;
      return {
        stepId: step.id,
        validationKey: reference.validationKey,
        mode: step.service?.mode,
        serviceDate: SERVICE_DATE,
        provider: "TDX",
        operator: step.service?.operator ?? null,
        jurisdiction: step.service?.jurisdiction ?? null,
        routeUid: step.service?.routeUid ?? null,
        subRouteUid: step.service?.subRouteUid ?? null,
        direction: step.service?.direction ?? null,
        trainNo: step.service?.trainNo ?? null,
        boardingStationOrStopId: step.service?.boardingStopId ?? null,
        alightingStationOrStopId: step.service?.alightingStopId ?? null,
        plannedDeparture: step.validationEvidence?.originalMaasDeparture ?? step.plannedStart,
        plannedArrival: step.validationEvidence?.originalMaasArrival ?? step.plannedEnd,
      };
    }),
  }));
  const rides = entries.flatMap((entry) => entry.rides);
  const count = (mode: string) => rides.filter((ride) => ride.mode === mode).length;
  return {
    schemaVersion: "1.0.0",
    retrievedAt,
    timezone: TIMEZONE,
    totals: {
      candidateCount: candidates.length,
      transitLegCount: rides.length,
      deduplicatedValidationKeys: new Set(rides.map((ride) => ride.validationKey)).size,
      kaohsiungCityBusLegCount: rides.filter((ride) => ride.mode === "BUS" && ride.jurisdiction === "Kaohsiung").length,
      taoyuanCityBusLegCount: rides.filter((ride) => ride.mode === "BUS" && ride.jurisdiction === "Taoyuan").length,
      intercityBusLegCount: rides.filter((ride) => ride.mode === "BUS" && ride.jurisdiction === "InterCity").length,
      unknownBusJurisdictionLegCount: rides.filter((ride) => ride.mode === "BUS" && (!ride.jurisdiction || ride.jurisdiction === "UNKNOWN")).length,
      traLegCount: count("TRA"),
      thsrLegCount: count("THSR"),
      mrtLegCount: count("MRT"),
    },
    candidates: entries,
  };
}

export async function validateExistingCorridorSnapshot(
  directory = SNAPSHOT_DIRECTORY,
  authorizationProvider = new TdxAuthorizationProvider(tdxCredentialsFromEnvironment()),
): Promise<JsonObject> {
  const outputDirectory = resolve(directory);
  const candidatePath = resolve(outputDirectory, "maas-candidates.json");
  const manifestPath = resolve(outputDirectory, "manifest.json");
  const snapshot = JSON.parse(await readFile(candidatePath, "utf8")) as SnapshotDocument;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as JsonObject;
  if (snapshot.candidates.length !== 10) throw new Error(`Expected the frozen 10 MaaS candidates, found ${snapshot.candidates.length}`);
  const retrievedAt = new Date().toISOString();
  const references = rideReferences(snapshot.candidates);
  const uniqueReferences = [...new Map(references.map((reference) => [reference.validationKey, reference])).values()];
  const thsrDatesPath = "/v2/Rail/THSR/DailyTimetable/TrainDates";
  const traDatesPath = "/v2/Rail/TRA/DailyTimetable/TrainDates";
  const [thsrDates, traDates] = await Promise.all([
    fetchJson(thsrDatesPath, authorizationProvider),
    fetchJson(traDatesPath, authorizationProvider),
  ]);
  const datesPublished = {
    THSR: Array.isArray(thsrDates.TrainDates) && thsrDates.TrainDates.includes(SERVICE_DATE),
    TRA: Array.isArray(traDates.TrainDates) && traDates.TrainDates.includes(SERVICE_DATE),
  };

  const railOdKeys = [...new Map(uniqueReferences.filter((reference) => "mode" in reference.query).map((reference) => {
    const query = reference.query as RailServiceQuery;
    return [`${query.mode}|${query.originStationId}|${query.destinationStationId}`, query];
  })).values()];
  const railRawByOd = new Map<string, JsonObject[]>();
  const fareRawByOd = new Map<string, JsonObject[]>();
  for (const query of railOdKeys) {
    const odPath = `/v2/Rail/${query.mode}/DailyTimetable/OD/${query.originStationId}/to/${query.destinationStationId}/${query.serviceDate}?%24top=100`;
    const farePath = `/v2/Rail/${query.mode}/ODFare/${query.originStationId}/to/${query.destinationStationId}?%24top=30`;
    railRawByOd.set(`${query.mode}|${query.originStationId}|${query.destinationStationId}`, await fetchJson(odPath, authorizationProvider));
    fareRawByOd.set(`${query.mode}|${query.originStationId}|${query.destinationStationId}`, await fetchJson(farePath, authorizationProvider));
  }

  const busStopPath = "/v2/Bus/StopOfRoute/City/Taoyuan/208A?%24top=100";
  const busDailyPath = "/v2/Bus/DailyStopTimeTable/City/Taoyuan/208A?%24top=100";
  const busSchedulePath = "/v2/Bus/Schedule/City/Taoyuan/208A?%24top=100";
  const [busStopRaw, busDailyRaw] = await Promise.all([
    fetchJson(busStopPath, authorizationProvider),
    fetchJson(busDailyPath, authorizationProvider),
  ]);
  // Queried for provenance and quality classification only; it contains origin-only times for 208A.
  await fetchJson(busSchedulePath, authorizationProvider);
  const busRoutes = normalizeBusRoutes(busStopRaw);
  const outbound = busRoutes.find((route) => route.direction === 0)!;
  const busTimetables = outbound ? normalizeBusTimetables(busDailyRaw, outbound) : [];

  const evidenceByKey = new Map<string, ModeValidationEvidence>();
  for (const reference of uniqueReferences) {
    if ("mode" in reference.query) {
      const query = reference.query;
      const odKey = `${query.mode}|${query.originStationId}|${query.destinationStationId}`;
      const odPath = `/v2/Rail/${query.mode}/DailyTimetable/OD/${query.originStationId}/to/${query.destinationStationId}/${query.serviceDate}`;
      const context: ValidationContext = { retrievedAt, endpointName: `${query.mode}_DAILY_TIMETABLE_OD`, sourceUrl: sourceUrl(odPath) };
      let evidence = validateRailTimetable(query, normalizeRailRecords(railRawByOd.get(odKey) ?? [], query), datesPublished[query.mode], context);
      const rawFare = fareRawByOd.get(odKey) ?? [];
      if (query.mode === "THSR") {
        const policy = { passengerType: "ADULT", ticketType: "FULL_FARE", fareClass: "ADULT", cabinClass: "STANDARD_RESERVED" };
        evidence = attachFare(evidence, selectFareByPolicy(thsrFareOptions(rawFare), policy), "THSR_FARE_POLICY_NOT_MATCHED");
      } else {
        const policy = { passengerType: "ADULT", ticketType: "FULL_FARE", fareClass: "LOCAL", cabinClass: "STANDARD" };
        evidence = attachFare(evidence, selectFareByPolicy(traFareOptions(rawFare), policy), "TRA_FARE_POLICY_NOT_MATCHED");
      }
      evidenceByKey.set(reference.validationKey, evidence);
    } else {
      const context: ValidationContext = { retrievedAt, endpointName: "BUS_V2_DAILY_STOP_TIMETABLE", sourceUrl: sourceUrl(busDailyPath) };
      evidenceByKey.set(reference.validationKey, validateBusTimetable(reference.query, busRoutes, busTimetables, context));
    }
  }

  const updatedCandidates = snapshot.candidates.map((candidate) => {
    const candidateReferences = references.filter((reference) => reference.candidateId === candidate.id);
    const evidenceByStep = new Map(candidateReferences.map((reference) => [reference.step.id, evidenceByKey.get(reference.validationKey)!]));
    const candidateWithIdentity: CandidateJourney = {
      ...candidate,
      steps: candidate.steps?.map((step) => {
        const evidence = evidenceByStep.get(step.id);
        return step.type === "RIDE" && evidence ? { ...step, service: enrichedService(step, evidence) } : step;
      }),
    };
    return recomputeCandidateWithEvidence(candidateWithIdentity, evidenceByStep, 180).candidate;
  });
  const resolutions = updatedCandidates.map((candidate) => resolveCandidate(candidate));
  const gates = evaluateFormalRecommendationGates(updatedCandidates, resolutions);
  const effective = updatedCandidates.filter((candidate) => {
    const resolution = resolutions.find((entry) => entry.candidateId === candidate.id)?.resolution;
    return resolution === "VALIDATED_FEASIBLE" || resolution === "VALIDATED_RISKY";
  });
  const provisionalFastest = rankFastest(effective);
  const provisionalBalanced = rankBalanced(effective);
  const updatedSnapshot = {
    ...snapshot,
    schemaVersion: "1.1.0",
    candidates: updatedCandidates,
    validationRetrievedAt: retrievedAt,
    formalRecommendationStatus: gates.formalRecommendationStatus,
    formalRecommendations: gates,
    candidateResolutions: resolutions.map(({ connection, ...resolution }) => ({ ...resolution, connection })),
    provisionalSelections: {
      fastestCandidateId: provisionalFastest?.id ?? null,
      balancedCandidateId: provisionalBalanced?.candidate.id ?? null,
      cheapestCandidateId: null,
      label: "PROVISIONAL_AMONG_VALIDATED_CANDIDATES",
    },
  };
  const updatedReferences = rideReferences(updatedCandidates);
  const inventory = coverageInventory(updatedCandidates, updatedReferences, retrievedAt);
  const modeValidation = {
    schemaVersion: "1.0.0",
    retrievedAt,
    timezone: TIMEZONE,
    deduplicatedValidationKeyCount: evidenceByKey.size,
    validations: [...evidenceByKey.entries()].map(([validationKey, evidence]) => ({
      validationKey,
      candidateIds: [...new Set(references.filter((reference) => reference.validationKey === validationKey).map((reference) => reference.candidateId))],
      rideStepIds: [...new Set(references.filter((reference) => reference.validationKey === validationKey).map((reference) => reference.step.id))],
      evidence,
    })),
  };
  const fares = {
    schemaVersion: "1.0.0",
    retrievedAt,
    timezone: TIMEZONE,
    policies: {
      THSR: { passengerType: "ADULT", ticketType: "FULL_FARE", fareClass: "ADULT", cabinClass: "STANDARD_RESERVED", numericCodes: { TicketType: 1, FareClass: 1, CabinClass: 1 } },
      TRA: { passengerType: "ADULT", ticketType: "FULL_FARE", fareClass: "LOCAL", cabinClass: "STANDARD", providerTicketType: "成普", applicableTrainTypes: ["區間", "區間快"] },
      BUS: { status: "UNKNOWN", reasonCode: "BUS_FARE_DATA_NOT_INCLUDED_IN_VALIDATED_ENDPOINTS" },
    },
    services: [...evidenceByKey.entries()].map(([validationKey, evidence]) => ({ validationKey, fareTwd: evidence.fareTwd, fareCoverage: evidence.fareCoverage, ticketType: evidence.ticketType, fareClass: evidence.fareClass, cabinClass: evidence.cabinClass })),
    candidates: updatedCandidates.map((candidate) => ({ candidateId: candidate.id, totalJourneyCostTwd: candidate.totalCost, fareCoverage: candidate.costCoverage })),
  };
  const allRides = updatedCandidates.flatMap((candidate) => candidate.steps?.filter((step) => step.type === "RIDE") ?? []);
  const resolutionCount = (value: string) => resolutions.filter((resolution) => resolution.resolution === value).length;
  const validationSummary = {
    schemaVersion: "1.0.0",
    retrievedAt,
    totals: {
      candidateCount: updatedCandidates.length,
      transitLegCount: allRides.length,
      deduplicatedValidationKeys: evidenceByKey.size,
      exactScheduleVerifiedLegs: allRides.filter((ride) => ride.validationEvidence?.validationStatus === "VERIFIED" && ride.validationEvidence.dataQuality === "EXACT_SCHEDULE").length,
      estimatedOnlyLegs: allRides.filter((ride) => ride.validationEvidence?.dataQuality === "STOP_LEVEL_TIMETABLE" && ride.validationEvidence.validationStatus !== "VERIFIED").length,
      unknownLegs: allRides.filter((ride) => ride.validationEvidence?.validationStatus === "UNKNOWN").length,
      fareCompleteCandidates: updatedCandidates.filter((candidate) => candidate.costCoverage === "COMPLETE").length,
      fareIncompleteCandidates: updatedCandidates.filter((candidate) => candidate.costCoverage !== "COMPLETE").length,
      validatedFeasibleCandidates: resolutionCount("VALIDATED_FEASIBLE"),
      validatedRiskyCandidates: resolutionCount("VALIDATED_RISKY"),
      validatedImpossibleCandidates: resolutionCount("VALIDATED_IMPOSSIBLE"),
      unknownCandidates: resolutionCount("UNKNOWN"),
    },
    candidateResolutions: resolutions,
    formalRecommendations: gates,
  };
  const sources = [
    ...(manifest.sources ?? []).filter((source: JsonObject) => source.provider !== "TDX" || !["Rail", "Bus"].includes(source.apiFamily)),
    { provider: "TDX", apiFamily: "Rail", apiVersion: "v2", endpointName: "TrainDates", normalizedQuery: { serviceDate: SERVICE_DATE, systems: ["THSR", "TRA"] }, sourceAttribution: "Transportation Data eXchange (TDX), Ministry of Transportation and Communications, Taiwan" },
    { provider: "TDX", apiFamily: "Rail", apiVersion: "v2", endpointName: "DailyTimetable OD", normalizedQuery: { serviceDate: SERVICE_DATE, uniqueOdQueries: railOdKeys.length }, sourceAttribution: "Transportation Data eXchange (TDX), Ministry of Transportation and Communications, Taiwan" },
    { provider: "TDX", apiFamily: "Rail", apiVersion: "v2", endpointName: "ODFare", normalizedQuery: { uniqueOdQueries: railOdKeys.length }, sourceAttribution: "Transportation Data eXchange (TDX), Ministry of Transportation and Communications, Taiwan" },
    { provider: "TDX", apiFamily: "Bus", apiVersion: "v2", endpointName: "StopOfRoute/DailyStopTimeTable/Schedule", normalizedQuery: { city: "Taoyuan", routeName: "208A", serviceDate: SERVICE_DATE }, sourceAttribution: "Transportation Data eXchange (TDX), Ministry of Transportation and Communications, Taiwan" },
  ];
  const updatedManifest = {
    ...manifest,
    retrievedAt,
    maasRetrievedAt: snapshot.retrievedAt,
    provider: "TDX",
    apiFamilies: ["MaaS", "Rail v2", "Bus v2"],
    candidateIdsCovered: updatedCandidates.map((candidate) => candidate.id),
    normalizerVersion: NORMALIZER_VERSION,
    validatorVersion: VALIDATOR_VERSION,
    sources,
    artifacts: ["places.json", "goal-access.json", "maas-candidates.json", "candidate-service-inventory.json", "mode-validation.json", "fares.json", "validation-summary.json"],
    dataDisclaimer: "Frozen official-data snapshot, not live operations. Bus stop times with TimeType=0 are estimated scheduled times and are not real-time ETA. UNKNOWN is not IMPOSSIBLE. Fare null means not proven, never zero.",
    knownGaps: ["Four Taoyuan 208A legs lack a unique stop-level fixed-timetable match and have no validated fare.", "The MaaS 12:15 Zuoying-to-Banqiao THSR leg lacks a unique Rail v2 match on the frozen service date.", "No Kaohsiung city bus, intercity bus, or MRT leg appears in the frozen ten candidates."],
    formalRecommendationStatus: gates.formalRecommendationStatus,
    formalRecommendations: gates,
    provisionalSelections: updatedSnapshot.provisionalSelections,
  };

  await Promise.all([
    writeFile(candidatePath, `${JSON.stringify(updatedSnapshot, null, 2)}\n`, "utf8"),
    writeFile(manifestPath, `${JSON.stringify(updatedManifest, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputDirectory, "candidate-service-inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputDirectory, "mode-validation.json"), `${JSON.stringify(modeValidation, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputDirectory, "fares.json"), `${JSON.stringify(fares, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputDirectory, "validation-summary.json"), `${JSON.stringify(validationSummary, null, 2)}\n`, "utf8"),
  ]);
  return validationSummary;
}

async function main(): Promise<void> {
  const summary = await validateExistingCorridorSnapshot(process.argv[2] ?? SNAPSHOT_DIRECTORY);
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
