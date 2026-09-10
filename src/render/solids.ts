/**
 * A very small solid modeller, for showing what a project IS.
 *
 * CorridorModel extrudes the result: every road stands up in proportion to a
 * number the simulation produced. That is the right picture after a run and the
 * wrong one before it, because it cannot tell a runway from a treatment plant.
 * Both are "a change to the network" and both would draw as the same field of
 * bars.
 *
 * So this file gives the preview a vocabulary of things instead. A scene is a
 * list of extruded footprints and elevated strands in local metres, and each
 * project in src/data/projects.ts composes its own out of them: a lock chamber
 * is two long walls and a gate, a clarifier is a ring, a stack interchange is
 * four ramps at four heights. Different projects therefore look different,
 * which is the entire point of the preview.
 *
 * The camera lives here and CorridorModel imports it, which is the arrangement
 * that should have existed from the start: the two renderers each kept a copy,
 * the copies disagreed about the sign of the z term, and the result page spent
 * a long time extruding every road downward through the ground. A hand-rolled
 * projection is the right call over WebGL for a panel like this, but only if
 * there is one of it.
 *
 * Nothing here loads an asset. Every mesh is generated, so nothing can go
 * missing and nothing has to be licensed.
 */

export type Point = [number, number]

/** An extruded footprint: a polygon on the ground, raised by `height`. */
export interface Solid {
    /** Footprint in local metres, x east and y north, in order around the shape. */
    base: Point[]
    /** Extrusion in metres. Zero draws the footprint flat. */
    height: number
    /** Metres the whole footprint floats above the ground plane. */
    lift?: number
    color: string
    /** Where in the build sequence this appears, 0 to 1. */
    t: number
    /** Draw the top face only. Water, plazas and paving want this. */
    flat?: boolean
    /** Face opacity, before the build fade. Defaults to 0.16. */
    opacity?: number
}

/** A polyline in three dimensions: a road centreline, a rail, a cable, a mast. */
export interface Strand {
    /** Points as [x, y, z] in local metres. */
    points: [number, number, number][]
    color: string
    /** Stroke width in pixels. */
    width: number
    t: number
    /** Given a width in metres, the strand is drawn as a flat ribbon instead. */
    ribbon?: number
    /** Stroke opacity, before the build fade. Defaults to 0.9. */
    opacity?: number
    dashed?: boolean
}

export interface Scene {
    solids: Solid[]
    strands: Strand[]
    /** Half-width of the scene in metres, used to frame the camera. */
    extent: number
    /** Ground plane tint, drawn as a disc under everything. */
    ground?: string
    /**
     * Vertical exaggeration, applied to every height in the scene.
     *
     * Real infrastructure is almost entirely horizontal. A freeway ramp climbs
     * twelve metres over a junction fifteen hundred metres across; drawn to
     * scale, a four-level stack is four lines lying on top of each other and
     * the one thing the picture exists to show is invisible. Section drawings
     * have exaggerated their vertical for the same reason for two centuries.
     *
     * It is safe here for one reason: NOTHING IS MEASURED OFF THIS PANEL. The
     * preview is a picture of which object you picked, and every number in the
     * app comes from the engine and appears somewhere else. The moment a height
     * here meant a quantity, this factor would have to go.
     *
     * Defaults to 1, so a scene that reads correctly at true scale stays there.
     */
    zScale?: number
}

/* --- footprint helpers ------------------------------------------------- */

/** An axis-aligned rectangle centred on (cx, cy). */
export function rect(cx: number, cy: number, w: number, d: number): Point[] {
    const hw = w / 2
    const hd = d / 2
    return [
        [cx - hw, cy - hd],
        [cx + hw, cy - hd],
        [cx + hw, cy + hd],
        [cx - hw, cy + hd],
    ]
}

/** A rectangle rotated about its own centre, radians anticlockwise. */
export function rotRect(cx: number, cy: number, w: number, d: number, a: number): Point[] {
    const c = Math.cos(a)
    const s = Math.sin(a)
    return rect(0, 0, w, d).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c] as Point)
}

/** A regular polygon, which at 24 sides reads as a circle at this scale. */
export function circle(cx: number, cy: number, r: number, sides = 24): Point[] {
    return Array.from({ length: sides }, (_, i) => {
        const a = (i / sides) * Math.PI * 2
        return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Point
    })
}

/** An annulus approximated as a thin polygon ring, for tanks and basins. */
export function ring(cx: number, cy: number, r: number, thickness: number, sides = 24): Point[] {
    const outer = circle(cx, cy, r, sides)
    const inner = circle(cx, cy, Math.max(1, r - thickness), sides).reverse()
    return [...outer, outer[0], ...inner, inner[0]]
}

/**
 * A strip of given width along a centreline: how every road, rail, runway and
 * trail in the catalogue is built.
 *
 * Offsetting each point along the average of its two segment normals keeps the
 * width right through a bend, which matters because half of these projects are
 * curves and a naive per-segment offset opens a wedge at every joint.
 */
export function strip(centre: Point[], width: number): Point[] {
    const half = width / 2
    const left: Point[] = []
    const right: Point[] = []

    for (let i = 0; i < centre.length; i++) {
        const prev = centre[Math.max(0, i - 1)]
        const next = centre[Math.min(centre.length - 1, i + 1)]
        const dx = next[0] - prev[0]
        const dy = next[1] - prev[1]
        const len = Math.hypot(dx, dy) || 1
        const nx = -dy / len
        const ny = dx / len
        left.push([centre[i][0] + nx * half, centre[i][1] + ny * half])
        right.push([centre[i][0] - nx * half, centre[i][1] - ny * half])
    }
    return [...left, ...right.reverse()]
}

/** A sampled arc, for ramps, river bends and bypass alignments. */
export function arc(
    cx: number,
    cy: number,
    r: number,
    from: number,
    to: number,
    steps = 20,
): Point[] {
    return Array.from({ length: steps + 1 }, (_, i) => {
        const a = from + ((to - from) * i) / steps
        return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Point
    })
}

/** A cubic-ish rise and fall, for a bridge deck or a flyover ramp. */
export function elevate(
    pts: Point[],
    peak: number,
    ends = 0,
): [number, number, number][] {
    return pts.map((p, i) => {
        const t = pts.length === 1 ? 0 : i / (pts.length - 1)
        // sin gives a flat approach at both ends rather than a kink.
        const z = ends + (peak - ends) * Math.sin(Math.PI * t)
        return [p[0], p[1], z]
    })
}

/** A polyline held at one height. */
export function flatten(pts: Point[], z: number): [number, number, number][] {
    return pts.map(([x, y]) => [x, y, z] as [number, number, number])
}

/** A vertical line: a mast, a stack, a crane leg, a hose tower. */
export function mast(
    x: number,
    y: number,
    height: number,
    color: string,
    t: number,
    width = 1.2,
): Strand {
    return { points: [[x, y, 0], [x, y, height]], color, width, t }
}

/** A row of the same solid, evenly spaced along a line. Piers, bays, silos. */
export function repeat<T>(count: number, make: (i: number, t: number) => T): T[] {
    return Array.from({ length: count }, (_, i) => make(i, count === 1 ? 0 : i / (count - 1)))
}

/* --- camera ------------------------------------------------------------ */

export interface Camera {
    bearing: number
    pitch: number
}

/**
 * Where a scene sits in a particular canvas.
 *
 * Split out from the projection because it is computed on a different clock.
 * The projection runs every frame; the framing must NOT, or the model breathes
 * in and out as the camera orbits, which reads as the panel being unable to
 * decide how big the thing is.
 */
export interface Fit {
    scale: number
    cx: number
    cy: number
    focal: number
}

/**
 * The camera transform, in world units, before anything is fitted to a canvas.
 *
 * Rotate about the vertical axis, tilt about the screen horizontal, divide by
 * depth. Returns screen-oriented world units plus the depth, which is what both
 * the fitting pass and the drawing pass need.
 *
 * Exported because there are two renderers, not one. This module draws the
 * generated scenes; CorridorModel draws the extruded result, which is thousands
 * of thin walls and wants its own tuned loop rather than a Scene. Both must
 * agree about which way is up, and the last time they each kept a copy of this
 * arithmetic they did not: one was fixed and the other quietly went on hanging
 * every bar below the ground for weeks.
 */
export function cameraTransform(cam: Camera, focal: number, zScale = 1) {
    const cb = Math.cos(cam.bearing)
    const sb = Math.sin(cam.bearing)
    const cp = Math.cos(cam.pitch)
    const sp = Math.sin(cam.pitch)

    /**
     * `out` lets a hot loop reuse one array instead of allocating per point.
     *
     * The result page projects roughly a hundred thousand points a frame for
     * the statewide ground plan, and returning a fresh three-element array for
     * each of them halved the frame rate on its own: the arithmetic was never
     * the cost, the garbage was. Callers with a handful of points can ignore it
     * and read the returned tuple normally.
     */
    return function at(
        x: number,
        y: number,
        zRaw: number,
        out?: [number, number, number],
    ): [number, number, number] {
        const z = zRaw * zScale

        // Bearing: spin the world about the vertical axis.
        const rx = x * cb - y * sb
        const ry = x * sb + y * cb

        /* Pitch, measured from straight down: 0 is a plan view, pi/2 is the
           horizon. North therefore leans into the screen as the camera drops,
           and height rises on it.

           The sign on the z terms is the whole thing. Getting it the other way
           round is not subtly wrong, it is upside down: the arch of a through
           bridge hangs below its deck, a water tower sinks into its own legs,
           and four interchange ramps stack downward into the ground. It looks
           deliberate for about a second, which is what makes it worth a note. */
        const sy = ry * cp + z * sp
        const depth = ry * sp - z * cp

        const f = focal / (focal + depth)
        if (out) {
            out[0] = rx * f
            out[1] = -sy * f
            out[2] = depth
            return out
        }
        return [rx * f, -sy * f, depth]
    }
}

/** Every point in a scene, once, for measuring. */
function* points(scene: Scene): Generator<[number, number, number]> {
    for (const s of scene.solids) {
        const lift = s.lift ?? 0
        for (const [x, y] of s.base) {
            yield [x, y, lift]
            if (s.height > 0) yield [x, y, lift + s.height]
        }
    }
    for (const st of scene.strands) {
        for (const pt of st.points) yield pt
        // A ribbon is wider than its centreline, and at 60 m that is most of a
        // runway. Measure the edges, not the middle.
        if (st.ribbon) {
            const half = st.ribbon / 2
            for (const [x, y, z] of st.points) {
                yield [x + half, y + half, z]
                yield [x - half, y - half, z]
            }
        }
    }
}

/**
 * Frames a scene so it FILLS its canvas.
 *
 * The first version scaled by `min(width, height) / extent`, which is right for
 * a square panel and wrong for every other shape. The preview strip is roughly
 * 360 by 200, so a scene was scaled to fit the 200 and then drawn in the middle
 * of the 360: about half the panel was empty black, and the object inside it was
 * half the size it could have been. Nothing was broken, which is why it survived
 * a review; it just looked like a small model adrift in a large box.
 *
 * So the scene is measured rather than assumed. Every vertex is projected in
 * world units, the bounding box of the result is taken, and the scale is
 * whichever of the two axes runs out first. An L-shaped plan and a long thin
 * bridge then fill the same panel equally well, because the fit is a property
 * of what was drawn rather than of a number the scene declared about itself.
 *
 * Measured at rest AND at the start of the build sweep, taking the tighter of
 * the two, so the camera movement during the build cannot push the object out
 * of frame. Orbiting well past that with the pointer can crop a corner, which
 * is the right trade: a pointer-driven camera is a deliberate act, and paying
 * for its extremes with a permanently smaller model is not worth it.
 */
export function fitScene(
    scene: Scene,
    width: number,
    height: number,
    cams: Camera[],
    /** Fraction of the panel the scene may occupy. */
    padding = 0.94,
): Fit {
    const focal = Math.max(scene.extent, 1) * 2.6
    const zScale = scene.zScale ?? 1

    let scale = Infinity
    let bestCentre: [number, number] = [0, 0]

    for (const cam of cams) {
        const at = cameraTransform(cam, focal, zScale)
        let minX = Infinity
        let maxX = -Infinity
        let minY = Infinity
        let maxY = -Infinity

        for (const [x, y, z] of points(scene)) {
            const [ux, uy] = at(x, y, z)
            if (ux < minX) minX = ux
            if (ux > maxX) maxX = ux
            if (uy < minY) minY = uy
            if (uy > maxY) maxY = uy
        }
        if (!Number.isFinite(minX)) continue

        const w = Math.max(maxX - minX, 1e-6)
        const h = Math.max(maxY - minY, 1e-6)
        const s = Math.min((width * padding) / w, (height * padding) / h)
        if (s < scale) {
            scale = s
            bestCentre = [(minX + maxX) / 2, (minY + maxY) / 2]
        }
    }

    if (!Number.isFinite(scale)) scale = 1

    // Centre the measured box in the canvas rather than centring the origin:
    // most of these scenes are not symmetrical about it.
    return {
        scale,
        cx: width / 2 - bestCentre[0] * scale,
        cy: height / 2 - bestCentre[1] * scale,
        focal,
    }
}

/** World to canvas pixels, for one camera and one fit. */
export function makeProjector(scene: Scene, cam: Camera, fit: Fit) {
    const at = cameraTransform(cam, fit.focal, scene.zScale ?? 1)
    return function project(x: number, y: number, z: number): [number, number, number] {
        const [ux, uy, depth] = at(x, y, z)
        return [fit.cx + ux * fit.scale, fit.cy + uy * fit.scale, depth]
    }
}

/* --- render ------------------------------------------------------------ */

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

/** One thing to paint, and how far away it is. */
interface Item {
    depth: number
    paint: () => void
}

/**
 * The left and right edges of a ribbon, offset along averaged normals.
 *
 * Computed once per strand rather than per segment, because a segment needs its
 * neighbours' normals to close cleanly against them.
 */
function ribbonEdges(pts: [number, number, number][], width: number) {
    const half = width / 2
    const left: Point[] = []
    const right: Point[] = []
    for (let i = 0; i < pts.length; i++) {
        const prev = pts[Math.max(0, i - 1)]
        const next = pts[Math.min(pts.length - 1, i + 1)]
        const dx = next[0] - prev[0]
        const dy = next[1] - prev[1]
        const len = Math.hypot(dx, dy) || 1
        const nx = (-dy / len) * half
        const ny = (dx / len) * half
        left.push([pts[i][0] + nx, pts[i][1] + ny])
        right.push([pts[i][0] - nx, pts[i][1] - ny])
    }
    return { left, right }
}

/**
 * Draws a scene at build progress `build`, 0 to 1.
 *
 * Depth ordering is per SEGMENT, not per object, and that distinction is the
 * difference between a bridge and a mess. A painter's algorithm sorts by one
 * number per thing, so a 1.7 km deck gets the depth of its midpoint and then
 * paints either in front of every pier or behind every one of them. Both look
 * broken in the same specific way: the deck slices through the columns holding
 * it up. Splitting each strand into its segments gives every span its own place
 * in the order, and the deck passes in front of the near piers and behind the
 * far ones, which is what it does in life.
 *
 * Ground-level paving is drawn first as a separate pass. It is large, flat and
 * underneath everything by definition, so letting it compete on average depth
 * with the objects standing on it only ever produces a water plane painted over
 * its own bridge.
 */
export function drawScene(
    ctx: CanvasRenderingContext2D,
    scene: Scene,
    width: number,
    height: number,
    cam: Camera,
    build: number,
    fit: Fit,
) {
    const project = makeProjector(scene, cam, fit)

    /** How far into its own growth this piece is, given the global progress. */
    const grow = (t: number) => Math.max(0, Math.min(1, (build - t * 0.6) / 0.4))

    if (scene.ground) {
        const r = scene.extent * 1.05
        const disc = circle(0, 0, r, 40).map(([x, y]) => project(x, y, 0))
        ctx.beginPath()
        ctx.moveTo(disc[0][0], disc[0][1])
        for (const p of disc.slice(1)) ctx.lineTo(p[0], p[1])
        ctx.closePath()
        ctx.fillStyle = scene.ground
        ctx.globalAlpha = 0.5 * Math.min(1, build * 4)
        ctx.fill()
    }

    const items: Item[] = []

    for (const s of scene.solids) {
        const g = grow(s.t)
        if (g <= 0) continue
        const lift = s.lift ?? 0

        // Paving, water and greens: on the ground, under everything, painted
        // in the first pass in scene order.
        if (s.flat && lift === 0) {
            drawSolid(ctx, project, s, g)
            continue
        }

        let depth = 0
        for (const [x, y] of s.base) depth += project(x, y, lift)[2]
        depth /= s.base.length
        items.push({ depth, paint: () => drawSolid(ctx, project, s, g) })
    }

    for (const st of scene.strands) {
        const g = grow(st.t)
        if (g <= 0) continue

        // A strand lays itself out along its length, so a road is built rather
        // than revealed. Buildings grow up; roads run out.
        const count = Math.max(2, Math.ceil(st.points.length * easeOut(g)))
        const edges = st.ribbon ? ribbonEdges(st.points, st.ribbon) : null

        for (let i = 0; i < count - 1; i++) {
            const a = st.points[i]
            const b = st.points[i + 1]
            const pa = project(a[0], a[1], a[2])
            const pb = project(b[0], b[1], b[2])
            const depth = (pa[2] + pb[2]) / 2
            const seg = i
            items.push({
                depth,
                paint: () => {
                    if (edges) {
                        const q = [
                            project(edges.left[seg][0], edges.left[seg][1], a[2]),
                            project(edges.left[seg + 1][0], edges.left[seg + 1][1], b[2]),
                            project(edges.right[seg + 1][0], edges.right[seg + 1][1], b[2]),
                            project(edges.right[seg][0], edges.right[seg][1], a[2]),
                        ]
                        ctx.beginPath()
                        ctx.moveTo(q[0][0], q[0][1])
                        for (const pt of q.slice(1)) ctx.lineTo(pt[0], pt[1])
                        ctx.closePath()
                        ctx.fillStyle = st.color
                        ctx.globalAlpha = 0.22 * g
                        ctx.fill()
                    }
                    ctx.beginPath()
                    ctx.moveTo(pa[0], pa[1])
                    ctx.lineTo(pb[0], pb[1])
                    ctx.strokeStyle = st.color
                    ctx.globalAlpha = (st.opacity ?? 0.9) * g
                    ctx.lineWidth = st.width
                    ctx.lineCap = "round"
                    ctx.setLineDash(st.dashed ? [5, 4] : [])
                    ctx.stroke()
                    ctx.setLineDash([])
                },
            })
        }
    }

    // Furthest first, so nearer geometry paints over it.
    items.sort((a, b) => b.depth - a.depth)
    for (const item of items) item.paint()

    ctx.globalAlpha = 1
}

function drawSolid(
    ctx: CanvasRenderingContext2D,
    project: (x: number, y: number, z: number) => [number, number, number],
    s: Solid,
    g: number,
) {
    const lift = s.lift ?? 0
    // Solids grow upward out of their own footprint, so a building is seen
    // being built rather than switched on.
    const h = lift + s.height * easeOut(g)
    const face = s.opacity ?? 0.16

    /* The outline follows the fill.
     *
     * It used to be a constant, which quietly defeated the whole point of
     * asking for a faint solid: the fill dropped to a fifth and the edge stayed
     * at full strength, so background terrain came back as a set of hard bright
     * outlines and read as panes of glass standing over the scene rather than
     * as ground behind it. An edge is part of how solid a thing looks, so it
     * has to move with the face. */
    const edge =
        s.opacity != null ? Math.max(0.08, Math.min(0.75, s.opacity * 4)) : s.flat ? 0.45 : 0.7

    const bottom = s.base.map(([x, y]) => project(x, y, lift))
    const top = s.base.map(([x, y]) => project(x, y, h))

    if (!s.flat && s.height > 0) {
        // Side walls, one quad per footprint edge.
        for (let i = 0; i < s.base.length; i++) {
            const j = (i + 1) % s.base.length
            ctx.beginPath()
            ctx.moveTo(bottom[i][0], bottom[i][1])
            ctx.lineTo(bottom[j][0], bottom[j][1])
            ctx.lineTo(top[j][0], top[j][1])
            ctx.lineTo(top[i][0], top[i][1])
            ctx.closePath()
            ctx.fillStyle = s.color
            ctx.globalAlpha = face * g
            ctx.fill()
        }
    }

    // The top face and its outline. The outline is what actually reads as an
    // object; the fill alone dissolves into every other translucent fill.
    ctx.beginPath()
    ctx.moveTo(top[0][0], top[0][1])
    for (const p of top.slice(1)) ctx.lineTo(p[0], p[1])
    ctx.closePath()
    ctx.fillStyle = s.color
    ctx.globalAlpha = (s.flat ? face * 1.6 : face * 1.35) * g
    ctx.fill()
    ctx.strokeStyle = s.color
    ctx.globalAlpha = edge * g
    ctx.lineWidth = s.flat ? 0.9 : 1.2
    ctx.lineJoin = "round"
    ctx.stroke()
}
