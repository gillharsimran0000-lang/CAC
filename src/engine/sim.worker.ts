/**
 * Simulation worker.
 *
 * A scenario takes about a second: a few hundred shortest-path trees across
 * four assignment slices, plus a multi-source response search. On the main
 * thread that would freeze the page for exactly as long as the consequence
 * chain is meant to be animating, so the whole engine lives here.
 *
 * Area preparation -- the free-flow skim and the baseline run -- happens once
 * per area and is kept, because it is the expensive half and it never changes.
 * Only `run` messages are on the interactive path.
 */

import { prepareArea, evaluate, PreparedArea, AreaData } from "./simulate"
import { buildChain, findTradeoff } from "./chain"
import { AXES, AxisKey, Scenario } from "./types"
import { AXIS_META } from "./metrics"

type Incoming =
    | { type: "load"; areaId: string }
    | { type: "run"; scenario: Scenario; requestId: number }

let prepared: PreparedArea | null = null
let baseScores: Record<AxisKey, number> | null = null

async function loadArea(areaId: string) {
    const [graph, zones, envelope] = await Promise.all([
        fetch(`/data/${areaId}-graph.json`).then((r) => r.json()),
        fetch(`/data/${areaId}-zones.json`).then((r) => r.json()),
        fetch(`/data/${areaId}-envelope.json`).then((r) => r.json()),
    ])
    const data: AreaData = { graph, zones }
    prepared = prepareArea(data, envelope)

    // The baseline's own axis scores, so every scenario has something to be a
    // change FROM -- including the first one the user runs.
    const baseline = evaluate(prepared, {
        id: "baseline",
        areaId,
        label: "Baseline",
        createdAt: 0,
        actions: [],
        parentId: null,
    })
    baseScores = {} as Record<AxisKey, number>
    for (const k of AXES) baseScores[k] = baseline.axes[k].score.value

    return {
        areaId,
        label: prepared.label,
        kind: prepared.kind,
        zoneKind: (zones as AreaData["zones"]).zoneKind,
        deterrenceS: prepared.deterrenceS,
        envelope,
        totals: (zones as AreaData["zones"]).totals,
        provenance: (zones as AreaData["zones"]).provenance,
        graphCounts: prepared.g.raw.counts,
        baseline: {
            axes: baseline.axes,
            civic: baseline.civic,
            raw: prepared.baseline.raw,
            coverage: prepared.baseline.coverage,
            totalPopulation: prepared.baseline.totalPopulation,
            totalTrips: prepared.baseline.totalTrips,
            assignedTrips: prepared.baseline.assignedTrips,
        },
        // Zones and corridors the UI needs for its controls.
        zones: prepared.zones.map((z) => ({
            geoid: z.geoid,
            name: z.name,
            population: z.population,
            housingUnits: z.housingUnits,
            centroid: z.centroid,
            densityPerKm2: z.densityPerKm2,
            roadMPerDwelling: z.roadMPerDwelling,
        })),
        /* Corridors carry what the interface needs to describe one before it is
           changed: how many lanes it has, what it can carry, and how loaded it
           already is. Summarised by the WORST link rather than the mean, for the
           same reason corridorStress does: a single saturated bottleneck is what
           a driver experiences and what a project would target. */
        corridors: corridorSummaries(prepared),
        facilities: prepared.facilities,
    }
}

/** Per-corridor figures for the interface, from the baseline run. */
function corridorSummaries(p: PreparedArea) {
    const acc = new Map<
        number,
        { lanes: number; capacityVph: number; edges: number; baseVc: number; lon: number; lat: number }
    >()
    const { geomOffset, geomCount } = p.g.raw.edges
    const lonArr = p.g.raw.geometry.lon
    const latArr = p.g.raw.geometry.lat

    for (let e = 0; e < p.g.edgeCount; e++) {
        if (p.g.virtual[e] || !p.g.routable[e]) continue
        const cid = p.g.corridorOf[e]
        if (cid < 0) continue
        const row = acc.get(cid) ?? { lanes: 0, capacityVph: 0, edges: 0, baseVc: 0, lon: 0, lat: 0 }
        row.lanes += p.baseLanes[e]
        row.capacityVph += p.baseCapacity[e]
        row.edges++
        if (p.baseline.vc[e] > row.baseVc) row.baseVc = p.baseline.vc[e]
        /* A representative point, so the interface can say WHERE a corridor is.
           The mean of its links' first vertices: crude for a route that crosses
           the state, exactly right for the ones a person actually picks, and it
           is only ever used to choose which landscape to draw behind it. */
        const o = geomOffset[e]
        if (o != null && geomCount[e] > 0) {
            row.lon += lonArr[o]
            row.lat += latArr[o]
        }
        acc.set(cid, row)
    }

    return p.g.raw.corridors
        .filter((c) => c.reportable)
        .map((c) => {
            const row = acc.get(c.id)
            const n = row && row.edges > 0 ? row.edges : 1
            return {
                ...c,
                lanes: row ? Math.max(1, Math.round(row.lanes / n)) : 1,
                capacityVph: row ? Math.round(row.capacityVph / n) : 0,
                baseVc: row ? +row.baseVc.toFixed(2) : 0,
                lonLat: [row ? row.lon / n : 0, row ? row.lat / n : 0] as [number, number],
            }
        })
}

self.onmessage = async (e: MessageEvent<Incoming>) => {
    const msg = e.data
    try {
        if (msg.type === "load") {
            const payload = await loadArea(msg.areaId)
            ;(self as unknown as Worker).postMessage({ type: "loaded", payload })
            return
        }

        if (msg.type === "run") {
            if (!prepared || !baseScores) throw new Error("area not loaded")
            const t0 = performance.now()
            const { outcome, axes, civic, corridors } = evaluate(prepared, msg.scenario)

            const scenarioScores = {} as Record<AxisKey, number>
            for (const k of AXES) scenarioScores[k] = axes[k].score.value

            const baseCivic = Math.round(
                AXES.reduce((s, k) => s + baseScores![k], 0) / AXES.length,
            )
            const chain = buildChain(prepared, outcome, corridors, baseCivic, civic.value)
            const labels = Object.fromEntries(
                AXES.map((k) => [k, AXIS_META[k].label]),
            ) as Record<string, string>
            const tradeoff = findTradeoff(baseScores!, scenarioScores, labels)

            ;(self as unknown as Worker).postMessage({
                type: "result",
                requestId: msg.requestId,
                payload: {
                    scenarioId: msg.scenario.id,
                    axes,
                    civic,
                    baseCivic,
                    chain,
                    tradeoff,
                    /* Enough of them that a wall in the 3D model can name
                       itself. Forty covered every corridor the consequence
                       chain quotes and left most of the model unclickable: the
                       chain wants the worst handful, the model wants whatever
                       the reader points at. These are eight numbers and a
                       string each, so the difference is a few kilobytes. */
                    corridors: corridors.slice(0, 200),
                    raw: outcome.raw,
                    coverage: outcome.coverage,
                    cost: outcome.cost,
                    addedResidents: outcome.addedResidents,
                    upgradedDwellings: outcome.upgradedDwellings,
                    addedJobs: outcome.addedJobs,
                    removedLaneKm: outcome.removedLaneKm,
                    speedChangedKm: outcome.speedChangedKm,
                    closedFacilities: outcome.closedFacilities,
                    totalPopulation: outcome.totalPopulation,
                    totalTrips: outcome.totalTrips,
                    assignedTrips: outcome.assignedTrips,
                    // Sent as plain arrays: the map needs them and structured
                    // clone handles typed arrays, but the buffers are reused
                    // between runs so they cannot be transferred.
                    vc: Array.from(outcome.vc),
                    baseVc: Array.from(prepared.baseline.vc),
                    runtimeMs: Math.round(performance.now() - t0),
                },
            })
        }
    } catch (err) {
        ;(self as unknown as Worker).postMessage({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
        })
    }
}
