/**
 * Running a scenario end to end.
 *
 * An area is prepared once -- graph, zones, the free-flow skim, and the
 * baseline run -- and then every scenario is evaluated against that same
 * baseline. Preparation is the expensive half (the skim is one shortest-path
 * tree per zone), so it is deliberately separated from evaluation, which is
 * what a user waits on when they drag a slider.
 *
 * Nothing here writes prose. It produces numbers and the derivations behind
 * them; chain.ts turns those into sentences by template.
 */

import { Graph, PathScratch, buildGraph, makeScratch, RawGraph } from "./graph"
import {
    MPH_TO_MS,
    MAX_SPEED_MPH,
    MIN_SPEED_MPH,
    PEAK_TRIPS_PER_RESIDENT,
    STRESS_VC,
    Zone,
    assign,
    buildSkim,
    congestedTimes,
    distribute,
    volumeToCapacity,
} from "./model"
import { NFPA_TRAVEL_S, Coverage, coverage, responseTimeField } from "./emergency"
import {
    AXIS_META,
    Envelope,
    RawMetrics,
    CostBreakdown,
    serviceHeadroom,
    civicImpact,
    costs,
    impliedLocalKm,
    meanTripTime,
    normaliseAxis,
} from "./metrics"
import {
    Action,
    Axis,
    AxisKey,
    AXES,
    CorridorStress,
    Measured,
    RESPONDING_FACILITIES,
    Scenario,
    SimResult,
    measured,
} from "./types"

export interface AreaData {
    graph: RawGraph
    zones: {
        areaId: string
        label: string
        kind: "state" | "metro"
        zoneKind: string
        totals: { zones: number; population: number; facilities: number }
        provenance: Record<string, unknown>
        zones: Zone[]
        measureZones: { geoid: string; population: number; node: number }[]
        facilities: { id: string; kind: string; name: string | null; node: number; lonLat: [number, number] }[]
    }
}

export interface PreparedArea {
    id: string
    label: string
    kind: "state" | "metro"
    g: Graph
    zones: Zone[]
    measureZones: { geoid: string; population: number; node: number; snapDistanceM?: number }[]
    zoneKind: string
    /** Traffic zone geoid -> indices of the block groups inside it. */
    measureIndexByZone: Map<string, number[]>
    measureIndexByGeoid: Map<string, number>
    facilities: AreaData["zones"]["facilities"]
    skim: Float32Array
    scratch: PathScratch
    /** Lane count per edge, mutated copy per scenario when a corridor is widened. */
    baseLanes: number[]
    baseCapacity: Float32Array
    baseline: ScenarioOutcome
    envelope: Envelope
    /** Gravity deterrence in seconds, solved for this area's zone system. */
    deterrenceS: number
}

export interface ScenarioOutcome {
    volume: Float64Array
    vc: Float32Array
    congested: Float64Array
    coverage: Coverage
    totalTrips: number
    /** Inter-zonal trips actually loaded onto the network. */
    assignedTrips: number
    totalPopulation: number
    raw: RawMetrics
    cost: CostBreakdown
    addedResidents: number
    /** Dwellings the scenario bought utility capacity for. */
    upgradedDwellings: number
    /** Trip attraction the scenario added, in jobs. */
    addedJobs: number
    /** Lane-km given up to a road diet. */
    removedLaneKm: number
    /** Corridor km whose posted limit the scenario changed. */
    speedChangedKm: number
    /** Responding stations the scenario closed. */
    closedFacilities: number
}

/* --- scenario application ---------------------------------------------- */

function residentsByZone(actions: Action[]): Map<string, number> {
    const m = new Map<string, number>()
    for (const a of actions) {
        if (a.kind !== "addResidents") continue
        m.set(a.zoneGeoid, (m.get(a.zoneGeoid) ?? 0) + a.count)
    }
    return m
}

/**
 * Dwellings each zone's utilities have been deliberately re-sized for.
 *
 * Two expansions in the same zone add rather than replace, because two plants
 * really are more capacity than one. That is the opposite of how residents
 * accumulate in the draft -- where a second entry for the same zone replaces
 * the first, since two rows saying "growth here" is one decision written twice.
 */
function upgradesByZone(actions: Action[]): Map<string, number> {
    const m = new Map<string, number>()
    for (const a of actions) {
        if (a.kind !== "upgradeUtility") continue
        m.set(a.zoneGeoid, (m.get(a.zoneGeoid) ?? 0) + a.dwellings)
    }
    return m
}

/**
 * Lanes, in both directions.
 *
 * Widening raises capacity on every edge that belongs to the corridor, which is
 * what a corridor project physically is. Free-flow time is left alone: extra
 * lanes buy throughput, not a higher speed limit.
 *
 * A negative count is a road diet, and it goes through the same arithmetic. The
 * only extra rule is a floor of one lane each way, because zero lanes is not a
 * narrower road, it is a closed one, and closing a link is a different question
 * from narrowing it. `addedLaneKm` is therefore computed from the lanes ACTUALLY
 * removed rather than from what was asked for, so a diet on a road that is
 * already single-lane costs nothing and claims nothing.
 */
function applyCorridorWidening(
    p: PreparedArea,
    actions: Action[],
): { capacity: Float32Array; lanes: number[]; addedLaneKm: number; removedLaneKm: number } {
    const capacity = Float32Array.from(p.baseCapacity)
    const lanes = [...p.baseLanes]
    let addedLaneKm = 0
    let removedLaneKm = 0

    for (const a of actions) {
        if (a.kind !== "expandCorridor") continue
        for (let e = 0; e < p.g.edgeCount; e++) {
            if (p.g.virtual[e] || p.g.corridorOf[e] !== a.corridorId) continue
            const perLane = capacity[e] / Math.max(lanes[e], 1)
            const before = lanes[e]
            lanes[e] = Math.max(1, before + a.addedLanesPerDir)
            capacity[e] = lanes[e] * perLane
            const delta = lanes[e] - before
            const km = (p.g.lengthM[e] / 1000) * Math.abs(delta)
            if (delta >= 0) addedLaneKm += km
            else removedLaneKm += km
        }
    }
    return { capacity, lanes, addedLaneKm, removedLaneKm }
}

/**
 * A posted speed limit, as a change to free-flow time.
 *
 * Free-flow time is length over speed, so this is one division. Capacity is
 * left alone, which is the honest reading: a 30 mph limit on a four-lane
 * arterial does not remove a lane, it makes every vehicle on it slower, and the
 * BPR curve then degrades that slower baseline exactly as it degrades a faster
 * one.
 *
 * The effect that makes this lever worth having is downstream: emergency
 * response runs on these same congested times, so a limit that improves one
 * thing can measurably cost another, and the fingerprint shows both.
 */
function applySpeedLimits(
    p: PreparedArea,
    actions: Action[],
): { freeTimeS: Float64Array; changedKm: number } {
    const freeTimeS = Float64Array.from(p.g.freeTimeS)
    let changedKm = 0

    for (const a of actions) {
        if (a.kind !== "setSpeedLimit") continue
        const mph = Math.max(MIN_SPEED_MPH, Math.min(MAX_SPEED_MPH, a.mph))
        for (let e = 0; e < p.g.edgeCount; e++) {
            if (p.g.virtual[e] || p.g.corridorOf[e] !== a.corridorId) continue
            const lengthM = p.g.lengthM[e]
            if (!(lengthM > 0)) continue
            freeTimeS[e] = lengthM / (mph * MPH_TO_MS)
            changedKm += lengthM / 1000
        }
    }
    return { freeTimeS, changedKm }
}

/** Extra trip attraction per zone: where the scenario says the destinations are. */
function jobsByZone(p: PreparedArea, actions: Action[]): { boost: Float64Array; total: number } {
    const boost = new Float64Array(p.zones.length)
    let total = 0
    const index = new Map(p.zones.map((z, i) => [z.geoid, i]))
    for (const a of actions) {
        if (a.kind !== "addJobs") continue
        const i = index.get(a.zoneGeoid)
        if (i == null) continue
        boost[i] += a.jobs
        total += a.jobs
    }
    return { boost, total }
}

/* --- one run ----------------------------------------------------------- */

function runOutcome(p: PreparedArea, actions: Action[]): ScenarioOutcome {
    const added = residentsByZone(actions)
    const upgraded = upgradesByZone(actions)
    const addedResidents = [...added.values()].reduce((s, v) => s + v, 0)
    const upgradedDwellings = [...upgraded.values()].reduce((s, v) => s + v, 0)

    /* Productions scale with the zone population the scenario implies. Clamped
       at zero: a scenario may remove more residents than a zone has, and a
       negative population would produce negative trips and a mean trip time
       with no meaning. */
    const productions = new Float64Array(p.zones.length)
    let totalPopulation = 0
    for (let i = 0; i < p.zones.length; i++) {
        const pop = Math.max(0, p.zones[i].population + (added.get(p.zones[i].geoid) ?? 0))
        totalPopulation += pop
        productions[i] = pop * PEAK_TRIPS_PER_RESIDENT
    }
    const totalTrips = productions.reduce((s, v) => s + v, 0)

    const { capacity, addedLaneKm, removedLaneKm } = applyCorridorWidening(p, actions)
    const { freeTimeS, changedKm: speedKm } = applySpeedLimits(p, actions)
    const { boost, total: addedJobs } = jobsByZone(p, actions)

    const trips = distribute(p.zones, productions, p.skim, p.kind, p.deterrenceS, boost)

    // Mean trip time is vehicle-hours over trips, so the denominator has to be
    // the trips that were actually put on the network -- not the intrazonal
    // ones, which generate no vehicle-hours here.
    let assignedTrips = 0
    for (let i = 0; i < p.zones.length; i++) {
        for (let j = 0; j < p.zones.length; j++) {
            if (i !== j) assignedTrips += trips[i * p.zones.length + j]
        }
    }
    const volume = assign(p.g, p.zones, trips, p.scratch, capacity, freeTimeS)
    const vc = volumeToCapacity(p.g, volume, capacity)
    const congested = congestedTimes(p.g, volume, capacity, freeTimeS)

    /* Extra facilities join the existing set for the response field. A fire
       station and an ambulance post are both first-response sources here: NFPA
       1710 measures the first arriving unit, and the model has no way to tell
       an engine from an ambulance once both are a node in the same search. */
    const closed = new Set(
        actions.flatMap((a) => (a.kind === "removeFacility" ? [a.facilityId] : [])),
    )
    const facilityNodes = p.facilities
        .filter((f) => f.kind !== "hospital" && !closed.has(f.id))
        .map((f) => f.node)
    for (const a of actions) {
        if (a.kind === "addFacility" && RESPONDING_FACILITIES.includes(a.facilityKind)) {
            facilityNodes.push(nearestNode(p.g, a.lonLat[0], a.lonLat[1]))
        }
    }
    const field = responseTimeField(p.g, facilityNodes, congested, p.scratch)

    /* Coverage is population-weighted over block groups, but growth is placed
       into whatever the traffic zone system is -- counties, at state scale. If
       the new residents are not pushed down into the block groups they land in,
       the weights never change and statewide emergency access cannot move at
       all: the sweep caught it as an axis with a range of exactly zero, which
       would have rendered as a permanently central, meaningless DNA vertex.
       County growth is therefore spread across its block groups in proportion
       to the population already there. */
    const measurePop = new Float64Array(p.measureZones.length)
    for (let i = 0; i < p.measureZones.length; i++) measurePop[i] = p.measureZones[i].population

    if (added.size > 0 && p.zoneKind !== "blockgroup") {
        for (const [geoid, count] of added) {
            const members = p.measureIndexByZone.get(geoid)
            if (!members?.length) continue
            let total = 0
            for (const i of members) total += p.measureZones[i].population
            if (total <= 0) continue
            for (const i of members) {
                measurePop[i] += count * (p.measureZones[i].population / total)
            }
        }
    } else if (added.size > 0) {
        for (const [geoid, count] of added) {
            const i = p.measureIndexByGeoid.get(geoid)
            if (i != null) measurePop[i] += count
        }
    }

    const weighted = p.measureZones.map((z, i) => ({ ...z, population: measurePop[i] }))
    const cov = coverage(weighted, field, NFPA_TRAVEL_S)

    const { km: localKm, upgrades } = impliedLocalKm(p.zones, added, upgraded)
    const cost = costs(localKm, addedLaneKm, upgrades, addedResidents, upgradedDwellings)

    /* Growth efficiency and burden are defined for the baseline too, using the
       status quo rather than an increment, so every scenario -- including the
       one with no actions -- has all five axes and therefore a fingerprint. */
    let growthEfficiency: number
    let burdenPerResident: number
    if (addedResidents > 0) {
        growthEfficiency = localKm > 0 ? addedResidents / localKm : addedResidents
        burdenPerResident = (cost.capital + cost.om20) / addedResidents
    } else {
        const existingLocalKm = p.zones.reduce((s, z) => s + z.roadLengthM, 0) / 1000
        growthEfficiency = existingLocalKm > 0 ? totalPopulation / existingLocalKm : 0
        const replacement = costs(existingLocalKm, 0, 0, totalPopulation, upgradedDwellings)
        burdenPerResident = (replacement.capital + replacement.om20) / Math.max(totalPopulation, 1)
    }

    return {
        volume,
        vc,
        congested,
        coverage: cov,
        totalTrips,
        assignedTrips,
        totalPopulation,
        addedResidents,
        upgradedDwellings,
        addedJobs,
        removedLaneKm,
        speedChangedKm: speedKm,
        closedFacilities: closed.size,
        cost,
        raw: {
            meanTripTimeS: meanTripTime(p.g, volume, congested, assignedTrips),
            emergencyShare: cov.share,
            capacityHeadroom: serviceHeadroom(p.zones, added, upgraded),
            growthEfficiency,
            burdenPerResident,
        },
    }
}

/** Nearest REAL node; virtual centroids are not places a station can stand. */
function nearestNode(g: Graph, lon: number, lat: number): number {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < g.raw.counts.nodes; i++) {
        const dx = g.nodeLon[i] - lon
        const dy = g.nodeLat[i] - lat
        const d = dx * dx + dy * dy
        if (d < bestD) {
            bestD = d
            best = i
        }
    }
    return best
}

/* --- preparation ------------------------------------------------------- */

export function prepareArea(
    data: AreaData,
    envelope: Envelope,
    deterrenceS?: number,
): PreparedArea {
    const zones = data.zones.zones
    // Zones reach the network through centroid connectors, so the graph has to
    // be built knowing about them.
    const g = buildGraph(
        data.graph,
        zones.map((z) => z.connectors ?? [{ node: z.node, weight: 1 }]),
    )
    const scratch = makeScratch(g)

    const skim = buildSkim(g, zones, scratch)

    const partial: PreparedArea = {
        id: data.graph.areaId,
        label: data.graph.label,
        kind: data.graph.kind,
        g,
        zones,
        measureZones: data.zones.measureZones,
        zoneKind: data.zones.zoneKind,
        // A block group's GEOID begins with its county's, so the rollup needs
        // no extra field on the wire.
        measureIndexByZone: data.zones.measureZones.reduce((m, z, i) => {
            const key = z.geoid.slice(0, 5)
            const list = m.get(key)
            if (list) list.push(i)
            else m.set(key, [i])
            return m
        }, new Map<string, number[]>()),
        measureIndexByGeoid: new Map(data.zones.measureZones.map((z, i) => [z.geoid, i])),
        facilities: data.zones.facilities,
        skim,
        scratch,
        baseLanes: [...data.graph.edges.lanes],
        baseCapacity: Float32Array.from(g.capacityVph),
        envelope,
        deterrenceS: deterrenceS ?? envelope.deterrenceS ?? 15 * 60,
        baseline: null as unknown as ScenarioOutcome,
    }
    partial.baseline = runOutcome(partial, [])
    return partial
}

/* --- corridor comparison ----------------------------------------------- */

/**
 * Corridor-level stress, baseline against scenario.
 *
 * A corridor is summarised by its worst link rather than its average: a single
 * saturated bottleneck is what a driver experiences and what a project would
 * target, and averaging it against twenty free-flowing kilometres would hide
 * exactly the thing worth reporting.
 */
export function corridorStress(p: PreparedArea, scenario: ScenarioOutcome): CorridorStress[] {
    const reportable = new Map(
        p.g.raw.corridors.filter((c) => c.reportable).map((c) => [c.id, c]),
    )
    const acc = new Map<number, CorridorStress>()

    for (let e = 0; e < p.g.edgeCount; e++) {
        if (!p.g.routable[e] || p.g.virtual[e]) continue
        const cid = p.g.corridorOf[e]
        const meta = reportable.get(cid)
        if (!meta) continue

        let row = acc.get(cid)
        if (!row) {
            row = {
                corridorId: cid,
                label: meta.label,
                baseVc: 0,
                scenarioVc: 0,
                baseVolume: 0,
                scenarioVolume: 0,
                capacityVph: 0,
                edgeCount: 0,
                newlyStressed: false,
            }
            acc.set(cid, row)
        }
        row.edgeCount++
        if (scenario.vc[e] > row.scenarioVc) {
            row.scenarioVc = scenario.vc[e]
            row.baseVc = p.baseline.vc[e]
            row.scenarioVolume = Math.round(scenario.volume[e])
            row.baseVolume = Math.round(p.baseline.volume[e])
            row.capacityVph = p.baseCapacity[e]
        }
    }

    const rows = [...acc.values()]
    for (const r of rows) {
        r.newlyStressed = r.baseVc < STRESS_VC && r.scenarioVc >= STRESS_VC
    }
    return rows.sort((a, b) => b.scenarioVc - a.scenarioVc)
}

/* --- public entry ------------------------------------------------------ */

export function evaluate(p: PreparedArea, scenario: Scenario): {
    outcome: ScenarioOutcome
    axes: Record<AxisKey, Axis>
    civic: Measured
    corridors: CorridorStress[]
} {
    const outcome = runOutcome(p, scenario.actions)
    const axes = {} as Record<AxisKey, Axis>
    const scores = {} as Record<AxisKey, number>

    for (const key of AXES) {
        const meta = AXIS_META[key]
        const rawValue = outcome.raw[meta.rawKey]
        const score = normaliseAxis(key, rawValue, p.envelope)
        scores[key] = score
        axes[key] = {
            key,
            label: meta.label,
            score: measured(score, "score 0-100", "modelled", "normalised against the area envelope", {
                formula: `min-max over ${p.envelope.sampleCount} sampled scenarios (${meta.higherIsBetter ? "higher" : "lower"} raw is better)`,
            }),
            raw: rawMeasure(key, rawValue),
            read: "",
        }
    }

    return { outcome, axes, civic: civicImpact(scores), corridors: corridorStress(p, outcome) }
}

function rawMeasure(key: AxisKey, value: number): Measured {
    switch (key) {
        case "transportation":
            return measured(+(value / 60).toFixed(1), "minutes", "modelled", "vehicle-hours / trips, BPR congested times", {
                formula: "sum(volume x congested time) / total peak trips",
            })
        case "emergencyAccess":
            return measured(+(value * 100).toFixed(1), "% of residents", "modelled", "NFPA 1710 240 s first-engine travel", {
                formula: "population within 240 s of a station on congested times / total population",
            })
        case "infrastructureCapacity":
            return measured(
                +(value * 100).toFixed(1),
                "% headroom",
                "modelled",
                "utility service headroom over 2020 housing stock (HU100)",
                { formula: "population-weighted mean of 1 - (dwellings used / dwellings designed)" },
            )
        case "growthEfficiency":
            return measured(Math.round(value), "residents per km", "modelled", "residents per km of implied local street", {
                formula: "added residents / implied new local street km",
            })
        case "infrastructureBurden":
            return measured(Math.round(value), "$ per resident", "demo", "DEMO unit costs; capital + 20 yr O&M", {
                formula: "(capital + 20 yr O&M) / added residents",
            })
    }
}
