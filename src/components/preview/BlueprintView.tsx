"use client"

/**
 * THE BLUEPRINT.
 *
 * The preview used to answer one question: which object is this. That was worth
 * having and it stopped short of the question people actually ask, which is not
 * "what is it" but "what happens if I put that there".
 *
 * So this is the same object in four acts, and the acts are the argument:
 *
 *   SITE       what is on the ground before you touch it
 *   BLUEPRINT  the proposal drawn over it, in lines, like a drawing
 *   BUILT      the drawing resolving into a thing that is there
 *   MECHANISM  what it then does: trips leaving, flow running, a response band
 *              reaching, basins filling
 *
 * It plays through once and can be scrubbed or replayed, because the sequence
 * IS the content: seeing a station appear and then watching four minutes of
 * road reach out from it says something that no still frame of either does.
 *
 * The last act is the one to be careful about. It animates the MECHANISM, never
 * the result. A response band is geometry and a standard: the station is at
 * that point, NFPA 1710 is 240 seconds, so that is how far a first engine gets.
 * How many residents end up inside it is a simulation output and is not here,
 * is not implied here, and the label says so. Nothing in this panel is a
 * prediction, because the run has not happened yet.
 *
 * three.js rather than the hand-rolled painter this app uses elsewhere, and the
 * reason is depth. A painter's algorithm sorts whole objects by a single
 * number, which is why a bridge deck kept slicing through its own piers; a
 * depth buffer sorts fragments and the problem stops existing. anime.js drives
 * the act timeline, because a timeline with labelled positions that can be
 * seeked and reversed is exactly what four acts want and exactly what a pile of
 * hand-rolled easing functions is worst at.
 */

import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { createTimeline, type Timeline } from "animejs"
import type { Scene } from "@/render/solids"
import { buildScene, type BuiltScene } from "@/render/three/blueprint"
import { ProjectModel } from "./ProjectModel"
import { prefersReducedMotion } from "@/lib/motion"

/** The four acts, and where each one starts on the 0..1 phase. */
const ACTS = [
    { at: 0.0, name: "Site", hint: "what is there now" },
    { at: 0.24, name: "Blueprint", hint: "what you are proposing" },
    { at: 0.54, name: "Built", hint: "the thing in place" },
    { at: 0.78, name: "Mechanism", hint: "how it reaches the model" },
] as const

const PLAY_MS = 7200

/** Where the camera rests, and the orientation the framing is measured at. */
const REST_BEARING = -0.62
const REST_PITCH = 0.92

export function BlueprintView({
    scene,
    /** Changing this restarts the sequence. Pass the project or lever key. */
    sceneKey,
    className,
}: {
    scene: Scene
    sceneKey: string
    className?: string
}) {
    const wrapRef = useRef<HTMLDivElement>(null)
    /** The three.js world. Owned by the renderer effect, filled by the scene one. */
    const worldRef = useRef<THREE.Scene | null>(null)
    const sceneRef = useRef(scene)
    const builtRef = useRef<BuiltScene | null>(null)
    const timelineRef = useRef<Timeline | null>(null)
    /** Driven by the timeline; read by the render loop. */
    const phaseRef = useRef({ value: 0 })
    /** Camera distance that makes the scene fill the panel. See refit. */
    const distRef = useRef(1000)
    /** Remeasures that distance. Owned by the renderer effect. */
    const refitRef = useRef<(() => void) | null>(null)
    const [act, setAct] = useState(0)
    const [scrub, setScrub] = useState(0)
    const [replayNonce, setReplayNonce] = useState(0)
    /* The preview strip gives this about 130 pixels of height, which is enough
       to tell one project from another and nowhere near enough to look at one.
       Expanding is not a flourish here, it is the difference between a
       thumbnail and a drawing. */
    const [expanded, setExpanded] = useState(false)
    /* WebGL is not a given: an old machine, a blocklisted driver, a browser
       with it switched off. The painted renderer this replaced still exists and
       still draws every one of these scenes, so a machine that cannot do the
       blueprint gets the model rather than an empty rectangle. */
    const [noWebgl, setNoWebgl] = useState(false)

    useEffect(() => {
        sceneRef.current = scene
    }, [scene])

    /* Whether this machine can do WebGL at all.
    
       A browser capability, so it cannot be known while rendering on the
       server, which is why it arrives through state rather than being computed
       inline: assuming one answer during SSR and finding the other on the
       client is a hydration mismatch. Same shape as the reduced-motion probe on
       the home page, for the same reason. */
    useEffect(() => {
        const probe = () => {
            try {
                const c = document.createElement("canvas")
                if (!(c.getContext("webgl2") || c.getContext("webgl"))) setNoWebgl(true)
            } catch {
                setNoWebgl(true)
            }
        }
        probe()
    }, [])

    useEffect(() => {
        if (!expanded) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setExpanded(false)
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [expanded])

    /* --- renderer, camera, lights: made once and kept --- */
    useEffect(() => {
        const wrap = wrapRef.current
        if (!wrap) return

        let renderer: THREE.WebGLRenderer
        try {
            /* preserveDrawingBuffer, so the frame survives being presented.
               Without it the buffer is cleared the moment the browser shows
               it, and anything reading the canvas afterwards -- "save image",
               a screenshot, the smoke test -- gets a blank rectangle. The cost
               is one retained buffer at the size of a small panel. */
            renderer = new THREE.WebGLRenderer({
                antialias: true,
                alpha: true,
                preserveDrawingBuffer: true,
            })
        } catch {
            // The probe above has already switched to the painted renderer;
            // this is the belt to its braces and simply declines to run.
            return
        }
        renderer.setClearColor(0x000000, 0)
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        wrap.appendChild(renderer.domElement)
        renderer.domElement.style.display = "block"
        renderer.domElement.style.width = "100%"
        renderer.domElement.style.height = "100%"

        const world = new THREE.Scene()
        /* Fog, so the far edge of a statewide alignment falls away instead of
           ending on a hard line. Matched to the panel ground, not to black. */
        world.fog = new THREE.Fog(0x0a0c11, 1, 10)

        const camera = new THREE.PerspectiveCamera(38, 1, 1, 100000)

        world.add(new THREE.HemisphereLight(0xbcd3ef, 0x0a0c11, 1.5))
        const key = new THREE.DirectionalLight(0xffffff, 1.5)
        key.position.set(-0.7, 1.3, 0.9)
        world.add(key)
        const rim = new THREE.DirectionalLight(0x7aa5e6, 0.7)
        rim.position.set(1, 0.4, -1)
        world.add(rim)

        /* Orbit, hand-rolled rather than OrbitControls.

           Not purity: OrbitControls lives in three/examples and drags in its
           own event handling and inertia, and all this needs is a bearing, a
           pitch and a drag. The camera also has to stay on rails vertically so
           a reader cannot end up underneath the site looking up through it,
           which is exactly the constraint OrbitControls makes you fight. */
        const cam = {
            bearing: REST_BEARING,
            pitch: REST_PITCH,
            targetBearing: REST_BEARING,
            targetPitch: REST_PITCH,
        }
        let dragging = false
        let lastX = 0
        let lastY = 0

        const onDown = (e: PointerEvent) => {
            dragging = true
            lastX = e.clientX
            lastY = e.clientY
            renderer.domElement.setPointerCapture(e.pointerId)
        }
        const onMove = (e: PointerEvent) => {
            if (!dragging) return
            cam.targetBearing -= (e.clientX - lastX) * 0.006
            cam.targetPitch = Math.max(
                0.18,
                Math.min(1.45, cam.targetPitch + (e.clientY - lastY) * 0.005),
            )
            lastX = e.clientX
            lastY = e.clientY
        }
        const onUp = (e: PointerEvent) => {
            dragging = false
            if (renderer.domElement.hasPointerCapture(e.pointerId)) {
                renderer.domElement.releasePointerCapture(e.pointerId)
            }
        }
        renderer.domElement.addEventListener("pointerdown", onDown)
        renderer.domElement.addEventListener("pointermove", onMove)
        renderer.domElement.addEventListener("pointerup", onUp)
        renderer.domElement.addEventListener("pointercancel", onUp)

        let frame = 0
        let width = 0
        let height = 0

        /**
         * How far back the camera has to sit for the scene to FILL the panel.
         *
         * Derived by measuring, not by assuming, for the same reason the 2D
         * renderer had to be: a radius over a tangent is right for a square
         * viewport and wrong for the one this renders into, which is roughly
         * three times as wide as it is tall. Worse, these scenes are almost
         * flat and seen at a tilt, so their projected height is a fraction of
         * their footprint and a bounding-sphere fit leaves the subject sitting
         * in the middle of a large empty box.
         *
         * So the eight corners of the scene's bounding box are projected and
         * the distance is scaled until they just fit. Two iterations converge
         * because the projected size is very nearly inverse in the distance.
         *
         * Measured at the RESTING orientation and cached, so orbiting does not
         * make the model breathe in and out. Dragging far enough can crop a
         * corner, which is the right trade: a drag is a deliberate act.
         */
        const refit = () => {
            const built = builtRef.current
            if (!built || width === 0 || height === 0) return
            // The proposal's own points: see BuiltScene.changePoints.
            const corners = built.changePoints
            if (!corners.length) return
            const target = new THREE.Vector3(0, built.top * 0.22, 0)
            const probe = camera.clone()
            // A starting guess; the passes below correct it whatever it was.
            let dist = Math.max(...corners.map((c) => c.length()), 1) * 2.6
            for (let pass = 0; pass < 5; pass++) {
                probe.position.set(
                    Math.sin(REST_BEARING) * Math.cos(REST_PITCH) * dist,
                    Math.sin(REST_PITCH) * dist,
                    Math.cos(REST_BEARING) * Math.cos(REST_PITCH) * dist,
                )
                probe.lookAt(target)
                probe.updateMatrixWorld()
                probe.updateProjectionMatrix()
                let mx = 0
                let my = 0
                for (const c of corners) {
                    const ndc = c.clone().project(probe)
                    mx = Math.max(mx, Math.abs(ndc.x))
                    my = Math.max(my, Math.abs(ndc.y))
                }
                const over = Math.max(mx, my) / 0.9
                if (!Number.isFinite(over) || over <= 0) break
                dist *= over
            }
            distRef.current = dist
        }

        const resize = () => {
            width = wrap.clientWidth
            height = wrap.clientHeight
            if (width === 0 || height === 0) return
            renderer.setSize(width, height, false)
            camera.aspect = width / height
            camera.updateProjectionMatrix()
            refit()
        }
        refitRef.current = resize
        resize()
        const ro = new ResizeObserver(resize)
        ro.observe(wrap)

        const start = performance.now()
        const loop = () => {
            frame = requestAnimationFrame(loop)
            const built = builtRef.current
            if (!built || width === 0) return

            cam.bearing += (cam.targetBearing - cam.bearing) * 0.1
            cam.pitch += (cam.targetPitch - cam.pitch) * 0.1

            const dist = distRef.current
            camera.position.set(
                Math.sin(cam.bearing) * Math.cos(cam.pitch) * dist,
                Math.sin(cam.pitch) * dist,
                Math.cos(cam.bearing) * Math.cos(cam.pitch) * dist,
            )
            camera.lookAt(0, built.top * 0.22, 0)
            ;(world.fog as THREE.Fog).near = dist * 0.55
            ;(world.fog as THREE.Fog).far = dist * 2.5

            built.update(phaseRef.current.value, performance.now() - start)
            renderer.render(world, camera)
        }
        frame = requestAnimationFrame(loop)

        // Handed to the scene effect below, which owns what is IN the world.
        worldRef.current = world

        return () => {
            cancelAnimationFrame(frame)
            refitRef.current = null
            ro.disconnect()
            renderer.domElement.removeEventListener("pointerdown", onDown)
            renderer.domElement.removeEventListener("pointermove", onMove)
            renderer.domElement.removeEventListener("pointerup", onUp)
            renderer.domElement.removeEventListener("pointercancel", onUp)
            renderer.dispose()
            renderer.domElement.remove()
            worldRef.current = null
        }
    }, [])

    /* --- the scene itself, rebuilt whenever the subject changes --- */
    useEffect(() => {
        const world = worldRef.current
        if (!world) return

        const built = buildScene(sceneRef.current)
        world.add(built.root)
        builtRef.current = built
        refitRef.current?.()

        const still = prefersReducedMotion()
        phaseRef.current.value = still ? 1 : 0
        setScrub(still ? 1 : 0)
        setAct(still ? ACTS.length - 1 : 0)

        /* anime.js drives the acts.

           A timeline rather than four eased tweens because the acts have to be
           seekable: the scrubber under the panel writes a position straight
           into it, and a reader who drags back to the blueprint has to see the
           surfaces come apart again rather than watch a separate reverse
           animation that has to be kept in step with the forward one. */
        let timeline: Timeline | null = null
        if (!still) {
            timeline = createTimeline({ defaults: { ease: "linear" }, autoplay: true })
            timeline.add(phaseRef.current, {
                value: 1,
                duration: PLAY_MS,
                onUpdate: () => {
                    const p = phaseRef.current.value
                    setScrub(p)
                    let i = 0
                    for (let k = 0; k < ACTS.length; k++) if (p >= ACTS[k].at) i = k
                    setAct(i)
                },
            })
            timelineRef.current = timeline
        }

        return () => {
            timeline?.revert()
            timelineRef.current = null
            world.remove(built.root)
            built.dispose()
            builtRef.current = null
        }
    }, [sceneKey, replayNonce])

    /**
     * The phase at which an act is fully expressed.
     *
     * The END of the act, not its start. Each act is a transition, so its
     * opening instant is the previous act with nothing happening yet: pressing
     * BLUEPRINT used to seek to 0.25, where the drafting lines are three per
     * cent drawn, and the panel appeared not to respond. What a reader means by
     * "show me the blueprint" is the finished drawing.
     */
    const actEnd = (i: number) => (i + 1 < ACTS.length ? ACTS[i + 1].at - 0.005 : 1)

    const goto = (p: number, i: number) => {
        phaseRef.current.value = p
        setScrub(p)
        setAct(i)
        timelineRef.current?.pause()
        timelineRef.current?.seek(p * PLAY_MS)
    }

    const actAt = (p: number) => {
        let i = 0
        for (let k = 0; k < ACTS.length; k++) if (p >= ACTS[k].at) i = k
        return i
    }

    if (noWebgl) {
        return <ProjectModel scene={scene} sceneKey={sceneKey} className={className} />
    }

    return (
        <div
            className={
                expanded
                    ? "fixed inset-0 z-50 flex flex-col bg-ink-950/97 p-4 backdrop-blur sm:p-8"
                    : `flex min-h-0 flex-col ${className ?? ""}`
            }
        >
            {/* Always rendered, hidden when small.
                
                Mounting it conditionally shifted the canvas container one place
                down the child list, so React replaced that node on every
                expand -- and the WebGL canvas is appended to it imperatively,
                so it went with it and the panel came back blank. */}
            <div
                hidden={!expanded}
                className="mb-3 flex items-baseline justify-between"
            >
                <h2 className="font-pixel text-[12px] tracking-[0.2em] text-paper-200">
                    THE BLUEPRINT
                </h2>
                <button
                    onClick={() => setExpanded(false)}
                    className="font-mono text-[10px] uppercase tracking-wider text-paper-400 transition-colors hover:text-paper-100"
                >
                    close
                </button>
            </div>

            <div
                ref={wrapRef}
                className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden rounded-lg border border-ink-800 bg-ink-900 active:cursor-grabbing"
            >
                <button
                    hidden={expanded}
                    onClick={() => setExpanded(true)}
                    className="absolute right-2 top-2 z-10 rounded border border-ink-700 bg-ink-950/80 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-paper-400 transition-colors hover:text-paper-100"
                >
                    expand
                </button>
            </div>

            {/* The acts, as buttons: the sequence is the content, so it has to
                be navigable rather than only watchable. */}
            <div className={`${expanded ? "mt-2" : "mt-1.5"} flex items-center gap-1`}>
                {ACTS.map((a, i) => (
                    <button
                        key={a.name}
                        onClick={() => goto(actEnd(i), i)}
                        aria-current={act === i}
                        className={`flex-1 rounded border px-1.5 py-1 text-left transition-colors ${
                            act === i
                                ? "border-accent/50 bg-accent/10"
                                : "border-ink-800 bg-ink-900 hover:border-ink-600"
                        }`}
                    >
                        <span
                            className={`block font-mono text-[9px] uppercase tracking-wider ${
                                act === i ? "text-accent" : "text-paper-400"
                            }`}
                        >
                            {a.name}
                        </span>
                    </button>
                ))}
                <button
                    onClick={() => setReplayNonce((n) => n + 1)}
                    className="shrink-0 rounded border border-ink-800 bg-ink-900 px-1.5 py-1 font-mono text-[9px] uppercase tracking-wider text-paper-400 transition-colors hover:text-paper-100"
                >
                    replay
                </button>
            </div>

            <label className={`${expanded ? "mt-1.5" : "mt-1"} block`}>
                <span className="sr-only">Scrub the sequence</span>
                <input
                    type="range"
                    min={0}
                    max={1000}
                    value={Math.round(scrub * 1000)}
                    onChange={(e) => {
                        const p = Number(e.target.value) / 1000
                        goto(p, actAt(p))
                    }}
                    className="w-full"
                    style={{ accentColor: "#7aa5e6" }}
                />
            </label>

            {/* One line when collapsed. Wrapped to three lines it was most
                of the height the 3D view was losing; the full sentence is
                still in the DOM, and shown whole once the panel is expanded. */}
            <p
                className={`mt-0.5 text-[10px] leading-relaxed text-paper-400 ${
                    expanded ? "" : "truncate"
                }`}
            >
                <span className="text-paper-200">{ACTS[act].name}:</span> {ACTS[act].hint}.
                {act === 3 && " Mechanism only: how far it moves an axis is what the run is for."}
                {act < 3 && " Drag to look around."}
            </p>
        </div>
    )
}
