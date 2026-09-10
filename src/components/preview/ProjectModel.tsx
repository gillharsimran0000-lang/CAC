"use client"

/**
 * WHAT YOU ARE ABOUT TO BUILD.
 *
 * The lab used to show one animation for every change: the extruded congestion
 * field, which is a picture of a RESULT and therefore cannot exist before a run.
 * Whatever you were adding -- a fire station, a treatment plant, nine thousand
 * residents -- the screen said the same thing back to you.
 *
 * This panel says the specific thing instead. It draws the object itself, built
 * from the primitives in src/render/solids.ts, and it builds it in front of you
 * piece by piece: ground, then structure, then the lines that make it legible.
 * A clarifier fills, a bridge deck runs out from the abutment, a stack
 * interchange stacks. Twenty projects, twenty different animations, because
 * they are twenty different objects rather than one object with a label.
 *
 * The camera orbits under the pointer, which is not decoration: these are
 * three-dimensional claims -- a ramp at level four, a tank on legs -- and a
 * fixed view flattens exactly the thing being claimed. It also sweeps a little
 * during the build itself, so the depth is legible to someone who never touches
 * the pointer.
 *
 * Then it stops. An idle drift would be the obvious way to keep the object
 * feeling alive, and it would hold a requestAnimationFrame open for as long as
 * the lab is on screen, redrawing a few hundred polygons sixty times a second
 * to move a camera nobody asked to move. The loop ends when the build finishes
 * and the camera settles, and a pointer moving over the panel starts it again.
 *
 * Under prefers-reduced-motion there is no build and no sweep: the finished
 * object is drawn once, and the loop stops on the first frame.
 */

import { useEffect, useRef, useState } from "react"
import type { Fit, Scene } from "@/render/solids"
import { drawScene, fitScene } from "@/render/solids"
import { prefersReducedMotion } from "@/lib/motion"

const BUILD_MS = 2200
/** Where the camera comes to rest, and where the build sweep ends. */
const REST_BEARING = -0.5
const REST_PITCH = 0.95

export function ProjectModel({
    scene,
    /** Changing this restarts the build. Pass the project id. */
    sceneKey,
    className,
    /** Omit to let the parent decide, e.g. a flex child that fills its row. */
    height,
}: {
    scene: Scene
    sceneKey: string
    className?: string
    height?: number
}) {
    const wrapRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const sceneRef = useRef(scene)
    const rafRef = useRef(0)
    const startRef = useRef(0)
    const camRef = useRef({
        bearing: REST_BEARING,
        pitch: REST_PITCH,
        targetBearing: REST_BEARING,
        targetPitch: REST_PITCH,
    })
    const pointerRef = useRef(false)
    /** Restarts the stopped render loop. Set by the effect that owns it. */
    const wakeRef = useRef<(() => void) | null>(null)
    /** How this scene is framed in this canvas. Recomputed only when either
        changes, never per frame: a fit that tracked the camera would make the
        model swell and shrink as it orbits. */
    const fitRef = useRef<Fit | null>(null)
    /** Remeasures the fit. Set by the effect that owns the canvas size. */
    const refitRef = useRef<(() => void) | null>(null)
    const [replayNonce, setReplayNonce] = useState(0)

    /* The draw loop reads the scene through a ref so a new scene does not tear
       down and rebuild the animation frame. Assigning during render would be a
       ref written where React is free to render twice, so it happens here. */
    useEffect(() => {
        sceneRef.current = scene
    }, [scene])

    /* A new project is a new build, from the ground up, and a new object to
       frame: a runway and a fire station are not the same shape and must not
       share a scale. */
    useEffect(() => {
        startRef.current = performance.now()
        camRef.current.bearing = REST_BEARING - 0.34
        refitRef.current?.()
        wakeRef.current?.()
    }, [sceneKey, replayNonce])

    useEffect(() => {
        const canvas = canvasRef.current
        const wrap = wrapRef.current
        if (!canvas || !wrap) return
        const ctx = canvas.getContext("2d")
        if (!ctx) return

        let dpr = 1
        let w = 0
        let h = 0

        const resize = () => {
            dpr = Math.min(window.devicePixelRatio || 1, 2)
            w = wrap.clientWidth
            h = wrap.clientHeight
            canvas.width = Math.round(w * dpr)
            canvas.height = Math.round(h * dpr)
            canvas.style.width = `${w}px`
            canvas.style.height = `${h}px`
            /* Measured at rest and at the start of the build sweep, so the
               camera movement during the build cannot push the object out of
               frame. */
            fitRef.current = fitScene(sceneRef.current, w, h, [
                { bearing: REST_BEARING, pitch: REST_PITCH },
                { bearing: REST_BEARING - 0.34, pitch: REST_PITCH },
            ])
        }
        resize()
        const ro = new ResizeObserver(() => {
            resize()
            // A resize clears the backing store, so the stopped loop has to
            // redraw or the panel goes blank on a window drag.
            wakeRef.current?.()
        })
        ro.observe(wrap)

        const still = prefersReducedMotion()

        const draw = () => {
            const cam = camRef.current
            const build = still ? 1 : Math.min(1, (performance.now() - startRef.current) / BUILD_MS)

            /* The build sweep. Only while the object is still assembling, and
               only while the pointer is away: adding a rotation on top of a
               pointer-driven bearing makes the model creep out from under the
               cursor, which reads as the control being ignored. */
            if (!still && build < 1 && !pointerRef.current) {
                cam.targetBearing = REST_BEARING - 0.34 * (1 - build)
            }
            cam.bearing += (cam.targetBearing - cam.bearing) * 0.07
            cam.pitch += (cam.targetPitch - cam.pitch) * 0.07

            ctx.save()
            ctx.scale(dpr, dpr)
            ctx.clearRect(0, 0, w, h)
            if (fitRef.current) {
                drawScene(ctx, sceneRef.current, w, h, cam, build, fitRef.current)
            }
            ctx.restore()

            // Finished and settled: stop, and leave the last frame up.
            const settled =
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

        /* A replay, a new project, or a resize all happen while the loop is
           stopped. Each has to wake it, or the panel keeps showing the frame it
           stopped on, and a new project has to be remeasured before it does. */
        wakeRef.current = start
        refitRef.current = resize

        const onMove = (e: PointerEvent) => {
            const r = wrap.getBoundingClientRect()
            const px = (e.clientX - r.left) / r.width - 0.5
            const py = (e.clientY - r.top) / r.height - 0.5
            pointerRef.current = true
            const cam = camRef.current
            cam.targetBearing = REST_BEARING + px * 1.5
            cam.targetPitch = Math.max(0.35, Math.min(1.35, REST_PITCH - py * 0.6))
            start()
        }
        const onLeave = () => {
            pointerRef.current = false
            const cam = camRef.current
            cam.targetBearing = REST_BEARING
            cam.targetPitch = REST_PITCH
            start()
        }
        wrap.addEventListener("pointermove", onMove)
        wrap.addEventListener("pointerleave", onLeave)

        return () => {
            wakeRef.current = null
            refitRef.current = null
            ro.disconnect()
            wrap.removeEventListener("pointermove", onMove)
            wrap.removeEventListener("pointerleave", onLeave)
            cancelAnimationFrame(rafRef.current)
            rafRef.current = 0
        }
    }, [sceneKey])

    return (
        <div
            ref={wrapRef}
            className={`relative cursor-grab overflow-hidden rounded-lg border border-ink-800 bg-ink-900 ${className ?? ""}`}
            style={height ? { height } : undefined}
        >
            <canvas ref={canvasRef} data-preview-model aria-hidden />
            <button
                onClick={() => setReplayNonce((n) => n + 1)}
                className="absolute bottom-2 right-2 rounded border border-ink-700 bg-ink-950/80 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-paper-400 transition-colors hover:text-paper-100"
            >
                replay
            </button>
        </div>
    )
}
