"use client"

import { useEffect, useRef, useState } from "react"

/* -------------------------------------------------------------------------- */
/*  CIVIC HERO: a scroll-locked, scrub-driven opening built from the data      */
/*                                                                            */
/*  The scroll mechanics are the airlock pattern: while the hero owns the      */
/*  screen the page cannot move, because the body is pinned with              */
/*  position:fixed, the technique modal libraries use, since overflow:hidden   */
/*  alone is not reliable across browsers. Wheel, touch and key input is       */
/*  captured and spent on progress instead, forward and backward. At the end   */
/*  the page is handed back; scrolling to the top takes the lock again.        */
/*                                                                            */
/*  What is scrubbed is not a video. It is Arkansas. The same renderer the     */
/*  map uses draws the real road network assembling itself, the real 2020      */
/*  Census population blooming across 75 counties, and the real baseline       */
/*  volume-to-capacity flooding the corridors: the identical numbers the       */
/*  tool reports on the next screen. A stock aerial would have been easier and */
/*  would have shown nothing. Here the opening IS the evidence.                */
/*                                                                            */
/*  Reduced-motion readers are never locked; they get the finished frame.      */
/* -------------------------------------------------------------------------- */

import {
    DrawGeometry,
    Viewport,
    fitBbox,
    renderNetwork,
    vcColor,
} from "@/render/network"

interface HeroData {
    bbox: [number, number, number, number]
    counts: { edges: number; stressedEdges: number }
    edges: { lon: number[]; lat: number[]; offset: number[]; count: number[]; cls: string[]; vc: number[] }
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

/** Phase boundaries along the scrub, 0-1. They overlap so nothing snaps. */
const PHASES = {
    network: [0.0, 0.42],
    bloom: [0.3, 0.64],
    stress: [0.58, 0.9],
    settle: [0.86, 1.0],
} as const

/**
 * How much of the network is drawn before any input.
 *
 * At 0.16 the opening frame held a handful of disconnected fragments that read
 * as a rendering fault rather than as a state. This shows the interstate and
 * trunk skeleton -- enough that Arkansas is recognisable standing still -- and
 * leaves the arterial detail to arrive under the scrub.
 */
const REST_REVEAL = 0.36

const ramp = (p: number, [a, b]: readonly [number, number]) =>
    Math.max(0, Math.min(1, (p - a) / (b - a)))

const KEY_STEPS: Record<string, number> = {
    ArrowDown: 140,
    ArrowUp: -140,
    PageDown: 700,
    PageUp: -700,
    " ": 700,
    End: Number.MAX_SAFE_INTEGER,
    Home: Number.MIN_SAFE_INTEGER,
}

export interface CivicHeroProps {
    scrubDistance?: number
    holdDistance?: number
    skipLabel?: string
}

export default function CivicHero({
    scrubDistance = 3000,
    holdDistance = 900,
    skipLabel = "Skip intro",
}: CivicHeroProps) {
    const sectionRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const titleRef = useRef<HTMLDivElement>(null)
    const hintRef = useRef<HTMLDivElement>(null)
    const captionRef = useRef<HTMLDivElement>(null)
    const barRef = useRef<HTMLDivElement>(null)
    const releaseRef = useRef<() => void>(() => {})

    const [data, setData] = useState<HeroData | null>(null)
    const [ready, setReady] = useState(false)

    useEffect(() => {
        let cancelled = false
        fetch("/data/hero.json")
            .then((r) => r.json())
            .then((d: HeroData) => {
                if (!cancelled) setData(d)
            })
            .catch(() => {
                /* The page below still works; the hero simply stays dark. */
            })
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        const canvas = canvasRef.current
        const section = sectionRef.current
        if (!canvas || !section || !data) return

        const ctx = canvas.getContext("2d", { alpha: false })
        if (!ctx) return

        const reduceMotion =
            typeof window !== "undefined" &&
            (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)

        /* The hero payload is already flat and decimated, so it slots straight
           into the shared renderer's geometry shape without another pass. */
        const geo: DrawGeometry = {
            lon: Float32Array.from(data.edges.lon),
            lat: Float32Array.from(data.edges.lat),
            offset: Int32Array.from(data.edges.offset),
            count: Int32Array.from(data.edges.count),
            width: Float32Array.from(data.edges.cls, (c) =>
                c.startsWith("motorway") ? 1.7 : c.startsWith("trunk") ? 1.4 : 1.0,
            ),
            revealAt: Float32Array.from(data.edges.cls, (c, i) => {
                const rank = c.startsWith("motorway") ? 0 : c.startsWith("trunk") ? 1 : 2
                const jitter = ((i * 2654435761) % 1000) / 1000
                return Math.min(0.98, rank * 0.26 + jitter * 0.3)
            }),
            order: Int32Array.from({ length: data.edges.count.length }, (_, i) => i),
            edgeCount: data.edges.count.length,
        }
        const vc = Float32Array.from(data.edges.vc)
        const facilities = data.facilities.map((lonLat) => ({ lonLat, kind: "fire" }))

        let view: Viewport = fitBbox(data.bbox, 1, 1)
        let dpr = 1

        const resize = () => {
            dpr = Math.min(window.devicePixelRatio || 1, 2)
            const w = section.clientWidth
            const h = section.clientHeight
            canvas.width = Math.round(w * dpr)
            canvas.height = Math.round(h * dpr)
            canvas.style.width = `${w}px`
            canvas.style.height = `${h}px`
            view = fitBbox(data.bbox, w, h, 0.88)
            paint(shown)
        }

        let target = 0
        let shown = 0
        let moved = false
        let locked = false
        let lockedY = 0
        let touchY = 0
        let released = false
        let lastY = 0
        let rafId = 0

        const totalDistance = scrubDistance + holdDistance
        const scrubShare = scrubDistance / totalDistance

        /* --- painting --------------------------------------------------- */

        function paint(p: number) {
            const q = Math.max(0, Math.min(1, p / scrubShare))

            /* The interstate skeleton is present before the reader touches
               anything. A canvas that starts genuinely empty makes the opening
               frame look broken rather than poised, and there is nothing to
               recognise as Arkansas until the scrub is well underway. */
            const reveal = REST_REVEAL + ramp(q, PHASES.network) * (1 - REST_REVEAL)
            const bloom = ramp(q, PHASES.bloom)
            const stress = ramp(q, PHASES.stress)

            // The ground is painted rather than cleared to transparent, so the
            // additive population bloom has something to sit on.
            ctx!.save()
            ctx!.scale(dpr, dpr)
            ctx!.fillStyle = "#06070a"
            ctx!.fillRect(0, 0, view.width, view.height)
            ctx!.restore()

            renderNetwork(ctx!, geo, view, {
                reveal,
                stress,
                vc,
                bloom,
                zones: data!.counties,
                facilities,
                // Stations fade in with the emergency beat, after congestion.
                facilityOpacity: ramp(q, PHASES.settle) * 0.85,
                dpr,
            })

            if (titleRef.current) {
                const t = 1 - ramp(q, [0.0, 0.3])
                titleRef.current.style.opacity = String(t)
                titleRef.current.style.transform = `translateY(${(1 - t) * -20}px)`
                titleRef.current.style.filter = `blur(${(1 - t) * 8}px)`
            }
            if (hintRef.current) hintRef.current.style.opacity = moved ? "0" : "1"
            if (barRef.current) barRef.current.style.transform = `scaleX(${p})`

            if (captionRef.current) {
                // One caption per beat, so the reader is told what they are
                // watching at the moment it happens.
                const beat =
                    q < 0.3 ? 0 : q < 0.58 ? 1 : q < 0.86 ? 2 : 3
                captionRef.current.dataset.beat = String(beat)
            }
        }

        /* --- the lock ---------------------------------------------------- */

        function engageLock() {
            if (locked) return
            locked = true
            released = false
            lockedY = window.scrollY
            const b = document.body.style
            b.position = "fixed"
            b.top = `-${lockedY}px`
            b.left = "0"
            b.right = "0"
            b.width = "100%"
        }

        function releaseLock() {
            if (!locked) return
            locked = false
            const y = lockedY
            const b = document.body.style
            b.position = ""
            b.top = ""
            b.left = ""
            b.right = ""
            b.width = ""
            window.scrollTo(0, y)
            released = true
            lastY = y
        }

        releaseRef.current = () => {
            target = shown = 1
            moved = true
            paint(1)
            releaseLock()
        }

        function consume(deltaY: number) {
            if (!locked) return false
            // Let the picture catch up before handing the page back, so a hard
            // flick does not throw the reader out mid-sequence.
            if (target >= 1 && shown > 0.98 && deltaY > 0) {
                releaseLock()
                return false
            }
            target = Math.max(0, Math.min(1, target + deltaY / totalDistance))
            if (target > 0.001) moved = true
            startLoop()
            return true
        }

        const onWheel = (e: WheelEvent) => {
            if (consume(e.deltaY)) e.preventDefault()
        }
        const onTouchStart = (e: TouchEvent) => {
            touchY = e.touches[0]?.clientY ?? 0
        }
        const onTouchMove = (e: TouchEvent) => {
            const y = e.touches[0]?.clientY ?? touchY
            const d = touchY - y
            touchY = y
            if (consume(d)) e.preventDefault()
        }
        const onKeyDown = (e: KeyboardEvent) => {
            const step = KEY_STEPS[e.key]
            if (step === undefined) return
            if (consume(step)) e.preventDefault()
        }
        const onScroll = () => {
            if (locked || !released) return
            const y = window.scrollY
            const climbing = y < lastY
            lastY = y
            if (climbing && y <= section!.offsetTop) {
                target = shown = 1
                paint(1)
                engageLock()
                startLoop()
            }
        }

        /* The scrub loop runs only when it has something to do.
         *
         * The first version called requestAnimationFrame unconditionally, so a
         * full repaint of 17,562 edges ran at 60fps for the life of the page --
         * including after the hero had been scrolled away and the reader was
         * three sections down. Measured, that was 26.8% of the main thread spent
         * drawing something nobody could see, competing with every animation
         * below it.
         *
         * Two gates now: the loop stands down once the eased value has caught up
         * with the target, and it stands down entirely while the hero is off
         * screen. Any input, or the hero returning to view, starts it again.
         */
        let looping = false
        let onScreen = true

        function frame() {
            const delta = target - shown
            if (Math.abs(delta) < 0.0004) {
                // Land exactly on the target, paint the final frame, and stop.
                if (shown !== target) {
                    shown = target
                    paint(shown)
                }
                looping = false
                return
            }
            shown += delta * 0.16
            paint(shown)
            rafId = requestAnimationFrame(frame)
        }

        function startLoop() {
            if (looping || !onScreen) return
            looping = true
            rafId = requestAnimationFrame(frame)
        }

        function stopLoop() {
            looping = false
            cancelAnimationFrame(rafId)
        }

        const visibility = new IntersectionObserver(
            ([entry]) => {
                onScreen = entry.isIntersecting
                if (onScreen) startLoop()
                else stopLoop()
            },
            { threshold: 0 },
        )
        visibility.observe(section)

        resize()
        window.addEventListener("resize", resize)
        setReady(true)

        if (reduceMotion) {
            target = shown = 1
            moved = true
            paint(1)
        } else {
            if (window.scrollY <= section.offsetTop + 1) engageLock()
            window.addEventListener("wheel", onWheel, { passive: false })
            window.addEventListener("touchstart", onTouchStart, { passive: true })
            window.addEventListener("touchmove", onTouchMove, { passive: false })
            window.addEventListener("keydown", onKeyDown)
            window.addEventListener("scroll", onScroll, { passive: true })

            startLoop()
        }

        return () => {
            visibility.disconnect()
            window.removeEventListener("resize", resize)
            window.removeEventListener("wheel", onWheel)
            window.removeEventListener("touchstart", onTouchStart)
            window.removeEventListener("touchmove", onTouchMove)
            window.removeEventListener("keydown", onKeyDown)
            window.removeEventListener("scroll", onScroll)
            cancelAnimationFrame(rafId)
            releaseLock()
        }
    }, [data, scrubDistance, holdDistance])

    return (
        <div ref={sectionRef} className="relative h-[100dvh] w-full overflow-hidden bg-ink-950">
            <canvas
                ref={canvasRef}
                aria-hidden="true"
                className="absolute inset-0 transition-opacity duration-700"
                style={{ opacity: ready ? 1 : 0 }}
            />

            {/* Falloff top and bottom so type never fights the network. */}
            <div
                className="pointer-events-none absolute inset-0"
                style={{
                    background:
                        "linear-gradient(180deg, rgba(6,7,10,0.85), rgba(6,7,10,0.1) 32%, rgba(6,7,10,0.15) 62%, rgba(6,7,10,0.92))",
                }}
            />

            <div
                ref={titleRef}
                className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-[6%] text-center"
            >
                <h1
                    className="font-pixel text-paper-100"
                    style={{ fontSize: "clamp(28px, 7vw, 92px)", lineHeight: 1.05 }}
                >
                    CIVICFLOW
                </h1>
                <p
                    className="mt-5 max-w-xl text-balance text-sm leading-relaxed text-paper-300 sm:text-base"
                >
                    Arkansas has {(data?.totals.counties ?? 75)} counties, {" "}
                    {(data?.totals.population ?? 3011524).toLocaleString()} residents and{" "}
                    {(data?.totals.facilities ?? 1731).toLocaleString()} emergency facilities.
                    Change one thing and watch it travel.
                </p>
            </div>

            {/* Beat captions. Only one is visible at a time, driven by paint(). */}
            <div
                ref={captionRef}
                data-beat="0"
                className="pointer-events-none absolute inset-x-0 bottom-[16%] flex justify-center px-6 [&>*]:hidden [&[data-beat='1']>:nth-child(1)]:block [&[data-beat='2']>:nth-child(2)]:block [&[data-beat='3']>:nth-child(3)]:block"
            >
                <Caption
                    label="THE NETWORK"
                    value={`${(data?.counts.edges ?? 0).toLocaleString()} road segments`}
                    source="OpenStreetMap · VERIFIED"
                />
                <Caption
                    label="THE PEOPLE"
                    value={`${(data?.totals.population ?? 0).toLocaleString()} residents`}
                    source="2020 Decennial Census · VERIFIED"
                />
                <Caption
                    label="THE STRAIN"
                    value={`${(data?.counts.stressedEdges ?? 0).toLocaleString()} segments at or over capacity`}
                    source="CivicFlow baseline · MODELLED"
                />
            </div>

            <div
                ref={hintRef}
                className="pointer-events-none absolute bottom-[clamp(20px,6vh,44px)] left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 text-paper-400 transition-opacity duration-300"
            >
                <span className="font-pixel text-[10px] tracking-[0.3em]">SCROLL</span>
                <svg width="13" height="17" viewBox="0 0 14 18" aria-hidden="true" className="animate-[civic-bounce_1.6s_ease-in-out_infinite]">
                    <style>{`@keyframes civic-bounce{0%,100%{transform:translateY(0);opacity:.5}50%{transform:translateY(5px);opacity:1}}`}</style>
                    <path d="M7 1 L7 17 M2 12 L7 17 L12 12" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </div>

            {/* Never trap anyone: keyboard-reachable escape from the lock. */}
            <button
                type="button"
                onClick={() => releaseRef.current()}
                className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-ink-900/80 px-4 py-2 text-xs font-medium text-paper-200 opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
                {skipLabel}
            </button>

            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-ink-700">
                <div ref={barRef} className="h-full w-full origin-left bg-accent" style={{ transform: "scaleX(0)" }} />
            </div>
        </div>
    )
}

function Caption({ label, value, source }: { label: string; value: string; source: string }) {
    return (
        <div className="text-center">
            <div className="font-pixel text-[11px] tracking-[0.28em] text-accent">{label}</div>
            <div className="tabular mt-2 text-lg font-medium text-paper-100 sm:text-2xl">{value}</div>
            <div className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-paper-400">{source}</div>
        </div>
    )
}
