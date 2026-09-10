/**
 * Shared access to the statewide hero payload.
 *
 * Every gallery tile draws from the same 1.5 MB file, so it is fetched once and
 * the parsed geometry is cached at module scope. Thirteen tiles each issuing
 * their own request would be thirteen copies of the same network in memory.
 */

import type { DrawGeometry } from "@/render/network"

export interface HeroData {
    bbox: [number, number, number, number]
    counts: { edges: number; stressedEdges: number }
    edges: {
        lon: number[]
        lat: number[]
        offset: number[]
        count: number[]
        cls: string[]
        vc: number[]
    }
    counties: { name: string; population: number; centroid: [number, number] }[]
    facilities: [number, number][]
    totals: {
        population: number
        facilities: number
        counties: number
        meanTripMin: number
        emergencySharePct: number
    }
}

export interface HeroBundle {
    data: HeroData
    geo: DrawGeometry
    vc: Float32Array
}

let pending: Promise<HeroBundle> | null = null

export function loadHero(): Promise<HeroBundle> {
    if (pending) return pending
    pending = fetch("/data/hero.json")
        .then((r) => r.json())
        .then((data: HeroData) => {
            const n = data.edges.count.length
            const geo: DrawGeometry = {
                lon: Float32Array.from(data.edges.lon),
                lat: Float32Array.from(data.edges.lat),
                offset: Int32Array.from(data.edges.offset),
                count: Int32Array.from(data.edges.count),
                width: Float32Array.from(data.edges.cls, (c) =>
                    c.startsWith("motorway") ? 2.2 : c.startsWith("trunk") ? 1.7 : 1.2,
                ),
                // Tiles are never scrubbed, so everything is present from the start.
                revealAt: new Float32Array(n),
                order: Int32Array.from({ length: n }, (_, i) => i),
                edgeCount: n,
            }
            return { data, geo, vc: Float32Array.from(data.edges.vc) }
        })
    return pending
}

/**
 * Counts what is inside a tile's window, so each card can state real figures
 * rather than a caption. Edges are tested by their first vertex, which is close
 * enough at these window sizes and avoids walking every point.
 */
export function windowStats(
    bundle: HeroBundle,
    centre: [number, number],
    spanDeg: number,
) {
    const { data, vc } = bundle
    const halfLon = spanDeg / 2
    const halfLat = spanDeg / 2 / 1.24 // rough cosine correction at ~35N

    let segments = 0
    let stressed = 0
    for (let e = 0; e < data.edges.count.length; e++) {
        const o = data.edges.offset[e]
        const lon = data.edges.lon[o]
        const lat = data.edges.lat[o]
        if (Math.abs(lon - centre[0]) > halfLon || Math.abs(lat - centre[1]) > halfLat) continue
        segments++
        if (vc[e] >= 0.85) stressed++
    }

    let stations = 0
    for (const [lon, lat] of data.facilities) {
        if (Math.abs(lon - centre[0]) > halfLon || Math.abs(lat - centre[1]) > halfLat) continue
        stations++
    }

    return { segments, stressed, stations }
}
