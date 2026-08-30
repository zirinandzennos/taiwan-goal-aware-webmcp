import type {
  JourneyNode,
  JourneyPlanningContext,
  ScheduledService,
  TransferRule,
} from "./types";
import { createIndexedTimetableStore } from "./timetableStore";

/** SYNTHETIC CHALLENGE FIXTURE — NOT REAL OPERATIONAL TRANSPORT INFORMATION. */
export const SYNTHETIC_CHALLENGE_FIXTURE_NOTICE =
  "SYNTHETIC CHALLENGE FIXTURE — NOT REAL OPERATIONAL TRANSPORT INFORMATION.";

export const syntheticJourneyNodes: JourneyNode[] = [
  { id: "kaohsiung-xiaogang", name: "Kaohsiung Xiaogang", kind: "PLACE" },
  { id: "xiaogang-mrt", name: "Xiaogang MRT", kind: "MRT_STATION" },
  { id: "zuoying-mrt", name: "Zuoying MRT", kind: "MRT_STATION" },
  { id: "zuoying-thsr", name: "Zuoying THSR", kind: "THSR_STATION" },
  { id: "taoyuan-thsr", name: "Taoyuan THSR", kind: "THSR_STATION" },
  { id: "taoyuan-bus", name: "Taoyuan Transfer Stop", kind: "BUS_STOP" },
  { id: "taoyuan-bade", name: "Bade, Taoyuan", kind: "PLACE" },
];

export const syntheticTransferRules: TransferRule[] = [
  // SYNTHETIC CHALLENGE VALUES: short local transfer, 3 walking + 3 buffer.
  { fromNodeId: "xiaogang-mrt", toNodeId: "xiaogang-mrt", walkingMinutes: 3, minimumTransferMinutes: 3 },
  // SYNTHETIC CHALLENGE VALUES: medium interchange, 8 walking + 5 buffer.
  { fromNodeId: "zuoying-mrt", toNodeId: "zuoying-thsr", walkingMinutes: 8, minimumTransferMinutes: 5 },
  { fromNodeId: "zuoying-thsr", toNodeId: "zuoying-thsr", walkingMinutes: 0, minimumTransferMinutes: 5 },
  { fromNodeId: "taoyuan-thsr", toNodeId: "taoyuan-thsr", walkingMinutes: 0, minimumTransferMinutes: 3 },
  // SYNTHETIC CHALLENGE VALUES: long interchange, 12 walking + 5 buffer.
  { fromNodeId: "taoyuan-thsr", toNodeId: "taoyuan-bus", walkingMinutes: 12, minimumTransferMinutes: 5 },
  { fromNodeId: "taoyuan-bus", toNodeId: "taoyuan-bus", walkingMinutes: 0, minimumTransferMinutes: 3 },
];

export const syntheticScheduledServices: ScheduledService[] = [
  { id: "taxi-xiaogang-0700", mode: "TAXI", routeId: "S-TAXI-1", fromNodeId: "kaohsiung-xiaogang", toNodeId: "zuoying-thsr", departureAt: "2030-06-15T07:00:00+08:00", arrivalAt: "2030-06-15T07:50:00+08:00", cost: 750 },
  { id: "bus-xiaogang-0705", mode: "BUS", routeId: "S-BUS-1", fromNodeId: "kaohsiung-xiaogang", toNodeId: "xiaogang-mrt", departureAt: "2030-06-15T07:05:00+08:00", arrivalAt: "2030-06-15T07:15:00+08:00", cost: 25 },
  { id: "bus-xiaogang-0720", mode: "BUS", routeId: "S-BUS-1", fromNodeId: "kaohsiung-xiaogang", toNodeId: "xiaogang-mrt", departureAt: "2030-06-15T07:20:00+08:00", arrivalAt: "2030-06-15T07:30:00+08:00", cost: 25 },
  { id: "bus-xiaogang-1655", mode: "BUS", routeId: "S-BUS-1", fromNodeId: "kaohsiung-xiaogang", toNodeId: "xiaogang-mrt", departureAt: "2030-06-15T16:55:00+08:00", arrivalAt: "2030-06-15T17:10:00+08:00", cost: 25 },
  { id: "mrt-xiaogang-0718", mode: "MRT", routeId: "S-MRT-1", fromNodeId: "xiaogang-mrt", toNodeId: "zuoying-mrt", departureAt: "2030-06-15T07:18:00+08:00", arrivalAt: "2030-06-15T07:58:00+08:00", cost: 45 },
  { id: "mrt-xiaogang-0725", mode: "MRT", routeId: "S-MRT-1", fromNodeId: "xiaogang-mrt", toNodeId: "zuoying-mrt", departureAt: "2030-06-15T07:25:00+08:00", arrivalAt: "2030-06-15T08:05:00+08:00", cost: 45 },
  { id: "mrt-xiaogang-0737", mode: "MRT", routeId: "S-MRT-1", fromNodeId: "xiaogang-mrt", toNodeId: "zuoying-mrt", departureAt: "2030-06-15T07:37:00+08:00", arrivalAt: "2030-06-15T08:17:00+08:00", cost: 45 },
  { id: "mrt-xiaogang-1650", mode: "MRT", routeId: "S-MRT-1", fromNodeId: "xiaogang-mrt", toNodeId: "zuoying-mrt", departureAt: "2030-06-15T16:50:00+08:00", arrivalAt: "2030-06-15T17:25:00+08:00", cost: 45 },
  { id: "thsr-zuoying-0808", mode: "THSR", routeId: "S-THSR-1", fromNodeId: "zuoying-thsr", toNodeId: "taoyuan-thsr", departureAt: "2030-06-15T08:08:00+08:00", arrivalAt: "2030-06-15T09:38:00+08:00", cost: 1_300 },
  { id: "thsr-zuoying-0830", mode: "THSR", routeId: "S-THSR-1", fromNodeId: "zuoying-thsr", toNodeId: "taoyuan-thsr", departureAt: "2030-06-15T08:30:00+08:00", arrivalAt: "2030-06-15T10:00:00+08:00", cost: 1_300 },
  { id: "thsr-zuoying-1734", mode: "THSR", routeId: "S-THSR-1", fromNodeId: "zuoying-thsr", toNodeId: "taoyuan-thsr", departureAt: "2030-06-15T17:34:00+08:00", arrivalAt: "2030-06-15T19:04:00+08:00", cost: 1_300 },
  { id: "thsr-zuoying-1742", mode: "THSR", routeId: "S-THSR-1", fromNodeId: "zuoying-thsr", toNodeId: "taoyuan-thsr", departureAt: "2030-06-15T17:42:00+08:00", arrivalAt: "2030-06-15T19:12:00+08:00", cost: 1_300 },
  { id: "thsr-zuoying-1755", mode: "THSR", routeId: "S-THSR-1", fromNodeId: "zuoying-thsr", toNodeId: "taoyuan-thsr", departureAt: "2030-06-15T17:55:00+08:00", arrivalAt: "2030-06-15T19:25:00+08:00", cost: 1_300 },
  { id: "bus-taoyuan-0950", mode: "BUS", routeId: "S-BUS-2", fromNodeId: "taoyuan-bus", toNodeId: "taoyuan-bade", departureAt: "2030-06-15T09:50:00+08:00", arrivalAt: "2030-06-15T10:20:00+08:00", cost: 30 },
  { id: "bus-taoyuan-1010", mode: "BUS", routeId: "S-BUS-2", fromNodeId: "taoyuan-bus", toNodeId: "taoyuan-bade", departureAt: "2030-06-15T10:10:00+08:00", arrivalAt: "2030-06-15T10:40:00+08:00", cost: 30 },
  { id: "taxi-taoyuan-0945", mode: "TAXI", routeId: "S-TAXI-1", fromNodeId: "taoyuan-thsr", toNodeId: "taoyuan-bade", departureAt: "2030-06-15T09:45:00+08:00", arrivalAt: "2030-06-15T10:10:00+08:00", cost: 550 },
  { id: "bus-taoyuan-1922", mode: "BUS", routeId: "S-BUS-2", fromNodeId: "taoyuan-bus", toNodeId: "taoyuan-bade", departureAt: "2030-06-15T19:22:00+08:00", arrivalAt: "2030-06-15T19:52:00+08:00", cost: 30 },
  { id: "bus-taoyuan-1935", mode: "BUS", routeId: "S-BUS-2", fromNodeId: "taoyuan-bus", toNodeId: "taoyuan-bade", departureAt: "2030-06-15T19:35:00+08:00", arrivalAt: "2030-06-15T20:05:00+08:00", cost: 30 },
];

/** Shared fixed Challenge context for both the human UI and WebMCP adapter. */
export const syntheticJourneyPlanningContext: JourneyPlanningContext = {
  timetable: syntheticScheduledServices,
  timetableStore: createIndexedTimetableStore(syntheticScheduledServices),
  transferRules: syntheticTransferRules,
  timetableMode: "SYNTHETIC_FIXED_TIMETABLE",
  dataSnapshot: {
    snapshotId: "synthetic-2030-challenge-fixture",
    periodStart: "2030-06-15T00:00:00+08:00",
    periodEnd: "2030-06-15T23:59:59+08:00",
    sourceLabel: SYNTHETIC_CHALLENGE_FIXTURE_NOTICE,
    actualOperationsClaimed: false,
  },
};
