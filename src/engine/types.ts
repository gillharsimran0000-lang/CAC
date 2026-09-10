/**
 * Core types for the CivicFlow simulation.
 *
 * The organising idea is `Measured`: a number never travels through this system
 * naked. It carries its unit, where it came from, and -- crucially -- the
 * numbers it was derived from. That makes the spec's labelling requirement
 * structural rather than a matter of discipline: a component cannot render a
 * value without also having its provenance in hand, and the consequence chain's
 * "click any step to inspect the calculation" is just a walk down `inputs`.
 */

/**
 * VERIFIED  - measured by someone else and reproduced here unchanged
 *             (Census population, OSM geometry, an OSM lane count).
 * MODELLED  - computed by this engine from verified inputs and stated
 *             assumptions. Most outputs are this, and that is fine, as long as
 *             it never claims to be an observation.
 * DEMO      - a placeholder standing in for data we do not have. Unit costs are
 *             the main offender. Never let one of these masquerade as the
 *             other two.
 */
export type Provenance = "verified" | "modelled" | "demo"

export interface Measured<T = number> {
    value: T
    unit: string
    provenance: Provenance
    /** Human-readable citation, shown verbatim in the inspector. */
    source: string
    /** How this value was produced, written so a person can check it by hand. */
    formula?: string
    /** The values this one was computed from. Walked by the step inspector. */
    inputs?: Record<string, Measured<number>>
}

export const measured = (
    value: number,
    unit: string,
    provenance: Provenance,
    source: string,
    extra?: Pick<Measured, "formula" | "inputs">,
): Measured => ({ value, unit, provenance, source, ...extra })

/* --- scenario ---------------------------------------------------------- */

/**
 * Everything a user can do to the model. Each maps to one lever in the UI.
 *
 * The list is short on purpose. Every entry has to be something the engine can
 * carry all the way through to a number, and a lever that produced a plausible
 * label and no change in the physics would be worse than no lever at all. A
 * park, a school and a library are all civic things a person might reasonably
 * want to add, and none of them are here, because this model has no mechanism
 * by which any of them would move an axis.
 *
 * The list grew in two directions, and the second one matters more.
 *
 * Every original lever ADDED something, which quietly made the tool an argument
 * for building. Real planning is at least as often about taking capacity away,
 * or losing it: a road diet, a station closed in a budget round, a county that
 * has been shrinking since 1970. `addResidents` and `expandCorridor` therefore
 * take negative values, and `removeFacility` exists, so the same machinery
 * answers both directions. A model that can only be asked optimistic questions
 * is not a model, it is a brochure.
 *
 * The other direction is the half of the travel model the interface could not
 * reach. `addResidents` moves trip PRODUCTIONS; nothing moved ATTRACTIONS, so
 * every scenario was about where people sleep and none was about where they
 * go. `addJobs` supplies the other end, which is what makes jobs-housing
 * balance expressible at all: the same ten thousand residents score differently
 * depending on whether the work is next to them or an hour away.
 *
 * `upgradeUtility` needed the least new machinery of any of them: infrastructure
 * capacity is already measured as headroom against the dwellings a zone's water,
 * sewer and treatment systems were sized for, so a treatment expansion is simply
 * that design figure going up. It is the counterweight to growth on the same
 * axis, which is what makes a scenario containing both interesting rather than
 * arithmetic.
 *
 * `setSpeedLimit` is the one lever here that makes travel WORSE on purpose and
 * can still be the right answer, which is why it earns its place.
 */
export type Action =
    /** Negative removes residents. The Delta has been doing that for fifty years. */
    | { kind: "addResidents"; zoneGeoid: string; count: number }
    /** Negative is a road diet. Lanes never fall below one each way. */
    | { kind: "expandCorridor"; corridorId: number; addedLanesPerDir: number }
    | { kind: "addFacility"; facilityKind: FacilityKind; lonLat: [number, number] }
    /** Closes an existing station, by its id in the area's facility list. */
    | { kind: "removeFacility"; facilityId: string }
    | { kind: "upgradeUtility"; zoneGeoid: string; dwellings: number }
    /** Destinations, not residents: the other half of the gravity model. */
    | { kind: "addJobs"; zoneGeoid: string; jobs: number }
    /** Posted limit in mph, applied to every link on the corridor. */
    | { kind: "setSpeedLimit"; corridorId: number; mph: number }

/**
 * What kind of thing is being placed.
 *
 * Fire stations and ambulance posts are one mechanism with two names: both are
 * first-response sources in the multi-source search, and NFPA 1710 measures the
 * first arriving unit regardless of which service it belongs to. Naming them
 * separately in the interface is honest because they are different civic
 * decisions; treating them identically in the engine is honest because the
 * model cannot tell them apart.
 *
 * A hospital is a destination, not a source, so it never enters the response
 * field. It is in the union because the facility data contains hospitals.
 */
export type FacilityKind = "fire" | "ems" | "hospital"

/** Facility kinds that answer a call. Hospitals are where you are taken. */
export const RESPONDING_FACILITIES: FacilityKind[] = ["fire", "ems"]

export interface Scenario {
    id: string
    areaId: string
    label: string
    createdAt: number
    actions: Action[]
    /** Version this was derived from, so history can draw the branch. */
    parentId: string | null
}

/* --- results ----------------------------------------------------------- */

/** The five Decision DNA axes. Order is fixed; the UI relies on it. */
export const AXES = [
    "transportation",
    "emergencyAccess",
    "infrastructureCapacity",
    "growthEfficiency",
    "infrastructureBurden",
] as const

export type AxisKey = (typeof AXES)[number]

export interface Axis {
    key: AxisKey
    label: string
    /** 0-100, normalised against the area's scenario-sweep envelope. */
    score: Measured
    /** The physical quantity behind the score, in its own units. */
    raw: Measured
    /** Short, generated, never model-written. */
    read: string
}

export interface CorridorStress {
    corridorId: number
    label: string
    /** Volume-to-capacity, peak hour, worst link on the corridor. */
    baseVc: number
    scenarioVc: number
    baseVolume: number
    scenarioVolume: number
    capacityVph: number
    edgeCount: number
    /** True when the corridor crosses into the stressed band because of this scenario. */
    newlyStressed: boolean
}

/** One link in the consequence chain. Renders as a step; expands to its maths. */
export interface ChainStep {
    id: string
    /** Generated from the numbers, never authored by a model. */
    headline: string
    detail: string
    value: Measured
    /** Whatever the inspector needs to show the working for this step. */
    evidence?: {
        corridors?: CorridorStress[]
        zones?: { geoid: string; name: string; before: number; after: number }[]
    }
}

export interface SimResult {
    scenarioId: string
    areaId: string
    axes: Record<AxisKey, Axis>
    civicImpact: Measured
    chain: ChainStep[]
    corridors: CorridorStress[]
    /** Per-edge v/c for the map, aligned to graph edge order. */
    edgeVc: Float32Array
    baseEdgeVc: Float32Array
    runtimeMs: number
}
