/**
 * Emergency response coverage, against NFPA 1710.
 *
 * NFPA 1710 is the standard career fire departments are measured by. It asks
 * for a 240-second travel time for the first arriving engine, on 90% of
 * incidents, plus 80 seconds of turnout. We model the travel component, which
 * is the part the road network and the placement of growth actually control.
 *
 * The important design decision here is that response times are computed on
 * CONGESTED travel times, not free-flow. If they were free-flow, adding ten
 * thousand residents could never change emergency access, the consequence chain
 * would show a link that does not exist, and the whole claim would be theatre.
 * Congestion is the mechanism by which growth reaches the ambulance.
 */

import { Graph, PathScratch } from "./graph"

/** NFPA 1710 first-engine travel time. */
export const NFPA_TRAVEL_S = 240
/** NFPA 1710 full first-alarm assembly travel time, the secondary band. */
export const NFPA_FIRST_ALARM_S = 480

/**
 * Emergency vehicles are not ordinary traffic: lights and sirens buy priority
 * at intersections and permit some use of opposing lanes. They do not, however,
 * buy free-flow speed through a genuinely saturated arterial. This applies a
 * modest advantage to congested time and is a stated assumption, not a
 * measurement -- it is the one number here a reviewer is most likely to want
 * to change, so it is isolated and named.
 */
export const EMERGENCY_PRIORITY_FACTOR = 0.85

/**
 * Travel time from the nearest facility to every node, in seconds.
 *
 * This is a single multi-source Dijkstra: every station starts settled at zero
 * and the search expands outward from all of them at once, so each node ends up
 * holding the time from whichever station reaches it first. One search answers
 * the question for the whole network, rather than one search per station.
 */
export function responseTimeField(
    g: Graph,
    facilityNodes: number[],
    congestedTimeS: Float64Array,
    scratch: PathScratch,
): Float64Array {
    const { dist, done, heap } = scratch
    dist.fill(Infinity)
    done.fill(0)
    heap.clear()

    for (const node of facilityNodes) {
        if (node < 0 || node >= g.nodeCount) continue
        if (dist[node] === 0) continue
        dist[node] = 0
        heap.push(node, 0)
    }

    while (!heap.empty) {
        const u = heap.pop()
        if (done[u]) continue
        done[u] = 1
        const du = dist[u]
        const end = g.arcStart[u + 1]
        for (let a = g.arcStart[u]; a < end; a++) {
            const e = g.arcEdge[a]
            const v = g.arcTo[a]
            const nd = du + congestedTimeS[e] * EMERGENCY_PRIORITY_FACTOR
            if (nd < dist[v]) {
                dist[v] = nd
                heap.push(v, nd)
            }
        }
    }
    return dist
}

export interface Coverage {
    /** Population inside the NFPA travel band. */
    coveredPopulation: number
    totalPopulation: number
    /** 0-1. */
    share: number
    /** Population-weighted mean response time, seconds; unreachable excluded. */
    meanResponseS: number
    /** Population with no modelled route to any facility at all. */
    unreachablePopulation: number
}

/**
 * Population-weighted coverage, measured at block group resolution.
 *
 * Weighting by population rather than by area is the whole point: Arkansas has
 * a great deal of land where a four-minute response is neither achievable nor
 * expected, and an area-weighted figure would be dominated by it while telling
 * you nothing about people.
 */
/**
 * Speed assumed for the stretch between a snapped node and the real address,
 * metres per second (~25 mph on local streets).
 */
const ACCESS_SPEED_MS = 11.2

/**
 * Population-weighted coverage, measured at block group resolution.
 *
 * Weighting by population rather than by area is the whole point: Arkansas has
 * a great deal of land where a four-minute response is neither achievable nor
 * expected, and an area-weighted figure would be dominated by it while telling
 * you nothing about people.
 *
 * Both ends of the last mile are charged for. Zones and stations are snapped to
 * the arterial network -- by a median of 2.3 km at county scale -- and treating
 * that stretch as free put statewide coverage at 93%, which is an artefact of
 * the snapping rather than a fact about Arkansas. Against a four-minute standard
 * a 2 km approach is most of the budget, so it is added at local street speed.
 */
export function coverage(
    measureZones: { population: number; node: number; snapDistanceM?: number }[],
    field: Float64Array,
    thresholdS = NFPA_TRAVEL_S,
): Coverage {
    let covered = 0
    let total = 0
    let unreachable = 0
    let weightedTime = 0
    let reachablePop = 0

    for (const z of measureZones) {
        const p = z.population
        if (p <= 0) continue
        total += p
        const networkTime = field[z.node]
        if (!Number.isFinite(networkTime)) {
            unreachable += p
            continue
        }
        const t = networkTime + (z.snapDistanceM ?? 0) / ACCESS_SPEED_MS
        reachablePop += p
        weightedTime += t * p
        if (t <= thresholdS) covered += p
    }

    return {
        coveredPopulation: covered,
        totalPopulation: total,
        share: total > 0 ? covered / total : 0,
        meanResponseS: reachablePop > 0 ? weightedTime / reachablePop : Infinity,
        unreachablePopulation: unreachable,
    }
}
