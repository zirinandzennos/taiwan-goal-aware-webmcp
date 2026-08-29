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
  avoidTaxi?: boolean;
  allowedModes?: TransportMode[];
  forbiddenModes?: TransportMode[];
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
  origin: PlaceInput;
  destination: PlaceInput;
  departAt: string;
  travelerState: TravelerState;
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

export interface TransitService {
  serviceId: string;
  mode: TransportMode;
  routeId: string;
  fromStopId: string;
  toStopId: string;
  departureAt: string;
  arrivalAt: string;
  operator?: string;
  serviceName?: string;
}

export interface TravelLeg {
  type: "TRAVEL";
  mode: TransportMode;
  fromNodeId: string;
  toNodeId: string;
  departAt: string;
  arriveAt: string;
  durationMinutes: number;
  serviceId?: string;
  walkingMinutes?: number;
  estimatedCost?: number;
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
  legs: JourneyLeg[];
  departAt: string;
  arriveAt: string;
  totalDurationMinutes: number;
  walkingMinutes: number;
  transferCount: number;
  estimatedCost: number;
  connectionRiskScore: number;
  /** Future ranking output; this contract does not calculate it. */
  policyScore?: number;
}

export type FeasibilityStatus = "FEASIBLE" | "RISKY" | "IMPOSSIBLE" | "UNKNOWN";

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
