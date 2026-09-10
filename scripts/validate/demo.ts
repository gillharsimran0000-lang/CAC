/**
 * End-to-end check: runs a realistic scenario and prints exactly what the UI
 * would show. This is the test that matters -- typechecking proves the code
 * compiles, this proves the consequence chain says true things.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { prepareArea, evaluate } from "../../src/engine/simulate"
import { buildChain, findTradeoff } from "../../src/engine/chain"
import { AXES, AxisKey } from "../../src/engine/types"
import { AXIS_META } from "../../src/engine/metrics"

async function main() {
    const areaId = process.argv[2] ?? "nwa"
    const GEN = path.join(process.cwd(), "data", "generated")
    const [graph, zones, envelope] = await Promise.all(
        ["graph", "zones", "envelope"].map((k) =>
            readFile(path.join(GEN, `${areaId}-${k}.json`), "utf8").then(JSON.parse),
        ),
    )
    const p = prepareArea({ graph, zones }, envelope)

    const base = evaluate(p, { id: "b", areaId, label: "Baseline", createdAt: 0, actions: [], parentId: null })
    const baseScores = {} as Record<AxisKey, number>
    for (const k of AXES) baseScores[k] = base.axes[k].score.value

    // Put 12,000 people in the largest zone and widen the longest corridor.
    const biggest = [...p.zones].sort((a, b) => b.population - a.population)[0]
    const corridor = p.g.raw.corridors.filter((c) => c.reportable).sort((a, b) => b.lengthM - a.lengthM)[0]

    const scenario = {
        id: "s1", areaId, label: "VERSION 1", createdAt: 0, parentId: null,
        actions: [
            { kind: "addResidents" as const, zoneGeoid: biggest.geoid, count: 12000 },
            { kind: "expandCorridor" as const, corridorId: corridor.id, addedLanesPerDir: 1 },
        ],
    }

    const t0 = Date.now()
    const { outcome, axes, civic, corridors } = evaluate(p, scenario)
    const ms = Date.now() - t0

    const scores = {} as Record<AxisKey, number>
    for (const k of AXES) scores[k] = axes[k].score.value
    const baseCivic = Math.round(AXES.reduce((s, k) => s + baseScores[k], 0) / AXES.length)

    console.log(`\n=== ${p.label}: +12,000 in ${biggest.name}, +1 lane on ${corridor.label} ===`)
    console.log(`ran in ${ms} ms\n`)

    console.log("DECISION DNA")
    for (const k of AXES) {
        const a = axes[k]
        const d = scores[k] - baseScores[k]
        console.log(
            `  ${a.label.padEnd(24)} ${String(a.score.value).padStart(3)}  ` +
            `(${d >= 0 ? "+" : ""}${d})`.padStart(7) +
            `   ${String(a.raw.value).padStart(10)} ${a.raw.unit}  [${a.raw.provenance}]`,
        )
    }
    console.log(`  ${"CIVIC IMPACT".padEnd(24)} ${baseCivic} -> ${civic.value}\n`)

    const labels = Object.fromEntries(AXES.map((k) => [k, AXIS_META[k].label]))
    const tradeoff = findTradeoff(baseScores, scores, labels)
    console.log("THE TRADEOFF")
    console.log(`  ${tradeoff ? tradeoff.sentence : "(nothing moved by more than a point)"}\n`)

    console.log("CONSEQUENCE CHAIN")
    for (const s of buildChain(p, outcome, corridors, baseCivic, civic.value)) {
        console.log(`  ${s.headline}   [${s.value.provenance.toUpperCase()}]`)
        console.log(`    ${s.detail}`)
        if (s.value.formula) console.log(`    formula: ${s.value.formula}`)
        if (s.evidence?.corridors?.length) {
            for (const c of s.evidence.corridors.slice(0, 4)) {
                console.log(`      ${c.label.padEnd(14)} v/c ${c.baseVc.toFixed(2)} -> ${c.scenarioVc.toFixed(2)}   ` +
                    `vol ${c.baseVolume.toLocaleString()} -> ${c.scenarioVolume.toLocaleString()} / cap ${c.capacityVph.toLocaleString()}`)
            }
        }
        console.log()
    }
}
main()
