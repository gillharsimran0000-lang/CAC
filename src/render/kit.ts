/**
 * The parts everything in a preview is built from.
 *
 * Split out of src/data/projects.ts once a second file needed the same block,
 * plate and tree. Two copies of a `plate` helper is how two previews end up
 * with subtly different paving, and the whole argument for generating this
 * geometry rather than importing meshes is that one change to a primitive
 * reaches every scene at once.
 *
 * Nothing here knows what it is drawing. It knows about footprints, ribbons and
 * lines; the meaning lives in src/data/projects.ts (twenty specific Arkansas
 * projects) and src/data/placeScenes.ts (whatever place the person picked).
 */

import { Solid, Strand, circle, flatten } from "./solids"

/** Read off globals.css, so a preview sits in the same light as everything else. */
export const C = {
    road: "#7aa5e6",
    deck: "#98a2b3",
    steel: "#f2c14e",
    water: "#4a5f8a",
    earth: "#dd8a63",
    green: "#3f9079",
    built: "#c9d0dc",
    warm: "#d9b26a",
    alert: "#e5484d",
    pipe: "#3ddc97",
    rail: "#c084fc",
} as const

/** A building: an extruded footprint with a sensible default colour. */
export const block = (
    base: [number, number][],
    height: number,
    t: number,
    color: string = C.built,
    lift = 0,
): Solid => ({ base, height, t, color, lift })

/** Paving, water, a green, a slab: a footprint with no walls. */
export const plate = (
    base: [number, number][],
    t: number,
    color: string,
    lift = 0,
): Solid => ({ base, height: 0, t, color, lift, flat: true })

/**
 * Context: something that is already there.
 *
 * The same solid at a fifth of the usual face opacity. Place-aware scenes draw
 * the settlement and the landscape that exist before the change, and if those
 * are drawn at full strength the change itself is lost inside them. Held faint,
 * they do the one job they are there for: giving the new thing somewhere to be.
 */
export const faint = (s: Solid, opacity = 0.05): Solid => ({ ...s, opacity })

/** Carriageway: a centreline drawn as a ribbon at a constant height. */
export const road = (
    centre: [number, number][],
    width: number,
    t: number,
    z = 0,
    color: string = C.road,
): Strand => ({ points: flatten(centre, z), color, width: 1.1, t, ribbon: width })

/** A line in the air: a cable, a rail, a fence, a hanger. */
export const line = (
    points: [number, number, number][],
    t: number,
    color: string,
    width = 1.1,
    dashed = false,
): Strand => ({ points, color, width, t, dashed })

/** A dashed circle on the ground. Response bands and site boundaries. */
export const circleLine = (
    cx: number,
    cy: number,
    r: number,
    t: number,
    color: string,
): Strand => ({
    points: flatten([...circle(cx, cy, r, 48), circle(cx, cy, r, 48)[0]], 0),
    color,
    width: 1,
    t,
    dashed: true,
    opacity: 0.5,
})

/** A small tree: a trunk with a canopy plate on top. */
export function tree(x: number, y: number, t: number, h = 9): [Strand, Solid] {
    return [
        { points: [[x, y, 0], [x, y, h]], color: C.green, width: 1, t, opacity: 0.6 },
        plate(circle(x, y, 4.5, 8), t, C.green, h),
    ]
}

/**
 * A deterministic pseudo-random number in [0, 1).
 *
 * Scenes need scatter -- farmsteads are not on a grid, and a row of identical
 * buildings reads as a diagram rather than a place -- but they must not need
 * Math.random. A scene rebuilt on every render with fresh noise would shuffle
 * itself under the pointer, and the same zone would look like a different place
 * each time you selected it. Seeding on the zone's own identity means a place
 * looks the same every time you come back to it, which is the entire difference
 * between a picture of somewhere and a picture of nowhere.
 */
export function seeded(seed: number) {
    let s = (seed >>> 0) || 1
    return () => {
        // xorshift32: small, fast, and good enough to place a barn.
        s ^= s << 13
        s ^= s >>> 17
        s ^= s << 5
        return ((s >>> 0) % 100000) / 100000
    }
}

/** A stable seed from any string, so a GEOID can drive the scatter. */
export function hash(text: string): number {
    let h = 2166136261
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i)
        h = Math.imul(h, 16777619)
    }
    return h >>> 0
}
