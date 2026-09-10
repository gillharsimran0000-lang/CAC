/**
 * Builds the small statewide payload the opening sequence draws.
 *
 * The hero cannot wait on the 9.5 MB simulation graph -- it is the first thing
 * on screen, and a scroll-driven reveal that arrives late is worse than none.
 * This keeps the motorway, trunk and primary skeleton of Arkansas plus county
 * population and station locations, and drops the rest.
 *
 * Crucially it also runs the real baseline assignment and ships the resulting
 * volume-to-capacity per edge. The congestion the hero floods in is therefore
 * the same number the tool reports on the next screen, not a gradient chosen to
 * look like traffic. An opening sequence that animated invented data would
 * undercut the entire claim of the project on the first scroll.
 *
 *   npx tsx scripts/build-hero.ts
 */

import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { prepareArea } from "../src/engine/simulate"

const GEN = path.join(process.cwd(), "data", "generated")
const HERO_CLASSES = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "primary"])
const MAX_POINTS = 5

async function main() {
    const graph = JSON.parse(await readFile(path.join(GEN, "arkansas-graph.json"), "utf8"))
    const zones = JSON.parse(await readFile(path.join(GEN, "arkansas-zones.json"), "utf8"))
    const envelope = JSON.parse(await readFile(path.join(GEN, "arkansas-envelope.json"), "utf8"))

    console.log("running the statewide baseline for real v/c...")
    const p = prepareArea({ graph, zones }, envelope)
    const vcAll = p.baseline.vc

    const { cls, geomOffset, geomCount } = graph.edges
    const lon: number[] = []
    const lat: number[] = []
    const offset: number[] = []
    const count: number[] = []
    const klass: string[] = []
    const vc: number[] = []

    for (let e = 0; e < graph.counts.edges; e++) {
        if (!HERO_CLASSES.has(cls[e])) continue
        const o = geomOffset[e]
        const n = geomCount[e]
        offset.push(lon.length)
        const keep = Math.min(n, MAX_POINTS)
        for (let i = 0; i < keep; i++) {
            const src = o + (keep === n ? i : Math.round((i / (keep - 1)) * (n - 1)))
            lon.push(+graph.geometry.lon[src].toFixed(4))
            lat.push(+graph.geometry.lat[src].toFixed(4))
        }
        count.push(keep)
        klass.push(cls[e])
        vc.push(+vcAll[e].toFixed(3))
    }

    const stressed = vc.filter((v) => v >= 0.85).length
    const out = {
        bbox: graph.bbox,
        generatedAt: new Date().toISOString(),
        counts: { edges: count.length, stressedEdges: stressed },
        provenance: {
            roads: "OpenStreetMap via Overpass API (ODbL)",
            population: "US Census Bureau, 2020 Decennial Census (POP100)",
            facilities: "OpenStreetMap (ODbL)",
            vc: "CivicFlow baseline assignment, BPR volume-delay",
        },
        edges: { lon, lat, offset, count, cls: klass, vc },
        counties: zones.zones.map((z: { name: string; population: number; centroid: number[] }) => ({
            name: z.name,
            population: z.population,
            centroid: [+z.centroid[0].toFixed(4), +z.centroid[1].toFixed(4)],
        })),
        facilities: zones.facilities
            .filter((f: { kind: string }) => f.kind === "fire")
            .map((f: { lonLat: number[] }) => [+f.lonLat[0].toFixed(4), +f.lonLat[1].toFixed(4)]),
        totals: {
            population: zones.totals.population,
            facilities: zones.totals.facilities,
            counties: zones.zones.length,
            meanTripMin: +(p.baseline.raw.meanTripTimeS / 60).toFixed(1),
            emergencySharePct: +(p.baseline.raw.emergencyShare * 100).toFixed(1),
        },
    }

    const json = JSON.stringify(out)
    await writeFile(path.join(GEN, "hero.json"), json)
    console.log(`hero: ${count.length} edges (${stressed} at or over v/c 0.85), ` +
        `${out.counties.length} counties, ${out.facilities.length} stations`)
    console.log(`baseline: ${out.totals.meanTripMin} min mean trip, ${out.totals.emergencySharePct}% within 4 min`)
    console.log(`wrote data/generated/hero.json (${(json.length / 1e6).toFixed(2)} MB)`)
}
main()
