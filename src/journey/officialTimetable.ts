import snapshotJson from "../data/officialTimetableSnapshot.json";
import manifestJson from "../data/officialTimetableManifest.json";
import { createIndexedTimetableStore } from "./timetableStore";
import type {
  JourneyNode,
  JourneyPlanningContext,
  ScheduledService,
  TransferRule,
} from "./types";

export interface OfficialScheduledService extends ScheduledService {
  serviceRunId: string;
  serviceName: string;
}

interface OfficialTimetableRuntime {
  metadata: {
    snapshotId: string;
    source: string;
    periodStart: string;
    periodEnd: string;
  };
  nodes: Array<{
    id: string;
    name: string;
    kind: JourneyNode["kind"];
    latitude: number | null;
    longitude: number | null;
  }>;
  services: OfficialScheduledService[];
  transferRules: TransferRule[];
}

const runtime = snapshotJson as OfficialTimetableRuntime;

if (runtime.metadata.snapshotId !== manifestJson.snapshotId) {
  throw new Error("Official timetable snapshot and manifest do not match.");
}

export const officialJourneyNodes: readonly JourneyNode[] = runtime.nodes.map((node) => ({
  id: node.id,
  name: node.name,
  kind: node.kind,
  ...(node.latitude === null ? {} : { latitude: node.latitude }),
  ...(node.longitude === null ? {} : { longitude: node.longitude }),
}));

export const officialScheduledServices: readonly OfficialScheduledService[] = runtime.services.map((service) => ({
  ...service,
  timingQuality: "SCHEDULED",
  source: {
    provider: manifestJson.provider,
    retrievedAt: manifestJson.retrievedAt,
    dataMode: "SNAPSHOT",
  },
}));

const servicesById = new Map(officialScheduledServices.map((service) => [service.id, service]));

export function findOfficialService(serviceId: string): OfficialScheduledService | undefined {
  return servicesById.get(serviceId);
}

export function findOfficialNode(nodeId: string): JourneyNode | undefined {
  return officialJourneyNodes.find((node) => node.id === nodeId);
}

export const officialJourneyPlanningContext: JourneyPlanningContext = {
  timetable: officialScheduledServices,
  timetableStore: createIndexedTimetableStore(officialScheduledServices),
  transferRules: runtime.transferRules,
  timetableMode: "PROVIDER_NORMALIZED",
  dataSnapshot: {
    snapshotId: runtime.metadata.snapshotId,
    periodStart: runtime.metadata.periodStart,
    periodEnd: runtime.metadata.periodEnd,
    sourceLabel: runtime.metadata.source,
    actualOperationsClaimed: false,
    retrievedAt: manifestJson.retrievedAt,
  },
};
