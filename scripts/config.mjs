/**
 * Study areas for CivicFlow.
 *
 * The engine is resolution-agnostic: it consumes a road graph plus a set of
 * demand zones and does not care whether a zone is a county or a block group.
 * That is what lets the statewide view and the metro drill-in share one code
 * path -- only the numbers below change.
 *
 * Bounding boxes are [south, west, north, east], the order Overpass expects.
 */

/**
 * Road classes that carry modelled traffic, coarsest first.
 *
 * The `_link` classes are the ramps and slip roads that connect a motorway to
 * everything else. Leaving them out looks harmless -- they are a rounding error
 * by length -- but it severs every freeway from the network it is supposed to
 * serve, and the model quietly routes all through-traffic onto arterials.
 */
export const ARTERIAL_CLASSES = [
    "motorway", "trunk", "primary", "secondary",
    "motorway_link", "trunk_link", "primary_link", "secondary_link",
]
export const LOCAL_CLASSES = [
    ...ARTERIAL_CLASSES,
    "tertiary", "tertiary_link", "unclassified", "residential",
]

/**
 * Classes the traffic assignment actually routes over.
 *
 * Regional travel models deliberately exclude local streets: they carry access
 * traffic, not through movement, and including them multiplies the shortest-path
 * cost for no gain in corridor-level answers. Residential roads stay in the
 * graph and stay on the map -- they are simply not where the model claims to
 * know what is happening.
 */
export const ROUTABLE_CLASSES = new Set([...ARTERIAL_CLASSES, "tertiary", "tertiary_link"])

/**
 * Per-lane hourly capacity, veh/h/ln, and free-flow speed, mph.
 *
 * Capacities are derated from the Highway Capacity Manual base values -- HCM
 * gives 2400 pc/h/ln for a 70 mph freeway, which we take down to 2000 to cover
 * heavy-vehicle and peak-hour-factor adjustments we do not model individually.
 * Signalised arterials sit near 900 because green time, not the lane, is the
 * binding constraint. These are defaults, used only when OSM has not tagged the
 * road; anything sourced from a real tag is marked VERIFIED downstream.
 */
export const ROAD_DEFAULTS = {
    motorway:     { capacity: 2000, speed: 70, lanes: 2 },
    trunk:        { capacity: 1600, speed: 60, lanes: 2 },
    primary:      { capacity:  900, speed: 45, lanes: 2 },
    secondary:    { capacity:  800, speed: 40, lanes: 1 },
    tertiary:     { capacity:  700, speed: 35, lanes: 1 },
    unclassified: { capacity:  600, speed: 30, lanes: 1 },
    residential:  { capacity:  500, speed: 25, lanes: 1 },
    // Ramps are short, one-way by nature and metered by the merge they feed,
    // so capacity is set by the merge rather than the ramp cross-section.
    motorway_link:  { capacity: 1500, speed: 40, lanes: 1 },
    trunk_link:     { capacity: 1200, speed: 35, lanes: 1 },
    primary_link:   { capacity:  800, speed: 30, lanes: 1 },
    secondary_link: { capacity:  700, speed: 25, lanes: 1 },
    tertiary_link:  { capacity:  600, speed: 25, lanes: 1 },
}

export const STUDY_AREAS = {
    arkansas: {
        id: "arkansas",
        label: "Arkansas",
        kind: "state",
        // Whole-state envelope. Clipped to the real state boundary after fetch.
        bbox: [33.0, -94.62, 36.51, -89.64],
        roadClasses: ARTERIAL_CLASSES,
        // 75 counties. Coarse on purpose: at state scale the question is which
        // region absorbs growth, not which driveway it arrives on.
        zoneLayer: 82,
        zoneKind: "county",
    },
    nwa: {
        id: "nwa",
        label: "Northwest Arkansas",
        kind: "metro",
        // Bentonville - Rogers - Springdale - Fayetteville, the I-49 corridor.
        bbox: [35.95, -94.40, 36.50, -93.90],
        roadClasses: LOCAL_CLASSES,
        zoneLayer: 10,
        zoneKind: "blockgroup",
    },
    "little-rock": {
        id: "little-rock",
        label: "Little Rock",
        kind: "metro",
        bbox: [34.58, -92.60, 34.92, -92.10],
        roadClasses: LOCAL_CLASSES,
        zoneLayer: 10,
        zoneKind: "blockgroup",
    },
}

export const STATE_FIPS = "05"

/** Overpass mirrors, tried in order. The main instance rate-limits hard. */
export const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.jp/api/interpreter",
]
