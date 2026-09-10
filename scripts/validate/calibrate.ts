/**
 * Solves for each area's gravity deterrence coefficient.
 *
 * The model distributes interzonal trips only, so what c0 has to reproduce
 * depends on the zone system: county zones absorb most local travel internally,
 * block groups absorb almost none. Rather than pick a number that makes the
 * output look reasonable, this searches for the c0 whose baseline mean assigned
 * journey matches a stated target, and records both the coefficient and what it
 * achieved.
 *
 * Targets are journey lengths, which is the quantity a travel model is normally
 * calibrated against. They are assumptions, labelled as such -- an ACS
 * mean-commute figure would be a better anchor and is the obvious upgrade.
 *
 *   npx tsx scripts/validate/calibrate.ts
 */

import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { prepareArea, AreaData } from "../../src/engine/simulate"
import { AXES } from "../../src/engine/types"
import { AXIS_META, Envelope } from "../../src/engine/metrics"

const GEN = path.join(process.cwd(), "data", "generated")

/**
 * Target mean assigned (interzonal) journey, minutes.
 *
 * A metro's interzonal trips are ordinary trips, so the target sits near the US
 * mean one-way journey. Statewide, an interzonal trip is by definition one that
 * leaves its county, so it is genuinely longer.
 */
const TARGETS: Record<string, number> = {
    arkansas: 45,
    nwa: 22,
    "little-rock": 22,
}

async function loadArea(areaId: string): Promise<AreaData> {
    const [graph, zones] = await Promise.all([
        readFile(path.join(GEN, `${areaId}-graph.json`), "utf8").then(JSON.parse),
        readFile(path.join(GEN, `${areaId}-zones.json`), "utf8").then(JSON.parse),
    ])
    return { graph, zones }
}

function neutralEnvelope(areaId: string): Envelope {
    const axes = {} as Envelope["axes"]
    for (const k of AXES) axes[k] = { min: 0, max: 1, higherIsBetter: AXIS_META[k].higherIsBetter }
    return { areaId, sampleCount: 0, axes }
}

async function run(areaId: string) {
    const target = TARGETS[areaId]
    console.log(`\n=== calibrating ${areaId} -> ${target} min mean assigned journey ===`)
    const data = await loadArea(areaId)

    /* Mean journey rises monotonically with c0: a larger coefficient makes
       distant zones more attractive, so trips get longer and the network more
       loaded. That monotonicity is what makes a bisection valid here. */
    let lo = 120
    let hi = 3600
    let best = { c0: 0, mean: 0, intrazonal: 0 }

    for (let iter = 0; iter < 14; iter++) {
        const c0 = Math.round((lo + hi) / 2)
        const p = prepareArea(data, neutralEnvelope(areaId), c0)
        const mean = p.baseline.raw.meanTripTimeS / 60
        const intrazonal = 100 * (1 - p.baseline.assignedTrips / p.baseline.totalTrips)
        console.log(
            `  c0 = ${String(c0).padStart(4)} s -> mean ${mean.toFixed(1)} min, ` +
            `intrazonal ${intrazonal.toFixed(1)}%`,
        )
        best = { c0, mean, intrazonal }
        if (Math.abs(mean - target) < 0.5) break
        if (mean > target) hi = c0
        else lo = c0
        if (hi - lo < 5) break
    }

    console.log(`  chosen c0 = ${best.c0} s (${(best.c0 / 60).toFixed(1)} min), ` +
        `mean ${best.mean.toFixed(1)} min, intrazonal ${best.intrazonal.toFixed(1)}%`)

    const file = path.join(GEN, `${areaId}-envelope.json`)
    let env: Envelope
    try {
        env = JSON.parse(await readFile(file, "utf8"))
    } catch {
        env = neutralEnvelope(areaId)
    }
    env.deterrenceS = best.c0
    env.calibratedMeanTripMin = +best.mean.toFixed(1)
    await writeFile(file, JSON.stringify(env, null, 2))
    console.log(`  wrote deterrence into data/generated/${areaId}-envelope.json`)
}

async function main() {
    const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"))
    for (const id of ids.length ? ids : Object.keys(TARGETS)) await run(id)
}
main()
