/**
 * Canvas renderer for the road network.
 *
 * One renderer serves both the hero and the map. That is the reason deck.gl and
 * MapLibre are not here: the hero has to draw the network *becoming* itself
 * under scroll control, which is not what a map library is shaped for, and
 * having two renderers would mean the opening sequence and the tool it
 * introduces could drift apart visually. They cannot, because they are the same
 * code with different arguments.
 *
 * Geometry is projected once at load into flat typed arrays and decimated to a
 * few points per edge. Per frame the loop then only reads numbers in order --
 * no object access, no allocation -- which is what keeps 30,000 edges at 60fps
 * in a 2D context.
 */

import type { RawGraph } from "@/engine/graph"

export interface Viewport {
    width: number
    height: number
    /** Longitude and latitude at the centre of the canvas. */
    centerLon: number
    centerLat: number
    /** Pixels per degree of longitude. */
    scale: number
}

/**
 * Equirectangular with a cosine correction at the view's latitude.
 *
 * Web Mercator would be the reflex choice, but nothing here is tiled and no
 * basemap has to line up, and across a single state its extra distortion buys
 * nothing. This keeps the projection to two multiplications.
 */
export function project(
    lon: number,
    lat: number,
    v: Viewport,
    cosLat: number,
): [number, number] {
    return [
        v.width / 2 + (lon - v.centerLon) * v.scale,
        v.height / 2 - (lat - v.centerLat) * (v.scale / cosLat),
    ]
}

/** Road classes ordered coarse to fine; also the hero's reveal order. */
const CLASS_ORDER = [
    "motorway", "motorway_link",
    "trunk", "trunk_link",
    "primary", "primary_link",
    "secondary", "secondary_link",
    "tertiary", "tertiary_link",
    "unclassified", "residential",
] as const

const CLASS_RANK: Record<string, number> = {}
CLASS_ORDER.forEach((c, i) => (CLASS_RANK[c] = i))

/** Stroke width by class, in CSS pixels at scale 1. */
const CLASS_WIDTH: Record<string, number> = {
    motorway: 1.9, motorway_link: 1.0,
    trunk: 1.6, trunk_link: 0.9,
    primary: 1.3, primary_link: 0.8,
    secondary: 1.0, secondary_link: 0.7,
    tertiary: 0.8, tertiary_link: 0.6,
    unclassified: 0.5, residential: 0.45,
}

/**
 * Edge geometry flattened and decimated for drawing.
 *
 * `points` holds every vertex of every edge back to back; `offset` and `count`
 * index into it. Decimation keeps the ends and samples the middle, which is
 * invisible at these zoom levels and cuts the per-frame work by roughly half on
 * the statewide network.
 */
export interface DrawGeometry {
    lon: Float32Array
    lat: Float32Array
    offset: Int32Array
    count: Int32Array
    width: Float32Array
    /** 0-1, when this edge appears during the hero reveal. */
    revealAt: Float32Array
    /** Draw order: coarse roads first, so the skeleton reads before the detail. */
    order: Int32Array
    edgeCount: number
}

const MAX_POINTS_PER_EDGE = 6

export function buildDrawGeometry(raw: RawGraph): DrawGeometry {
    const m = raw.counts.edges
    const { geomOffset, geomCount, cls } = raw.edges
    const srcLon = raw.geometry.lon
    const srcLat = raw.geometry.lat

    // Worst case is every edge keeping the cap.
    const lon = new Float32Array(m * MAX_POINTS_PER_EDGE)
    const lat = new Float32Array(m * MAX_POINTS_PER_EDGE)
    const offset = new Int32Array(m)
    const count = new Int32Array(m)
    const width = new Float32Array(m)
    const revealAt = new Float32Array(m)

    let w = 0
    for (let e = 0; e < m; e++) {
        const n = geomCount[e]
        const o = geomOffset[e]
        offset[e] = w

        if (n <= MAX_POINTS_PER_EDGE) {
            for (let i = 0; i < n; i++) {
                lon[w] = srcLon[o + i]
                lat[w] = srcLat[o + i]
                w++
            }
            count[e] = n
        } else {
            // Keep both ends exactly; sample evenly between them.
            for (let i = 0; i < MAX_POINTS_PER_EDGE; i++) {
                const t = i / (MAX_POINTS_PER_EDGE - 1)
                const src = o + Math.round(t * (n - 1))
                lon[w] = srcLon[src]
                lat[w] = srcLat[src]
                w++
            }
            count[e] = MAX_POINTS_PER_EDGE
        }

        const c = cls[e]
        width[e] = CLASS_WIDTH[c] ?? 0.5
        // Reveal spreads the twelve classes across the first part of the scrub,
        // with a little jitter so a class does not snap in as one solid block.
        const rank = CLASS_RANK[c] ?? CLASS_ORDER.length - 1
        const jitter = ((e * 2654435761) % 1000) / 1000
        revealAt[e] = Math.min(0.98, (rank / CLASS_ORDER.length) * 0.85 + jitter * 0.12)
    }

    const order = Int32Array.from({ length: m }, (_, i) => i).sort(
        (a, b) => (CLASS_RANK[cls[b]] ?? 99) - (CLASS_RANK[cls[a]] ?? 99),
    )

    return { lon, lat, offset, count, width, revealAt, order, edgeCount: m }
}

/* --- colour ------------------------------------------------------------ */

/**
 * Volume-to-capacity ramp.
 *
 * The band boundaries are the Highway Capacity Manual's, not a designer's: 0.85
 * is the level-of-service C/D line where flow stops being free, and 1.0 is
 * capacity. Colour here is a reading, so the same ratio always gets the same
 * colour on the map, in the chain and in the hero.
 */
export function vcColor(vc: number): string {
    if (vc < 0.5) return "#3ddc97"
    if (vc < 0.7) return "#8ed081"
    if (vc < 0.85) return "#f2c14e"
    if (vc < 1.0) return "#f28f3b"
    return "#e5484d"
}

/**
 * Unloaded network colour.
 *
 * Dim enough that the stress ramp still reads as the signal, but well clear of
 * the #06070a ground -- the first pass sat so close to the background that the
 * statewide network looked like a few stray scratches rather than a road system.
 */
export const IDLE = "#39414f"
export const IDLE_MAJOR = "#57627a"

/** Classes drawn heavier, because at state scale they are the skeleton. */
export function isMajorClass(cls: string): boolean {
    return cls === "motorway" || cls === "trunk" || cls === "motorway_link" || cls === "trunk_link"
}

export interface RenderOptions {
    /** 0-1 hero reveal; 1 draws everything. */
    reveal?: number
    /** How strongly v/c colour is mixed in, 0-1. */
    stress?: number
    vc?: Float32Array
    /** Population bloom, 0-1. */
    bloom?: number
    zones?: { centroid: [number, number]; population: number }[]
    facilities?: { lonLat: [number, number]; kind: string }[]
    facilityOpacity?: number
    dpr?: number
}

export function renderNetwork(
    ctx: CanvasRenderingContext2D,
    geo: DrawGeometry,
    v: Viewport,
    opts: RenderOptions = {},
) {
    const { reveal = 1, stress = 0, vc, bloom = 0, zones, facilities, facilityOpacity = 0 } = opts
    const cosLat = Math.cos((v.centerLat * Math.PI) / 180)
    const dpr = opts.dpr ?? 1

    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, v.width, v.height)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"

    const halfW = v.width / 2
    const halfH = v.height / 2
    const sx = v.scale
    const sy = v.scale / cosLat

    /* Roads are grouped by stroke style before drawing. Setting strokeStyle or
       lineWidth flushes the current path, so changing them per edge would mean
       thirty thousand separate strokes; batching gets it down to a couple of
       dozen. */
    const buckets = new Map<string, number[]>()

    for (let k = 0; k < geo.edgeCount; k++) {
        const e = geo.order[k]
        if (geo.revealAt[e] > reveal) continue

        let color: string
        if (vc && stress > 0) {
            const ratio = vc[e]
            color = ratio > 0 ? vcColor(ratio) : geo.width[e] > 1 ? IDLE_MAJOR : IDLE
            if (stress < 1 && ratio > 0) {
                // Fade the stress ramp in rather than snapping to it.
                color = mix(geo.width[e] > 1 ? IDLE_MAJOR : IDLE, color, stress)
            }
        } else {
            color = geo.width[e] > 1 ? IDLE_MAJOR : IDLE
        }

        const wKey = geo.width[e].toFixed(2)
        const key = `${color}|${wKey}`
        let bucket = buckets.get(key)
        if (!bucket) buckets.set(key, (bucket = []))
        bucket.push(e)
    }

    for (const [key, edges] of buckets) {
        const [color, wStr] = key.split("|")
        ctx.strokeStyle = color
        ctx.lineWidth = Number(wStr)
        ctx.beginPath()
        for (const e of edges) {
            const o = geo.offset[e]
            const n = geo.count[e]
            for (let i = 0; i < n; i++) {
                const x = halfW + (geo.lon[o + i] - v.centerLon) * sx
                const y = halfH - (geo.lat[o + i] - v.centerLat) * sy
                if (i === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
            }
        }
        ctx.stroke()
    }

    /* Population, as light rather than as dots: an additive bloom reads as
       inhabited area instead of as a scatter plot of centroids. */
    if (bloom > 0 && zones?.length) {
        ctx.globalCompositeOperation = "lighter"
        for (const z of zones) {
            if (z.population <= 0) continue
            const x = halfW + (z.centroid[0] - v.centerLon) * sx
            const y = halfH - (z.centroid[1] - v.centerLat) * sy
            if (x < -40 || x > v.width + 40 || y < -40 || y > v.height + 40) continue
            const r = Math.min(26, 2 + Math.sqrt(z.population) * 0.09) * bloom
            const g = ctx.createRadialGradient(x, y, 0, x, y, r)
            g.addColorStop(0, `rgba(110,168,254,${0.5 * bloom})`)
            g.addColorStop(1, "rgba(110,168,254,0)")
            ctx.fillStyle = g
            ctx.beginPath()
            ctx.arc(x, y, r, 0, Math.PI * 2)
            ctx.fill()
        }
        ctx.globalCompositeOperation = "source-over"
    }

    if (facilityOpacity > 0 && facilities?.length) {
        ctx.fillStyle = `rgba(61,220,151,${facilityOpacity})`
        for (const f of facilities) {
            const x = halfW + (f.lonLat[0] - v.centerLon) * sx
            const y = halfH - (f.lonLat[1] - v.centerLat) * sy
            if (x < 0 || x > v.width || y < 0 || y > v.height) continue
            ctx.fillRect(x - 1.5, y - 1.5, 3, 3)
        }
    }

    ctx.restore()
}

/** Hex mix, used to fade the stress ramp in over the idle colour. */
function mix(a: string, b: string, t: number): string {
    const pa = parseInt(a.slice(1), 16)
    const pb = parseInt(b.slice(1), 16)
    const r = Math.round((((pa >> 16) & 255) * (1 - t)) + (((pb >> 16) & 255) * t))
    const g = Math.round((((pa >> 8) & 255) * (1 - t)) + (((pb >> 8) & 255) * t))
    const bl = Math.round(((pa & 255) * (1 - t)) + ((pb & 255) * t))
    return `rgb(${r},${g},${bl})`
}

/** Fits a bounding box into the viewport with a margin. */
export function fitBbox(
    bbox: [number, number, number, number],
    width: number,
    height: number,
    margin = 0.92,
): Viewport {
    const [s, w, n, e] = bbox
    const centerLon = (w + e) / 2
    const centerLat = (s + n) / 2
    const cosLat = Math.cos((centerLat * Math.PI) / 180)
    const scaleX = width / (e - w)
    const scaleY = (height / (n - s)) * cosLat
    return { width, height, centerLon, centerLat, scale: Math.min(scaleX, scaleY) * margin }
}
