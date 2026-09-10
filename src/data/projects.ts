/**
 * TWENTY THINGS ARKANSAS WOULD ACTUALLY BUILD.
 *
 * The scenario builder can express any change the engine understands, which is
 * powerful and completely unhelpful as a starting point: "add 10,000 people to
 * block group 050070106023" is not how anyone thinks about their state. This
 * file is the other end of that. Twenty real projects, each a thing you could
 * drive to, each translated into the levers the engine actually has.
 *
 * Three rules hold the list together.
 *
 * FIRST, every project resolves to real actions. A template that produced a
 * pretty picture and no simulation would be decoration; each one below states
 * the corridor it widens, the residents it places, the station it sits or the
 * utility headroom it buys, and those are the same actions the manual builder
 * emits. Nothing here is a special case inside the engine.
 *
 * SECOND, every project states what the model cannot see. An airport is mostly
 * aviation and this model has no aviation layer; a river bridge is mostly
 * structure and this model has no structures. `notModelled` says so on the card,
 * next to the effect, rather than letting a convincing render imply a claim the
 * simulation is not making.
 *
 * THIRD, every project looks like itself. A lock chamber, a clarifier and a
 * stack interchange are three different objects, and the preview draws three
 * different objects, generated from the primitives in src/render/solids.ts.
 * That is the whole reason the preview exists: before you run anything, you
 * should be able to see WHICH thing you are about to put into the state.
 *
 * Coordinates are approximate placements, accurate enough to land in the right
 * block group, which is all they are used for. They are not survey positions.
 */

import {
    Scene,
    Strand,
    arc,
    circle,
    elevate,
    flatten,
    mast,
    rect,
    repeat,
    ring,
    rotRect,
    strip,
} from "@/render/solids"
import { C, block, circleLine, line, plate, road, tree } from "@/render/kit"
import type { AxisTouch } from "./placeScenes"

/* Re-exported so one import gives a caller both halves of the builder: the
   twenty fixed projects here, and the levers whose scenes are generated from
   whichever place was picked. */
export type { AxisTouch, LeverKind } from "./placeScenes"
export { genericTouches, placeScene } from "./placeScenes"

/* --- what a project does to the model ---------------------------------- */

/**
 * One lever, in the engine's own terms.
 *
 * These map one to one onto the Action union. The UI resolves them against the
 * loaded area -- a corridor by its route label, a zone by nearest centroid --
 * because a project is a fact about Arkansas and an Action is a fact about
 * whichever graph happens to be loaded.
 */
export type ProjectEffect =
    | { kind: "corridor"; match: RegExp; routes: string; lanes: number }
    | { kind: "residents"; count: number }
    | { kind: "station"; facility: "fire" | "ems" }
    | { kind: "utility"; dwellings: number }

export interface Project {
    id: string
    name: string
    place: string
    county: string
    /** Area ids this template can be applied in. */
    areas: string[]
    /** Roughly where it sits, used only to find the zone it lands in. */
    lonLat: [number, number]
    /** What the thing is. One sentence, no adjectives. */
    what: string
    /** A concrete figure about the real project, for scale. */
    scale: string
    /** Slug in src/data/photos.ts, where the manifest has the place. */
    photo?: string
    effects: ProjectEffect[]
    /** What the simulation does not represent about this project. */
    notModelled: string
    /** Which axes the MECHANISM can move. Not a prediction of how far. */
    touches: AxisTouch[]
    /** Built on demand: twenty scenes eagerly is a lot of arrays to hold. */
    model: () => Scene
}

/* --- the twenty scenes -------------------------------------------------- */

/**
 * 1. A river crossing: deck, piers, water.
 *
 * The deck rises over the channel and falls to the approaches, which is what
 * makes it read as a crossing rather than as a road drawn on blue.
 */
function riverBridge(): Scene {
    const centre = repeat(41, (i) => [-800 + i * 40, 0] as [number, number])
    const deckA = elevate(centre, 30, 6)
    const deckB = elevate(centre.map(([x, y]) => [x, y - 70] as [number, number]), 30, 6)

    return {
        extent: 800,
        ground: "#0e1117",
        zScale: 5,
        solids: [
            plate(rect(0, -35, 1700, 460), 0, C.water),
            /* Piers stand in the channel, each one reaching the deck it holds
               up. Giving them a height of their own let the tallest overshoot
               the span at midriver, which is not a pier, it is a spike through
               a bridge. Sampling the same sine the deck uses is the only way
               the two can agree. */
            ...repeat(6, (i) => {
                const x = -450 + i * 180
                const k = (x + 800) / 1600
                return block(rect(x, -35, 30, 130), 6 + 24 * Math.sin(Math.PI * k), 0.15 + i * 0.04, C.deck)
            }),
            // The approaches: solid embankment either side of the water.
            plate(rect(-880, -35, 340, 220), 0.05, C.earth),
            plate(rect(880, -35, 340, 220), 0.05, C.earth),
        ],
        strands: [
            { points: deckA, color: C.deck, width: 1.2, t: 0.5, ribbon: 44 },
            { points: deckB, color: C.deck, width: 1.2, t: 0.6, ribbon: 44 },
            // Lane lines, so the deck reads as carrying six lanes and not as a slab.
            ...repeat(3, (i) =>
                line(deckA.map(([x, y, z]) => [x, y - 14 + i * 14, z + 0.4]), 0.8, C.road, 0.7, true),
            ),
            ...repeat(3, (i) =>
                line(deckB.map(([x, y, z]) => [x, y - 14 + i * 14, z + 0.4]), 0.85, C.road, 0.7, true),
            ),
        ],
    }
}

/**
 * 2. A four-level stack.
 *
 * Two freeways crossing, and the four turning movements each taking their own
 * level. The heights are the whole subject, so the columns are drawn: a ramp
 * floating with nothing under it reads as a diagram.
 */
function stackInterchange(): Scene {
    const ew = repeat(31, (i) => [-750 + i * 50, 0] as [number, number])
    const ns = repeat(31, (i) => [0, -750 + i * 50] as [number, number])

    /* Four turning movements, four levels. The radii step outward with the
       height so the ramps do not stack into one line from above: a stack is
       legible precisely because the higher ramp swings wider. */
    const ramps = [
        { a: arc(-300, -300, 300, 0, Math.PI / 2, 26), z: 9, c: C.road },
        { a: arc(330, -330, 330, Math.PI / 2, Math.PI, 26), z: 19, c: C.road },
        { a: arc(360, 360, 360, Math.PI, Math.PI * 1.5, 26), z: 29, c: C.steel },
        { a: arc(-390, 390, 390, Math.PI * 1.5, Math.PI * 2, 26), z: 39, c: C.steel },
    ]

    return {
        extent: 760,
        ground: "#0e1117",
        zScale: 4.5,
        solids: ramps.flatMap((r, ri) =>
            // A column every fourth sample, which is close enough to a real
            // pier spacing at this scale and cheap enough to draw.
            r.a
                .filter((_, i) => i % 9 === 4)
                .map((p) => block(rect(p[0], p[1], 8, 8), r.z, 0.4 + ri * 0.1, C.deck)),
        ),
        strands: [
            road(ew, 38, 0, 0),
            road(ns, 38, 0.12, 16),
            ...repeat(9, (i) => line([[-90 + i * 22, 0, 0], [-90 + i * 22, 0, 16]], 0.2, C.deck, 1)),
            ...ramps.map((r, i) => ({
                points: flatten(r.a, r.z),
                color: r.c,
                width: 1.3,
                t: 0.45 + i * 0.12,
                ribbon: 16,
            })),
        ],
    }
}

/**
 * 3. New alignment through the Ozark ridges.
 *
 * The reason a bypass here costs what it does is the terrain, so the terrain is
 * the model: ridges the road is cut through, with the cut faces standing either
 * side of the roadbed.
 */
function cutAndFill(): Scene {
    const align = arc(0, -1400, 1500, Math.PI * 0.36, Math.PI * 0.64, 30)

    /* Three ridges, held faint.
       
       The first version drew five at full strength and the result was a wall of
       overlapping orange with a road somewhere inside it: the terrain is the
       reason the project is expensive, not the subject of the picture. They are
       drawn behind, at a fifth of the usual face opacity, so the alignment
       reads as cutting THROUGH something. */
    const ridges = repeat(3, (i, t) => ({
        ...block(
            rotRect(-420 + i * 420, -300 + t * 620, 380, 1000, -0.42 + t * 0.3),
            46 + Math.sin(i * 1.7) * 22,
            0.02 + t * 0.1,
            C.earth,
        ),
        opacity: 0.05,
    }))

    return {
        extent: 800,
        ground: "#0e1117",
        zScale: 2.5,
        solids: [
            ...ridges,
            // The cut: the roadbed is a shelf carved into the hillside, so it
            // is drawn as a plate below the ridge tops rather than on them.
            plate(strip(align, 96), 0.5, C.earth, 12),
        ],
        strands: [
            { points: flatten(align, 14), color: C.road, width: 2, t: 0.6, ribbon: 40 },
            line(flatten(align, 14.6), 0.78, C.steel, 1, true),
            // Cut faces either side, drawn as lines because that is what a
            // benched rock face looks like from above.
            line(flatten(strip(align, 104).slice(0, align.length), 30), 0.66, C.earth, 1.4),
            line(flatten(strip(align, 104).slice(align.length), 30), 0.68, C.earth, 1.4),
        ],
    }
}

/**
 * 4. A diamond: the ordinary American interchange.
 *
 * One road over the other, four straight ramps, and the frontage roads that
 * make it a bypass rather than a junction.
 */
function diamondInterchange(): Scene {
    const main = repeat(25, (i) => [-720 + i * 60, 0] as [number, number])
    const cross = repeat(25, (i) => [0, -720 + i * 60] as [number, number])

    return {
        extent: 720,
        ground: "#0e1117",
        zScale: 7,
        solids: [
            // Abutments, which is what holds the overpass up and what makes a
            // diamond legible from the air.
            block(rect(-70, 0, 26, 120), 14, 0.3, C.deck),
            block(rect(70, 0, 26, 120), 14, 0.32, C.deck),
        ],
        strands: [
            road(main, 40, 0, 0),
            road(cross, 30, 0.18, 15),
            // Four ramps, each leaving the mainline and climbing to the cross road.
            ...[
                [-1, -1],
                [1, -1],
                [-1, 1],
                [1, 1],
            ].map(([sx, sy], i) => ({
                /* Starts ON the mainline, 360 m out, and climbs to the cross
                   road 300 m up. Both ends have to touch a road: lifting the
                   start clear of the mainline left four ramps floating beside
                   the junction rather than joining it, which is the one thing
                   a diamond has to show. */
                points: repeat(14, (k, t) => [
                    sx * (360 - t * 300),
                    sy * (t * 300),
                    t * 15,
                ] as [number, number, number]),
                color: C.road,
                width: 1.1,
                t: 0.45 + i * 0.08,
                ribbon: 13,
            })),
            // Frontage roads: the reason the bypass changes how the town works.
            line(flatten(main.map(([x]) => [x, -150] as [number, number]), 0), 0.8, C.deck, 1.4),
            line(flatten(main.map(([x]) => [x, 150] as [number, number]), 0), 0.85, C.deck, 1.4),
        ],
    }
}

/**
 * 5. A divided highway on embankment, through farmland.
 *
 * Two carriageways, a median wide enough to be a field, and the section grid it
 * cuts across. What is being built here is mostly earth.
 */
function ruralFreeway(): Scene {
    const centre = repeat(31, (i) => [-900 + i * 60, 0] as [number, number])

    return {
        extent: 900,
        ground: "#0e1117",
        // Six, not nine: the embankment is only a few metres of fill, and past
        // this the two carriageways start to look like a viaduct.
        zScale: 6,
        solids: [
            /* The section grid: quarter-quarters, which is what the Delta and
               the Red River valley are actually divided into. Very faint, since
               they are here to give the embankment a scale and nothing else. */
            ...repeat(4, (i) =>
                repeat(3, (j) => ({
                    ...plate(rect(-660 + i * 440, -560 + j * 560, 400, 500), 0.02 + i * 0.02, C.green),
                    opacity: 0.06,
                })),
            ).flat(),
            // The fill the two carriageways sit on, and the median between them.
            block(rect(0, 0, 1900, 300), 5, 0.2, C.earth),
            plate(rect(0, 0, 1860, 80), 0.55, C.green, 5.4),
        ],
        strands: [
            { points: flatten(centre.map(([x]) => [x, 78] as [number, number]), 5.4), color: C.road, width: 2, t: 0.4, ribbon: 60 },
            { points: flatten(centre.map(([x]) => [x, -78] as [number, number]), 5.4), color: C.road, width: 2, t: 0.5, ribbon: 60 },
            // Lane lines, so each carriageway reads as two lanes rather than one.
            line(flatten(centre.map(([x]) => [x, 78] as [number, number]), 5.8), 0.66, C.steel, 0.8, true),
            line(flatten(centre.map(([x]) => [x, -78] as [number, number]), 5.8), 0.68, C.steel, 0.8, true),
            // Drainage ditches either side of the embankment.
            line(flatten(centre.map(([x]) => [x, 190] as [number, number]), 0), 0.78, C.water, 1.2),
            line(flatten(centre.map(([x]) => [x, -190] as [number, number]), 0), 0.8, C.water, 1.2),
            // A box culvert where a creek passes under the fill.
            line([[-180, -340, 0], [-180, 340, 0]], 0.88, C.water, 1.8),
        ],
    }
}

/**
 * 6. A through arch over the Mississippi.
 *
 * The arch carries the load above the deck and the deck hangs from it, which is
 * exactly what the geometry has to show: two ribs, hangers between, no piers in
 * the navigation channel.
 */
function archBridge(): Scene {
    const span = 900
    const rib = (y: number, t: number): Strand => ({
        points: repeat(33, (i, k) => [
            -span / 2 + k * span,
            y,
            22 + Math.sin(Math.PI * k) * 110,
        ] as [number, number, number]),
        color: C.steel,
        width: 2,
        t,
    })

    return {
        extent: 720,
        ground: "#0e1117",
        zScale: 2,
        solids: [
            plate(rect(0, 0, 1700, 620), 0, C.water),
            block(rect(-620, 0, 90, 200), 22, 0.15, C.deck),
            block(rect(620, 0, 90, 200), 22, 0.17, C.deck),
        ],
        strands: [
            {
                points: repeat(33, (i, k) => [-820 + k * 1640, 0, 22] as [number, number, number]),
                color: C.deck,
                width: 1.4,
                t: 0.35,
                ribbon: 48,
            },
            rib(-26, 0.55),
            rib(26, 0.6),
            // Hangers. The eye reads the load path from these, not from the ribs.
            ...repeat(11, (i, t) => {
                const k = 0.08 + t * 0.84
                const x = -span / 2 + k * span
                const z = 22 + Math.sin(Math.PI * k) * 110
                return line([[x, 0, 22], [x, 0, z]], 0.75 + t * 0.15, C.steel, 0.8)
            }),
        ],
    }
}

/**
 * 7. Grade separation over a railroad.
 *
 * Upgrading a highway to interstate standard is mostly this: taking the level
 * crossings out. The old at-grade line is drawn dashed underneath the new
 * structure, because the change is the difference between them.
 */
function gradeSeparation(): Scene {
    const hwy = repeat(29, (i) => [-840 + i * 60, 0] as [number, number])
    const deck = hwy.map(([x, y]) => [x, y, 18 * Math.max(0, 1 - Math.abs(x) / 520)] as [number, number, number])

    return {
        extent: 780,
        ground: "#0e1117",
        zScale: 6,
        solids: [
            plate(rect(0, 0, 240, 1500), 0.05, C.earth),
            ...repeat(4, (i, t) => block(rect(-330 + i * 220, 0, 18, 70), 4 + t * 12, 0.3 + t * 0.15, C.deck)),
        ],
        strands: [
            { points: deck, color: C.road, width: 1.3, t: 0.45, ribbon: 44 },
            // The railroad the highway now passes over: two rails and sleepers.
            line([[-60, -740, 0], [-60, 740, 0]], 0.15, C.rail, 1.4),
            line([[-36, -740, 0], [-36, 740, 0]], 0.17, C.rail, 1.4),
            ...repeat(16, (i, t) => line([[-72, -700 + t * 1400, 0], [-24, -700 + t * 1400, 0]], 0.2 + t * 0.1, C.rail, 0.7)),
            // The crossing that is being removed.
            line(flatten(hwy, 0.2), 0.85, C.deck, 1, true),
            // Loop ramps back down to the old road.
            { points: flatten(arc(-300, -240, 240, 0, Math.PI / 2, 18), 9), color: C.road, width: 1, t: 0.7, ribbon: 12 },
            { points: flatten(arc(300, 240, 240, Math.PI, Math.PI * 1.5, 18), 9), color: C.road, width: 1, t: 0.75, ribbon: 12 },
        ],
    }
}

/**
 * 8. A runway, a taxiway, an apron and a terminal.
 *
 * Nothing about the flying is modelled. What is drawn is the ground side, which
 * is also the only part the simulation can reach.
 */
function airfield(): Scene {
    const rw = repeat(21, (i) => [-1100 + i * 110, -240] as [number, number])
    const tw = repeat(21, (i) => [-1000 + i * 100, -60] as [number, number])

    return {
        extent: 1100,
        ground: "#0e1117",
        zScale: 4,
        solids: [
            plate(strip(rw, 60), 0, C.deck),
            plate(strip(tw, 26), 0.2, C.deck),
            plate(rect(120, 130, 700, 220), 0.3, C.deck),
            // The terminal: a long low block with a pier off the back.
            block(rect(120, 300, 560, 90), 18, 0.55, C.built),
            block(rect(-140, 300, 80, 90), 12, 0.6, C.built),
            // Control tower cab, on its shaft.
            plate(circle(430, 360, 14, 12), 0.85, C.warm, 52),
        ],
        strands: [
            // Runway centreline and threshold bars.
            line(flatten(rw, 0.5), 0.15, C.warm, 1, true),
            ...repeat(5, (i) => line([[-1090 + i * 12, -262, 0.6], [-1090 + i * 12, -218, 0.6]], 0.2, C.warm, 1.2)),
            ...repeat(5, (i) => line([[1030 + i * 12, -262, 0.6], [1030 + i * 12, -218, 0.6]], 0.22, C.warm, 1.2)),
            // Jet bridges reaching from the terminal onto the apron.
            ...repeat(3, (i, t) => line([[-90 + t * 420, 255, 8], [-90 + t * 420, 170, 8]], 0.7 + t * 0.08, C.built, 2)),
            mast(430, 360, 52, C.warm, 0.8, 2),
            // The access road, which is the part that enters the simulation.
            { points: flatten([[120, 420], [120, 620], [-620, 700]] as [number, number][], 0), color: C.road, width: 1.2, t: 0.9, ribbon: 26 },
        ],
    }
}

/**
 * 9. Infill: buildings on the streets that are already there.
 *
 * The grid is drawn first and unchanged, because the argument for infill is
 * that it is growth that does not ask for new street.
 */
function infillBlocks(): Scene {
    const streetsX = repeat(4, (i) => flatten(repeat(2, (k) => [-420 + k * 840, -300 + i * 200] as [number, number]), 0))
    const streetsY = repeat(5, (i) => flatten(repeat(2, (k) => [-420 + i * 210, -360 + k * 720] as [number, number]), 0))

    const heights = [34, 18, 26, 44, 14, 30, 22, 38, 16, 28, 20, 42]
    const blocks = heights.map((h, i) => {
        const cx = -320 + (i % 4) * 210
        const cy = -240 + Math.floor(i / 4) * 200
        return block(rect(cx, cy, 150, 130), h, 0.25 + (i / heights.length) * 0.7, C.built)
    })

    const planting = repeat(8, (i, t) => tree(-380 + t * 760, -330, 0.8 + t * 0.1, 8))

    return {
        extent: 480,
        ground: "#0e1117",
        zScale: 1.4,
        solids: [
            ...blocks,
            ...planting.map(([, canopy]) => canopy),
            // Two courtyards, so the density reads as buildings rather than as
            // one solid mass with lines scored into it.
            plate(ring(-320, -40, 52, 16, 16), 0.6, C.green),
            plate(ring(100, 160, 52, 16, 16), 0.65, C.green),
        ],
        strands: [
            ...streetsX.map((s, i) => ({ points: s, color: C.road, width: 1, t: 0.05 + i * 0.02, ribbon: 22 })),
            ...streetsY.map((s, i) => ({ points: s, color: C.road, width: 1, t: 0.05 + i * 0.02, ribbon: 18 })),
            ...planting.map(([trunk]) => trunk),
        ],
    }
}

/**
 * 10. Pavilions around a green.
 *
 * Low, wide, spread around open ground. The opposite shape to the infill above,
 * and the model scores them differently for exactly that reason.
 */
function campusPavilions(): Scene {
    const green = circle(0, 0, 230, 32)
    const pavilions = repeat(5, (i, t) => {
        const a = t * Math.PI * 1.7 - 0.5
        return block(rotRect(Math.cos(a) * 380, Math.sin(a) * 340, 220, 110, a + Math.PI / 2), 13 + (i % 3) * 5, 0.3 + t * 0.4, C.built)
    })
    const planting = repeat(12, (i, t) =>
        tree(Math.cos(t * Math.PI * 2) * 268, Math.sin(t * Math.PI * 2) * 268, 0.82 + t * 0.12, 11),
    )

    return {
        extent: 620,
        ground: "#0e1117",
        zScale: 3,
        solids: [
            plate(green, 0.05, C.green),
            ...pavilions,
            // Parking deck: three plates is what a deck is, and it says
            // something about the trips this arrangement generates.
            ...repeat(3, (i) => plate(rect(-460, -420, 260, 180), 0.75 + i * 0.05, C.deck, i * 5)),
            ...planting.map(([, canopy]) => canopy),
        ],
        strands: [
            { points: flatten([...circle(0, 0, 300, 40), circle(0, 0, 300, 40)[0]], 0), color: C.road, width: 1.1, t: 0.2, ribbon: 20 },
            ...planting.map(([trunk]) => trunk),
        ],
    }
}

/**
 * 11. A subdivision: loops, bulbs and lots.
 *
 * Drawn honestly, because this is the shape the growth-efficiency axis is
 * measuring. Every metre of that curling street is street the model will charge
 * the scenario for.
 */
function subdivision(): Scene {
    const collector = flatten([[-560, -420], [-180, -300], [120, -120], [420, 60]] as [number, number][], 0)
    const loops = repeat(3, (i, t) => {
        const cx = -280 + i * 300
        const cy = 60 + i * 120
        return { cx, cy, pts: arc(cx, cy, 150, -0.4, Math.PI * 1.7, 26), t }
    })

    return {
        extent: 620,
        ground: "#0e1117",
        zScale: 4,
        solids: [
            // Lots, ranked along each loop. Small, detached, one storey.
            ...loops.flatMap((l, li) =>
                repeat(10, (i, t) => {
                    const a = -0.3 + t * Math.PI * 1.6
                    return block(
                        rotRect(l.cx + Math.cos(a) * 205, l.cy + Math.sin(a) * 205, 46, 34, a),
                        7,
                        0.45 + li * 0.14 + t * 0.1,
                        C.built,
                    )
                }),
            ),
        ],
        strands: [
            { points: collector, color: C.road, width: 1.2, t: 0.05, ribbon: 24 },
            ...loops.map((l) => ({
                points: flatten(l.pts, 0),
                color: C.road,
                width: 1,
                t: 0.2 + l.t * 0.2,
                ribbon: 14,
            })),
            // The cul-de-sac bulb, which is the detail that makes it read.
            ...loops.map((l) => ({
                points: flatten([...circle(l.cx + 150, l.cy - 60, 34, 16), circle(l.cx + 150, l.cy - 60, 34, 16)[0]], 0),
                color: C.road,
                width: 1,
                t: 0.35 + l.t * 0.2,
                ribbon: 12,
            })),
        ],
    }
}

/**
 * 12. A street wall along an arterial.
 *
 * Buildings brought to the kerb on both sides of a road that already exists.
 * The section is the subject: this is a corridor being made into a place.
 */
function streetWall(): Scene {
    const spine = repeat(2, (k) => [0, -620 + k * 1240] as [number, number])
    const heights = [26, 34, 18, 30, 22, 38, 16, 28]

    const planting = repeat(9, (i, t) => tree(-72, -480 + t * 960, 0.75 + t * 0.15, 8))

    return {
        extent: 560,
        ground: "#0e1117",
        zScale: 1.8,
        solids: [
            ...planting.map(([, canopy]) => canopy),
            ...heights.map((h, i) =>
                block(rect(-140, -520 + i * 150, 130, 118), h, 0.3 + i * 0.07, C.built),
            ),
            ...heights.map((h, i) =>
                block(rect(140, -560 + i * 150, 130, 118), h * 0.8 + 8, 0.34 + i * 0.07, C.built),
            ),
            // Bus stop pads, the reason the section is worth changing.
            plate(rect(-62, -160, 30, 90), 0.85, C.warm),
            plate(rect(62, 200, 30, 90), 0.88, C.warm),
        ],
        strands: [
            { points: flatten(spine, 0), color: C.road, width: 1.3, t: 0, ribbon: 44 },
            line(flatten(spine, 0.3), 0.15, C.steel, 0.8, true),
            // Crosswalks.
            ...repeat(4, (i, t) =>
                line([[-30, -400 + t * 800, 0.2], [30, -400 + t * 800, 0.2]], 0.2 + t * 0.1, C.built, 2.4),
            ),
            // Shelter canopies, on their posts.
            line([[-62, -160, 0], [-62, -160, 4]], 0.9, C.warm, 1.4),
            line([[62, 200, 0], [62, 200, 4]], 0.92, C.warm, 1.4),
            ...planting.map(([trunk]) => trunk),
        ],
    }
}

/**
 * 13. A steel mill: sheds, stacks, a coil yard and the rail that serves it.
 *
 * Long and low and enormous, which is the only honest way to draw it. The
 * workforce this template places is what the simulation actually sees.
 */
function steelMill(): Scene {
    return {
        extent: 900,
        ground: "#0e1117",
        zScale: 2.5,
        solids: [
            ...repeat(3, (i, t) => block(rect(-120, -300 + i * 300, 1100, 190), 34 - i * 6, 0.15 + t * 0.3, C.built)),
            // The melt shop, taller than the rolling lines beside it.
            block(rect(-620, -300, 260, 190), 62, 0.5, C.built),
            // Coil yard: flat stock, laid out in rows.
            ...repeat(6, (i) =>
                repeat(4, (j) => plate(rect(560 + i * 60, -420 + j * 70, 44, 52), 0.7 + i * 0.03, C.steel)),
            ).flat(),
        ],
        strands: [
            mast(-560, -300, 108, C.steel, 0.62, 2.4),
            mast(-500, -240, 96, C.steel, 0.66, 2.4),
            // Stack caps, drawn as short cross bars so they do not read as wires.
            line([[-576, -300, 108], [-544, -300, 108]], 0.64, C.steel, 2.4),
            line([[-516, -240, 96], [-484, -240, 96]], 0.68, C.steel, 2.4),
            // The rail spur, curving in from the main line.
            { points: flatten([...arc(-200, 900, 1000, Math.PI * 1.28, Math.PI * 1.5, 20)], 0), color: C.rail, width: 1.6, t: 0.35, ribbon: 10 },
            // Gantry over the coil yard.
            line([[540, -460, 0], [540, -460, 26], [860, -460, 26], [860, -460, 0]], 0.85, C.deck, 1.4),
            line([[540, -160, 0], [540, -160, 26], [860, -160, 26], [860, -160, 0]], 0.88, C.deck, 1.4),
            line([[700, -460, 26], [700, -160, 26]], 0.9, C.deck, 1.2),
        ],
    }
}

/**
 * 14. A fire station.
 *
 * Bays, an apron deep enough to turn an engine on, a hose tower, and the four
 * minute band the whole NFPA standard is about. The band is the point: this is
 * the one project type whose effect is a distance.
 */
function fireStation(): Scene {
    return {
        extent: 420,
        ground: "#0e1117",
        zScale: 2.4,
        solids: [
            ...repeat(3, (i, t) => block(rect(-70 + i * 70, 40, 62, 90), 11, 0.3 + t * 0.15, C.built)),
            block(rect(140, 40, 76, 90), 8, 0.5, C.built),
            plate(rect(0, -70, 260, 130), 0.15, C.deck),
            // The hose tower cap.
            plate(rect(-140, 70, 22, 22), 0.7, C.alert, 26),
        ],
        strands: [
            mast(-140, 70, 26, C.alert, 0.65, 2),
            // Apron markings, one per bay.
            ...repeat(3, (i, t) => line([[-70 + i * 70, -10, 0.2], [-70 + i * 70, -130, 0.2]], 0.2 + t * 0.1, C.warm, 1.6)),
            { points: flatten([[0, -130], [0, -300], [-360, -340]] as [number, number][], 0), color: C.road, width: 1.2, t: 0.55, ribbon: 22 },
            // The response band, which is what the model actually measures.
            circleLine(0, 0, 300, 0.85, C.alert),
            circleLine(0, 0, 390, 0.92, C.alert),
        ],
    }
}

/**
 * 15. An ambulance post.
 *
 * Smaller than a fire station and shaped differently: a canopy to keep the
 * units out of the weather, a crew block, and a pad. It enters the response
 * field the same way a station does, which is why it is here.
 */
function emsPost(): Scene {
    return {
        extent: 340,
        ground: "#0e1117",
        zScale: 2.4,
        solids: [
            block(rect(-90, 60, 130, 90), 9, 0.35, C.built),
            // The canopy, held up rather than floating.
            plate(rect(70, 20, 170, 120), 0.6, C.deck, 6.5),
            ...repeat(2, (i) => block(rect(30 + i * 80, 20, 42, 24), 3.2, 0.75 + i * 0.05, C.alert)),
            // Helipad.
            plate(circle(-30, -200, 55, 20), 0.5, C.deck),
        ],
        strands: [
            ...[[-10, -35], [150, -35], [-10, 75], [150, 75]].map(([x, y], i) =>
                mast(x, y, 6.5, C.deck, 0.55 + i * 0.02, 1.4),
            ),
            { points: flatten([...circle(-30, -200, 40, 24), circle(-30, -200, 40, 24)[0]], 0.2), color: C.warm, width: 1.2, t: 0.55 },
            line([[-55, -225, 0.3], [-55, -175, 0.3]], 0.6, C.warm, 2),
            line([[-5, -225, 0.3], [-5, -175, 0.3]], 0.62, C.warm, 2),
            line([[-55, -200, 0.3], [-5, -200, 0.3]], 0.64, C.warm, 2),
            { points: flatten([[70, -80], [70, -290], [300, -320]] as [number, number][], 0), color: C.road, width: 1.1, t: 0.7, ribbon: 18 },
            circleLine(0, 0, 260, 0.88, C.alert),
        ],
    }
}

/**
 * 16. A station where there is nothing else.
 *
 * The building is small and the bands are enormous, and that gap is the whole
 * argument for putting one here. Rural Arkansas is where the four minute
 * standard is furthest from being met.
 */
function ruralStation(): Scene {
    return {
        extent: 900,
        ground: "#0e1117",
        zScale: 6,
        solids: [
            block(rect(0, 0, 110, 74), 8, 0.4, C.built),
            plate(rect(0, -70, 150, 70), 0.3, C.deck),
            // Section-line fields, to give the emptiness a scale.
            ...repeat(3, (i) =>
                repeat(3, (j) => plate(rect(-620 + i * 620, -560 + j * 560, 540, 480), 0.02 + i * 0.03, C.green)),
            ).flat(),
        ],
        strands: [
            // The one road, running the whole width of the scene.
            { points: flatten([[-1000, -140], [1000, -100]] as [number, number][], 0), color: C.road, width: 1.2, t: 0.1, ribbon: 22 },
            { points: flatten([[40, -105], [60, 900]] as [number, number][], 0), color: C.road, width: 1, t: 0.2, ribbon: 14 },
            mast(-70, 30, 22, C.alert, 0.5, 1.6),
            circleLine(0, 0, 420, 0.75, C.alert),
            circleLine(0, 0, 760, 0.86, C.alert),
        ],
    }
}

/**
 * 17. A water treatment plant: clarifiers and filter beds.
 *
 * The circles are the recognisable thing about a plant like this, so they lead.
 * What the model gets from it is headroom: dwellings the system is sized for.
 */
function clarifiers(): Scene {
    const basins = repeat(3, (i, t) => ({ cx: -180 + i * 190, cy: 60, t }))

    return {
        extent: 420,
        ground: "#0e1117",
        zScale: 2.2,
        solids: [
            ...basins.map((b) => plate(ring(b.cx, b.cy, 82, 12, 28), 0.25 + b.t * 0.2, C.built)),
            ...basins.map((b) => plate(circle(b.cx, b.cy, 70, 28), 0.4 + b.t * 0.2, C.water)),
            // Filter beds: a grid of cells, which is what they are.
            ...repeat(4, (i) =>
                repeat(2, (j) => plate(rect(-150 + i * 100, -180 + j * 90, 88, 78), 0.6 + i * 0.04, C.water)),
            ).flat(),
            block(rect(240, -140, 100, 80), 12, 0.75, C.built),
        ],
        strands: [
            // The rake arm across each clarifier: the detail that makes a
            // circle read as a clarifier rather than as a tank.
            ...basins.map((b) => line([[b.cx - 70, b.cy, 4], [b.cx + 70, b.cy, 4]], 0.5 + b.t * 0.15, C.built, 1.4)),
            // Process piping, above ground because that is how it is built.
            line([[-300, 60, 3], [-300, -180, 3], [230, -180, 3]], 0.8, C.pipe, 2),
            line([[-180, -20, 3], [110, -20, 3]], 0.84, C.pipe, 1.6),
            // The raw water main, running off toward the lake.
            line([[-300, 60, 1], [-560, 240, 1]], 0.9, C.pipe, 2.4, true),
        ],
    }
}

/**
 * 18. A reclamation plant: aeration basins and digesters.
 *
 * Long rectangles with baffles, and two domes. Deliberately not the same shape
 * as the water plant above, because they are not the same building and the
 * preview is supposed to tell you which one you picked.
 */
function reclamation(): Scene {
    return {
        extent: 460,
        ground: "#0e1117",
        zScale: 2.2,
        solids: [
            ...repeat(4, (i, t) => plate(rect(-200 + i * 130, 40, 112, 300), 0.2 + t * 0.25, C.water)),
            // Digester domes.
            ...repeat(2, (i) => block(circle(300, -80 + i * 150, 52, 20), 20, 0.6 + i * 0.06, C.built)),
            ...repeat(2, (i) => plate(circle(300, -80 + i * 150, 38, 20), 0.68 + i * 0.05, C.warm, 20)),
            block(rect(-330, -170, 90, 110), 10, 0.15, C.built),
        ],
        strands: [
            // Baffle walls, zigzagging down each basin.
            ...repeat(4, (i, t) =>
                line(
                    repeat(9, (k, u) => [
                        -200 + i * 130 + (u % 2 === 0 ? -40 : 40),
                        -100 + u * 34,
                        2,
                    ] as [number, number, number]),
                    0.35 + t * 0.2,
                    C.built,
                    0.9,
                ),
            ),
            // Gas flare.
            mast(400, 40, 34, C.alert, 0.8, 1.6),
            line([[-330, -110, 2], [-200, -110, 2], [-200, 40, 2]], 0.25, C.pipe, 2),
            // The effluent channel, leaving toward the river.
            { points: flatten([[240, 190], [420, 320], [640, 360]] as [number, number][], 0), color: C.water, width: 1.2, t: 0.9, ribbon: 24 },
        ],
    }
}

/**
 * 19. Treatment lagoons.
 *
 * The cheapest way a growing town in Arkansas buys wastewater capacity, and it
 * looks nothing like either plant above: three shallow cells, berms between
 * them, and a field of surface aerators.
 */
function lagoons(): Scene {
    const cells = repeat(3, (i, t) => ({ cx: -320 + i * 320, t }))

    return {
        extent: 560,
        ground: "#0e1117",
        zScale: 5,
        solids: [
            ...cells.map((c) => plate(rect(c.cx, 0, 280, 400), 0.2 + c.t * 0.2, C.water)),
            // Berms, which are the built part of a lagoon.
            ...repeat(4, (i) => block(rect(-480 + i * 320, 0, 34, 440), 5, 0.1 + i * 0.05, C.earth)),
            block(rect(0, 260, 1000, 34), 4, 0.08, C.earth),
            block(rect(0, -260, 1000, 34), 4, 0.09, C.earth),
            block(rect(-560, -190, 80, 70), 8, 0.15, C.built),
        ],
        strands: [
            // Surface aerators, a grid of them per cell.
            ...cells.flatMap((c) =>
                repeat(3, (i) =>
                    repeat(3, (j) =>
                        mast(c.cx - 80 + i * 80, -120 + j * 120, 5, C.pipe, 0.55 + c.t * 0.2, 1.6),
                    ),
                ).flat(),
            ),
            line([[-560, -150, 2], [-460, -150, 2], [-460, 0, 2]], 0.3, C.pipe, 2),
            line([[-180, 0, 2], [-140, 0, 2]], 0.6, C.pipe, 2),
            line([[140, 0, 2], [180, 0, 2]], 0.65, C.pipe, 2),
            // Perimeter access road.
            {
                points: flatten(
                    [[-540, -300], [540, -300], [540, 300], [-540, 300], [-540, -300]] as [number, number][],
                    0,
                ),
                color: C.road,
                width: 1,
                t: 0.85,
                ribbon: 16,
            },
        ],
    }
}

/**
 * 20. An elevated tank and the trunk main that fills it.
 *
 * Storage and conveyance, the two halves of what a distribution system is short
 * of when a town grows. The main runs off the edge of the scene, because that
 * is what a trunk main does.
 */
function waterTower(): Scene {
    const legs: [number, number][] = [
        [-22, -22],
        [22, -22],
        [22, 22],
        [-22, 22],
    ]

    return {
        extent: 420,
        ground: "#0e1117",
        zScale: 1.2,
        solids: [
            // The tank itself, floating on its legs.
            block(circle(0, 0, 46, 24), 26, 0.55, C.pipe, 46),
            plate(circle(0, 0, 34, 24), 0.7, C.warm, 72),
            block(rect(230, 120, 90, 70), 9, 0.3, C.built),
            plate(rect(0, 0, 200, 200), 0.05, C.deck),
        ],
        strands: [
            ...legs.map(([x, y], i) => mast(x, y, 46, C.pipe, 0.25 + i * 0.04, 2)),
            // Cross bracing, which is what makes a water tower a water tower.
            ...legs.map(([x, y], i) => {
                const [nx, ny] = legs[(i + 1) % legs.length]
                return line([[x, y, 12], [nx, ny, 34]], 0.35 + i * 0.03, C.pipe, 0.8)
            }),
            // The riser.
            mast(0, 0, 46, C.pipe, 0.2, 3),
            // The trunk main: exposed at the site, buried where it leaves it.
            line([[0, 0, 0], [160, 90, 0]], 0.75, C.pipe, 3),
            line([[160, 90, 0], [560, 200, 0]], 0.85, C.pipe, 2.4, true),
            line([[0, 0, 0], [-420, -240, 0]], 0.9, C.pipe, 2.4, true),
            // Valve vaults along the main.
            ...repeat(3, (i, t) => line([[190 + t * 300, 98 + t * 82, 0], [190 + t * 300, 98 + t * 82, 3]], 0.9, C.warm, 2)),
        ],
    }
}

/* --- the catalogue ------------------------------------------------------ */

/**
 * Twenty, and twenty is the point.
 *
 * Long enough to cover the state and the four things the engine can actually
 * do, short enough that every entry earned its place and has its own model
 * rather than sharing one with four others.
 */
export const PROJECTS: Project[] = [
    {
        id: "i30-crossing",
        name: "I-30 Crossing",
        place: "Little Rock and North Little Rock",
        county: "Pulaski",
        areas: ["little-rock", "arkansas"],
        lonLat: [-92.267, 34.749],
        what: "Widening Interstate 30 through downtown and replacing the Arkansas River bridge.",
        scale: "The busiest stretch of interstate in the state, carrying well over 100,000 vehicles a day.",
        photo: "little-rock",
        effects: [{ kind: "corridor", match: /\bI 30\b/, routes: "I 30", lanes: 2 }],
        notModelled:
            "The structure itself. The engine widens the corridor's capacity; it does not build a bridge, and it has no view of construction-period traffic.",
        touches: [
            { axis: "transportation", direction: "up", because: "more capacity on the same demand lowers modelled trip time" },
            { axis: "emergencyAccess", direction: "up", because: "response times are computed on congested speeds, so relieving congestion moves them" },
            { axis: "infrastructureBurden", direction: "down", because: "arterial lane-km carry a capital cost per km" },
        ],
        model: riverBridge,
    },
    {
        id: "big-rock-interchange",
        name: "Big Rock Interchange",
        place: "West Little Rock",
        county: "Pulaski",
        areas: ["little-rock", "arkansas"],
        lonLat: [-92.412, 34.755],
        what: "The I-430 and I-630 junction, rebuilt with free-flowing directional ramps.",
        scale: "Two interstates meeting inside the city, the only route between west Little Rock and everything east of it.",
        photo: "little-rock",
        effects: [
            { kind: "corridor", match: /\bI 430\b/, routes: "I 430", lanes: 1 },
            { kind: "corridor", match: /\bI 630\b/, routes: "I 630", lanes: 1 },
        ],
        notModelled:
            "Ramp geometry and weaving. The assignment sees link capacity, not the merge that actually fails first at a junction like this.",
        touches: [
            { axis: "transportation", direction: "up", because: "capacity added on both legs of the junction" },
            { axis: "infrastructureBurden", direction: "down", because: "lane-km on two interstates is expensive per km" },
        ],
        model: stackInterchange,
    },
    {
        id: "bella-vista-bypass",
        name: "Bella Vista Bypass",
        place: "Bella Vista",
        county: "Benton",
        areas: ["nwa", "arkansas"],
        lonLat: [-94.253, 36.462],
        what: "Completing Interstate 49 north of Bentonville on new alignment through the Ozark foothills.",
        scale: "The last gap in a corridor that runs from Kansas City to Fort Smith.",
        photo: "bella-vista",
        effects: [{ kind: "corridor", match: /\bI 49\b/, routes: "I 49", lanes: 2 }],
        notModelled:
            "The new alignment. The graph holds the roads that exist, so this template widens the corridor rather than drawing a route beside it, and the terrain that makes the project expensive is not in the cost model.",
        touches: [
            { axis: "transportation", direction: "up", because: "capacity on the region's north-south spine" },
            { axis: "infrastructureBurden", direction: "down", because: "interstate lane-km at demo unit cost" },
        ],
        model: cutAndFill,
    },
    {
        id: "springdale-bypass",
        name: "Springdale Northern Bypass",
        place: "Springdale",
        county: "Washington",
        areas: ["nwa", "arkansas"],
        lonLat: [-94.148, 36.223],
        what: "Highway 412 taken around the north of Springdale instead of through Emma Avenue.",
        scale: "The main east-west route across Northwest Arkansas, and the one that runs through the middle of a town of 87,000.",
        photo: "springdale",
        effects: [{ kind: "corridor", match: /\bUS 412\b/, routes: "US 412", lanes: 2 }],
        notModelled:
            "The redistribution a bypass causes. Trip distribution is skimmed on free-flow time and held fixed, so through traffic is not moved off the old street by the new one.",
        touches: [
            { axis: "transportation", direction: "up", because: "capacity on the corridor carrying the region's east-west demand" },
            { axis: "emergencyAccess", direction: "either", because: "response times follow congested speeds on the same links" },
        ],
        model: diamondInterchange,
    },
    {
        id: "highway-549",
        name: "Highway 549",
        place: "Texarkana",
        county: "Miller",
        areas: ["arkansas"],
        lonLat: [-93.99, 33.47],
        what: "The four-lane connector between Texarkana and Interstate 30, built to interstate standard.",
        scale: "Arkansas's leg of a corridor intended to run from Texarkana to Shreveport.",
        photo: "texarkana",
        effects: [{ kind: "corridor", match: /\bAR 549\b/, routes: "AR 549", lanes: 1 }],
        notModelled:
            "Freight. Trip generation here is per resident, so a route whose case rests on trucks is under-represented by construction.",
        touches: [
            { axis: "transportation", direction: "up", because: "capacity on a corridor with little parallel network" },
            { axis: "infrastructureBurden", direction: "down", because: "rural lane-km still carry capital cost" },
        ],
        model: ruralFreeway,
    },
    {
        id: "i40-river-crossing",
        name: "I-40 Mississippi River Crossing",
        place: "West Memphis",
        county: "Crittenden",
        areas: ["arkansas"],
        lonLat: [-90.14, 35.15],
        what: "Additional capacity on the Interstate 40 crossing between West Memphis and Memphis.",
        scale: "One of two road crossings of the Mississippi within 70 miles; its closure in 2021 rerouted a national freight corridor for three months.",
        photo: "west-memphis",
        effects: [{ kind: "corridor", match: /\bI 40\b/, routes: "I 40", lanes: 1 }],
        notModelled:
            "Everything on the Tennessee side. The graph stops at the state line, so a crossing is modelled as capacity on the Arkansas approach only.",
        touches: [
            { axis: "transportation", direction: "up", because: "capacity on the eastern gateway" },
            { axis: "infrastructureBurden", direction: "down", because: "lane-km at demo unit cost" },
        ],
        model: archBridge,
    },
    {
        id: "us67-i57",
        name: "US 67, Future I-57",
        place: "Walnut Ridge and Pocahontas",
        county: "Lawrence",
        areas: ["arkansas"],
        lonLat: [-90.96, 36.07],
        what: "Bringing US 67 north of Newport up to interstate standard, level crossings removed.",
        scale: "A designated future interstate route between Little Rock and Missouri.",
        photo: "paragould",
        effects: [{ kind: "corridor", match: /\bUS 67\b/, routes: "US 67", lanes: 1 }],
        notModelled:
            "Access control. The benefit of an upgrade like this is largely safety and reliability, and the model measures neither.",
        touches: [
            { axis: "transportation", direction: "up", because: "capacity along the northeast corridor" },
            { axis: "infrastructureBurden", direction: "down", because: "a long route means a lot of lane-km" },
        ],
        model: gradeSeparation,
    },
    {
        id: "xna-access",
        name: "XNA Terminal and Access",
        place: "Highfill",
        county: "Benton",
        areas: ["nwa", "arkansas"],
        lonLat: [-94.307, 36.282],
        what: "Terminal expansion at Northwest Arkansas National Airport, with its access route widened.",
        scale: "The region's only commercial airport, reached by a single two-lane approach for most of its first twenty years.",
        photo: "xna",
        effects: [{ kind: "corridor", match: /\bAR 612\b|\bUS 412\b/, routes: "AR 612 and US 412", lanes: 1 }],
        notModelled:
            "The aviation. There is no air layer in this model at all; what it can see is the ground access, which is what this template changes.",
        touches: [
            { axis: "transportation", direction: "up", because: "capacity on the airport approach" },
            { axis: "infrastructureBurden", direction: "down", because: "lane-km at demo unit cost" },
        ],
        model: airfield,
    },
    {
        id: "east-village-infill",
        name: "East Village Infill",
        place: "Little Rock",
        county: "Pulaski",
        areas: ["little-rock", "arkansas"],
        lonLat: [-92.265, 34.746],
        what: "Housing built on the existing downtown street grid east of the interstate.",
        scale: "Blocks already served by street, water and sewer, a mile from the state capitol.",
        photo: "state-capitol",
        effects: [{ kind: "residents", count: 6000 }],
        notModelled:
            "Which buildings. Growth is placed into a zone and spread across its block groups by existing population; the model has no parcels.",
        touches: [
            { axis: "growthEfficiency", direction: "up", because: "a downtown zone carries very little street per dwelling, so the implied new local km is small" },
            { axis: "infrastructureBurden", direction: "up", because: "few new kilometres to build and maintain per resident" },
            { axis: "infrastructureCapacity", direction: "down", because: "new dwellings consume the headroom designed into the zone's utilities" },
            { axis: "transportation", direction: "down", because: "more residents generate more peak trips on the same network" },
        ],
        model: infillBlocks,
    },
    {
        id: "bentonville-district",
        name: "Bentonville Campus District",
        place: "Bentonville",
        county: "Benton",
        areas: ["nwa", "arkansas"],
        lonLat: [-94.212, 36.372],
        what: "Housing and workplace around a low campus north of the square.",
        scale: "Benton County grew by more than 60,000 people between 2010 and 2020, faster than any other county in the state.",
        photo: "bentonville",
        effects: [
            { kind: "residents", count: 9000 },
            { kind: "utility", dwellings: 2000 },
        ],
        notModelled:
            "Employment. The gravity model uses population as its attraction proxy, so a district built around jobs is represented by the people who live in it.",
        touches: [
            { axis: "growthEfficiency", direction: "either", because: "the answer depends entirely on the street per dwelling already in that zone" },
            { axis: "infrastructureCapacity", direction: "either", because: "the dwellings consume headroom and the utility works buy it back" },
            { axis: "transportation", direction: "down", because: "more peak trips on the same network" },
        ],
        model: campusPavilions,
    },
    {
        id: "conway-subdivision",
        name: "Conway Greenfield Growth",
        place: "Conway",
        county: "Faulkner",
        areas: ["arkansas"],
        lonLat: [-92.42, 35.11],
        what: "Detached housing on new streets at the edge of town, along the Interstate 40 commute.",
        scale: "Faulkner County's population has roughly doubled since 1990, most of it in this pattern.",
        photo: "conway",
        effects: [{ kind: "residents", count: 8000 }],
        notModelled:
            "The subdivision layout. Implied new street is derived from the metres of road per dwelling that zone already has, not from a drawn plat.",
        touches: [
            { axis: "growthEfficiency", direction: "down", because: "an edge zone carries far more street per dwelling than a downtown one" },
            { axis: "infrastructureBurden", direction: "down", because: "every implied kilometre carries capital plus twenty years of maintenance" },
            { axis: "transportation", direction: "down", because: "longer trips from a zone further out" },
        ],
        model: subdivision,
    },
    {
        id: "college-avenue",
        name: "College Avenue Corridor",
        place: "Fayetteville",
        county: "Washington",
        areas: ["nwa", "arkansas"],
        lonLat: [-94.155, 36.08],
        what: "Housing brought to the kerb along an arterial that already carries the traffic.",
        scale: "US 71B through Fayetteville, four to five lanes wide, running past the university.",
        photo: "fayetteville",
        effects: [{ kind: "residents", count: 7000 }],
        notModelled:
            "Mode. Transit and walking are folded into vehicle occupancy rather than modelled, so a corridor whose case is that fewer people drive is scored as though they all do.",
        touches: [
            { axis: "growthEfficiency", direction: "up", because: "an already-built corridor carries little new street per dwelling" },
            { axis: "transportation", direction: "down", because: "more trips loaded onto an arterial already near capacity" },
            { axis: "infrastructureCapacity", direction: "down", because: "new dwellings against the zone's designed headroom" },
        ],
        model: streetWall,
    },
    {
        id: "osceola-steel",
        name: "Osceola Steel Workforce Housing",
        place: "Osceola",
        county: "Mississippi",
        areas: ["arkansas"],
        lonLat: [-89.97, 35.7],
        what: "Housing for the mills, in a county that has been losing population while adding jobs.",
        scale: "Mississippi County produces more steel than any other county in the United States, and had 5,000 fewer residents in 2020 than in 2010.",
        photo: "blytheville",
        effects: [
            { kind: "residents", count: 5000 },
            { kind: "utility", dwellings: 1200 },
        ],
        notModelled:
            "The mills. Industry appears in this model only through the people who work in it and the roads they use.",
        touches: [
            { axis: "growthEfficiency", direction: "either", because: "depends on the street already serving that zone" },
            { axis: "infrastructureCapacity", direction: "either", because: "dwellings consume headroom, the utility works restore it" },
            { axis: "emergencyAccess", direction: "either", because: "coverage is population-weighted, so where people are changes the figure" },
        ],
        model: steelMill,
    },
    {
        id: "fayetteville-station",
        name: "Fayetteville Fire Station",
        place: "Fayetteville",
        county: "Washington",
        areas: ["nwa", "arkansas"],
        lonLat: [-94.135, 36.045],
        what: "A new engine company on the south side of the city.",
        scale: "NFPA 1710 asks for a first engine on scene within 240 seconds of travel. That is the standard this station is measured against.",
        photo: "fayetteville",
        effects: [{ kind: "station", facility: "fire" }],
        notModelled:
            "Staffing and turnout. The model measures travel time only, which is the part the road network and the station's position control.",
        touches: [
            { axis: "emergencyAccess", direction: "up", because: "a new source in the multi-source response search shortens the time to everything near it" },
        ],
        model: fireStation,
    },
    {
        id: "jonesboro-ems",
        name: "Jonesboro Ambulance Post",
        place: "Jonesboro",
        county: "Craighead",
        areas: ["arkansas"],
        lonLat: [-90.704, 35.842],
        what: "A staffed ambulance post on the east side of the city.",
        scale: "Jonesboro is the regional hospital centre for the whole of northeast Arkansas.",
        photo: "jonesboro",
        effects: [{ kind: "station", facility: "ems" }],
        notModelled:
            "Unit availability. A post with one ambulance out on a call covers nothing, and the model has no concept of a busy unit.",
        touches: [
            { axis: "emergencyAccess", direction: "up", because: "an ambulance post enters the response field as a first-response source" },
        ],
        model: emsPost,
    },
    {
        id: "delta-station",
        name: "Delta Response Station",
        place: "Helena and the Arkansas Delta",
        county: "Phillips",
        areas: ["arkansas"],
        lonLat: [-90.68, 34.5],
        what: "A staffed station in a county where most residents are far outside the four-minute band.",
        scale: "Phillips County has lost more than half its population since 1970 and covers 700 square miles.",
        photo: "delta",
        effects: [{ kind: "station", facility: "fire" }],
        notModelled:
            "Volunteer cover. Much of rural Arkansas is served by volunteer departments whose response begins with a drive to the station, and the model starts the clock at the station door.",
        touches: [
            { axis: "emergencyAccess", direction: "up", because: "a source where there was none, though coverage is population-weighted and the population here is thin" },
        ],
        model: ruralStation,
    },
    {
        id: "beaver-water",
        name: "Beaver Water District Expansion",
        place: "Lowell",
        county: "Benton",
        areas: ["nwa", "arkansas"],
        lonLat: [-94.13, 36.26],
        what: "More treatment capacity for the district that supplies most of Northwest Arkansas.",
        scale: "One lake supplies drinking water to the four largest cities in the region.",
        photo: "rogers",
        effects: [{ kind: "utility", dwellings: 9000 }],
        notModelled:
            "The distribution network. Capacity here is a count of dwellings the system is sized for, not a hydraulic model of mains and pressure zones.",
        touches: [
            { axis: "infrastructureCapacity", direction: "up", because: "headroom is measured against the dwellings a zone's system was built for, and this raises that number" },
            { axis: "infrastructureBurden", direction: "up", because: "growth that no longer trips a threshold upgrade avoids that lump cost" },
        ],
        model: clarifiers,
    },
    {
        id: "adams-field-reclamation",
        name: "Adams Field Reclamation Plant",
        place: "Little Rock",
        county: "Pulaski",
        areas: ["little-rock", "arkansas"],
        lonLat: [-92.23, 34.727],
        what: "Wastewater treatment capacity for the eastern half of the city.",
        scale: "The plant that serves downtown, the port and the airport.",
        photo: "arkansas-river",
        effects: [{ kind: "utility", dwellings: 7000 }],
        notModelled:
            "Wet weather. Combined flows during storms are what actually constrains a plant like this, and there is no rainfall in this model.",
        touches: [
            { axis: "infrastructureCapacity", direction: "up", because: "raises the dwellings the zone's system is sized for" },
            { axis: "infrastructureBurden", direction: "up", because: "growth inside the raised threshold avoids the lump upgrade cost" },
        ],
        model: reclamation,
    },
    {
        id: "springdale-lagoons",
        name: "Springdale Treatment Lagoons",
        place: "Springdale",
        county: "Washington",
        areas: ["nwa", "arkansas"],
        lonLat: [-94.12, 36.19],
        what: "Additional wastewater cells for a city that has grown by half since 2000.",
        scale: "Springdale added roughly 42,000 residents between 2000 and 2020.",
        photo: "springdale",
        effects: [{ kind: "utility", dwellings: 6000 }],
        notModelled:
            "Discharge quality. The model counts capacity, and says nothing about what leaves the plant or where it goes.",
        touches: [
            { axis: "infrastructureCapacity", direction: "up", because: "more dwellings served before headroom runs out" },
            { axis: "infrastructureBurden", direction: "up", because: "a threshold upgrade avoided is a lump cost avoided" },
        ],
        model: lagoons,
    },
    {
        id: "rogers-tank",
        name: "Rogers Elevated Tank and Trunk Main",
        place: "Rogers",
        county: "Benton",
        areas: ["nwa", "arkansas"],
        lonLat: [-94.118, 36.332],
        what: "Storage and a transmission main for the north side of the city.",
        scale: "An elevated tank is what holds a distribution system's pressure through a peak hour and a fire flow.",
        photo: "rogers",
        effects: [{ kind: "utility", dwellings: 4000 }],
        notModelled:
            "Pressure. This is the clearest case in the catalogue of the model counting dwellings where the real constraint is hydraulic.",
        touches: [
            { axis: "infrastructureCapacity", direction: "up", because: "raises the dwelling count the zone's system is sized for" },
            { axis: "infrastructureBurden", direction: "up", because: "avoids a threshold upgrade the growth would otherwise trigger" },
        ],
        model: waterTower,
    },
]

/** Projects offered for a given area, in catalogue order. */
export function projectsFor(areaId: string): Project[] {
    return PROJECTS.filter((p) => p.areas.includes(areaId))
}

/**
 * Substring search over the fields a person would actually type.
 *
 * Deliberately not fuzzy. A planner typing "412" wants the two projects on
 * Highway 412, and a matcher clever enough to also return "Highway 549" because
 * the digits are similar would be worse than a plain filter.
 */
export function searchProjects(list: Project[], query: string): Project[] {
    const q = query.trim().toLowerCase()
    if (!q) return list
    const terms = q.split(/\s+/)
    return list.filter((p) => {
        const hay = [
            p.name,
            p.place,
            p.county,
            p.what,
            ...p.effects.map((e) => (e.kind === "corridor" ? e.routes : e.kind)),
        ]
            .join(" ")
            .toLowerCase()
        return terms.every((t) => hay.includes(t))
    })
}

/** The one-word category, used for the filter chips and the row colour. */
export function projectKind(p: Project): "corridor" | "growth" | "response" | "utility" {
    const first = p.effects[0].kind
    return first === "corridor"
        ? "corridor"
        : first === "residents"
          ? "growth"
          : first === "station"
            ? "response"
            : "utility"
}
