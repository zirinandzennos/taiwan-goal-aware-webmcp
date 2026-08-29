/**
 * Provider-neutral, trip-scoped contracts for the future Journey Engine.
 * These types deliberately contain no account, identity, or persistent-history data.
 */

export type TransportMode =
  | "WALK"
  | "BUS"
  | "MRT"
  | "TRA"
  | "THSR"
  | "BIKE"
  | "TAXI"
  | "CAR"
  | "SCOOTER";

export type JourneyPolicyPreset =
  | "FASTEST"
  | "BALANCED"
  | "CHEAPEST"
  | "LEISURE"
  | "DEADLINE_CRITICAL";

export type TravelerDataSource =
  | "USER_STATED"
  | "CURRENT_REQUEST"
  | "PAGE_STATE"
  | "UNKNOWN";

/** A value and the trip-scoped source that supplied it. Never use AI_GUESSED. */
export interface KnownUnknown<T> {
  value: T;
  source: TravelerDataSource;
}

export interface PlaceInput {
  text: string;
  canonicalPlaceId?: string;
}

export type Luggage = "NONE" | "LIGHT" | "LARGE" | "UNKNOWN";
export type TripPurpose = "BUSINESS" | "LEISURE" | "ERRAND" | "COMMUTE" | "UNKNOWN";
export type PriorityLevel = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
export type Availability = "YES" | "NO" | "UNKNOWN";

/** Information relevant only to the journey currently being planned. */
export interface TravelerState {
  luggage: KnownUnknown<Luggage>;
  purpose: KnownUnknown<TripPurpose>;
  speedPriority: KnownUnknown<PriorityLevel>;
  costSensitivity: KnownUnknown<PriorityLevel>;
  ownsCar: KnownUnknown<Availability>;
  ownsScooter: KnownUnknown<Availability>;
  canUseBike: KnownUnknown<Availability>;
  willingToUseTaxi: KnownUnknown<Availability>;
}

/** Hard limits. A future engine filters these before applying policy weights. */
export interface JourneyConstraints {
  arriveBy?: string;
  maxWalkingMinutes?: number;
  maxTransfers?: number;
  budgetLimit?: number;
  avoidTaxi?: boolean;
  allowedModes?: TransportMode[];
  forbiddenModes?: TransportMode[];
}

/** Lightweight trip preferences; these are not a persistent user profile. */
export interface JourneyPreferences {
  luggage?: "NONE" | "NORMAL" | "BULKY";
}

export type JourneyActivityType = "MEAL" | "REST" | "CUSTOM";

export interface JourneyActivityRequest {
  type: JourneyActivityType;
  durationMinutes: number;
  preferredLocation?: string;
  earliestStartAt?: string;
  latestEndAt?: string;
}

/**
 * Canonical, resolved domain input. WebMCP adapters must merge explicit AI
 * arguments and page state before they create this request.
 */
export interface JourneyRequest {
  originId: string;
  destinationId: string;
  origin: PlaceInput;
  destination: PlaceInput;
  departAt: string;
  travelerState: TravelerState;
  preferences: JourneyPreferences;
  policy: JourneyPolicyPreset;
  constraints: JourneyConstraints;
  activities: JourneyActivityRequest[];
}

export type JourneyNodeKind =
  | "PLACE"
  | "BUS_STOP"
  | "MRT_STATION"
  | "RAIL_STATION"
  | "THSR_STATION"
  | "BIKE_STATION"
  | "PARKING";

export interface JourneyNode {
  id: string;
  name: string;
  kind: JourneyNodeKind;
  latitude?: number;
  longitude?: number;
}

/** TransitStop is an equivalent name where a JourneyNode is specifically a stop. */
export type TransitStop = JourneyNode;

export interface ScheduledService {
  id: string;
  mode: TransportMode;
  fromNodeId: string;
  toNodeId: string;
  departureAt: string;
  arrivalAt: string;
  cost: number;
  routeId?: string;
  operator?: string;
  serviceName?: string;
}

/**
 * Kept as the earlier contract name; all scheduled provider data uses the
 * canonical ScheduledService shape.
 */
export type TransitService = ScheduledService;

/** An explicit transfer policy, including same-node transfer buffers. */
export interface TransferRule {
  fromNodeId: string;
  toNodeId: string;
  /** Deterministic walking time from arrival point to the next boarding point. */
  walkingMinutes: number;
  /** Mandatory operational buffer applied after walking; never walking time. */
  minimumTransferMinutes: number;
}

export interface TravelLeg {
  type: "TRAVEL";
  mode: TransportMode;
  fromNodeId: string;
  toNodeId: string;
  departAt: string;
  arriveAt: string;
  durationMinutes: number;
  /** The source scheduled service used to build this leg. */
  serviceId: string;
  walkingMinutes?: number;
  estimatedCost: number;
}

export interface ActivityLeg {
  type: "ACTIVITY";
  activityType: JourneyActivityType;
  locationNodeId: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
}

export type JourneyLeg = TravelLeg | ActivityLeg;

export interface JourneyCandidate {
  id: string;
  originId: string;
  destinationId: string;
  legs: JourneyLeg[];
  departAt: string;
  arriveAt: string;
  totalDurationMinutes: number;
  /** Time after completing transfer preparation and before the next departure. */
  totalWaitingMinutes: number;
  /** Walking plus mandatory buffer across each service-to-service transfer. */
  totalTransferMinutes: number;
  /** Walking is tracked separately from mandatory transfer buffers and waiting. */
  totalWalkingMinutes: number;
  /** Null only when no transfer is needed; direct journeys are lowest transfer risk. */
  minimumTransferSlackMinutes: number | null;
  /** Feasible transfers with fewer than five minutes of slack. */
  tightTransferCount: number;
  totalCost: number;
  walkingMinutes: number;
  transferCount: number;
  /** Kept for the earlier result contract; candidate generation sets it to totalCost. */
  estimatedCost: number;
  connectionRiskScore: number;
  /** Future ranking output; this contract does not calculate it. */
  policyScore?: number;
}

/** Canonical candidate journey assembled from scheduled services. */
export type CandidateJourney = JourneyCandidate;

export interface JourneyScoreBreakdown {
  durationPenalty: number;
  costPenalty: number;
  transferPenalty: number;
  walkingPenalty: number;
  riskPenalty: number;
  weightedDuration: number;
  weightedCost: number;
  weightedTransfers: number;
  weightedWalking: number;
  weightedRisk: number;
  totalScore: number;
}

export interface RankedJourney {
  candidate: CandidateJourney;
  rank: number;
  score: number;
  scoreBreakdown: JourneyScoreBreakdown;
}

export interface JourneyRecommendations {
  fastest: CandidateJourney | null;
  cheapest: CandidateJourney | null;
  balanced: RankedJourney | null;
}

export type FeasibilityStatus = "FEASIBLE" | "RISKY" | "IMPOSSIBLE" | "UNKNOWN";

export type JourneyFeasibilityReasonCode =
  | "JOURNEY_MEETS_CONSTRAINTS"
  | "MEETS_DEADLINE_WITH_BUFFER"
  | "INSUFFICIENT_ARRIVAL_BUFFER"
  | "TIGHT_TRANSFER"
  | "ARRIVAL_AFTER_HARD_DEADLINE"
  | "NO_EXECUTABLE_JOURNEY"
  | "REQUIRED_DEADLINE_UNAVAILABLE"
  | "REQUIRED_JOURNEY_DATA_UNAVAILABLE"
  | "INVALID_REQUIRED_TIMESTAMP";

export type JourneyDataAvailability = "AVAILABLE" | "UNAVAILABLE";

/**
 * Explicit data state supplied by a future adapter. Omitted fields mean that
 * no deadline was requested and the fixed Challenge timetable is complete.
 */
export interface JourneyFeasibilityContext {
  journeyDataAvailability?: JourneyDataAvailability;
  deadlineRequired?: boolean;
  deadlineAt?: string | null;
  deadlineAvailability?: JourneyDataAvailability;
}

export interface CandidateFeasibility {
  candidateId: string;
  status: FeasibilityStatus;
  arrivalAt: string;
  deadlineAt: string | null;
  deadlineMarginMinutes: number | null;
  minimumTransferSlackMinutes: number | null;
  reasonCodes: JourneyFeasibilityReasonCode[];
}

export interface JourneyFeasibilityResult {
  status: FeasibilityStatus;
  candidateFeasibilities: CandidateFeasibility[];
  reasonCodes: JourneyFeasibilityReasonCode[];
}

/** The timetable origin is explicit so callers never mistake demo data for live travel data. */
export type JourneyTimetableMode = "SYNTHETIC_FIXED_TIMETABLE" | "PROVIDER_NORMALIZED";

export interface JourneyPlanningContext extends JourneyFeasibilityContext {
  timetable: readonly ScheduledService[];
  transferRules: readonly TransferRule[];
  timetableMode: JourneyTimetableMode;
}

export interface JourneyOption {
  candidate: CandidateJourney;
  feasibility: CandidateFeasibility;
  rank?: number;
  score?: number;
  scoreBreakdown?: JourneyScoreBreakdown;
}

export interface JourneyPlanResult {
  status: FeasibilityStatus;
  candidateCount: number;
  fastest: JourneyOption | null;
  cheapest: JourneyOption | null;
  balanced: JourneyOption | null;
  reasonCodes: JourneyFeasibilityReasonCode[];
  timetableMode: JourneyTimetableMode;
}

export interface JourneyCurrentState {
  nodeId: string;
  at: string;
}

export interface JourneyReplanRequest {
  originalRequest: JourneyRequest;
  currentState: JourneyCurrentState;
}

export type JourneyReplanReasonCode =
  | "CURRENT_NODE_NOT_IN_TIMETABLE"
  | "INVALID_CURRENT_TIMESTAMP"
  | "ALREADY_AT_DESTINATION";

export interface JourneyReplanResult {
  previousOriginId: string;
  currentNodeId: string;
  replannedAt: string;
  request: JourneyRequest | null;
  plan: JourneyPlanResult | null;
  alreadyAtDestination: boolean;
  reasonCodes: JourneyReplanReasonCode[];
  clarification?: ClarificationRequest;
}

export interface ClarificationRequest {
  field: string;
  question: string;
  reason: string;
}

export interface JourneyResult {
  status: FeasibilityStatus;
  recommended: JourneyCandidate | null;
  alternatives: JourneyCandidate[];
  warnings: string[];
  reasonCodes: string[];
  clarification?: ClarificationRequest;
}
