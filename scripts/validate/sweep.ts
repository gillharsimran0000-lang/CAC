/**
 * Scenario sweep: builds each area's normalisation envelope and checks that the
 * five Decision DNA axes are actually measuring different things.
 *
 * Two jobs, one sweep, because they need the same samples.
 *
 * 1. ENVELOPE. Axis scores are min-max normalised, and the reference has to come
 *    from somewhere defensible. Here it is the range the area actually reaches
 *    across randomly sampled scenarios, so 100 means "best seen under the tested
 *    action space" rather than an ideal nobody defined. The envelope ships with
 *    the app and is shown in the UI.
 *
 * 2. INDEPENDENCE. If two axes correlate near-perfectly across the sweep, the
 *    fingerprint has fewer dimensions than it claims and the visual is lying
 *    about how much it knows. Any |r| above the threshold fails the run --
 *    loudly, with a non-zero exit -- because the alternative is shipping a
 *    five-sided shape driven by two numbers.
 *
 *   npx tsx scripts/validate/sweep.ts nwa --samples 200
 */

import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { prepareArea, evaluate, PreparedArea, AreaData } from "../../src/engine/simulate"
import { AXIS_META, Envelope, RawMetrics } from "../../src/engine/metrics"
import { AXES, AxisKey, Action, Scenario } from "../../src/engine/types"

const GEN = path.join(process.cwd(), "data", "generated")

/** Correlation above this means two axes are not independent enough to plot. */
const MAX_ABS_R = 0.9

/** Deterministic PRNG so a failing sweep can be reproduced exactly. */
function mulberry32(seed: number) {
    return () => {
        seed |= 0
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

async function loadArea(areaId: string): Promise<AreaData> {
    const [graph, zones] = await Promise.all([
        readFile(path.join(GEN, `${areaId}-graph.json`), "utf8").then(JSON.parse),
        readFile(path.join(GEN, `${areaId}-zones.json`), "utf8").then(JSON.parse),
    ])
    return { graph, zones }
}

/** A neutral envelope, so the first (envelope-building) pass can run at all. */
function unitEnvelope(areaId: string): Envelope {
    const axes = {} as Envelope["axes"]
    for (const k of AXES) axes[k] = { min: 0, max: 1, higherIsBetter: AXIS_META[k].higherIsBetter }
    return { areaId, sampleCount: 0, axes }
}

/**
 * Random but plausible scenarios: growth concentrated in a handful of zones,
 * sometimes a corridor widening, sometimes a new station. The sampler is
 * deliberately wider than what a user is likely to try, because the envelope
 * should contain realistic use rather than be defined by it.
 */
function sampleScenario(p: PreparedArea, rnd: () => number, i: number): Scenario {
    const actions: Action[] = []
    const zoneCount = 1 + Math.floor(rnd() * 4)
    for (let k = 0; k < zoneCount; k++) {
        const z = p.zones[Math.floor(rnd() * p.zones.length)]
        actions.push({
            kind: "addResidents",
            zoneGeoid: z.geoid,
            count: Math.round(500 + rnd() * 20_000),
        })
    }
    const reportable = p.g.raw.corridors.filter((c) => c.reportable)
    if (rnd() < 0.5 && reportable.length) {
        actions.push({
            kind: "expandCorridor",
            corridorId: reportable[Math.floor(rnd() * reportable.length)].id,
            addedLanesPerDir: 1 + Math.floor(rnd() * 2),
        })
    }
    if (rnd() < 0.35) {
        const z = p.zones[Math.floor(rnd() * p.zones.length)]
        actions.push({ kind: "addFacility", facilityKind: "fire", lonLat: z.centroid })
    }
    return {
        id: `sweep-${i}`,
        areaId: p.id,
        label: `sweep ${i}`,
        createdAt: 0,
        actions,
        parentId: null,
    }
}

function pearson(a: number[], b: number[]): number {
    const n = a.length
    const ma = a.reduce((s, v) => s + v, 0) / n
    const mb = b.reduce((s, v) => s + v, 0) / n
    let num = 0
    let da = 0
    let db = 0
    for (let i = 0; i < n; i++) {
        const x = a[i] - ma
        const y = b[i] - mb
        num += x * y
        da += x * x
        db += y * y
    }
    const den = Math.sqrt(da * db)
    return den < 1e-12 ? 0 : num / den
}

async function run(areaId: string, samples: number) {
    console.log(`\n=== sweep: ${areaId}, ${samples} samples ===`)
    const data = await loadArea(areaId)

    /* The calibration step has already solved for this area's deterrence and
       written it here; the sweep must run at that value, and must not lose it
       when it writes the envelope back. */
    let prior: Partial<Envelope> = {}
    try {
        prior = JSON.parse(await readFile(path.join(GEN, `${areaId}-envelope.json`), "utf8"))
    } catch {
        /* first run: no envelope yet */
    }
    if (!prior.deterrenceS) {
        console.log(`  WARNING: no calibrated deterrence -- run scripts/validate/calibrate.ts first`)
    }

    const t0 = Date.now()
    const p = prepareArea(data, unitEnvelope(areaId), prior.deterrenceS)
    console.log(`  prepared in ${((Date.now() - t0) / 1000).toFixed(1)}s, c0 = ${p.deterrenceS}s ` +
        `(${p.zones.length} zones, ${p.g.edgeCount} edges, ${p.g.raw.counts.routableEdges} routable)`)

    const base = p.baseline.raw
    console.log(`\n  baseline:`)
    console.log(`    mean trip time      ${(base.meanTripTimeS / 60).toFixed(1)} min`)
    console.log(`    emergency coverage  ${(base.emergencyShare * 100).toFixed(1)}% within 4 min`)
    console.log(`    capacity headroom   ${(base.capacityHeadroom * 100).toFixed(1)}% of lane-km`)
    console.log(`    population          ${p.baseline.totalPopulation.toLocaleString()}`)
    console.log(`    peak trips          ${Math.round(p.baseline.totalTrips).toLocaleString()}/h`)

    const rnd = mulberry32(20260902)
    const rows: RawMetrics[] = [base]
    const times: number[] = []

    for (let i = 0; i < samples; i++) {
        const s = sampleScenario(p, rnd, i)
        const t = Date.now()
        rows.push(evaluate(p, s).outcome.raw)
        times.push(Date.now() - t)
        if ((i + 1) % 25 === 0) process.stdout.write(`\r  sampled ${i + 1}/${samples}`)
    }
    console.log(`\r  sampled ${samples}/${samples}, median ${median(times)} ms per scenario`)

    /* --- envelope --- */
    /* Bounds are the 5th and 95th percentile, not the outright min and max.
       A single extreme sample -- one scenario that happened to drop all its
       growth into the densest block group in Bentonville -- was setting the top
       of the Growth Efficiency range at 632 residents per km, which squashed
       every ordinary scenario into the bottom tenth of the scale and made the
       axis look broken. Percentile bounds keep the scale spanning the range
       scenarios actually occupy; anything beyond simply clamps to 0 or 100. */
    const percentile = (xs: number[], q: number) => {
        const sorted = [...xs].sort((a, b) => a - b)
        const i = (sorted.length - 1) * q
        const lo = Math.floor(i)
        const hi = Math.ceil(i)
        return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
    }

    const axes = {} as Envelope["axes"]
    for (const k of AXES) {
        const key = AXIS_META[k].rawKey
        const vals = rows.map((r) => r[key]).filter(Number.isFinite)
        axes[k] = {
            min: percentile(vals, 0.05),
            max: percentile(vals, 0.95),
            higherIsBetter: AXIS_META[k].higherIsBetter,
        }
    }

    console.log(`\n  envelope:`)
    for (const k of AXES) {
        const { min, max } = axes[k]
        console.log(`    ${AXIS_META[k].label.padEnd(24)} ${fmt(min)} .. ${fmt(max)}  (${AXIS_META[k].unit})`)
    }

    /* --- independence --- */
    const series = AXES.map((k) => rows.map((r) => r[AXIS_META[k].rawKey]))
    console.log(`\n  axis correlation (|r| must stay under ${MAX_ABS_R}):`)
    console.log(`    ${"".padEnd(24)}${AXES.map((k) => shortName(k).padStart(9)).join("")}`)

    const failures: string[] = []
    for (let i = 0; i < AXES.length; i++) {
        const cells: string[] = []
        for (let j = 0; j < AXES.length; j++) {
            const r = i === j ? 1 : pearson(series[i], series[j])
            cells.push(r.toFixed(2).padStart(9))
            if (i < j && Math.abs(r) > MAX_ABS_R) {
                failures.push(`${AXIS_META[AXES[i]].label} vs ${AXIS_META[AXES[j]].label}: r = ${r.toFixed(3)}`)
            }
        }
        console.log(`    ${AXIS_META[AXES[i]].label.padEnd(24)}${cells.join("")}`)
    }

    const envelope: Envelope = {
        areaId,
        sampleCount: rows.length,
        deterrenceS: prior.deterrenceS,
        calibratedMeanTripMin: prior.calibratedMeanTripMin,
        axes,
    }
    await writeFile(path.join(GEN, `${areaId}-envelope.json`), JSON.stringify(envelope, null, 2))
    console.log(`\n  wrote data/generated/${areaId}-envelope.json`)

    if (failures.length) {
        console.error(`\n  FAILED -- these axes are not independent:`)
        for (const f of failures) console.error(`    ${f}`)
        return false
    }
    console.log(`  independence OK`)
    return true
}

const fmt = (v: number) =>
    (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(3)).padStart(12)
const shortName = (k: AxisKey) =>
    ({ transportation: "trans", emergencyAccess: "emerg", infrastructureCapacity: "capac", growthEfficiency: "growth", infrastructureBurden: "burden" })[k]
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0

async function main() {
    const args = process.argv.slice(2)
    const samples = Number(args[args.indexOf("--samples") + 1]) || 120
    const ids = args.filter((a) => !a.startsWith("--") && Number.isNaN(Number(a)))
    let allOk = true
    for (const id of ids.length ? ids : ["arkansas", "nwa", "little-rock"]) {
        allOk = (await run(id, samples)) && allOk
    }
    process.exit(allOk ? 0 : 1)
}

main()
