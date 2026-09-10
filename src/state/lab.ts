"use client"

/**
 * Lab state, and the Decision History that makes it a laboratory.
 *
 * The central idea is that a scenario is never edited in place. Every run
 * appends a version holding the actions AND the result they produced, so the
 * history is a record of experiments rather than an undo stack: each entry can
 * be inspected, compared and restored, and restoring one does not destroy the
 * branch it came from. That is what turns the tool from a form into something
 * a person can experiment in.
 *
 * Versions keep their parent, so a restore-then-change reads as a branch rather
 * than as a linear sequence that quietly lost its middle.
 */

import { create } from "zustand"
import { Action, Axis, AxisKey, ChainStep, CorridorStress, FacilityKind, Measured, Scenario } from "@/engine/types"
import { DEFAULT_WEIGHTS } from "@/engine/metrics"

export interface RunResult {
    scenarioId: string
    axes: Record<AxisKey, Axis>
    civic: Measured
    baseCivic: number
    chain: ChainStep[]
    tradeoff: { gain: string | null; loss: string | null; sentence: string }
    corridors: CorridorStress[]
    raw: Record<string, number>
    coverage: { share: number; coveredPopulation: number; meanResponseS: number }
    cost: {
        capital: number
        om20: number
        impliedNewLocalKm: number
        thresholdUpgrades: number
        utilityCapacity: number
        upgradedDwellings: number
    }
    addedResidents: number
    upgradedDwellings: number
    addedJobs: number
    removedLaneKm: number
    speedChangedKm: number
    closedFacilities: number
    totalPopulation: number
    totalTrips: number
    assignedTrips: number
    vc: number[]
    baseVc: number[]
    runtimeMs: number
}

export interface Version {
    id: string
    label: string
    createdAt: number
    parentId: string | null
    actions: Action[]
    result: RunResult | null
}

export interface AreaMeta {
    areaId: string
    label: string
    kind: "state" | "metro"
    zoneKind: string
    deterrenceS: number
    envelope: {
        sampleCount: number
        calibratedMeanTripMin?: number
        axes: Record<AxisKey, { min: number; max: number; higherIsBetter: boolean }>
    }
    totals: { zones: number; population: number; facilities: number }
    provenance: Record<string, unknown>
    graphCounts: Record<string, number>
    baseline: {
        axes: Record<AxisKey, Axis>
        civic: Measured
        raw: Record<string, number>
        coverage: { share: number; coveredPopulation: number; meanResponseS: number }
        totalPopulation: number
        totalTrips: number
        assignedTrips: number
    }
    zones: {
        geoid: string
        name: string
        population: number
        housingUnits: number
        centroid: [number, number]
        densityPerKm2: number
        roadMPerDwelling: number | null
    }[]
    corridors: {
        id: number
        label: string
        kind: string
        cls: string
        lengthM: number
        /** Mean lanes per direction across the corridor's links. */
        lanes: number
        /** Mean per-link capacity, vehicles per hour. */
        capacityVph: number
        /** Worst link's baseline volume/capacity, so a corridor can be described
            as already stressed before anyone changes it. */
        baseVc: number
        /** Roughly where the corridor runs, for choosing its landscape. */
        lonLat: [number, number]
    }[]
    facilities: { id: string; kind: string; name: string | null; lonLat: [number, number] }[]
}

interface LabState {
    areaId: string
    area: AreaMeta | null
    loading: boolean
    running: boolean
    error: string | null

    /** Actions being edited, not yet committed to a version. */
    draft: Action[]
    versions: Version[]
    currentId: string | null
    /** Version pinned for side-by-side comparison, if any. */
    compareId: string | null

    /** Set when a run finishes, so the lab can hand off to the result page. */
    justCompleted: string | null

    /**
     * What the person using this tool thinks matters.
     *
     * The five axes measure things that cannot be traded against each other by
     * any fact -- whether a minute of travel is worth a dollar of capital is a
     * value judgement, not a finding -- so the engine ships equal weights and
     * the judgement is handed to the user. Changing these never re-runs the
     * simulation: the axis scores are properties of the scenario, and the
     * weights only decide how they are combined. That is exactly why a reweight
     * is instant and can reorder every saved version at once.
     */
    weights: Record<AxisKey, number>

    setArea: (areaId: string) => void
    setDraft: (actions: Action[]) => void
    addResidents: (zoneGeoid: string, count: number) => void
    expandCorridor: (corridorId: number, lanes: number) => void
    addFacility: (lonLat: [number, number], facilityKind?: FacilityKind) => void
    /** Close an existing station, by its id in the area's facility list. */
    removeFacility: (facilityId: string) => void
    /** Buy utility capacity in a zone, measured in dwellings served. */
    upgradeUtility: (zoneGeoid: string, dwellings: number) => void
    /** Place trip destinations: the other end of the gravity model. */
    addJobs: (zoneGeoid: string, jobs: number) => void
    /** Post a limit, in mph, on every link of a corridor. */
    setSpeedLimit: (corridorId: number, mph: number) => void
    /** Edit one entry in place -- a scenario is a list, not a single choice. */
    updateAction: (index: number, action: Action) => void
    removeAction: (index: number) => void
    clearDraft: () => void
    acknowledgeCompletion: () => void
    run: () => void
    restore: (versionId: string) => void
    setCompare: (versionId: string | null) => void
    setWeight: (axis: AxisKey, value: number) => void
    resetWeights: () => void
    /** Applies the stored preference. Call once, from an effect after mount. */
    hydrateWeights: () => void
}

let worker: Worker | null = null
let requestId = 0

function ensureWorker(get: () => LabState, set: (p: Partial<LabState>) => void) {
    if (worker) return worker
    worker = new Worker(new URL("../engine/sim.worker.ts", import.meta.url))
    worker.onmessage = (e: MessageEvent) => {
        const { type, payload, message } = e.data
        if (type === "loaded") {
            set({ area: payload, loading: false, error: null })
        } else if (type === "result") {
            const state = get()
            // Attach the result to the version this run was for.
            set({
                running: false,
                justCompleted: payload.scenarioId,
                versions: state.versions.map((v) =>
                    v.id === payload.scenarioId ? { ...v, result: payload } : v,
                ),
            })
        } else if (type === "error") {
            set({ error: message, loading: false, running: false })
        }
    }
    return worker
}

const nextLabel = (n: number) => `VERSION ${n}`

export const useLab = create<LabState>((set, get) => ({
    areaId: "nwa",
    area: null,
    loading: false,
    running: false,
    error: null,
    draft: [],
    versions: [],
    currentId: null,
    compareId: null,
    justCompleted: null,
    // Defaults, always. The stored preference is applied by hydrateWeights()
    // after mount: reading localStorage during store creation would give the
    // server DEFAULT_WEIGHTS and the client something else, and React would
    // hydrate onto markup that no longer matches.
    weights: { ...DEFAULT_WEIGHTS },

    setArea: (areaId) => {
        set({ areaId, area: null, loading: true, versions: [], currentId: null, compareId: null, draft: [] })
        ensureWorker(get, set).postMessage({ type: "load", areaId })
    },

    setDraft: (draft) => set({ draft }),

    /* Adding the same zone twice replaces rather than stacks -- two entries for
       one place would be two rows saying the same thing -- but different zones
       accumulate freely, which is the point: a scenario is several decisions,
       not one.
       
       Non-zero rather than positive: a negative count is a zone losing people,
       which half of Arkansas has been doing since 1970 and which the tool had
       no way to ask about. */
    addResidents: (zoneGeoid, count) => {
        const draft = get().draft.filter(
            (a) => !(a.kind === "addResidents" && a.zoneGeoid === zoneGeoid),
        )
        if (count !== 0) draft.push({ kind: "addResidents", zoneGeoid, count })
        set({ draft })
    },

    /** Negative lanes is a road diet; the engine floors it at one each way. */
    expandCorridor: (corridorId, lanes) => {
        const draft = get().draft.filter(
            (a) => !(a.kind === "expandCorridor" && a.corridorId === corridorId),
        )
        if (lanes !== 0) draft.push({ kind: "expandCorridor", corridorId, addedLanesPerDir: lanes })
        set({ draft })
    },

    /* Jobs replace per zone for the same reason residents do: "put four thousand
       jobs here" is one statement about one place. */
    addJobs: (zoneGeoid, jobs) => {
        const draft = get().draft.filter((a) => !(a.kind === "addJobs" && a.zoneGeoid === zoneGeoid))
        if (jobs !== 0) draft.push({ kind: "addJobs", zoneGeoid, jobs })
        set({ draft })
    },

    /* A corridor has one posted limit, so a second entry for the same corridor
       is a correction rather than an addition. */
    setSpeedLimit: (corridorId, mph) => {
        const draft = get().draft.filter(
            (a) => !(a.kind === "setSpeedLimit" && a.corridorId === corridorId),
        )
        draft.push({ kind: "setSpeedLimit", corridorId, mph })
        set({ draft })
    },

    /* Closing the same station twice is the same closure. */
    removeFacility: (facilityId) => {
        const draft = get().draft.filter(
            (a) => !(a.kind === "removeFacility" && a.facilityId === facilityId),
        )
        draft.push({ kind: "removeFacility", facilityId })
        set({ draft })
    },

    updateAction: (index, action) =>
        set({ draft: get().draft.map((a, i) => (i === index ? action : a)) }),

    removeAction: (index) => set({ draft: get().draft.filter((_, i) => i !== index) }),

    /* Stations stack rather than replace. Two engine houses on opposite sides
       of a town are two decisions, and unlike growth in one zone there is no
       sense in which the second overwrites the first. */
    addFacility: (lonLat, facilityKind = "fire") =>
        set({ draft: [...get().draft, { kind: "addFacility", facilityKind, lonLat }] }),

    /* Utility capacity replaces per zone, like residents: "size this zone's
       system for 4,000 more dwellings" is one statement about one place, and
       adding it twice would be that statement written twice rather than two
       plants. The engine sums entries, so leaving duplicates in would silently
       double what the user asked for. */
    upgradeUtility: (zoneGeoid, dwellings) => {
        const draft = get().draft.filter(
            (a) => !(a.kind === "upgradeUtility" && a.zoneGeoid === zoneGeoid),
        )
        if (dwellings > 0) draft.push({ kind: "upgradeUtility", zoneGeoid, dwellings })
        set({ draft })
    },

    clearDraft: () => set({ draft: [] }),

    acknowledgeCompletion: () => set({ justCompleted: null }),

    run: () => {
        const { draft, versions, currentId, areaId, running } = get()
        if (running) return
        const id = `v${versions.length + 1}-${Date.now().toString(36)}`
        const version: Version = {
            id,
            label: nextLabel(versions.length + 1),
            createdAt: Date.now(),
            // The version being viewed becomes the parent, so restoring and then
            // experimenting branches rather than overwriting.
            parentId: currentId,
            actions: [...draft],
            result: null,
        }
        set({ versions: [...versions, version], currentId: id, running: true })

        const scenario: Scenario = {
            id,
            areaId,
            label: version.label,
            createdAt: version.createdAt,
            actions: version.actions,
            parentId: version.parentId,
        }
        ensureWorker(get, set).postMessage({ type: "run", scenario, requestId: ++requestId })
    },

    restore: (versionId) => {
        const v = get().versions.find((x) => x.id === versionId)
        if (!v) return
        // Restoring loads the actions back into the draft and makes that version
        // current; nothing is deleted, so the branch stays on the timeline.
        set({ draft: [...v.actions], currentId: versionId })
    },

    setCompare: (compareId) => set({ compareId }),

    hydrateWeights: () => {
        const stored = loadWeights()
        const current = get().weights
        const same = (Object.keys(stored) as AxisKey[]).every((k) => stored[k] === current[k])
        if (!same) set({ weights: stored })
    },

    setWeight: (axis, value) => {
        // Clamped, not normalised. Normalising on every drag would move the
        // four sliders the user is not touching, which makes the control feel
        // possessed; civicImpact divides by the sum, so the ratios are what
        // matter and the absolute numbers need not add to anything.
        const weights = { ...get().weights, [axis]: Math.max(0, Math.min(5, value)) }
        // All-zero would divide by zero downstream, and means nothing anyway.
        if (Object.values(weights).every((w) => w === 0)) return
        set({ weights })
        saveWeights(weights)
    },

    resetWeights: () => {
        set({ weights: { ...DEFAULT_WEIGHTS } })
        saveWeights(DEFAULT_WEIGHTS)
    },
}))

/**
 * Weights survive a reload.
 *
 * A person's priorities are not part of a scenario -- they are how that person
 * reads every scenario -- so they belong to the browser rather than to the run,
 * and it would be rude to make someone re-state them after a refresh. Wrapped
 * because localStorage throws outright in a few configurations rather than
 * returning null.
 */
const WEIGHTS_KEY = "civicflow.weights.v1"

function loadWeights(): Record<AxisKey, number> {
    try {
        const raw = window.localStorage.getItem(WEIGHTS_KEY)
        if (!raw) return { ...DEFAULT_WEIGHTS }
        const parsed = JSON.parse(raw) as Record<string, unknown>
        const out = { ...DEFAULT_WEIGHTS }
        for (const key of Object.keys(DEFAULT_WEIGHTS) as AxisKey[]) {
            const v = parsed[key]
            if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 5) out[key] = v
        }
        return Object.values(out).every((w) => w === 0) ? { ...DEFAULT_WEIGHTS } : out
    } catch {
        return { ...DEFAULT_WEIGHTS }
    }
}

function saveWeights(weights: Record<AxisKey, number>) {
    try {
        window.localStorage.setItem(WEIGHTS_KEY, JSON.stringify(weights))
    } catch {
        // Private browsing, quota, or storage disabled. The weights still work
        // for this session; only their persistence is lost.
    }
}

/** Convenience: the version currently being viewed. */
export const useCurrentVersion = () =>
    useLab((s) => s.versions.find((v) => v.id === s.currentId) ?? null)
