/**
 * Turns raw OSM ways into a routable, capacity-annotated road graph.
 *
 * OSM ways are cartography, not a network: one way may run through twenty
 * intersections, and two ways may meet only by sharing a node id. So ways are
 * split at every node that more than one way touches, and the stretches between
 * those splits become edges. Interior nodes stay as drawing geometry rather
 * than becoming graph nodes, which is what keeps the edge count low enough to
 * assign traffic in a browser.
 *
 * Every edge carries where its numbers came from. `lanes` is tagged on under a
 * fifth of Arkansas ways and `maxspeed` on under a third, so most edges fall
 * back to class defaults -- that difference is recorded per edge and surfaces
 * in the UI as VERIFIED DATA versus MODELED RESULT. It is never averaged away.
 *
 *   node scripts/build-graph.mjs arkansas
 */

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { STUDY_AREAS, ROAD_DEFAULTS, ROUTABLE_CLASSES, STATE_FIPS } from "./config.mjs"

const RAW = path.join(process.cwd(), "data", "raw")
const OUT = path.join(process.cwd(), "data", "generated")
const EARTH_R_M = 6_371_000

/* --- geometry ---------------------------------------------------------- */

function haversineM(lon1, lat1, lon2, lat2) {
    const toRad = Math.PI / 180
    const dLat = (lat2 - lat1) * toRad
    const dLon = (lon2 - lon1) * toRad
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
    return 2 * EARTH_R_M * Math.asin(Math.sqrt(a))
}

/** Ray casting against an ArcGIS ring set. Holes are rare here and ignored. */
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

/* --- tag parsing ------------------------------------------------------- */

/**
 * OSM `lanes` counts both directions on a two-way road. Capacity is a
 * per-direction quantity, so a tagged value is halved unless the way is oneway.
 * Values like "2;3" or "1.5" appear in the wild and are treated as untagged.
 */
function parseLanes(tags, oneway, fallback) {
    const raw = tags.lanes
    const n = raw != null ? Number(String(raw).split(";")[0]) : NaN
    if (!Number.isFinite(n) || n <= 0) return { lanes: fallback, source: "default" }
    const perDir = oneway ? n : n / 2
    // A two-way road tagged `lanes=1` is a single shared lane, not half a lane.
    return { lanes: Math.max(1, Math.round(perDir)), source: "osm" }
}

/** `maxspeed` is usually "45 mph" in the US but bare numbers mean km/h. */
function parseSpeedMph(tags, fallback) {
    const raw = tags.maxspeed
    if (!raw) return { speed: fallback, source: "default" }
    const m = String(raw).match(/^\s*(\d+(?:\.\d+)?)\s*(mph)?\s*$/i)
    if (!m) return { speed: fallback, source: "default" }
    const n = Number(m[1])
    if (!Number.isFinite(n) || n <= 0) return { speed: fallback, source: "default" }
    return { speed: m[2] ? n : n * 0.621371, source: "osm" }
}

function isOneway(tags) {
    const v = tags.oneway
    if (v === "yes" || v === "true" || v === "1" || v === "-1") return true
    // Motorway carriageways are mapped as separate one-way ways by convention
    // even when the tag is left off.
    return tags.highway === "motorway" || tags.highway === "motorway_link"
}

/* --- build ------------------------------------------------------------- */

async function stateBoundary() {
    const cache = path.join(RAW, "ar-boundary.json")
    if (existsSync(cache)) return JSON.parse(await readFile(cache, "utf8"))
    const url =
        `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/MapServer/80/query` +
        `?where=STATE='${STATE_FIPS}'&outFields=GEOID&returnGeometry=true&outSR=4326` +
        `&geometryPrecision=5&maxAllowableOffset=0.002&f=json`
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    const json = await res.json()
    const rings = json.features?.[0]?.geometry?.rings
    if (!rings) throw new Error("could not fetch Arkansas state boundary")
    await writeFile(cache, JSON.stringify(rings))
    return rings
}

async function build(areaId) {
    const area = STUDY_AREAS[areaId]
    if (!area) throw new Error(`unknown study area: ${areaId}`)
    console.log(`\n== building graph: ${area.label} ==`)

    const raw = JSON.parse(await readFile(path.join(RAW, `${areaId}-roads.json`), "utf8"))
    const ways = raw.elements.filter((e) => e.type === "way" && e.geometry?.length >= 2)
    console.log(`  ways: ${ways.length}`)

    // A state-scale bbox necessarily overhangs into Missouri, Tennessee and
    // Oklahoma. Those roads are real but they are not ours to plan, and leaving
    // them in would let growth "spill" across the state line.
    let clip = null
    if (area.kind === "state") {
        clip = await stateBoundary()
        console.log(`  clipping to Arkansas boundary (${clip.length} rings)`)
    }

    /* Pass 1: how many ways touch each node. Shared nodes are intersections. */
    const useCount = new Map()
    for (const w of ways) {
        for (const id of w.nodes) useCount.set(id, (useCount.get(id) ?? 0) + 1)
    }

    /* Pass 2: split ways at intersections and at their own endpoints. */
    const nodeIndex = new Map() // osm node id -> graph node index
    const nodeLon = []
    const nodeLat = []
    const getNode = (osmId, lon, lat) => {
        let i = nodeIndex.get(osmId)
        if (i === undefined) {
            i = nodeLon.length
            nodeIndex.set(osmId, i)
            nodeLon.push(lon)
            nodeLat.push(lat)
        }
        return i
    }

    const edges = []
    const geomLon = []
    const geomLat = []
    let droppedOutOfState = 0

    for (const w of ways) {
        const tags = w.tags ?? {}
        const cls = tags.highway
        const def = ROAD_DEFAULTS[cls]
        if (!def) continue

        const oneway = isOneway(tags)
        const { lanes, source: lanesSource } = parseLanes(tags, oneway, def.lanes)
        const { speed, source: speedSource } = parseSpeedMph(tags, def.speed)
        const geom = w.geometry
        const ids = w.nodes

        // Walk the way, cutting a new edge every time we hit a shared node.
        let startIdx = 0
        for (let i = 1; i < geom.length; i++) {
            const isEnd = i === geom.length - 1
            const isJunction = (useCount.get(ids[i]) ?? 0) > 1
            if (!isEnd && !isJunction) continue

            const slice = geom.slice(startIdx, i + 1)
            let lengthM = 0
            for (let k = 1; k < slice.length; k++) {
                lengthM += haversineM(slice[k - 1].lon, slice[k - 1].lat, slice[k].lon, slice[k].lat)
            }

            // Zero-length stubs occur where a way doubles back on a node.
            if (lengthM < 1) {
                startIdx = i
                continue
            }

            const mid = slice[Math.floor(slice.length / 2)]
            if (clip && !pointInRings(mid.lon, mid.lat, clip)) {
                droppedOutOfState++
                startIdx = i
                continue
            }

            const from = getNode(ids[startIdx], geom[startIdx].lon, geom[startIdx].lat)
            const to = getNode(ids[i], geom[i].lon, geom[i].lat)

            const geomOffset = geomLon.length
            for (const p of slice) {
                geomLon.push(p.lon)
                geomLat.push(p.lat)
            }

            edges.push({
                from,
                to,
                lengthM,
                lanes,
                lanesSource,
                speedMph: speed,
                speedSource,
                // Capacity is per direction: lanes x HCM-derated per-lane flow.
                capacityVph: lanes * def.capacity,
                oneway,
                cls,
                name: tags.name ?? null,
                ref: tags.ref ?? null,
                bridge: tags.bridge === "yes",
                geomOffset,
                geomCount: slice.length,
            })
            startIdx = i
        }
    }

    console.log(`  nodes: ${nodeLon.length}`)
    console.log(`  edges: ${edges.length}${droppedOutOfState ? ` (${droppedOutOfState} dropped outside Arkansas)` : ""}`)

    /* Pass 3: keep the largest connected component. Islands are digitising
       artefacts or genuinely unreachable stubs; either way traffic cannot use
       them and leaving them in makes shortest paths fail unpredictably. */
    const adj = Array.from({ length: nodeLon.length }, () => [])
    edges.forEach((e, i) => {
        adj[e.from].push(i)
        adj[e.to].push(i)
    })

    const comp = new Int32Array(nodeLon.length).fill(-1)
    let best = -1
    let bestSize = 0
    let nComp = 0
    const stack = []
    for (let s = 0; s < nodeLon.length; s++) {
        if (comp[s] !== -1) continue
        let size = 0
        stack.push(s)
        comp[s] = nComp
        while (stack.length) {
            const n = stack.pop()
            size++
            for (const ei of adj[n]) {
                const e = edges[ei]
                const other = e.from === n ? e.to : e.from
                if (comp[other] === -1) {
                    comp[other] = nComp
                    stack.push(other)
                }
            }
        }
        if (size > bestSize) {
            bestSize = size
            best = nComp
        }
        nComp++
    }
    console.log(`  components: ${nComp}, largest holds ${bestSize} nodes (${(100 * bestSize / nodeLon.length).toFixed(1)}%)`)

    /* Renumber down to the giant component. */
    const nodeMap = new Int32Array(nodeLon.length).fill(-1)
    const outLon = []
    const outLat = []
    for (let i = 0; i < nodeLon.length; i++) {
        if (comp[i] !== best) continue
        nodeMap[i] = outLon.length
        outLon.push(nodeLon[i])
        outLat.push(nodeLat[i])
    }

    const kept = edges.filter((e) => nodeMap[e.from] !== -1 && nodeMap[e.to] !== -1)

    /* Corridors: contiguous named or numbered routes. "2 corridors experience
       higher stress" has to name something a person recognises -- I-49, US-71 --
       not an edge id, so edges are grouped by ref first, then name. */
    const corridorIndex = new Map()
    const corridors = []
    const corridorOf = kept.map((e) => {
        const key = e.ref ?? e.name
        if (!key) return -1
        let ci = corridorIndex.get(key)
        if (ci === undefined) {
            ci = corridors.length
            corridorIndex.set(key, ci)
            corridors.push({ id: ci, label: key, kind: e.ref ? "route" : "street", cls: e.cls, edgeCount: 0, lengthM: 0 })
        }
        corridors[ci].edgeCount++
        corridors[ci].lengthM += e.lengthM
        return ci
    })

    /* Grouping by name alone turns every cul-de-sac into a "corridor" -- NWA
       produced 11,815 of them. A corridor is only useful if a result sentence
       can name it and a person can picture it, so keep numbered routes and
       arterial-class streets of real length, and mark the rest unreportable.
       They stay in the graph and still carry traffic; they just never headline. */
    const REPORTABLE_CLASSES = new Set(["motorway", "trunk", "primary", "secondary"])
    const MIN_CORRIDOR_M = 1200
    for (const c of corridors) {
        c.reportable = (c.kind === "route" || REPORTABLE_CLASSES.has(c.cls)) && c.lengthM >= MIN_CORRIDOR_M
        c.lengthM = Math.round(c.lengthM)
    }
    const reportable = corridors.filter((c) => c.reportable).length

    const routableCount = kept.filter((e) => ROUTABLE_CLASSES.has(e.cls)).length
    const lanesFromOsm = kept.filter((e) => e.lanesSource === "osm").length
    const speedFromOsm = kept.filter((e) => e.speedSource === "osm").length

    /* Coordinates dominate the payload, and full float precision is a lie about
       how well we know where a road is. Five decimals is ~1.1 m, four is ~11 m;
       a statewide map is never zoomed close enough to tell. This roughly halves
       the file with no visible change. */
    const coordDp = area.kind === "state" ? 4 : 5
    const round = (v) => Number(v.toFixed(coordDp))

    const out = {
        areaId,
        label: area.label,
        kind: area.kind,
        bbox: area.bbox,
        generatedAt: new Date().toISOString(),
        counts: { nodes: outLon.length, edges: kept.length, routableEdges: routableCount, corridors: corridors.length, reportableCorridors: reportable },
        provenance: {
            geometry: { source: "OpenStreetMap via Overpass API", license: "ODbL", level: "verified" },
            lanes: {
                verifiedEdges: lanesFromOsm,
                modelledEdges: kept.length - lanesFromOsm,
                defaultBasis: "class defaults, Highway Capacity Manual derated",
            },
            speed: {
                verifiedEdges: speedFromOsm,
                modelledEdges: kept.length - speedFromOsm,
                defaultBasis: "class defaults",
            },
            capacity: { level: "modelled", basis: "lanes x per-lane capacity (HCM derated)" },
        },
        nodes: { lon: outLon.map(round), lat: outLat.map(round) },
        edges: {
            from: kept.map((e) => nodeMap[e.from]),
            to: kept.map((e) => nodeMap[e.to]),
            lengthM: kept.map((e) => Math.round(e.lengthM)),
            lanes: kept.map((e) => e.lanes),
            capacityVph: kept.map((e) => e.capacityVph),
            speedMph: kept.map((e) => Math.round(e.speedMph)),
            // Free-flow traversal time in seconds, the base for the BPR curve.
            freeTimeS: kept.map((e) => Math.round((e.lengthM / (e.speedMph * 0.44704)) * 10) / 10),
            oneway: kept.map((e) => (e.oneway ? 1 : 0)),
            cls: kept.map((e) => e.cls),
            corridor: corridorOf,
            // Assignment routes over this subset; the rest is drawn, not modelled.
            routable: kept.map((e) => (ROUTABLE_CLASSES.has(e.cls) ? 1 : 0)),
            lanesVerified: kept.map((e) => (e.lanesSource === "osm" ? 1 : 0)),
            speedVerified: kept.map((e) => (e.speedSource === "osm" ? 1 : 0)),
            geomOffset: kept.map((e) => e.geomOffset),
            geomCount: kept.map((e) => e.geomCount),
        },
        geometry: { lon: geomLon.map(round), lat: geomLat.map(round) },
        corridors,
    }

    await mkdir(OUT, { recursive: true })
    const file = path.join(OUT, `${areaId}-graph.json`)
    await writeFile(file, JSON.stringify(out))
    const mb = (JSON.stringify(out).length / 1e6).toFixed(1)
    console.log(`  lanes verified on ${lanesFromOsm}/${kept.length}, speed on ${speedFromOsm}/${kept.length}`)
    console.log(`  corridors: ${corridors.length} (${reportable} reportable)`)
    console.log(`  routable edges: ${routableCount}/${kept.length} (${(100*routableCount/kept.length).toFixed(0)}% -- the rest is drawn but not assigned)`)
    console.log(`  wrote ${path.relative(process.cwd(), file)} (${mb} MB)`)
}

const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const all = process.argv.includes("--all")
const targets = all ? Object.keys(STUDY_AREAS) : ids
if (targets.length === 0) {
    console.error("usage: node scripts/build-graph.mjs <area-id ...|--all>")
    process.exit(1)
}
for (const id of targets) await build(id)
console.log("\ndone.")
