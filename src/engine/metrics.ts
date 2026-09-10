/**
 * The five Decision DNA axes.
 *
 * The design constraint that matters here is INDEPENDENCE. A fingerprint made
 * of five axes that move together is decoration: it looks like a rich profile
 * while carrying one number's worth of information. Two pairs were at risk:
 *
 *   Transportation vs Infrastructure Capacity
 *     Both concern roads, so they are split by whose question they answer.
 *     Transportation is demand-weighted -- how long the average trip actually
 *     takes, what a resident experiences. Capacity is asset-weighted -- how much
 *     of the built network still has room, what an engineer inherits. Rural
 *     Arkansas separates them cleanly: long trips (poor transportation) over
 *     empty roads (excellent headroom).
 *
 *   Growth Efficiency vs Infrastructure Burden
 *     Near-reciprocal by construction: residents per kilometre against dollars
 *     per resident. They are decoupled by giving Burden inputs Efficiency
 *     cannot see -- twenty years of operations and maintenance, which scale
 *     with network length rather than population, and a STEP cost when a zone's
 *     growth crosses a threshold that forces a trunk or treatment upgrade. A
 *     cliff cannot be a linear function of the thing it is plotted against.
 *
 * validate/axis-independence.ts sweeps random scenarios and prints the
 * correlation matrix. If any |r| exceeds 0.9 the axis definitions are wrong and
 * the fingerprint is lying, regardless of how it looks.
 */

import { Axis, AxisKey, Measured, measured } from "./types"
import { Graph } from "./graph"
import { STRESS_VC, Zone } from "./model"
import { Coverage } from "./emergency"

/* --- unit costs -------------------------------------------------------- */

/**
 * DEMO DATA. Order-of-magnitude figures for US local infrastructure, used to
 * make burden comparable between scenarios -- not to price a real project.
 * Every value below is labelled `demo` wherever it surfaces, and no conclusion
 * in the app rests on their absolute level, only on the fact that both the
 * baseline and the scenario are costed identically.
 */
export const UNIT_COSTS = {
    localStreetPerKm: 1_400_000,
    arterialLanePerKm: 2_600_000,
    waterSewerPerKm: 900_000,
    /** Annual operations and maintenance per km of local street. */
    omPerKmYear: 22_000,
    /** Lump cost when a zone's growth forces a trunk or treatment upgrade. */
    thresholdUpgrade: 12_000_000,
    /**
     * Capacity bought deliberately, per dwelling served.
     *
     * Lower per dwelling than the lump threshold upgrade above, which is the
     * asymmetry that matters: capacity planned for is cheaper than capacity
     * reached for after the fact. Both figures are DEMO, and the conclusion
     * rests on the ordering rather than on either number.
     */
    utilityCapacityPerDwelling: 9_000,
    horizonYears: 20,
} as const

const COST_SOURCE = "DEMO DATA -- illustrative US unit costs, not an Arkansas estimate"

/**
 * Growth beyond this multiple of a zone's 2020 housing stock is assumed to
 * exceed the headroom designed into its existing trunk mains and treatment
 * allocation, triggering the step cost above.
 */
export const UPGRADE_THRESHOLD = 1.25

/* --- raw quantities ---------------------------------------------------- */

export interface RawMetrics {
    /** Demand-weighted mean peak trip duration, seconds. Lower is better. */
    meanTripTimeS: number
    /** Share of population within the NFPA travel band. Higher is better. */
    emergencyShare: number
    /** Remaining utility service headroom, population-weighted. Higher is better. */
    capacityHeadroom: number
    /** Residents supported per km of local street. Higher is better. */
    growthEfficiency: number
    /** Capital plus 20-year O&M per resident, dollars. Lower is better. */
    burdenPerResident: number
}

export interface CostBreakdown {
    impliedNewLocalKm: number
    addedLaneKm: number
    capital: number
    om20: number
    thresholdUpgrades: number
    /** Capital spent on deliberately expanding utility capacity. */
    utilityCapacity: number
    /** Dwellings that capacity was bought for. */
    upgradedDwellings: number
    addedResidents: number
}

/** Demand-weighted mean trip time: total vehicle-hours over total trips. */
export function meanTripTime(
    g: Graph,
    volume: Float64Array,
    congestedTimeS: Float64Array,
    totalTrips: number,
): number {
    if (totalTrips <= 0) return 0
    let vehicleSeconds = 0
    for (let e = 0; e < g.edgeCount; e++) {
        if (!g.routable[e]) continue
        const t = congestedTimeS[e]
        if (Number.isFinite(t)) vehicleSeconds += volume[e] * t
    }
    return vehicleSeconds / totalTrips
}

/**
 * Remaining service capacity in the utility systems, population-weighted.
 *
 * This axis started life as road headroom -- share of lane-km below the stress
 * threshold -- and the sweep rejected it: against Transportation it scored
 * r = -0.96, because both were readings of the same v/c field. Two views of one
 * number is not a second dimension, and a fingerprint built on it would have
 * been drawing a shape it could not justify.
 *
 * So capacity is measured where it is genuinely separate: the water, sewer and
 * treatment systems sized around a zone's housing stock. Each zone is assumed
 * built with headroom of UPGRADE_THRESHOLD over its 2020 dwelling count, and
 * new dwellings consume it. That responds to WHERE growth is put and HOW
 * CONCENTRATED it is -- ten thousand residents in one zone can exhaust it while
 * the same ten thousand spread over twenty zones barely register -- and it does
 * so with no reference to traffic at all.
 *
 * It is also the axis most directly built on verified data: HU100 is a counted
 * quantity, not an estimate.
 */
export function serviceHeadroom(
    zones: Zone[],
    addedByZone: Map<string, number>,
    /** Extra dwellings the zone's systems have been re-sized for. */
    upgradedByZone: Map<string, number> = new Map(),
): number {
    let weighted = 0
    let totalPop = 0
    for (const z of zones) {
        const added = addedByZone.get(z.geoid) ?? 0
        const pop = z.population + added
        if (pop <= 0) continue
        const householdSize = z.housingUnits > 0 ? z.population / z.housingUnits : 2.5
        const addedDwellings = added / Math.max(householdSize, 1)
        /* A treatment or trunk-main expansion enters here and nowhere else: it
           raises the dwelling count the zone was BUILT for, which is the
           denominator this axis has always been measured against. Nothing about
           the arithmetic changes, which is the point -- capacity bought and
           capacity consumed are now the same quantity with opposite signs, so a
           scenario that grows a zone and expands its plant can be read directly
           against one that only grows it. */
        const designed = (Math.max(z.housingUnits, 1) + (upgradedByZone.get(z.geoid) ?? 0)) * UPGRADE_THRESHOLD
        const used = z.housingUnits + addedDwellings
        const headroom = Math.max(0, Math.min(1, 1 - used / designed))
        weighted += headroom * pop
        totalPop += pop
    }
    return totalPop > 0 ? weighted / totalPop : 1
}

/**
 * Local street kilometres implied by placing new dwellings in a zone.
 *
 * Each zone already reveals how much street it takes to serve a dwelling there;
 * new dwellings are assumed to arrive at that same local ratio. This is what
 * makes infill and sprawl score differently from real geometry rather than from
 * a judgement about which is virtuous: a downtown block group carries perhaps
 * 15 m of street per dwelling, a rural one several hundred.
 */
export function impliedLocalKm(
    zones: Zone[],
    addedByZone: Map<string, number>,
    /** Extra dwellings already provided for, which the step cost skips. */
    upgradedByZone: Map<string, number> = new Map(),
): { km: number; upgrades: number } {
    let km = 0
    let upgrades = 0
    for (const z of zones) {
        const added = addedByZone.get(z.geoid) ?? 0
        if (added <= 0) continue
        const householdSize = z.housingUnits > 0 ? z.population / z.housingUnits : 2.5
        const addedDwellings = added / Math.max(householdSize, 1)
        /* Block groups covering an airport, an industrial park or a river
           bottom carry road but almost no housing, and the raw ratio there runs
           to tens of thousands of metres per dwelling -- a fact about land use,
           not a sprawl signal. Clamped to a range that spans genuine downtown
           to genuine rural; anything outside it is a category error. */
        const rawPerDwelling =
            z.housingUnits > 0 && z.roadLengthM > 0 ? z.roadLengthM / z.housingUnits : 200
        const mPerDwelling = Math.max(5, Math.min(400, rawPerDwelling))
        km += (addedDwellings * mPerDwelling) / 1000
        /* The step: past this point the zone's existing trunk capacity is
           assumed spent and a lump upgrade is required. A scenario that has
           already paid for the expansion does not pay for it twice, which is
           the whole reason a utility project is worth adding before the growth
           rather than after it. */
        const provided = z.housingUnits + (upgradedByZone.get(z.geoid) ?? 0)
        if (provided > 0 && (z.housingUnits + addedDwellings) / provided > UPGRADE_THRESHOLD) {
            upgrades++
        }
    }
    return { km, upgrades }
}

export function costs(
    localKm: number,
    addedLaneKm: number,
    upgrades: number,
    addedResidents: number,
    upgradedDwellings = 0,
): CostBreakdown {
    const utilityCapacity = upgradedDwellings * UNIT_COSTS.utilityCapacityPerDwelling
    const capital =
        localKm * UNIT_COSTS.localStreetPerKm +
        localKm * UNIT_COSTS.waterSewerPerKm +
        addedLaneKm * UNIT_COSTS.arterialLanePerKm +
        upgrades * UNIT_COSTS.thresholdUpgrade +
        utilityCapacity
    const om20 = localKm * UNIT_COSTS.omPerKmYear * UNIT_COSTS.horizonYears
    return {
        impliedNewLocalKm: localKm,
        addedLaneKm,
        capital,
        om20,
        thresholdUpgrades: upgrades * UNIT_COSTS.thresholdUpgrade,
        utilityCapacity,
        upgradedDwellings,
        addedResidents,
    }
}

/* --- normalisation ----------------------------------------------------- */

/**
 * Per-axis min and max observed across a random scenario sweep for one area.
 *
 * Scores are min-max normalised against this envelope, so 100 means "the best
 * this area achieved under the tested action space" and 0 means the worst --
 * not a score out of some absolute ideal nobody defined. The envelope ships
 * with the area data and is shown in the UI, because a normalised score whose
 * reference is hidden is exactly the kind of arbitrary number this project is
 * supposed to avoid.
 */
export interface Envelope {
    areaId: string
    sampleCount: number
    /** Calibrated gravity deterrence for this area, seconds. */
    deterrenceS?: number
    /** Mean assigned journey the calibration achieved, minutes. */
    calibratedMeanTripMin?: number
    axes: Record<AxisKey, { min: number; max: number; higherIsBetter: boolean }>
}

export const AXIS_META: Record<
    AxisKey,
    { label: string; unit: string; higherIsBetter: boolean; rawKey: keyof RawMetrics }
> = {
    transportation: {
        label: "Transportation",
        unit: "min mean trip",
        higherIsBetter: false,
        rawKey: "meanTripTimeS",
    },
    emergencyAccess: {
        label: "Emergency Access",
        unit: "% within 4 min",
        higherIsBetter: true,
        rawKey: "emergencyShare",
    },
    infrastructureCapacity: {
        label: "Infrastructure Capacity",
        unit: "% service headroom",
        higherIsBetter: true,
        rawKey: "capacityHeadroom",
    },
    growthEfficiency: {
        label: "Growth Efficiency",
        unit: "residents per km of street",
        higherIsBetter: true,
        rawKey: "growthEfficiency",
    },
    infrastructureBurden: {
        label: "Infrastructure Burden",
        unit: "$ per resident",
        higherIsBetter: false,
        rawKey: "burdenPerResident",
    },
}

/** Min-max into 0-100, flipped where lower is better, clamped to the envelope. */
export function normaliseAxis(key: AxisKey, raw: number, env: Envelope): number {
    const { min, max } = env.axes[key]
    if (!Number.isFinite(raw)) return 0
    if (max - min < 1e-12) return 50
    const t = (raw - min) / (max - min)
    const score = AXIS_META[key].higherIsBetter ? t : 1 - t
    return Math.round(Math.max(0, Math.min(1, score)) * 100)
}

/**
 * Civic Impact: the mean of the five axis scores.
 *
 * Equal weights, stated plainly. Any other weighting would be a value judgement
 * about whether a minute of travel matters more than a dollar of capital, and
 * that judgement belongs to the person using the tool -- so the weights are
 * exposed rather than tuned until the demo looked good.
 */
export const DEFAULT_WEIGHTS: Record<AxisKey, number> = {
    transportation: 1,
    emergencyAccess: 1,
    infrastructureCapacity: 1,
    growthEfficiency: 1,
    infrastructureBurden: 1,
}

/**
 * The composite, as a bare number.
 *
 * Split out from civicImpact because the interface reweights constantly -- a
 * slider drag re-scores every saved version on every frame -- and building a
 * Measured with its full inputs tree for each of those would be a great deal of
 * allocation to throw away. Same arithmetic, one definition.
 */
/**
 * The five axis scores as bare numbers.
 *
 * An `Axis` carries its score inside a `Measured`, which is the right shape for
 * an inspector and the wrong one for arithmetic. Without this the call site
 * ends up writing a cast to get an axis record past the type checker, and a
 * cast is exactly what stops the compiler noticing that it is now multiplying
 * an object by a weight -- which produced a screen full of NaN before this
 * existed.
 */
export function axisScores(axes: Record<AxisKey, Axis>): Record<AxisKey, number> {
    return Object.fromEntries(
        (Object.keys(axes) as AxisKey[]).map((k) => [k, axes[k].score.value]),
    ) as Record<AxisKey, number>
}

export function compositeScore(
    scores: Record<AxisKey, number>,
    weights: Record<AxisKey, number> = DEFAULT_WEIGHTS,
): number {
    const keys = Object.keys(scores) as AxisKey[]
    const wSum = keys.reduce((s, k) => s + weights[k], 0)
    if (wSum <= 0) return 0
    return Math.round(keys.reduce((s, k) => s + scores[k] * weights[k], 0) / wSum)
}

export function civicImpact(
    scores: Record<AxisKey, number>,
    weights: Record<AxisKey, number> = DEFAULT_WEIGHTS,
): Measured {
    const keys = Object.keys(scores) as AxisKey[]
    return measured(compositeScore(scores, weights), "score 0-100", "modelled", "CivicFlow composite", {
        formula: `weighted mean of ${keys.length} axis scores (${keys.map((k) => `${AXIS_META[k].label} x${weights[k]}`).join(", ")})`,
        inputs: Object.fromEntries(
            keys.map((k) => [
                AXIS_META[k].label,
                measured(scores[k], "score 0-100", "modelled", "normalised against the area envelope"),
            ]),
        ),
    })
}

export { COST_SOURCE }
