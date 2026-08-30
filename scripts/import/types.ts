export const SNAPSHOT_PERIOD_START = "2026-08-27T00:00:00+08:00";
export const SNAPSHOT_PERIOD_END = "2026-09-02T23:59:59+08:00";
export const SNAPSHOT_TIMEZONE = "Asia/Taipei";
export const NORMALIZATION_VERSION = "tdx-thsr-v1";

export interface TdxLocalizedName { Zh_tw?: string; En?: string; }
export interface TdxTrainDateList { StartDate: string; EndDate: string; TrainDates: string[]; UpdateTime: string; }
export interface TdxStopTime { StopSequence: number; StationID: string; StationName?: TdxLocalizedName; ArrivalTime?: string | null; DepartureTime: string; }
export interface TdxDailyTimetableRecord { TrainDate: string; DailyTrainInfo: { TrainNo: string; Overnight?: boolean }; StopTimes: TdxStopTime[]; }
export interface NormalizedNode { id: string; name: string; type: "THSR_STATION"; operator: "THSR"; latitude?: number; longitude?: number; }
export interface NormalizedServiceRun { id: string; serviceDate: string; operator: "THSR"; mode: "THSR"; routeId: "THSR_WESTERN_CORRIDOR"; serviceNumber: string; sourceSnapshotId: string; }
export interface NormalizedStopTime { serviceRunId: string; stopSequence: number; nodeId: string; arrivalAt: string; departureAt: string; }
export interface NormalizedTransferRule { fromNodeId: string; toNodeId: string; walkingMinutes: number; minimumTransferMinutes: number; }
export interface SnapshotMetadata { snapshotId: string; source: string; provider: string; dataset: string; retrievedAt: string; periodStart: string; periodEnd: string; timezone: string; license: string; attribution: string; normalizationVersion: string; }
export interface NormalizedTimetableSnapshot { metadata: SnapshotMetadata; nodes: NormalizedNode[]; serviceRuns: NormalizedServiceRun[]; stopTimes: NormalizedStopTime[]; transferRules: NormalizedTransferRule[]; }
