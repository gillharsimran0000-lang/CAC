"use client"

/**
 * THE RESULT, IN THREE DIMENSIONS.
 *
 * After a simulation the affected corridors are rebuilt as a solid: every road
 * is extruded upward in proportion to its volume-to-capacity, so congestion
 * stops being a colour on a flat map and becomes height you can see across.
 * A saturated arterial is a wall; a free-flowing one lies almost flat.
 *
 * This is a model OF the result, not a model dropped next to it. There is no
 * imported mesh and no asset to load -- the geometry is generated from the same
 * per-edge numbers the chain quotes, so it cannot show anything the simulation
 * did not produce.
 *
 * Rendered with a hand-rolled perspective projection into the existing 2D
 * canvas rather than WebGL. Three.js for one view would add megabytes and a
 * second rendering model to keep in sync with the map; the maths for a camera
 * that orbits and tilts is a dozen lines.
 *
 * Those dozen lines are imported from src/render/solids.ts rather than kept
 * here, and that is not tidiness. This file had its own copy, the copy had its
 * z term the wrong way round, and so every bar in the result extruded DOWNWARD
 * through the ground plane: seen from above, thousands of translucent walls
 * hanging under the map stacked into a red smear that looked like a rendering
 * artefact rather than a model of anything. It survived because a smear is hard
 * to distinguish from a busy network, and because the preview -- which had the
 * corrected copy -- looked right. One camera now, shared.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import type { RawGraph } from "@/engine/graph"
import type { CorridorStress } from "@/engine/types"
import { IDLE, IDLE_MAJOR, isMajorClass, vcColor } from "@/render/network"
import { cameraTransform, type Camera } from "@/render/solids"
import { prefersReducedMotion } from "@/lib/motion"

/**
 * How many links may stand up.
 *
 * Walls are translucent quads that have to be depth-sorted every frame, so they
 * are capped and the cap is spent on the WORST links: at this point the ground
 * plan is complete, so the walls are pure signal and there is no reason to take
 * anything but the top of the distribution.
 */
const MAX_WALLS = 1800
/** Points kept per road when drawing the ground plan. */
const MAX_GEOM = 4
/**
 * Metres of extrusion at v/c = 1.
 *
 * Held down to roughly a tenth of the width of a metro, which is already a
 * heavy exaggeration and reads as architecture. The first figure here was 5,200
 * and a failed link came out eleven kilometres tall over a thirty kilometre
 * network: not a wall, a needle, and a field of them is a scribble.
 */
const HEIGHT_AT_CAPACITY = 2200
const BUILD_MS = 1500
/** Below this v/c a road lies flat; at or above it, it stands up. */
const EXTRUDE_FROM = 0.7

/**
 * THE GROUND PLAN, AND WHY IT IS NOT A LIST OF OBJECTS.
 *
 * Every road that is not standing up, drawn flat. All of them: this is the one
 * layer that has to be complete, because it is the only thing telling a reader
 * that they are looking at Arkansas rather than at a scatter plot.
 *
 * The previous version capped it at nine thousand and sampled every Nth edge to
 * get there. That is fine for Northwest Arkansas, which has 10,975 routable
 * edges and therefore never hit the cap, and it is destructive for the
 * statewide network, which has 30,148: keeping one edge in three does not
 * thin a road network, it DISCONNECTS it, and the state came out as a field of
 * unrelated stubs. A network is its connectivity. You cannot subsample one.
 *
 * It also has to include roads carrying no traffic. Filtering to loaded links
 * looked reasonable and produced the same disconnected-stub picture by a second
 * route: at state scale most of the network carries almost nothing in the peak
 * hour, so the filter threw away the roads BETWEEN the busy ones. The map
 * component had already learnt this and solved it the right way, with a dim
 * tone for an idle road, and this now borrows both the idea and the colours.
 *
 * Drawing all thirty thousand is affordable because of how they are stored.
 * There are only a handful of colours, so the polylines are sorted into runs of
 * one colour and each run is drawn as a SINGLE path: a few beginPath calls for
 * the whole state instead of thirty thousand. The coordinates live in flat
 * typed arrays so the per-frame loop reads numbers in order and allocates
 * nothing.
 */
interface Ground {
    /** All polylines concatenated, as x,y pairs in local metres. */
    xy: Float32Array
    /** Index of each polyline's first point, in points, not floats. */
    start: Int32Array
    count: Int32Array
    /** Where in the build sequence each polyline appears, ascending. */
    order: Float32Array
    /** One contiguous run of polylines per colour, with the width it is drawn at. */
    buckets: { color: string; width: number; from: number; to: number }[]
}

const EMPTY_GROUND: Ground = {
    xy: new Float32Array(0),
    start: new Int32Array(0),
    count: new Int32Array(0),
    order: new Float32Array(0),
    buckets: [],
}

interface Bar {
    /** Local metres east/north of the view centre, both ends of the edge. */
    x1: number
    y1: number
    x2: number
    y2: number
    vc: number
    height: number
    /** 0-1 position in the build-in order. */
    order: number
    color: string
    /** Which corridor this link belongs to, so a wall can be named and picked. */
    corridorId: number
}

/**
 * How a flat road is coloured, and how heavily it is drawn.
 *
 * An idle road is not absent, it is idle: it keeps its place in the network at
 * a tone well clear of the background, heavier where it is an interstate,
 * because at state scale the motorway skeleton is what makes the shape
 * recognisable as Arkansas.
 */
function groundStyle(vc: number, cls: string): { color: string; width: number; rank: number } {
    if (vc <= 0.02) {
        return isMajorClass(cls)
            ? { color: IDLE_MAJOR, width: 1.1, rank: 1 }
            : { color: IDLE, width: 0.7, rank: 0 }
    }
    const color = vcColor(vc)
    return { color, width: 0.95, rank: color === "#3ddc97" ? 2 : 3 }
}

/** Where the resting camera sits. The fit is measured against it. */
const REST: Camera = { bearing: -0.42, pitch: 1.02 }

interface Fit {
    scale: number
    cx: number
    cy: number
    focal: number
}

/**
 * Frames the bars in the canvas by projecting them and measuring the result.
 *
 * Both ends of every bar, at the ground and at the top, because a field of
 * five-kilometre walls occupies a good deal more of the frame than its
 * footprint does and fitting to the footprint alone crops the tops off exactly
 * the links the picture exists to show.
 */
function fitBars(
    bars: Bar[],
    ground: Ground,
    width: number,
    height: number,
    /** Fraction of the canvas the geometry may occupy. */
    padding = 0.9,
): Fit | null {
    const groundPts = ground.xy.length / 2
    if ((!bars.length && !groundPts) || width <= 0 || height <= 0) return null

    /* Focal length from the 92nd percentile radius rather than the outright
       maximum: a handful of stray links at the edge of the bbox were setting
       the perspective and flattening everything inside it. */
    const radii: number[] = []
    for (let i = 0; i < groundPts; i++) {
        radii.push(Math.hypot(ground.xy[i * 2], ground.xy[i * 2 + 1]))
    }
    for (const b of bars) {
        radii.push(Math.max(Math.hypot(b.x1, b.y1), Math.hypot(b.x2, b.y2)))
    }
    radii.sort((a, b) => a - b)
    const focal = Math.max(1, (radii[Math.floor(radii.length * 0.92)] ?? 1) * 2.4)

    const at = cameraTransform(REST, focal)
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    const see = (x: number, y: number, z: number) => {
        const [ux, uy] = at(x, y, z)
        if (ux < minX) minX = ux
        if (ux > maxX) maxX = ux
        if (uy < minY) minY = uy
        if (uy > maxY) maxY = uy
    }
    /* The ground plan sets the footprint and the walls add their tops. Fitting
       to the walls alone framed the congested core and cropped the rest of the
       network out of the picture, which is the one thing the ground plan is
       there to prevent. */
    for (let i = 0; i < groundPts; i++) {
        see(ground.xy[i * 2], ground.xy[i * 2 + 1], 0)
    }
    for (const b of bars) {
        see(b.x1, b.y1, 0)
        see(b.x2, b.y2, 0)
        see(b.x1, b.y1, b.height)
        see(b.x2, b.y2, b.height)
    }
    if (!Number.isFinite(minX)) return null

    const w = Math.max(maxX - minX, 1e-6)
    const h = Math.max(maxY - minY, 1e-6)
    const scale = Math.min((width * padding) / w, (height * padding) / h)
    return {
        scale,
        cx: width / 2 - ((minX + maxX) / 2) * scale,
        cy: height / 2 - ((minY + maxY) / 2) * scale,
        focal,
    }
}

/** Longitude/latitude to local metres, flat-earth over a single metro. */
function toLocal(lon: number, lat: number, lon0: number, lat0: number): [number, number] {
    const mPerDegLat = 111_320
    const mPerDegLon = mPerDegLat * Math.cos((lat0 * Math.PI) / 180)
    return [(lon - lon0) * mPerDegLon, (lat - lat0) * mPerDegLat]
}

/**
 * Everything a result needs drawn, derived from the run.
 *
 * A plain function of the graph and the per-edge v/c, so the component can call
 * it during render through a useMemo rather than inside an effect. It used to
 * live in an effect that ended with a setState, which is a cascading render to
 * publish a number that was already knowable: the counts under the panel are a
 * property of the arrays being built, not news arriving from somewhere else.
 */
function buildModel(graph: RawGraph, vc: number[]) {
    const { from, routable, geomOffset, geomCount, cls: clsArr, corridor: corridorArr } = graph.edges
    const lonArr = graph.geometry.lon
    const latArr = graph.geometry.lat
    const [s, w, n, e] = graph.bbox
    const lon0 = (w + e) / 2
    const lat0 = (s + n) / 2

    /* Two passes, one per budget.
       
       Everything loaded lies flat unless it is stressed; the stressed links
       stand up. The flat set is sampled evenly across the network rather
       than by rank, which is what keeps the shape of the place: taking the
       worst 9,000 would draw the metro core and nothing else, and the whole
       point of the ground plan is to be the thing the walls are standing
       on. */
    /* Every routable link is in the picture. The stressed ones stand up and
       everything else lies flat, including the roads carrying nothing. */
    const flatIdx: number[] = []
    const wallIdx: number[] = []
    for (let i = 0; i < vc.length && i < from.length; i++) {
        if (!routable[i]) continue
        ;(vc[i] >= EXTRUDE_FROM ? wallIdx : flatIdx).push(i)
    }

    /* Sorted so each colour is a contiguous run, and so the reveal sweeps
       from the quiet network to the busy parts of it: idle minor roads,
       idle interstates, then the loaded links in order of how loaded they
       are. One sort buys both the batching and the build order. */
    const style = new Map<number, ReturnType<typeof groundStyle>>()
    for (const i of flatIdx) style.set(i, groundStyle(vc[i], clsArr[i]))
    flatIdx.sort((a, b) => {
        const d = style.get(a)!.rank - style.get(b)!.rank
        return d !== 0 ? d : vc[a] - vc[b]
    })

    let pointTotal = 0
    const kept: number[][] = flatIdx.map((i) => {
        const o = geomOffset[i]
        const c = Math.max(2, geomCount[i])
        /* Decimated to a handful of points. A county-scale link has dozens,
           and past five they are smaller than a pixel at this zoom; two
           would straighten every bend in the state. */
        const step = Math.max(1, Math.floor((c - 1) / (MAX_GEOM - 1)))
        const idx: number[] = []
        for (let k = 0; k < c - 1 && idx.length < MAX_GEOM - 1; k += step) idx.push(o + k)
        idx.push(o + c - 1)
        pointTotal += idx.length
        return idx
    })

    const ground: Ground = {
        xy: new Float32Array(pointTotal * 2),
        start: new Int32Array(flatIdx.length),
        count: new Int32Array(flatIdx.length),
        order: new Float32Array(flatIdx.length),
        buckets: [],
    }

    let cursor = 0
    for (let n = 0; n < kept.length; n++) {
        ground.start[n] = cursor
        ground.count[n] = kept[n].length
        for (const gi of kept[n]) {
            const [x, y] = toLocal(lonArr[gi], latArr[gi], lon0, lat0)
            ground.xy[cursor * 2] = x
            ground.xy[cursor * 2 + 1] = y
            cursor++
        }
        // The plan lays in first, over the opening 45% of the build.
        ground.order[n] = (n / Math.max(1, kept.length - 1)) * 0.45

        const { color, width } = style.get(flatIdx[n])!
        const last = ground.buckets[ground.buckets.length - 1]
        if (last && last.color === color) last.to = n + 1
        else ground.buckets.push({ color, width, from: n, to: n + 1 })
    }

    /* The worst links stand up. Ranked rather than sampled: with a complete
       ground plan behind them the walls are pure signal, so there is no
       reason to take anything but the top of the distribution. */
    wallIdx.sort((a, b) => vc[b] - vc[a])
    const bars: Bar[] = wallIdx.slice(0, MAX_WALLS).map((i) => {
        const o = geomOffset[i]
        const c = geomCount[i]
        const [x1, y1] = toLocal(lonArr[o], latArr[o], lon0, lat0)
        const [x2, y2] = toLocal(lonArr[o + c - 1], latArr[o + c - 1], lon0, lat0)
        const ratio = vc[i]
        return {
            x1, y1, x2, y2,
            vc: ratio,
            height: Math.min(ratio, 2.2) * HEIGHT_AT_CAPACITY,
            order: 0,
            color: vcColor(ratio),
            corridorId: corridorArr[i],
        }
    })

    // And the worst bottlenecks rise last, so the eye ends on the problem.
    const sorted = [...bars].sort((a, b) => a.vc - b.vc)
    sorted.forEach((b, i) => (b.order = 0.4 + (i / Math.max(1, sorted.length - 1)) * 0.6))


    return {
        ground,
        bars,
        stats: {
            walls: bars.length,
            flat: ground.count.length,
            tallest: bars.reduce((m, b) => Math.max(m, b.vc), 0),
        },
    }
}


/**
 * WHAT THE READER IS LOOKING AT.
 *
 * The model was, for a long time, a beautiful object that explained nothing. A
 * green web with red things standing on it is not self-evident: a reader has to
 * be told that a line is a road, that height is how far past capacity it is,
 * and that the thing they can see is clickable at all. None of that can be
 * inferred from the picture, and a picture that needs a caption should simply
 * have one.
 *
 * Written as DOM rather than painted into the canvas, deliberately. The canvas
 * is aria-hidden, so anything drawn inside it does not exist for a screen
 * reader; this way the model's own explanation, and the figures for whichever
 * corridor is selected, are ordinary readable text.
 */
function ModelKey({
    focus,
    onClear,
    compact,
}: {
    focus?: CorridorStress | null
    onClear: () => void
    compact?: boolean
}) {
    const band = (v: number) =>
        v >= 1 ? "over capacity" : v >= 0.85 ? "past the stress threshold" : "below the threshold"

    return (
        <>
            {/* The key. Always there, because the question it answers is the
                first one anyone has. */}
            <div
                className={`pointer-events-none absolute left-2 top-2 z-10 max-w-[15rem] rounded-md border border-white/10 bg-black/55 p-2 backdrop-blur-sm ${
                    compact ? "text-[9px]" : "text-[10px]"
                }`}
            >
                <p className="font-mono uppercase tracking-wider text-white/50">
                    Every line is a road
                </p>
                <p className="mt-1 leading-relaxed text-white/70">
                    Flat means it carries its traffic. A road stands up when it passes the
                    level-of-service C/D threshold, and how tall it stands is how far past
                    capacity the model puts it.
                </p>
                <div className="mt-1.5 flex items-center gap-1">
                    {[
                        ["#57627a", "idle"],
                        ["#3ddc97", "free"],
                        ["#f2c14e", "stressed"],
                        ["#e5484d", "over"],
                    ].map(([c, label]) => (
                        <span key={label} className="flex items-center gap-0.5">
                            <span
                                aria-hidden
                                className="h-2 w-2 rounded-[1px]"
                                style={{ background: c }}
                            />
                            <span className="font-mono text-[8.5px] text-white/45">{label}</span>
                        </span>
                    ))}
                </div>
                {!focus && (
                    <p className="mt-1.5 font-mono uppercase tracking-wider text-white/40">
                        Click a standing road
                    </p>
                )}
            </div>

            {/* And the corridor, once one is picked. Every figure here is from
                the run: nothing about a selection is recomputed or estimated. */}
            {focus && (
                <div className="absolute bottom-2 left-2 right-2 z-10 rounded-md border border-white/12 bg-black/70 p-2.5 backdrop-blur-sm sm:right-auto sm:max-w-xs">
                    <div className="flex items-baseline justify-between gap-3">
                        <p className="truncate text-[13px] text-white">{focus.label}</p>
                        <button
                            onClick={onClear}
                            className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-white/50 transition-colors hover:text-white"
                        >
                            show all
                        </button>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-white/80">
                        v/c {focus.baseVc.toFixed(2)}{" "}
                        <span aria-hidden className="text-white/40">to</span>{" "}
                        <span style={{ color: focus.scenarioVc >= 1 ? "#e5484d" : focus.scenarioVc >= 0.85 ? "#f28f3b" : "#3ddc97" }}>
                            {focus.scenarioVc.toFixed(2)}
                        </span>
                    </p>
                    <p className="mt-1 text-[10px] leading-relaxed text-white/60">
                        Worst link carries {Math.round(focus.scenarioVolume).toLocaleString()} vehicles
                        in the peak hour against {Math.round(focus.baseVolume).toLocaleString()} in the
                        baseline, into {Math.round(focus.capacityVph).toLocaleString()} vehicles per
                        hour of capacity: {band(focus.scenarioVc)}.
                    </p>
                    {focus.newlyStressed && (
                        <p className="mt-1 font-mono text-[9.5px] uppercase tracking-wider text-flow-tight">
                            crossed into stress because of this scenario
                        </p>
                    )}
                </div>
            )}
        </>
    )
}

export function CorridorModel({
    areaId,
    vc,
    corridors,
    className,
    fill,
}: {
    areaId: string
    /** Per-edge volume/capacity from the current run. */
    vc: number[] | null
    /**
     * What the run found for each corridor, so a wall can be named and read.
     *
     * Without it the model is still correct and still unreadable: a viewer sees
     * a red thing standing over a green thing and has no way to learn that it
     * is Interstate 49 at v/c 1.34. This is the difference between a picture of
     * a result and an explanation of one.
     */
    corridors?: CorridorStress[]
    className?: string
    /** Fill the parent instead of rendering the labelled panel. */
    fill?: boolean
}) {
    const wrapRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const barsRef = useRef<Bar[]>([])
    const groundRef = useRef<Ground>(EMPTY_GROUND)
    const rafRef = useRef(0)
    const buildStartRef = useRef(0)
    // Camera, driven by the pointer. Bearing orbits, pitch leans.
    const camRef = useRef({
        bearing: REST.bearing,
        pitch: REST.pitch,
        targetBearing: REST.bearing,
        targetPitch: REST.pitch,
    })
    /* How the bars sit in this canvas. Recomputed when the bars or the canvas
       change and never per frame: a fit that tracked the camera would make the
       model swell and shrink as it orbits.
       
       Three of them, because zooming is a move between two framings. `full` is
       the whole network, `target` is where the camera is going, and `current`
       eases toward it: a cut straight to a corridor loses the viewer, since the
       one thing they need is to see WHERE in the network the thing they clicked
       actually was. */
    const fitRef = useRef<Fit | null>(null)
    const fitTargetRef = useRef<Fit | null>(null)
    const fitFullRef = useRef<Fit | null>(null)
    const refitRef = useRef<(() => void) | null>(null)
    /** Corridor the view is zoomed into, or null for the whole network. */
    const [focus, setFocus] = useState<number | null>(null)
    // The draw loop reads the focus through a ref so a pick does not tear down
    // and rebuild the animation frame.
    const focusRef = useRef<number | null>(null)
    /** Names and figures for the walls, read by the draw loop through a ref. */
    const corridorsRef = useRef<Map<number, CorridorStress>>(new Map())
    /** Set by the render effect, so the overlay button can zoom back out. */
    const clearFocusRef = useRef<() => void>(() => {})
    const clearFocus = () => clearFocusRef.current()
    const [graph, setGraph] = useState<RawGraph | null>(null)

    useEffect(() => {
        let live = true
        fetch(`/data/${areaId}-graph.json`)
            .then((r) => r.json())
            .then((g: RawGraph) => live && setGraph(g))
        return () => {
            live = false
        }
    }, [areaId])

    /* Built during render, not in an effect: it is a pure function of the run.
       The refs and the build clock are the imperative half, so they are the
       only thing left for an effect to do. */
    const model = useMemo(() => (graph && vc ? buildModel(graph, vc) : null), [graph, vc])

    useEffect(() => {
        corridorsRef.current = new Map((corridors ?? []).map((c) => [c.corridorId, c]))
    }, [corridors])

    useEffect(() => {
        focusRef.current = focus
    }, [focus])

    useEffect(() => {
        if (!model) return
        groundRef.current = model.ground
        barsRef.current = model.bars
        buildStartRef.current = performance.now()
        refitRef.current?.()
    }, [model])

    /* Render loop. Stops once the build has finished and the camera has settled,
       so an idle results panel costs nothing. */
    useEffect(() => {
        const canvas = canvasRef.current
        const wrap = wrapRef.current
        if (!canvas || !wrap) return
        const ctx = canvas.getContext("2d")
        if (!ctx) return

        let dpr = 1
        let width = 0
        let height = 0

        const resize = () => {
            /* In fill mode the card is scaled up by a CSS transform during the
               reveal, which stretches the raster rather than redrawing it --
               the bars went soft exactly when they filled the screen. Rendering
               into a larger backing store gives the transform something to
               scale into. Redrawing per frame instead would be correct and far
               too expensive; this costs one oversized render. */
            const base = Math.min(window.devicePixelRatio || 1, 2)
            dpr = fill ? Math.min(base * 2, 4) : base
            width = wrap.clientWidth
            height = wrap.clientHeight
            canvas.width = Math.round(width * dpr)
            canvas.height = Math.round(height * dpr)
            canvas.style.width = `${width}px`
            canvas.style.height = `${height}px`
            const full = fitBars(barsRef.current, groundRef.current, width, height)
            fitFullRef.current = full
            fitTargetRef.current = focusRef.current == null ? full : frameCorridor(focusRef.current)
            // On a resize the view should land, not glide, so current follows target.
            fitRef.current = fitTargetRef.current
        }
        /** The fit that frames one corridor, with room around it for context. */
        const frameCorridor = (corridorId: number): Fit | null => {
            const own = barsRef.current.filter((b) => b.corridorId === corridorId)
            if (!own.length) return fitFullRef.current
            // 0.42 rather than 0.9: a corridor filling the frame edge to edge
            // answers "how bad" and destroys "where", and where is half of what
            // someone clicking a wall is asking.
            return fitBars(own, EMPTY_GROUND, width, height, 0.42) ?? fitFullRef.current
        }

        resize()
        refitRef.current = resize
        window.addEventListener("resize", resize)

        const draw = () => {
            const cam = camRef.current
            // Ease the camera toward the pointer rather than tracking it exactly;
            // 1:1 tracking on a 3D view reads as twitchy.
            cam.bearing += (cam.targetBearing - cam.bearing) * 0.08
            cam.pitch += (cam.targetPitch - cam.pitch) * 0.08

            const bars = barsRef.current
            const ground = groundRef.current
            const elapsed = performance.now() - buildStartRef.current
            const build = prefersReducedMotion() ? 1 : Math.min(1, elapsed / BUILD_MS)

            ctx.save()
            ctx.scale(dpr, dpr)
            ctx.clearRect(0, 0, width, height)

            if (!bars.length && !ground.count.length) {
                ctx.restore()
                rafRef.current = requestAnimationFrame(draw)
                return
            }

            /* Framed by measuring, not by assuming.
               
               The old fit divided the SMALLER canvas dimension by the 92nd
               percentile radius, which is right for a square panel and wrong
               for the one this actually renders into: the result hero is far
               wider than it is tall, so the model was scaled to the height and
               then drawn in the middle of the width. Projecting the bars and
               taking the bounding box of the result frames whatever shape the
               network turns out to be. Measured against the resting camera and
               cached, so orbiting does not make the model breathe. */
            /* Glide toward the framing we want rather than cutting to it. */
            const want = fitTargetRef.current
            const fit = fitRef.current
            if (!fit || !want) {
                ctx.restore()
                rafRef.current = requestAnimationFrame(draw)
                return
            }
            fit.scale += (want.scale - fit.scale) * 0.12
            fit.cx += (want.cx - fit.cx) * 0.12
            fit.cy += (want.cy - fit.cy) * 0.12
            fit.focal += (want.focal - fit.focal) * 0.12
            const framed = Math.abs(want.scale - fit.scale) < want.scale * 0.002
            const at = cameraTransform(cam, fit.focal)
            const project = (x: number, y: number, z: number) => {
                const [ux, uy, depth] = at(x, y, z)
                return [fit.cx + ux * fit.scale, fit.cy + uy * fit.scale, depth] as const
            }
            /* The ground plan runs through a hundred thousand points a frame,
               so it reuses one scratch array rather than allocating a tuple per
               point. Same camera, same call, no garbage. */
            const scratch: [number, number, number] = [0, 0, 0]

            /* The ground plan: one path per colour, not one per road.
               
               These are flat lines on a plane, so nothing among them can
               occlude anything else and depth order buys nothing. What they
               cost is state changes, and batching a whole colour into a single
               path removes thirty thousand of those. The polylines were sorted
               by v/c at build time, so a bucket is a contiguous range and its
               reveal order only increases: the sweep can stop at the first
               road that has not arrived yet rather than testing the rest. */
            ctx.lineCap = "butt"
            ctx.globalAlpha = 0.62
            for (const bucket of ground.buckets) {
                ctx.strokeStyle = bucket.color
                ctx.lineWidth = bucket.width
                ctx.beginPath()
                for (let i = bucket.from; i < bucket.to; i++) {
                    if (ground.order[i] > build) break
                    const from = ground.start[i]
                    const n = ground.count[i]
                    for (let k = 0; k < n; k++) {
                        const q = (from + k) * 2
                        at(ground.xy[q], ground.xy[q + 1], 0, scratch)
                        const sx = fit.cx + scratch[0] * fit.scale
                        const sy = fit.cy + scratch[1] * fit.scale
                        if (k === 0) ctx.moveTo(sx, sy)
                        else ctx.lineTo(sx, sy)
                    }
                }
                ctx.stroke()
            }

            // Painter's algorithm for the walls: furthest first, so nearer ones occlude.
            const drawn = bars
                .map((b) => {
                    const grown = Math.max(0, Math.min(1, (build - b.order * 0.85) / 0.35))
                    const h = b.height * easeOut(grown)
                    const mid = project((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, 0)
                    return { b, h, depth: mid[2], grown }
                })
                .filter((d) => d.grown > 0)
                .sort((a, b) => b.depth - a.depth)

            /* The face is deliberately faint and the top edge deliberately is
               not. A few hundred translucent quads at a quarter opacity add up
               to an even wash of colour with no edges in it, which is what the
               first version of this looked like; the lit top is the line the
               eye actually reads a height from, so that is where the contrast
               is spent. */
            const picked = focusRef.current
            /** Tallest wall per corridor, in screen space, for the labels. */
            const peaks = new Map<number, { x: number; y: number; vc: number }>()

            for (const { b, h, grown } of drawn) {
                const a0 = project(b.x1, b.y1, 0)
                const a1 = project(b.x2, b.y2, 0)
                const t0 = project(b.x1, b.y1, h)
                const t1 = project(b.x2, b.y2, h)

                /* A pick dims everything it did not select. Without it the
                   chosen corridor is a slightly brighter red among four hundred
                   reds, and zooming to it only tells you that something changed
                   size. */
                const on = picked == null || b.corridorId === picked
                const mute = on ? 1 : 0.16

                ctx.beginPath()
                ctx.moveTo(a0[0], a0[1])
                ctx.lineTo(a1[0], a1[1])
                ctx.lineTo(t1[0], t1[1])
                ctx.lineTo(t0[0], t0[1])
                ctx.closePath()
                ctx.fillStyle = b.color
                ctx.globalAlpha = (0.05 + grown * 0.07) * mute
                ctx.fill()

                ctx.beginPath()
                ctx.moveTo(t0[0], t0[1])
                ctx.lineTo(t1[0], t1[1])
                ctx.strokeStyle = b.color
                ctx.globalAlpha = (0.55 + grown * 0.45) * mute
                ctx.lineWidth = b.vc >= 1 ? 1.9 : 1.2
                ctx.lineCap = "round"
                ctx.stroke()

                const top = peaks.get(b.corridorId)
                if (grown > 0.9 && (!top || b.vc > top.vc)) {
                    peaks.set(b.corridorId, { x: (t0[0] + t1[0]) / 2, y: Math.min(t0[1], t1[1]), vc: b.vc })
                }
            }

            /* Names on the worst of them.
               
               Five, or just the one that was picked. A label per wall would be
               four hundred labels; the point of a label here is to answer "what
               road is that" for the handful a reader is actually looking at,
               and the rest are one click away. */
            const named = [...peaks.entries()]
                .filter(([id]) => corridorsRef.current.has(id) && (picked == null || id === picked))
                .sort((a, b) => b[1].vc - a[1].vc)
                .slice(0, picked == null ? 5 : 1)

            if (build > 0.85) {
                ctx.font = "500 11px ui-monospace, SFMono-Regular, Menlo, monospace"
                ctx.textAlign = "center"
                ctx.textBaseline = "bottom"
                /* Labels that collide are worse than no labels: two names drawn
                   over each other produced "ARR12;US 62551.64", which is not a
                   road and not a number. Taken worst first, each one is dropped
                   if it would land on top of a label already placed. */
                const placed: { x: number; y: number }[] = []
                for (const [id, pt] of named) {
                    const clash = placed.some(
                        (q) => Math.abs(q.x - pt.x) < 96 && Math.abs(q.y - pt.y) < 15,
                    )
                    if (clash) continue
                    placed.push(pt)

                    const meta = corridorsRef.current.get(id)!
                    const label = `${meta.label}  ${meta.scenarioVc.toFixed(2)}`
                    ctx.globalAlpha = 0.92
                    ctx.strokeStyle = "rgba(6,7,10,0.9)"
                    ctx.lineWidth = 3.5
                    ctx.lineJoin = "round"
                    ctx.strokeText(label, pt.x, pt.y - 7)
                    ctx.fillStyle = "#eef1f6"
                    ctx.fillText(label, pt.x, pt.y - 7)
                }
                ctx.textAlign = "start"
                ctx.textBaseline = "alphabetic"
            }

            ctx.globalAlpha = 1
            ctx.restore()

            const settled =
                framed &&
                build >= 1 &&
                Math.abs(cam.targetBearing - cam.bearing) < 0.0008 &&
                Math.abs(cam.targetPitch - cam.pitch) < 0.0008
            if (settled) {
                rafRef.current = 0
                return
            }
            rafRef.current = requestAnimationFrame(draw)
        }

        const start = () => {
            if (!rafRef.current) rafRef.current = requestAnimationFrame(draw)
        }
        start()

        // Restart the loop whenever the camera is nudged.
        const onMove = (e: PointerEvent) => {
            // Fractions of the box, so the CSS transform cancels out here.
            const rect = wrap.getBoundingClientRect()
            const px = (e.clientX - rect.left) / rect.width - 0.5
            const py = (e.clientY - rect.top) / rect.height - 0.5
            const cam = camRef.current
            cam.targetBearing = -0.42 + px * 1.1
            cam.targetPitch = Math.max(0.45, Math.min(1.35, 1.02 - py * 0.5))
            start()
        }
        const onLeave = () => {
            camRef.current.targetBearing = -0.42
            camRef.current.targetPitch = 1.02
            start()
        }
        /** Squared distance from a point to a segment, in screen pixels. */
        const distToSeg = (
            px: number, py: number,
            ax: number, ay: number,
            bx: number, by: number,
        ) => {
            const vx = bx - ax
            const vy = by - ay
            const len = vx * vx + vy * vy
            const t = len > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len)) : 0
            const dx = px - (ax + vx * t)
            const dy = py - (ay + vy * t)
            return dx * dx + dy * dy
        }

        /**
         * Which wall is under the pointer.
         *
         * Tested against the whole TOP EDGE of each wall, not its midpoint and
         * not its footprint. The top edge is the bright line a reader is
         * actually aiming at; measuring to a midpoint means the ends of a long
         * wall are unclickable, and measuring to the footprint means clicking a
         * tall bar selects whatever happens to lie on the ground under it.
         */
        const pick = (px: number, py: number): number | null => {
            const fit = fitRef.current
            if (!fit) return null
            const at = cameraTransform(camRef.current, fit.focal)
            const s2: [number, number, number] = [0, 0, 0]
            /* Forgiving on purpose. These are one-pixel lines in a field of
               other one-pixel lines, and roughly a third of the walls belong to
               corridors the run cannot name and are skipped here, so an exact
               hit test means most clicks land on nothing and the model reads as
               broken rather than as precise. Thirty-four pixels is about a
               fingertip. */
            let best: number | null = null
            let bestD = 34 * 34
            for (const b of barsRef.current) {
                /* Only walls the run can describe are pickable. Selecting one
                   whose corridor is not in the result would zoom the view to a
                   thing and then have nothing to say about it, which is worse
                   than not selecting at all: the reader learns that clicking
                   does something and that it does not work. */
                if (!corridorsRef.current.has(b.corridorId)) continue
                at(b.x1, b.y1, b.height, s2)
                const ax = fit.cx + s2[0] * fit.scale
                const ay = fit.cy + s2[1] * fit.scale
                at(b.x2, b.y2, b.height, s2)
                const bx = fit.cx + s2[0] * fit.scale
                const by = fit.cy + s2[1] * fit.scale
                const d = distToSeg(px, py, ax, ay, bx, by)
                if (d < bestD) {
                    bestD = d
                    best = b.corridorId
                }
            }
            return best
        }

        const onClick = (e: PointerEvent) => {
            /* Into the canvas's own coordinate space, which is not the one the
               pointer arrives in. The result page scales this card with a CSS
               transform as it opens, so getBoundingClientRect reports the
               SCALED box while the canvas still thinks in its layout pixels.
               Using the raw offset picked nothing at all once the card had
               grown, which reads as the model simply not being clickable. */
            const r = wrap.getBoundingClientRect()
            const kx = r.width > 0 ? wrap.clientWidth / r.width : 1
            const ky = r.height > 0 ? wrap.clientHeight / r.height : 1
            const hit = pick((e.clientX - r.left) * kx, (e.clientY - r.top) * ky)
            // Clicking the same corridor again, or clicking past everything,
            // returns to the whole network. There is always a way back out.
            const next = hit == null || hit === focusRef.current ? null : hit
            focusRef.current = next
            setFocus(next)
            fitTargetRef.current = next == null ? fitFullRef.current : frameCorridor(next)
            start()
        }

        clearFocusRef.current = () => {
            focusRef.current = null
            setFocus(null)
            fitTargetRef.current = fitFullRef.current
            start()
        }

        wrap.addEventListener("pointermove", onMove)
        wrap.addEventListener("pointerleave", onLeave)
        wrap.addEventListener("click", onClick as EventListener)

        const kick = setInterval(start, 250)

        return () => {
            refitRef.current = null
            window.removeEventListener("resize", resize)
            wrap.removeEventListener("pointermove", onMove)
            wrap.removeEventListener("pointerleave", onLeave)
            wrap.removeEventListener("click", onClick as EventListener)
            clearInterval(kick)
            cancelAnimationFrame(rafRef.current)
            rafRef.current = 0
        }
    }, [fill])

    const chosen = focus == null ? null : (corridors ?? []).find((c) => c.corridorId === focus)

    if (fill) {
        /* Bare canvas, plus the two things that turn it from a picture into
           something a reader can use: a key saying what a line and a height
           mean, and the corridor's own numbers once one is picked.
           
           The canvas is aria-hidden and always was, so before this the model
           was literally nothing to a screen reader. Both overlays are real DOM
           with real text, which is also the version a sighted reader needs:
           the strongest visualisation in the world does not say what its own
           axes are. */
        return (
            <div ref={wrapRef} className={`relative ${className ?? ""}`}>
                <canvas ref={canvasRef} aria-hidden />
                <ModelKey focus={chosen} onClear={() => clearFocus()} />
            </div>
        )
    }

    return (
        <div className={className}>
            <div className="flex items-baseline justify-between">
                <h3 className="font-pixel text-[11px] tracking-[0.2em] text-paper-300">
                    CONGESTION, EXTRUDED
                </h3>
                {model && (
                    <span className="tabular font-mono text-[10px] text-paper-400">
                        {/* Both counts, because they are two different budgets
                            and quoting only one of them was quietly wrong the
                            moment the ground plan stopped sharing the cap. */}
                        {model.stats.walls.toLocaleString()} standing ·{" "}
                        {model.stats.flat.toLocaleString()} flat · peak v/c{" "}
                        {model.stats.tallest.toFixed(2)}
                    </span>
                )}
            </div>
            <div
                ref={wrapRef}
                className="relative mt-2 h-64 w-full cursor-grab overflow-hidden rounded-lg border border-ink-800 bg-ink-900"
            >
                <canvas ref={canvasRef} aria-hidden />
                <ModelKey focus={chosen} onClear={() => clearFocus()} compact />
                {!vc && (
                    <div className="absolute inset-0 grid place-content-center">
                        <span className="font-mono text-[10px] text-paper-400">
                            run a simulation to build the model
                        </span>
                    </div>
                )}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-paper-400">
                Roads at or over v/c {EXTRUDE_FROM} stand up, extruded by the same modelled
                volume-to-capacity the chain quotes. Everything below lies flat, for context.
                Move the pointer to orbit.
            </p>
        </div>
    )
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
