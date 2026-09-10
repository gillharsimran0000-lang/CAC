/**
 * Travel demand and traffic assignment.
 *
 * This is a compressed version of the four-step model that regional planning
 * agencies actually run: generation, distribution, assignment (mode choice is
 * skipped -- Arkansas transit share is low enough that folding it into vehicle
 * occupancy loses little and inventing a mode-choice model would lose more).
 *
 * Every coefficient below is either a published figure or a stated assumption,
 * and each is carried through to the UI as MODELLED rather than presented as an
 * observation. The point is not that these numbers are exactly right -- they are
 * not -- but that a scenario and its baseline are run through identical
 * assumptions, so the *difference* between them is meaningful even where the
 * absolute level is uncertain.
 */

import { Graph, PathScratch, shortestPathTree } from "./graph"

/* --- constants, with their derivations -------------------------------- */

/**
 * Peak-hour vehicle trips produced per resident.
 *
 *   3.4 person-trips per person per day        (NHTS 2017 national average)
 *   x 0.095 share of daily travel in peak hour (typical US urban peak factor)
 *   / 1.67 persons per vehicle                 (NHTS average vehicle occupancy)
 *   = 0.193
 *
 * Held at 0.19. Two significant figures is already more precision than the
 * inputs support.
 */
export const PEAK_TRIPS_PER_RESIDENT = 0.19

/**
 * BPR volume-delay function, Bureau of Public Roads (1964):
 *
 *   t = t0 * (1 + a * (v/c)^b),  a = 0.15, b = 4
 *
 * Still the default in most US regional models. The fourth power is what makes
 * congestion bite suddenly rather than gradually: at v/c = 0.8 travel time is
 * up 6%, at v/c = 1.0 it is up 15%, at v/c = 1.3 it is up 43%.
 */
export const BPR_ALPHA = 0.15
export const BPR_BETA = 4

/**
 * Ceiling on the ratio fed to the BPR curve.
 *
 * A fourth power has no upper bound, and a zone loading more demand than a road
 * can carry produces travel times with no physical meaning -- an early statewide
 * run reported a mean trip of 4.6 million minutes. Beyond about v/c = 4 the road
 * is failed by any measure and the exact number stops carrying information, so
 * the curve is clamped there. Clamping is visible in the output rather than
 * hidden: a link pinned at the ceiling is reported as over capacity, not as a
 * precise delay.
 */
export const BPR_MAX_VC = 4

export function bprTime(freeTimeS: number, volume: number, capacity: number): number {
    const vc = capacity > 0 ? Math.min(volume / capacity, BPR_MAX_VC) : 0
    return freeTimeS * (1 + BPR_ALPHA * Math.pow(vc, BPR_BETA))
}

/**
 * Volume-to-capacity band where a link is described as stressed.
 *
 * 0.85 is the conventional threshold between Highway Capacity Manual level of
 * service C and D -- the point where flow stops being free and small increases
 * in demand start producing large increases in delay.
 */
export const STRESS_VC = 0.85

/**
 * Gravity model deterrence: f(c) = exp(-c / c0), c0 in seconds.
 *
 * This was originally set per area -- 15 minutes for a metro, 45 for the state,
 * on the reasoning that county-sized zones need longer trips. That is backwards.
 * Deterrence describes how far people are willing to travel, which is a fact
 * about people, not about the zone system drawn over them. The flat statewide
 * value let counties trade trips with the far side of Arkansas as if it were a
 * commute, saturating every interstate and producing a 25-hour mean trip.
 *
 * One value now, matched to a US mean one-way journey in the low twenties of
 * minutes. It is the single most load-bearing behavioural parameter here, so it
 * is stated once, in one place, rather than tuned per view.
 */
/**
 * Default deterrence, overridden per area by the calibration step.
 *
 * An earlier version fixed this at one value for every area on the argument
 * that willingness to travel is a fact about people, not about zones. That is
 * true of the underlying behaviour and false of this coefficient: the gravity
 * model here distributes only INTERZONAL trips, so what c0 has to reproduce
 * depends on how much travel the zone system has already absorbed internally.
 * County zones swallow most local movement; block groups swallow almost none.
 * Fitting one number to both left statewide travel wildly over-dispersed.
 *
 * scripts/validate/calibrate.ts solves for it per area against a stated target
 * mean journey and writes the result alongside the envelope, so the value in use
 * is always visible and reproducible rather than tuned by hand until a demo
 * looked right.
 */
const DEFAULT_DETERRENCE_S = 15 * 60

/**
 * Longest journey the peak-hour model will distribute, seconds.
 *
 * An exponential tail never quite reaches zero, and multiplied by the
 * population of a distant metro that tail stops being negligible: rural
 * counties were sending a large share of their peak trips to Little Rock and
 * Northwest Arkansas two and three hours away, which saturated the interstates
 * and inflated the statewide mean trip to five hours against a free-flow 35
 * minutes. Journeys beyond ninety minutes each way are a very small share of US
 * peak-hour travel, and truncating them is standard practice in trip
 * distribution. Intrazonal and short-haul flows absorb the difference.
 */
const MAX_TRIP_S = 90 * 60

/* --- zones ------------------------------------------------------------- */

export interface Zone {
    geoid: string
    name: string
    node: number
    population: number
    housingUnits: number
    areaLandM2: number
    /** Road length inside the zone, metres; the infill-versus-sprawl signal. */
    roadLengthM: number
    roadMPerDwelling: number | null
    /** Where this zone's demand enters the network; weighted by population. */
    connectors: { node: number; weight: number }[]
    centroid: [number, number]
    densityPerKm2: number
    snapDistanceM: number
}

/* --- skim -------------------------------------------------------------- */

/**
 * Zone-to-zone free-flow travel times, in seconds, row-major [origin][dest].
 *
 * Distribution is deliberately skimmed on free-flow rather than congested time
 * and cached for the whole area. Real models iterate the two together, but the
 * feedback mostly redistributes trips a planner did not ask about, and holding
 * impedance fixed means a scenario's change in corridor volume is attributable
 * to the scenario rather than to the distribution shifting underneath it.
 */
export function buildSkim(g: Graph, zones: Zone[], scratch: PathScratch): Float32Array {
    const n = zones.length
    const skim = new Float32Array(n * n)
    const cost = Float64Array.from(g.freeTimeS)
    // Unroutable edges are removed from consideration by pricing them out;
    // the adjacency itself is shared with the display network.
    for (let e = 0; e < g.edgeCount; e++) if (!g.routable[e]) cost[e] = Infinity

    for (let i = 0; i < n; i++) {
        shortestPathTree(g, g.zoneNode[i], cost, scratch)
        for (let j = 0; j < n; j++) {
            const d = scratch.dist[g.zoneNode[j]]
            // Unreachable pairs get a large finite cost so the gravity model
            // assigns them ~0 trips instead of producing NaN.
            skim[i * n + j] = Number.isFinite(d) ? d : 1e9
        }
    }
    return skim
}

/* --- distribution ------------------------------------------------------ */

/**
 * Singly-constrained gravity model.
 *
 *   T_ij = P_i * (A_j * f(c_ij)) / sum_k (A_k * f(c_ik))
 *
 * Attractions use population as an activity proxy. That is the weakest
 * assumption in the model -- jobs are not distributed like residents -- and it
 * is labelled as such wherever it surfaces. It is defensible here because the
 * question asked is always comparative: both baseline and scenario use the same
 * attraction field, so the growth being tested is what moves the answer.
 */
/**
 * Travel time for a trip that begins and ends inside the same zone, seconds.
 *
 * Most travel is local, and at county scale it is overwhelmingly local. Dropping
 * the intrazonal term entirely -- as the first version did -- forces every
 * modelled trip to be an inter-county journey, which saturated the whole
 * Arkansas arterial network and produced a mean trip of 29 hours.
 *
 * The estimate is the standard one: treat the zone as a circle of equal area and
 * take a representative internal trip as two thirds of its radius, at local
 * street speed. A 1,500 km2 county gives about 18 minutes; a 2 km2 block group
 * about 40 seconds. Both are the right order.
 */
const LOCAL_SPEED_MS = 13.4 // ~30 mph

/** Geometric estimate: two thirds of the radius of an equal-area circle. */
export function intrazonalFromArea(areaLandM2: number): number {
    if (!(areaLandM2 > 0)) return 120
    const radiusM = Math.sqrt(areaLandM2 / Math.PI)
    return ((2 / 3) * radiusM) / LOCAL_SPEED_MS
}

/**
 * Intrazonal time as half the journey to the nearest other zone.
 *
 * The purely geometric estimate above has a flaw that only shows at county
 * scale: it assumes local roads, so a large county came out at 21 minutes while
 * the interstate reached the NEXT county's centroid in 15. The model then
 * preferred leaving to staying, and only 18% of statewide travel stayed home
 * where the true figure is upwards of 80%.
 *
 * Taking half the nearest-neighbour time is the conventional fix and is
 * self-consistent by construction: a trip inside a zone cannot cost more than
 * leaving it. The geometric figure is kept as a floor so dense adjacent block
 * groups do not drive intrazonal time to nearly zero.
 */
export function intrazonalTimes(zones: Zone[], skim: Float32Array): Float64Array {
    const n = zones.length
    const out = new Float64Array(n)
    for (let i = 0; i < n; i++) {
        let nearest = Infinity
        for (let j = 0; j < n; j++) {
            if (i === j) continue
            const d = skim[i * n + j]
            if (d < nearest) nearest = d
        }
        const geometric = intrazonalFromArea(zones[i].areaLandM2)
        out[i] = Number.isFinite(nearest) ? Math.max(nearest * 0.5, geometric * 0.25) : geometric
    }
    return out
}

export function distribute(
    zones: Zone[],
    productions: Float64Array,
    skim: Float32Array,
    kind: "state" | "metro",
    deterrenceS: number = DEFAULT_DETERRENCE_S,
    /**
     * Extra attraction per zone, in the same units as population.
     *
     * This is where jobs enter the model, and the unit conversion is the whole
     * assumption: attraction here is a count of reasons to travel somewhere, and
     * one job is taken as one such reason. That is not a claim that a job and a
     * resident generate identical trips -- they do not -- but the field is a
     * relative weight, it is normalised away by the sum below, and the
     * alternative is having no way to say "the work is over here" at all.
     *
     * Stated rather than hidden, and it is the assumption to attack first if a
     * jobs scenario ever looks wrong.
     */
    attractionBoost?: Float64Array,
): Float64Array {
    const n = zones.length
    const trips = new Float64Array(n * n)
    const c0 = deterrenceS
    const attraction = zones.map((z, i) =>
        Math.max(z.population + (attractionBoost?.[i] ?? 0), 1),
    )
    const intrazonal = intrazonalTimes(zones, skim)

    const weights = new Float64Array(n)
    for (let i = 0; i < n; i++) {
        if (productions[i] <= 0) continue
        let total = 0
        for (let j = 0; j < n; j++) {
            /* The self term competes for trips like any other destination, using
               the zone's own internal travel time. That is what lets the model
               decide how much travel is local instead of being told; those trips
               are then held back from assignment, because they never reach the
               arterial network. */
            const cost = i === j ? intrazonal[i] : skim[i * n + j]
            const w = cost > MAX_TRIP_S ? 0 : attraction[j] * Math.exp(-cost / c0)
            weights[j] = w
            total += w
        }
        if (total <= 0) continue
        const scale = productions[i] / total
        for (let j = 0; j < n; j++) {
            if (weights[j] > 0) trips[i * n + j] = weights[j] * scale
        }
    }
    return trips
}

/* --- assignment -------------------------------------------------------- */

/** Slices of demand loaded one at a time, with costs updated between each. */
const SLICES = [0.4, 0.3, 0.2, 0.1]

/**
 * Incremental capacity-restrained assignment.
 *
 * Demand is loaded in decreasing slices, and travel times are recomputed from
 * the BPR curve between slices, so later trips see the congestion earlier trips
 * created and divert around it. This is not a true user equilibrium -- it does
 * not iterate to convergence -- but it is stable, it is what the incremental
 * method is for, and it runs in roughly a second where equilibrium would take
 * a minute in a browser.
 *
 * Returns per-edge peak-hour volume in vehicles.
 */
export function assign(
    g: Graph,
    zones: Zone[],
    trips: Float64Array,
    scratch: PathScratch,
    capacity: Float32Array,
    /**
     * Free-flow time per edge, when the scenario has changed it.
     *
     * A posted speed limit is a change to t0, not to capacity, and the BPR
     * curve multiplies the two independently: a 30 mph arterial that is empty
     * is slower than a 45 mph arterial that is empty, and both degrade by the
     * same factor once they fill. Passing it in rather than mutating the graph
     * keeps the baseline's own times untouched between runs.
     *
     * Note what this does NOT change: the skim. Distribution is deliberately
     * held on baseline free-flow times so a scenario's change in corridor
     * volume is attributable to the scenario rather than to the destinations
     * shifting underneath it. A speed limit therefore changes how traffic is
     * ASSIGNED and how fast an engine gets there, and not where people go.
     */
    freeTimeS: Float32Array | Float64Array = g.freeTimeS,
): Float64Array {
    const n = zones.length
    const volume = new Float64Array(g.edgeCount)
    const cost = new Float64Array(g.edgeCount)
    const load = new Float64Array(g.nodeCount)

    for (const slice of SLICES) {
        // Re-cost the network against everything loaded so far.
        for (let e = 0; e < g.edgeCount; e++) {
            cost[e] = g.routable[e] ? bprTime(freeTimeS[e], volume[e], capacity[e]) : Infinity
        }

        for (let i = 0; i < n; i++) {
            let any = false
            load.fill(0)
            for (let j = 0; j < n; j++) {
                // Intrazonal trips stay on local streets the model does not
                // route over, so they are generated but never assigned.
                if (i === j) continue
                const t = trips[i * n + j]
                if (t > 0) {
                    load[g.zoneNode[j]] += t * slice
                    any = true
                }
            }
            if (!any) continue

            shortestPathTree(g, g.zoneNode[i], cost, scratch)

            // Sweep the settle order backwards: every node is visited after all
            // of its tree descendants, so a single pass pushes each node's load
            // up its parent edge and accumulates the whole path at once.
            const { order, parentEdge, parentNode, settled } = scratch
            for (let k = settled - 1; k >= 0; k--) {
                const u = order[k]
                const l = load[u]
                if (l <= 0) continue
                const pe = parentEdge[u]
                if (pe < 0) continue
                volume[pe] += l
                load[parentNode[u]] += l
                load[u] = 0
            }
        }
    }
    return volume
}

/** Per-edge volume-to-capacity ratio for the current loading. */
export function volumeToCapacity(
    g: Graph,
    volume: Float64Array,
    capacity: Float32Array,
): Float32Array {
    const vc = new Float32Array(g.edgeCount)
    for (let e = 0; e < g.edgeCount; e++) {
        vc[e] = capacity[e] > 0 && g.routable[e] && !g.virtual[e] ? volume[e] / capacity[e] : 0
    }
    return vc
}

/** Congested travel time per edge, the input to emergency response. */
export function congestedTimes(
    g: Graph,
    volume: Float64Array,
    capacity: Float32Array,
    freeTimeS: Float32Array | Float64Array = g.freeTimeS,
): Float64Array {
    const t = new Float64Array(g.edgeCount)
    for (let e = 0; e < g.edgeCount; e++) {
        t[e] = g.routable[e] ? bprTime(freeTimeS[e], volume[e], capacity[e]) : Infinity
    }
    return t
}

/** Metres per second in one mile per hour. */
export const MPH_TO_MS = 0.44704

/**
 * Lowest posted limit the model will accept, mph.
 *
 * Below about fifteen a link stops behaving like a road in a strategic model:
 * every trip diverts off it, and the BPR curve is being asked about a shared
 * space it was never fitted to.
 */
export const MIN_SPEED_MPH = 15
export const MAX_SPEED_MPH = 75
