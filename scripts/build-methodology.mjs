/**
 * The facts the methodology page states about itself.
 *
 * Written from the generated artefacts rather than typed into the page, for the
 * obvious reason: a page that explains how the model works is worthless the
 * moment it disagrees with the model. Every count and provenance record here is
 * lifted straight out of the file the simulator actually loads, so rebuilding
 * the data rebuilds the documentation.
 *
 * Small on purpose. The graphs are tens of megabytes; this is the few hundred
 * bytes of it a reader needs.
 */

import fs from "node:fs/promises"
import path from "node:path"

const DATA = path.join(process.cwd(), "data", "generated")
const OUT = path.join(process.cwd(), "public", "data", "methodology.json")
const AREAS = ["arkansas", "nwa", "little-rock"]

const read = (f) => fs.readFile(path.join(DATA, f), "utf8").then(JSON.parse)

const areas = []
for (const areaId of AREAS) {
    const [graph, zones, envelope] = await Promise.all([
        read(`${areaId}-graph.json`),
        read(`${areaId}-zones.json`),
        read(`${areaId}-envelope.json`),
    ])
    areas.push({
        areaId,
        label: graph.label,
        kind: graph.kind,
        zoneKind: zones.zoneKind,
        generatedAt: graph.generatedAt,
        counts: graph.counts,
        totals: zones.totals,
        graphProvenance: graph.provenance,
        zoneProvenance: zones.provenance,
        deterrenceS: envelope.deterrenceS,
        calibratedMeanTripMin: envelope.calibratedMeanTripMin ?? null,
        sampleCount: envelope.sampleCount,
    })
}

await fs.writeFile(
    OUT,
    JSON.stringify({ generatedAt: new Date().toISOString(), areas }, null, 2),
)

for (const a of areas) {
    console.log(
        `  ✓ ${a.areaId.padEnd(12)} ${String(a.counts.edges).padStart(7)} edges  ` +
            `${String(a.totals.zones).padStart(5)} zones  ${String(a.totals.population).padStart(9)} residents`,
    )
}
console.log(`\n${areas.length} areas → public/data/methodology.json`)
