/**
 * Attaches demand zones and emergency facilities to the road graph.
 *
 * A zone's population has to enter the network somewhere. Census gives an
 * interior point per zone, so each zone is snapped to the nearest graph node
 * and that node becomes where its trips load and where response times are
 * measured to. Snapping is brute-force over a lat/lon bucket grid: exact
 * nearest-neighbour on 2,294 zones against 31,000 nodes is cheap enough that a
 * spatial index would only add ways to be subtly wrong.
 *
 * Facilities are OSM fire stations, hospitals and ambulance stations, which may
 * be mapped as a node, a building outline or a site relation -- Overpass `out
 * center` collapses all three to a point.
 *
 *   node scripts/build-zones.mjs --all
 */

import { readFile, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { STUDY_AREAS } from "./config.mjs"

const RAW = path.join(process.cwd(), "data", "raw")
const OUT = path.join(process.cwd(), "data", "generated")
const EARTH_R_M = 6_371_000

/** Connectors per county. Enough to spread the load, few enough to stay legible. */
const MAX_CONNECTORS = 12

function haversineM(lon1, lat1, lon2, lat2) {
    const toRad = Math.PI / 180
    const dLat = (lat2 - lat1) * toRad
    const dLon = (lon2 - lon1) * toRad
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
    return 2 * EARTH_R_M * Math.asin(Math.sqrt(a))
}

/**
 * Bucketed nearest-node lookup. Buckets are ~0.02 deg, and the search widens a
 * ring at a time until a hit is found and then goes one ring further, because
 * the nearest point may sit just across a bucket boundary.
 */
function makeSnapper(lon, lat, eligible) {
    const CELL = 0.02
    const key = (i, j) => `${i}:${j}`
    const grid = new Map()
    for (let i = 0; i < lon.length; i++) {
        // Only nodes the assignment can actually route from are snap targets.
        if (eligible && !eligible[i]) continue
        const k = key(Math.floor(lon[i] / CELL), Math.floor(lat[i] / CELL))
        let bucket = grid.get(k)
        if (!bucket) grid.set(k, (bucket = []))
        bucket.push(i)
    }
    return (qlon, qlat) => {
        const ci = Math.floor(qlon / CELL)
        const cj = Math.floor(qlat / CELL)
        let best = -1
        let bestD = Infinity
        for (let r = 0; r < 60; r++) {
            for (let i = ci - r; i <= ci + r; i++) {
                for (let j = cj - r; j <= cj + r; j++) {
                    // Only the newly added ring, not the filled square.
                    if (r > 0 && Math.abs(i - ci) !== r && Math.abs(j - cj) !== r) continue
                    for (const n of grid.get(key(i, j)) ?? []) {
                        const d = haversineM(qlon, qlat, lon[n], lat[n])
                        if (d < bestD) {
                            bestD = d
                            best = n
                        }
                    }
                }
            }
            // One ring past the first hit, then stop.
            if (best !== -1 && r > 0) break
        }
        return { node: best, distanceM: bestD }
    }
}

const inBbox = ([s, w, n, e], lon, lat) => lat >= s && lat <= n && lon >= w && lon <= e

/** Ray casting against an ArcGIS ring set. */
function pointInRings(lon, lat, rings) {
    let inside = false
    for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i]
            const [xj, yj] = ring[j]
            if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
                inside = !inside
            }
        }
    }
    return inside
}

/**
 * Road length inside each zone, by edge midpoint.
 *
 * This is what separates infill from sprawl later: a zone already carrying a
 * kilometre of street per twenty dwellings can absorb more of them without
 * building anything, while a zone carrying a kilometre per two dwellings cannot.
 * Assigning a whole edge to whichever zone holds its midpoint miscounts edges
 * that straddle a boundary, but at these zone sizes the errors are small and
 * they cancel; splitting edges at zone borders would be false precision.
 */
function roadLengthByZone(graph, zones) {
    const { lengthM, geomOffset, geomCount } = graph.edges
    const { lon, lat } = graph.geometry
    const m = lengthM.length

    // Zone bounding boxes make the point-in-polygon test affordable: most
    // edges are rejected by four comparisons instead of a full ring walk.
    const boxes = zones.map((z) => {
        if (!z.rings) return null
        let s = 90, w = 180, n = -90, e = -180
        for (const ring of z.rings) {
            for (const [x, y] of ring) {
                if (y < s) s = y
                if (y > n) n = y
                if (x < w) w = x
                if (x > e) e = x
            }
        }
        return [s, w, n, e]
    })

    const total = new Float64Array(zones.length)
    for (let i = 0; i < m; i++) {
        const k = geomOffset[i] + (geomCount[i] >> 1)
        const mx = lon[k]
        const my = lat[k]
        for (let z = 0; z < zones.length; z++) {
            const b = boxes[z]
            if (!b || my < b[0] || my > b[2] || mx < b[1] || mx > b[3]) continue
            if (pointInRings(mx, my, zones[z].rings)) {
                total[z] += lengthM[i]
                break
            }
        }
    }
    return total
}

async function build(areaId) {
    const area = STUDY_AREAS[areaId]
    console.log(`\n== ${area.label} ==`)

    const graph = JSON.parse(await readFile(path.join(OUT, `${areaId}-graph.json`), "utf8"))

    /* Snap only to nodes that carry a routable edge.
       The assignment walks the arterial subgraph, so a zone snapped to the end
       of a cul-de-sac is not merely inaccurate -- it is disconnected, produces
       no trips, and is invisible to the response-time search. Before this
       restriction 84% of Northwest Arkansas's population sat on nodes the model
       could not reach, which read on the dashboard as an uncongested network
       with poor emergency coverage rather than as a bug. */
    const routableNode = new Uint8Array(graph.counts.nodes)
    for (let e = 0; e < graph.counts.edges; e++) {
        if (!graph.edges.routable[e]) continue
        routableNode[graph.edges.from[e]] = 1
        routableNode[graph.edges.to[e]] = 1
    }
    const eligible = routableNode.reduce((s, v) => s + v, 0)
    console.log(`  snap targets: ${eligible}/${graph.counts.nodes} nodes carry a routable edge`)
    const snap = makeSnapper(graph.nodes.lon, graph.nodes.lat, routableNode)

    /* --- zones --- */
    const src = area.zoneKind === "county" ? "ar-counties.json" : "ar-blockgroups.json"
    const zoneFile = JSON.parse(await readFile(path.join(RAW, src), "utf8"))

    /* "Block Group 3" identifies nothing to a reader. Every result sentence and
       every dropdown entry names a zone, so they are given their county -- the
       unit an Arkansan actually recognises -- and their tract, which keeps the
       name unique within it. */
    if (area.zoneKind === "blockgroup") {
        const counties = JSON.parse(await readFile(path.join(RAW, "ar-counties.json"), "utf8"))
        const countyName = new Map(counties.zones.map((c) => [c.geoid, c.name]))
        for (const z of zoneFile.zones) {
            const county = countyName.get(z.countyFips) ?? "Arkansas"
            const tract = z.geoid.slice(5, 11).replace(/^0+/, "")
            const bg = z.geoid.slice(11)
            z.name = `${county} · tract ${tract}.${bg}`
        }
    }

    // A metro study area uses only the zones whose interior point lands inside
    // its box; the statewide area uses every county.
    const selected =
        area.kind === "state"
            ? zoneFile.zones
            : zoneFile.zones.filter((z) => inBbox(area.bbox, z.centroid[0], z.centroid[1]))

    const zones = selected.map((z) => {
        const { node, distanceM } = snap(z.centroid[0], z.centroid[1])
        return {
            ...z,
            node,
            // A long snap means the interior point fell far from any modelled
            // road -- normal for a big rural county, worth flagging in the UI.
            snapDistanceM: Math.round(distanceM),
            densityPerKm2: z.areaLandM2 > 0 ? +(z.population / (z.areaLandM2 / 1e6)).toFixed(1) : 0,
        }
    })

    /* --- measurement zones ---
       Traffic is assigned on counties at state scale, but asking whether a
       county centroid sits within four minutes of a fire station is a question
       about a point in a field, not about people. Coverage is therefore always
       measured at block group resolution and weighted by population, whatever
       the traffic zone system is. For a metro the two collections coincide. */
    let measureZones = zones
    if (area.zoneKind !== "blockgroup") {
        const bgFile = JSON.parse(await readFile(path.join(RAW, "ar-blockgroups.json"), "utf8"))
        measureZones = bgFile.zones.map((z) => {
            const { node, distanceM } = snap(z.centroid[0], z.centroid[1])
            return {
                geoid: z.geoid,
                countyFips: z.countyFips,
                population: z.population,
                node,
                snapDistanceM: Math.round(distanceM),
            }
        })
        const mpop = measureZones.reduce((s, z) => s + z.population, 0)
        console.log(`  measure zones: ${measureZones.length} block groups, population ${mpop.toLocaleString()}`)
    }

    const roadM = roadLengthByZone(graph, zones)
    zones.forEach((z, i) => {
        z.roadLengthM = Math.round(roadM[i])
        // Metres of street per dwelling: the inverse of how efficiently this
        // zone's existing infrastructure is already being used.
        z.roadMPerDwelling = z.housingUnits > 0 ? +(roadM[i] / z.housingUnits).toFixed(1) : null
    })

    /* Centroid connectors.
       A county's entire peak demand cannot enter the network at one point:
       Pulaski would inject 75,834 trips onto a single arterial, a v/c of 40,
       and BPR's fourth power turns that into a 382,000x travel time. Real models
       avoid this with centroid connectors -- an artificial node joined to
       several real ones -- so the demand enters where the people actually are.
       Block groups are already snapped to this graph, so they serve as the
       county's connectors, weighted by population. Metro zones are small enough
       to load at a single point. */
    if (area.zoneKind === "county") {
        const byCounty = new Map()
        for (const m of measureZones) {
            if (m.population <= 0) continue
            const list = byCounty.get(m.countyFips) ?? []
            list.push(m)
            byCounty.set(m.countyFips, list)
        }
        for (const z of zones) {
            const list = (byCounty.get(z.geoid) ?? [])
                .sort((a, b) => b.population - a.population)
                .slice(0, MAX_CONNECTORS)
            const total = list.reduce((s, m) => s + m.population, 0)
            z.connectors = total > 0
                ? list.map((m) => ({ node: m.node, weight: +(m.population / total).toFixed(6) }))
                : [{ node: z.node, weight: 1 }]
        }
        const spread = zones.map((z) => z.connectors.length)
        console.log(`  connectors per county: min ${Math.min(...spread)}, median ${median(spread)}, max ${Math.max(...spread)}`)
    } else {
        for (const z of zones) z.connectors = [{ node: z.node, weight: 1 }]
    }

    const pop = zones.reduce((s, z) => s + z.population, 0)
    const withRoad = zones.filter((z) => z.roadMPerDwelling != null).map((z) => z.roadMPerDwelling)
    console.log(`  road m/dwelling: median ${median(withRoad).toFixed(1)}, range ${Math.min(...withRoad).toFixed(1)}-${Math.max(...withRoad).toFixed(0)}`)
    const far = zones.filter((z) => z.snapDistanceM > 2000).length
    console.log(`  zones: ${zones.length} (${area.zoneKind}), population ${pop.toLocaleString()}`)
    console.log(`  snap: median ${median(zones.map((z) => z.snapDistanceM))} m, ${far} beyond 2 km`)

    /* --- facilities --- */
    const facRaw = JSON.parse(await readFile(path.join(RAW, `${areaId}-facilities.json`), "utf8"))
    const facilities = []
    for (const el of facRaw.elements) {
        const lon = el.lon ?? el.center?.lon
        const lat = el.lat ?? el.center?.lat
        if (lon == null || lat == null) continue
        if (!inBbox(area.bbox, lon, lat)) continue
        const t = el.tags ?? {}
        const kind =
            t.amenity === "fire_station" ? "fire"
            : t.amenity === "hospital" ? "hospital"
            : "ambulance"
        const { node, distanceM } = snap(lon, lat)
        facilities.push({
            id: `${el.type}/${el.id}`,
            kind,
            name: t.name ?? null,
            lonLat: [+lon.toFixed(5), +lat.toFixed(5)],
            node,
            snapDistanceM: Math.round(distanceM),
        })
    }

    const byKind = facilities.reduce((m, f) => ((m[f.kind] = (m[f.kind] ?? 0) + 1), m), {})
    console.log(`  facilities: ${facilities.length} ${JSON.stringify(byKind)}`)

    const out = {
        areaId,
        label: area.label,
        kind: area.kind,
        zoneKind: area.zoneKind,
        generatedAt: new Date().toISOString(),
        totals: { zones: zones.length, population: pop, facilities: facilities.length },
        provenance: {
            ...zoneFile.provenance,
            facilities: {
                level: "verified",
                source: "OpenStreetMap via Overpass API",
                license: "ODbL",
                note: "community-mapped; completeness varies by county",
            },
            snapping: { level: "modelled", basis: "nearest graph node to the Census interior point" },
        },
        zones,
        // Identical to `zones` for metro areas; kept separate so the engine
        // never has to know which case it is in.
        measureZones: measureZones.map((z) => ({
            geoid: z.geoid,
            population: z.population,
            node: z.node,
            // Charged as access time against the NFPA threshold.
            snapDistanceM: z.snapDistanceM,
        })),
        facilities,
    }
    await mkdir(OUT, { recursive: true })
    await writeFile(path.join(OUT, `${areaId}-zones.json`), JSON.stringify(out))
    console.log(`  wrote data/generated/${areaId}-zones.json`)
}

function median(xs) {
    const s = [...xs].sort((a, b) => a - b)
    return s.length ? s[Math.floor(s.length / 2)] : 0
}

const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const targets = process.argv.includes("--all") ? Object.keys(STUDY_AREAS) : ids
if (targets.length === 0) {
    console.error("usage: node scripts/build-zones.mjs <area-id ...|--all>")
    process.exit(1)
}
for (const id of targets) await build(id)
console.log("\ndone.")
