/**
 * THE PREVIEW, BUILT FROM THE PLACE.
 *
 * A scene here is three layers, and the order is the argument.
 *
 *   LANDSCAPE   what is under everything, from the region the zone sits in.
 *   SETTLEMENT  what is already built, from the zone's measured density.
 *   THE CHANGE  what you are about to do, drawn bright on top of both.
 *
 * The first two are held faint on purpose. They are context, and if they are
 * drawn at full strength the change disappears into them. But they are not
 * decoration: a road diet in the Delta and the same diet in the Ozarks are
 * genuinely different projects, and the reason is entirely in those two layers.
 * Ten thousand people into a tract with 3,000 already there is infill; the same
 * ten thousand into open country is a new town, and the model scores them
 * differently. The picture should say so before the run does.
 *
 * Everything scales off numbers the simulation itself uses. How many buildings
 * appear is derived from the residents being added and the zone's own household
 * size; how far apart the streets sit is derived from its metres of street per
 * dwelling. So the drawing cannot claim a density the engine is not about to
 * charge for.
 *
 * The scatter is seeded on the zone's GEOID. A place therefore looks the same
 * every time you come back to it, which is the whole difference between a
 * picture of somewhere and a picture of nowhere.
 */

import { AxisKey } from "@/engine/types"
import { Mechanism, Scene, Solid, Strand, arc, circle, flatten, repeat, rotRect, rect, strip } from "@/render/solids"
import { C, block, circleLine, faint, hash, line, plate, seeded, tree } from "@/render/kit"
import { PlaceProfile, Region, householdSize } from "./place"

export type LeverKind =
    | "residents"
    | "decline"
    | "jobs"
    | "corridor"
    | "diet"
    | "speed"
    | "fire"
    | "ems"
    | "closure"
    | "utility"

export interface AxisTouch {
    axis: AxisKey
    direction: "up" | "down" | "either"
    because: string
}

/** Half-width of every place scene, metres. One frame for all of them. */
const EXTENT = 620

interface Layer {
    solids: Solid[]
    strands: Strand[]
}

const EMPTY: Layer = { solids: [], strands: [] }

/**
 * Marks a whole layer as the site rather than the proposal.
 *
 * The blueprint view plays the site in first and then draws the change over it,
 * which needs to know which is which. Applied here, once, rather than on every
 * primitive in the landscape and settlement builders: those two functions ARE
 * the site by definition, and tagging at the call site means a new landform
 * cannot forget.
 */
const asSite = (l: Layer): Layer => ({
    solids: l.solids.map((s) => ({ ...s, layer: "site" as const })),
    strands: l.strands.map((st) => ({ ...st, layer: "site" as const })),
})
const merge = (...ls: Layer[]): Layer => ({
    solids: ls.flatMap((l) => l.solids),
    strands: ls.flatMap((l) => l.strands),
})

/**
 * Narrows a layer across the road, leaving its length alone.
 *
 * The frame is measured from everything drawn, so a corridor scene was being
 * fitted to the square of countryside behind it rather than to the road: an
 * eight hundred metre road across sixteen hundred metres of section grid is
 * genuinely a thin line, and the picture was right and useless. Squashing the
 * landscape into a band around the alignment is the same move a strip map
 * makes, and for the same reason: the subject is long and thin, so the frame
 * should be too.
 */
function squash(layer: Layer, fy: number): Layer {
    return {
        solids: layer.solids.map((s) => ({
            ...s,
            base: s.base.map(([x, y]) => [x, y * fy] as [number, number]),
        })),
        strands: layer.strands.map((st) => ({
            ...st,
            points: st.points.map(([x, y, z]) => [x, y * fy, z] as [number, number, number]),
            ribbon: st.ribbon ? st.ribbon * fy : st.ribbon,
        })),
    }
}

/* --- layer one: the ground -------------------------------------------- */

/**
 * What the land does here.
 *
 * Five regions, five genuinely different pictures. The Ouachitas run east to
 * west and the Ozarks are dissected in every direction, which is a real
 * distinction between two ranges a hundred miles apart and the sort of thing a
 * single "mountains" texture would flatten.
 */
function landscape(region: Region, rnd: () => number): Layer {
    /* Terrain is drawn FLAT, with a crest line over it.
     *
     * The first version extruded ridges as solids, which is what a building is,
     * and the result was a set of translucent slabs standing across the scene
     * like panes of glass. Ground does not have walls. A ridge reads as a ridge
     * from a raised line running along its spine and a soft footprint under it,
     * and it stays underneath the thing the panel is actually about. */
    const ridge = (
        base: [number, number][],
        crest: [number, number][],
        height: number,
        t: number,
    ): Layer => ({
        solids: [faint(plate(base, t, C.earth), 0.05)],
        strands: [
            { points: flatten(crest, height), color: C.earth, width: 1.3, t: t + 0.02, opacity: 0.45 },
        ],
    })

    switch (region) {
        case "ozarks": {
            // Dissected plateau: ridges at broken angles, hollows between them.
            const ridges = repeat(4, (i, t) => {
                const cx = -360 + i * 250
                const cy = -240 + rnd() * 480
                const a = -0.9 + rnd() * 1.8
                const half = 380
                const crest: [number, number][] = [
                    [cx - Math.cos(a) * half, cy - Math.sin(a) * half],
                    [cx + Math.cos(a) * half * 0.3, cy + Math.sin(a) * half * 0.3],
                    [cx + Math.cos(a) * half, cy + Math.sin(a) * half],
                ]
                return ridge(rotRect(cx, cy, 760, 240, a), crest, 30 + rnd() * 18, 0.02 + t * 0.05)
            })
            const creek = repeat(14, (i) => [-620 + i * 95, Math.sin(i / 2.1) * 130] as [number, number])
            return merge(...ridges, {
                solids: [],
                strands: [
                    { points: flatten(creek, 0), color: C.water, width: 1.2, t: 0.1, ribbon: 22, opacity: 0.5 },
                ],
            })
        }
        case "ouachitas": {
            // Long parallel ridges, all running the same way, which is what
            // makes this range unusual and what makes it recognisable.
            const ridges = repeat(4, (i, t) => {
                const y = -400 + i * 270
                return ridge(
                    rect(0, y, 1350, 150),
                    [[-660, y], [0, y + 18], [660, y]],
                    38 + rnd() * 16,
                    0.02 + t * 0.05,
                )
            })
            return merge(...ridges, {
                solids: [faint(plate(circle(340, 240, 170, 20), 0.1, C.water), 0.14)],
                strands: [],
            })
        }
        case "valley": {
            // The river, bottomland on one bank, a bluff line on the other.
            const river = repeat(14, (i) => [-680 + i * 105, -240 + Math.sin(i / 3) * 60] as [number, number])
            const bluff = river.map(([x, y]) => [x, y + 330] as [number, number])
            return {
                solids: [
                    faint(plate(strip(river, 200), 0.04, C.water), 0.16),
                    faint(plate(strip(bluff, 300), 0.08, C.earth), 0.05),
                ],
                strands: [
                    { points: flatten(bluff, 40), color: C.earth, width: 1.3, t: 0.11, opacity: 0.45 },
                ],
            }
        }
        case "delta": {
            /* The section grid. Arkansas east of Crowley's Ridge is laid out on
               the Public Land Survey, and a quarter-quarter section is 40 acres
               and about 400 m on a side: this is drawn at that size because
               that is the size it is. Nothing stands up here, which is the
               single most reliable fact about the Delta. */
            const fields: Solid[] = []
            for (let i = 0; i < 4; i++) {
                for (let j = 0; j < 4; j++) {
                    fields.push(
                        faint(
                            plate(rect(-600 + i * 400, -600 + j * 400, 380, 380), 0.02 + i * 0.02, C.green),
                            0.055,
                        ),
                    )
                }
            }
            return {
                solids: fields,
                strands: repeat(3, (i) =>
                    // Field ditches, dead straight, on the section lines.
                    line([[-800 + i * 400, -800, 0], [-800 + i * 400, 800, 0]], 0.06, C.water, 1),
                ),
            }
        }
        case "coastal": {
            // Rolling pine. The trees are the landscape here.
            const stands = repeat(30, () =>
                tree(-580 + rnd() * 1160, -580 + rnd() * 1160, 0.04 + rnd() * 0.08, 16 + rnd() * 12),
            )
            return {
                solids: [
                    faint(plate(rect(-120, 120, 1200, 700), 0.02, C.earth), 0.04),
                    ...stands.map(([, canopy]) => ({ ...canopy, opacity: 0.1 })),
                ],
                strands: [
                    ...stands.map(([trunk]) => ({ ...trunk, opacity: 0.3 })),
                    line([[-620, -420, 0], [620, -300, 0]], 0.08, C.water, 1.4),
                ],
            }
        }
    }
}

/* --- layer two: what is already built ---------------------------------- */

/**
 * Street spacing implied by the zone's own metres of street per dwelling.
 *
 * The same quantity the growth-efficiency axis is built on. A tract carrying
 * 15 m of street per home is a place with short blocks; one carrying 300 m is a
 * place with long ones, and drawing them at the same spacing would contradict
 * the axis that is about to score them.
 */
function blockSpacing(p: PlaceProfile): number {
    const m = p.roadMPerDwelling ?? 60
    return Math.max(90, Math.min(320, 70 + m * 1.6))
}

/** Roughly how tall things are here, from the form. */
const FORM_HEIGHT: Record<PlaceProfile["form"], [number, number]> = {
    core: [22, 58],
    town: [11, 26],
    suburban: [7, 12],
    village: [6, 11],
    rural: [5, 9],
}

/**
 * The place as it stands.
 *
 * Held faint, and deliberately incomplete: this is the setting, not an
 * inventory. A core zone gets a continuous grid, a rural one gets a section
 * road and a handful of farmsteads, and the two are as different as the places
 * they stand for.
 */
function settlement(p: PlaceProfile, rnd: () => number): Layer {
    const [lo, hi] = FORM_HEIGHT[p.form]
    const gap = blockSpacing(p)

    if (p.form === "rural") {
        const steads = repeat(7, (i, t) => {
            const x = -540 + rnd() * 1080
            const y = -520 + rnd() * 1040
            return [
                faint(block(rect(x, y, 42, 30), 6 + rnd() * 4, 0.12 + t * 0.06, C.built), 0.07),
                faint(block(rect(x + 46, y + 12, 30, 22), 8, 0.13 + t * 0.06, C.built), 0.06),
            ]
        }).flat()
        return {
            solids: steads,
            strands: [
                { points: flatten([[-620, -60], [620, 20]] as [number, number][], 0), color: C.deck, width: 1.2, t: 0.1, ribbon: 16, opacity: 0.5 },
                { points: flatten([[-40, -620], [40, 620]] as [number, number][], 0), color: C.deck, width: 1, t: 0.12, ribbon: 12, opacity: 0.4 },
            ],
        }
    }

    if (p.form === "village") {
        // A main street, a courthouse square, and not much else.
        const main = repeat(2, (k) => [-600 + k * 1200, 40] as [number, number])
        return {
            solids: [
                ...repeat(5, (i, t) =>
                    faint(block(rect(-300 + i * 150, 130, 120, 70), lo + rnd() * (hi - lo), 0.14 + t * 0.05, C.built), 0.07),
                ),
                ...repeat(5, (i, t) =>
                    faint(block(rect(-260 + i * 150, -60, 120, 70), lo + rnd() * (hi - lo), 0.15 + t * 0.05, C.built), 0.07),
                ),
                faint(plate(rect(360, 40, 200, 200), 0.12, C.green), 0.09),
            ],
            strands: [
                { points: flatten(main, 0), color: C.deck, width: 1.3, t: 0.1, ribbon: 26, opacity: 0.55 },
                ...repeat(3, (i) => ({
                    points: flatten(repeat(2, (k) => [-260 + i * 300, -300 + k * 600] as [number, number]), 0),
                    color: C.deck,
                    width: 1,
                    t: 0.12,
                    ribbon: 14,
                    opacity: 0.4,
                })),
            ],
        }
    }

    if (p.form === "suburban") {
        // Curving streets, and lots hung off them.
        const loops = repeat(3, (i) => ({
            cx: -300 + i * 300,
            cy: -140 + (i % 2) * 260,
            pts: arc(-300 + i * 300, -140 + (i % 2) * 260, 150, -0.4, Math.PI * 1.7, 22),
        }))
        return {
            solids: loops.flatMap((l, li) =>
                repeat(8, (k, t) => {
                    const a = -0.3 + t * Math.PI * 1.6
                    return faint(
                        block(
                            rotRect(l.cx + Math.cos(a) * 200, l.cy + Math.sin(a) * 200, 44, 32, a),
                            lo + rnd() * (hi - lo),
                            0.14 + li * 0.04 + t * 0.03,
                            C.built,
                        ),
                        0.07,
                    )
                }),
            ),
            strands: [
                { points: flatten([[-620, -420], [620, -340]] as [number, number][], 0), color: C.deck, width: 1.2, t: 0.08, ribbon: 20, opacity: 0.5 },
                ...loops.map((l, i) => ({
                    points: flatten(l.pts, 0),
                    color: C.deck,
                    width: 1,
                    t: 0.12 + i * 0.03,
                    ribbon: 12,
                    opacity: 0.4,
                })),
            ],
        }
    }

    // core and town: a grid, at the spacing the zone's own street ratio implies.
    const cols = Math.max(3, Math.min(6, Math.round(1100 / gap)))
    const solids: Solid[] = []
    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < cols; j++) {
            if (rnd() < 0.16) continue
            const x = -((cols - 1) / 2) * gap + i * gap
            const y = -((cols - 1) / 2) * gap + j * gap
            solids.push(
                faint(
                    block(rect(x, y, gap * 0.66, gap * 0.6), lo + rnd() * (hi - lo), 0.12 + (i + j) * 0.02, C.built),
                    0.07,
                ),
            )
        }
    }
    const strands: Strand[] = []
    for (let i = 0; i < cols + 1; i++) {
        const o = -((cols - 1) / 2) * gap - gap / 2 + i * gap
        strands.push({
            points: flatten(repeat(2, (k) => [-620 + k * 1240, o] as [number, number]), 0),
            color: C.deck, width: 1, t: 0.06, ribbon: gap * 0.16, opacity: 0.4,
        })
        strands.push({
            points: flatten(repeat(2, (k) => [o, -620 + k * 1240] as [number, number]), 0),
            color: C.deck, width: 1, t: 0.07, ribbon: gap * 0.13, opacity: 0.35,
        })
    }
    return { solids, strands }
}

/* --- layer three: the change ------------------------------------------- */

/**
 * How many new buildings to draw, from the residents being added.
 *
 * Dwellings, not people, and via the zone's own household size, so the count on
 * screen is the count the cost model is about to charge for. Capped at
 * twenty-eight because past that they stop being buildings and become texture,
 * and the label under the panel carries the real figure anyway.
 */
function newBuildings(p: PlaceProfile): number {
    const dwellings = Math.abs(p.amount) / householdSize(p)
    const per = p.form === "core" ? 90 : p.form === "town" ? 40 : 14
    return Math.max(3, Math.min(28, Math.round(dwellings / per)))
}

/** Where the change goes: a patch of the scene, not the whole of it. */
function developmentSites(p: PlaceProfile, rnd: () => number, count: number) {
    const gap = blockSpacing(p)
    const spread = p.form === "rural" || p.form === "village" ? 420 : 300
    return repeat(count, () => [
        -spread + rnd() * spread * 2,
        -spread + rnd() * spread * 2,
        gap,
    ] as [number, number, number])
}

function changeLayer(kind: LeverKind, p: PlaceProfile, rnd: () => number): Layer {
    const [lo, hi] = FORM_HEIGHT[p.form]

    switch (kind) {
        case "residents": {
            const sites = developmentSites(p, rnd, newBuildings(p))
            const w = p.form === "core" ? 96 : p.form === "town" ? 76 : 46
            return {
                solids: sites.map(([x, y], i) =>
                    block(rect(x, y, w, w * 0.78), lo + rnd() * (hi - lo) * 1.2, 0.35 + (i / sites.length) * 0.6, C.road),
                ),
                strands: [],
            }
        }
        case "decline": {
            /* An absence cannot be drawn as an object, so it is drawn as the
               ground coming back: cleared lots where buildings were, and the
               street still there in front of every one of them. That is the
               whole point of the axis this lever moves. */
            const sites = developmentSites(p, rnd, newBuildings(p))
            return {
                solids: sites.map(([x, y], i) => ({
                    ...plate(rect(x, y, 74, 58), 0.35 + (i / sites.length) * 0.6, C.green),
                    opacity: 0.1,
                })),
                strands: sites.map(([x, y], i) => ({
                    points: flatten(
                        [
                            [x - 37, y - 29],
                            [x + 37, y - 29],
                            [x + 37, y + 29],
                            [x - 37, y + 29],
                            [x - 37, y - 29],
                        ] as [number, number][],
                        0.3,
                    ),
                    color: C.warm,
                    width: 1,
                    t: 0.4 + (i / sites.length) * 0.5,
                    dashed: true,
                    opacity: 0.7,
                })),
            }
        }
        case "jobs": {
            // Floorplates in a field of parking, which is what a workplace looks
            // like from above anywhere in the state.
            const bays = repeat(9, (i) => -260 + i * 62)
            return {
                solids: [
                    plate(rect(0, -130, 600, 300), 0.15, C.deck),
                    block(rect(-150, 150, 240, 120), 18 + hi * 0.4, 0.45, C.rail),
                    block(rect(140, 170, 200, 130), 14 + hi * 0.3, 0.55, C.rail),
                    block(rect(300, -10, 130, 170), 22 + hi * 0.4, 0.65, C.rail),
                ],
                strands: [
                    ...bays.map((x, i) => line([[x, -260, 0.2], [x, 0, 0.2]], 0.2 + i * 0.02, C.deck, 0.7)),
                    line([[-300, -130, 0.3], [300, -130, 0.3]], 0.3, C.deck, 1.2),
                    { points: flatten([[-60, -280], [-60, -130]] as [number, number][], 0), color: C.road, width: 1.2, t: 0.75, ribbon: 20 },
                    // Trips arriving, which is the mechanism the lever uses.
                    ...repeat(3, (i, t) =>
                        line([[-460 + t * 240, -300 + t * 30, 8], [-190 + t * 180, -190 + t * 30, 8]], 0.85, C.steel, 1.6, true),
                    ),
                ],
            }
        }
        case "corridor":
        case "diet":
        case "speed": {
            const removing = kind === "diet"
            /* Longer and wider than the landscape behind it, on purpose. The
               frame is measured from everything in the scene, so a road drawn
               the same size as the section grid around it came out as a thin
               line across a field: on a corridor lever the road is the subject
               and has to be the thing the fit is built around. */
            const centre = repeat(25, (i) => [-780 + i * 65, Math.sin(i / 7) * 26] as [number, number])
            const off = (d: number) => centre.map(([x, y]) => [x, y + d] as [number, number])

            const base: Layer = {
                solids: [],
                strands: [
                    // The road as it is.
                    { points: flatten(centre, 0), color: C.deck, width: 1.8, t: 0.1, ribbon: 72 },
                    line(flatten(centre, 0.4), 0.2, C.steel, 1, true),
                ],
            }

            if (kind === "corridor") {
                return merge(base, {
                    solids: [],
                    strands: [
                        { points: flatten(off(50), 0.3), color: C.road, width: 1.8, t: 0.55, ribbon: 26 },
                        { points: flatten(off(-50), 0.3), color: C.road, width: 1.8, t: 0.7, ribbon: 26 },
                    ],
                })
            }
            if (removing) {
                return merge(base, {
                    solids: [],
                    strands: [
                        // What the lane becomes: a separated path.
                        { points: flatten(off(30), 0.4), color: C.pipe, width: 2, t: 0.6, ribbon: 15 },
                        // And the lane that is gone, outlined where it was.
                        { points: flatten(off(-30), 0.5), color: C.alert, width: 2, t: 0.75, ribbon: 15, dashed: true },
                    ],
                })
            }
            // speed: signs and build-outs, because that is all a limit is.
            return merge(base, {
                solids: repeat(4, (i, t) => plate(rect(-500 + t * 1000, 60, 28, 5), 0.6 + i * 0.06, C.alert, 20)),
                strands: [
                    ...repeat(4, (i, t) => ({
                        points: [[-500 + t * 1000, 60, 0], [-500 + t * 1000, 60, 20]] as [number, number, number][],
                        color: C.alert,
                        width: 1.6,
                        t: 0.55 + i * 0.06,
                    })),
                    ...repeat(3, (i, t) =>
                        repeat(5, (k, u) =>
                            line(
                                [
                                    [-420 + t * 840 + u * 11, -34, 0.3],
                                    [-420 + t * 840 + u * 11, 34, 0.3],
                                ],
                                0.85,
                                C.built,
                                1.6,
                            ),
                        ),
                    ).flat(),
                ],
            })
        }
        case "fire":
        case "ems": {
            const isFire = kind === "fire"
            return {
                solids: [
                    ...(isFire
                        ? repeat(3, (i, t) => block(rect(-60 + i * 62, 30, 56, 80), 12, 0.35 + t * 0.1, C.alert))
                        : [block(rect(-70, 40, 120, 84), 10, 0.35, C.alert)]),
                    ...(isFire ? [] : [plate(rect(70, 10, 150, 110), 0.55, C.deck, 7)]),
                    plate(rect(0, -70, 240, 120), 0.2, C.deck),
                    ...(isFire ? [plate(rect(-124, 62, 20, 20), 0.65, C.alert, 26)] : []),
                ],
                strands: [
                    ...(isFire
                        ? [{ points: [[-124, 62, 0], [-124, 62, 26]] as [number, number, number][], color: C.alert, width: 2, t: 0.6 }]
                        : [-15, 145, -15, 145].map((x, i) =>
                              line([[x, i < 2 ? -35 : 65, 0], [x, i < 2 ? -35 : 65, 7]], 0.5, C.deck, 1.4),
                          )),
                    circleLine(0, 0, 300, 0.85, C.alert),
                    circleLine(0, 0, 400, 0.92, C.alert),
                ],
            }
        }
        case "closure":
            return {
                solids: [
                    ...repeat(3, (i, t) => ({
                        ...block(rect(-60 + i * 62, 30, 56, 80), 12, 0.35 + t * 0.1, C.alert),
                        opacity: 0.1,
                    })),
                    { ...plate(rect(0, -70, 240, 120), 0.2, C.alert), opacity: 0.1 },
                ],
                strands: [
                    { points: [[-124, 62, 0], [-124, 62, 26]], color: C.alert, width: 2, t: 0.55, opacity: 0.4 },
                    // The band nobody covers from here any more.
                    circleLine(0, 0, 300, 0.75, C.alert),
                    circleLine(0, 0, 420, 0.85, C.alert),
                ],
            }
        case "utility": {
            const basins = repeat(3, (i, t) => ({ cx: -170 + i * 175, cy: 40, t }))
            return {
                solids: [
                    ...basins.map((b) => plate(circle(b.cx, b.cy, 76, 26), 0.3 + b.t * 0.2, C.pipe)),
                    ...basins.map((b) => plate(circle(b.cx, b.cy, 62, 26), 0.4 + b.t * 0.2, C.water)),
                    ...repeat(4, (i) =>
                        repeat(2, (j) => plate(rect(-140 + i * 95, -170 + j * 84, 82, 72), 0.6 + i * 0.04, C.water)),
                    ).flat(),
                    block(rect(230, -140, 96, 76), 12, 0.75, C.built),
                ],
                strands: [
                    ...basins.map((b) => line([[b.cx - 64, b.cy, 4], [b.cx + 64, b.cy, 4]], 0.5 + b.t * 0.15, C.pipe, 1.4)),
                    line([[-290, 40, 3], [-290, -170, 3], [220, -170, 3]], 0.8, C.pipe, 2),
                    line([[-290, 40, 1], [-560, 210, 1]], 0.9, C.pipe, 2.4, true),
                ],
            }
        }
    }
}

/* --- the scene ---------------------------------------------------------- */

/** Levers whose subject is the road, where the settlement is only the setting. */
const CORRIDOR_LEVERS: LeverKind[] = ["corridor", "diet", "speed"]

/**
 * A preview for one lever in one place.
 *
 * Vertical exaggeration is chosen from the FORM rather than fixed, because the
 * same factor cannot serve both: a downtown block is fifty metres tall over a
 * three hundred metre frame and needs none, while a farmstead is six metres
 * over the same frame and disappears without it.
 */
export function placeScene(kind: LeverKind, p: PlaceProfile): Scene {
    const rnd = seeded(hash(`${p.key}:${kind}`))
    const alongRoad = CORRIDOR_LEVERS.includes(kind)
    const ground = alongRoad ? squash(landscape(p.region, rnd), 0.38) : landscape(p.region, rnd)
    /* A corridor scene keeps the landscape and drops the settlement: the road
       runs across the frame, and a grid of buildings under it competes with the
       one thing being changed. */
    const built = alongRoad ? EMPTY : settlement(p, rnd)
    const change = changeLayer(kind, p, rnd)
    const all = merge(asSite(ground), asSite(built), change)

    const zScale =
        p.form === "core" ? 1.6 : p.form === "town" ? 2.2 : p.form === "suburban" ? 3 : 3.6

    return {
        extent: EXTENT,
        ground: "#0e1117",
        zScale: alongRoad ? 4 : zScale,
        solids: all.solids,
        strands: all.strands,
        mechanism: mechanismFor(kind, p, rnd),
    }
}

/**
 * WHAT THE LEVER DOES, ONCE IT IS BUILT.
 *
 * The fourth act of the blueprint. Every one of these is geometry and a stated
 * standard, never an outcome: a response band is 240 seconds of NFPA 1710
 * turned into distance at a plausible speed, trips are the journeys the engine
 * generates per resident leaving the dwellings that generated them, flow is
 * vehicles on the lanes the scenario asked for.
 *
 * None of it says how far an axis moves. That is the difference between showing
 * someone the mechanism and showing them a result they have not run yet, and
 * the label under the panel repeats it in words.
 */
function mechanismFor(kind: LeverKind, p: PlaceProfile, rnd: () => number): Mechanism | undefined {
    switch (kind) {
        case "residents":
        case "decline":
        case "jobs": {
            /* Journeys leaving the new dwellings. Heading is seeded on the zone
               so a place keeps the same one every visit, and it is arbitrary by
               construction: trip DISTRIBUTION is the engine's business and this
               panel has not run it. */
            const sites = developmentSites(p, rnd, Math.min(9, newBuildings(p)))
            return {
                kind: "trips",
                from: sites.map(([x, y]) => [x, y] as [number, number]),
                heading: kind === "decline" ? Math.PI * 1.15 : Math.PI * 0.18,
            }
        }
        case "corridor":
        case "diet":
        case "speed": {
            const centre = repeat(25, (i) => [-780 + i * 65, Math.sin(i / 7) * 26] as [number, number])
            return {
                kind: "flow",
                along: centre,
                // A diet runs what it has left; the others run what they gain.
                lanes: kind === "diet" ? 2 : kind === "corridor" ? 4 : 3,
                z: 0.5,
            }
        }
        case "fire":
        case "ems":
        case "closure":
            /* 240 seconds of NFPA 1710 at roughly 50 km/h of congested urban
               travel is about three and a half kilometres, which is more than
               this frame holds, so the band is drawn to the edge of the site.
               It is the reaching that is the mechanism. */
            return { kind: "band", at: [0, 0], radius: EXTENT * 0.92 }
        case "utility":
            return {
                kind: "fill",
                basins: repeat(3, (i) => ({
                    at: [-170 + i * 175, 40] as [number, number],
                    radius: 62,
                    z: 2,
                })),
            }
    }
}

/* --- what each lever can reach ----------------------------------------- */

/**
 * The axes a hand-built change can reach.
 *
 * States the mechanism, never a magnitude. Written once here rather than copied
 * into every project so the two paths through the builder cannot drift into
 * saying different things about the same lever.
 */
export function genericTouches(kind: LeverKind): AxisTouch[] {
    switch (kind) {
        case "residents":
            return [
                { axis: "transportation", direction: "down", because: "more residents generate more peak trips on the same network" },
                { axis: "growthEfficiency", direction: "either", because: "residents per km of implied new street, which depends entirely on the zone" },
                { axis: "infrastructureCapacity", direction: "down", because: "new dwellings consume the headroom the zone's utilities were sized for" },
                { axis: "infrastructureBurden", direction: "either", because: "capital plus twenty years of maintenance, over the residents added" },
                { axis: "emergencyAccess", direction: "either", because: "coverage is population-weighted, so where people are changes the figure" },
            ]
        case "decline":
            return [
                { axis: "growthEfficiency", direction: "down", because: "the same kilometres of street, serving fewer residents" },
                { axis: "infrastructureBurden", direction: "down", because: "maintenance is a property of network length, so the cost per remaining resident rises" },
                { axis: "transportation", direction: "up", because: "fewer residents generate fewer peak trips on the same network" },
                { axis: "emergencyAccess", direction: "either", because: "coverage is population-weighted, so losing people changes the weights" },
            ]
        case "jobs":
            return [
                { axis: "transportation", direction: "either", because: "destinations move trips; whether the mean journey shortens depends on whether the work is near the people" },
                { axis: "emergencyAccess", direction: "either", because: "response times run on congested speeds, which the redistribution changes" },
            ]
        case "corridor":
            return [
                { axis: "transportation", direction: "up", because: "capacity added under the same demand lowers modelled trip time" },
                { axis: "emergencyAccess", direction: "up", because: "response times run on congested speeds, so relieving congestion moves them" },
                { axis: "infrastructureBurden", direction: "down", because: "arterial lane-km carry a capital cost per kilometre" },
            ]
        case "diet":
            return [
                { axis: "transportation", direction: "down", because: "capacity removed under the same demand raises modelled trip time" },
                { axis: "emergencyAccess", direction: "down", because: "response runs on congested speeds on those same links" },
                { axis: "infrastructureBurden", direction: "up", because: "lane-km given up is capital not spent" },
            ]
        case "speed":
            return [
                { axis: "transportation", direction: "down", because: "free-flow time is length over the posted limit, so a lower limit is a longer trip" },
                { axis: "emergencyAccess", direction: "down", because: "an engine is subject to the same free-flow time as everyone else here" },
            ]
        case "fire":
        case "ems":
            return [
                { axis: "emergencyAccess", direction: "up", because: "a new first-response source shortens the multi-source search near it" },
            ]
        case "closure":
            return [
                { axis: "emergencyAccess", direction: "down", because: "the nearest remaining unit answers instead, from further away" },
            ]
        case "utility":
            return [
                { axis: "infrastructureCapacity", direction: "up", because: "raises the dwelling count the zone's systems are sized for" },
                { axis: "infrastructureBurden", direction: "either", because: "capacity is bought outright, but a threshold upgrade may be avoided" },
            ]
    }
}
