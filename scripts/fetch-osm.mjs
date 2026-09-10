/**
 * Pulls the road network and emergency facilities for a study area from
 * OpenStreetMap via Overpass, and caches the raw response.
 *
 * Raw responses are kept in data/raw so that re-running the pipeline costs
 * nothing and so the exact bytes behind every VERIFIED number stay auditable.
 * Overpass is a shared volunteer service: it rate-limits, it times out on big
 * extracts, and any given mirror may be down, so requests fail over.
 *
 *   node scripts/fetch-osm.mjs arkansas
 *   node scripts/fetch-osm.mjs --all --force
 */

import { writeFile, readFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { STUDY_AREAS, OVERPASS_ENDPOINTS } from "./config.mjs"

const RAW_DIR = path.join(process.cwd(), "data", "raw")

/** Overpass counts a query against your IP, so leave room between attempts. */
const RETRY_DELAY_MS = 8000
const MAX_ATTEMPTS = 3

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function overpass(query, label) {
    let lastError
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        for (const endpoint of OVERPASS_ENDPOINTS) {
            const host = new URL(endpoint).host
            process.stdout.write(`  [${label}] ${host} (attempt ${attempt})... `)
            try {
                const res = await fetch(endpoint, {
                    method: "POST",
                    body: new URLSearchParams({ data: query }),
                    // Overpass returns 429/504 as HTML; the JSON parse below is
                    // what actually catches those, so read status first.
                    headers: { "User-Agent": "CivicFlow/1.0 (civic planning simulator)" },
                    signal: AbortSignal.timeout(600_000),
                })
                if (!res.ok) {
                    console.log(`HTTP ${res.status}`)
                    lastError = new Error(`HTTP ${res.status} from ${host}`)
                    continue
                }
                const text = await res.text()
                const json = JSON.parse(text)
                console.log(`ok, ${json.elements.length} elements, ${(text.length / 1e6).toFixed(1)} MB`)
                return json
            } catch (err) {
                console.log(`failed (${err.message.slice(0, 60)})`)
                lastError = err
            }
        }
        if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt)
    }
    throw new Error(`Overpass failed for ${label}: ${lastError?.message}`)
}

/**
 * `out geom` inlines each way's coordinates, which avoids a second pass to
 * resolve node ids. It roughly triples the payload but makes the cached file
 * self-contained, which matters more than bytes here.
 */
function roadQuery(bbox, classes) {
    const [s, w, n, e] = bbox
    return `[out:json][timeout:600];
way["highway"~"^(${classes.join("|")})$"]["area"!~"yes"](${s},${w},${n},${e});
out geom;`
}

/**
 * Fire stations, hospitals and ambulance stations. Requested as `nwr` because
 * a station may be mapped as a point, a building outline, or a multipolygon
 * site, and dropping any of those would silently understate coverage.
 */
function facilityQuery(bbox) {
    const [s, w, n, e] = bbox
    return `[out:json][timeout:300];
(
  nwr["amenity"="fire_station"](${s},${w},${n},${e});
  nwr["amenity"="hospital"](${s},${w},${n},${e});
  nwr["emergency"="ambulance_station"](${s},${w},${n},${e});
);
out center tags;`
}

async function fetchArea(area, force) {
    console.log(`\n== ${area.label} (${area.id}) ==`)
    await mkdir(RAW_DIR, { recursive: true })

    const targets = [
        { name: `${area.id}-roads`, query: roadQuery(area.bbox, area.roadClasses) },
        { name: `${area.id}-facilities`, query: facilityQuery(area.bbox) },
    ]

    for (const { name, query } of targets) {
        const file = path.join(RAW_DIR, `${name}.json`)
        if (existsSync(file) && !force) {
            const cached = JSON.parse(await readFile(file, "utf8"))
            console.log(`  [${name}] cached, ${cached.elements.length} elements`)
            continue
        }
        const json = await overpass(query, name)
        await writeFile(file, JSON.stringify(json))
        // Overpass asks for a pause between heavy queries from one client.
        await sleep(3000)
    }
}

const args = process.argv.slice(2)
const force = args.includes("--force")
const ids = args.includes("--all")
    ? Object.keys(STUDY_AREAS)
    : args.filter((a) => !a.startsWith("--"))

if (ids.length === 0) {
    console.error("usage: node scripts/fetch-osm.mjs <area-id ...|--all> [--force]")
    console.error(`areas: ${Object.keys(STUDY_AREAS).join(", ")}`)
    process.exit(1)
}

for (const id of ids) {
    const area = STUDY_AREAS[id]
    if (!area) throw new Error(`unknown study area: ${id}`)
    await fetchArea(area, force)
}
console.log("\ndone.")
