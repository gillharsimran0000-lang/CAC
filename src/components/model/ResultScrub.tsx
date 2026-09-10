"use client"

/**
 * The result, revealed by scroll.
 *
 * A tall section with an inner sticky panel, choreographed by a single GSAP
 * ScrollTrigger scrub. Over the length of the section the model card grows from
 * a contained card, past the edges of the screen until it overfills the
 * viewport, then settles back; the two halves of the headline part to let it
 * through and return as it recedes.
 *
 * Two notes on how this is built, both learned the hard way in this file's
 * previous life:
 *
 * Sticky, not pin. ScrollTrigger's `pin` rewrites the document's layout and
 * fights anything else that wants a say in scroll position. A tall section with
 * a `position: sticky` child produces the identical effect while leaving the
 * scroll alone.
 *
 * Scrub, not wheel capture. The first version intercepted wheel events and held
 * the page at zero until the model had opened. It worked, and it meant two
 * things claiming authority over the same gesture -- the hero's gate and the
 * page's smooth scrolling -- which is a class of bug that only shows up on
 * someone else's trackpad. Scrubbing a timeline against native scroll position
 * has no such conflict.
 *
 * What scales is the live corridor model, not a frame sequence: the thing that
 * fills the screen is the simulation's own output, still rendering.
 */

import { ReactNode, useEffect, useRef, useState } from "react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import type { CorridorStress } from "@/engine/types"
import { CorridorModel } from "./CorridorModel"

/** Section height as a multiple of the viewport; the length of the choreography. */
const SCROLL_LENGTH = 3.2
/** Push slightly past a perfect fit so no edge of the field shows through. */
const IMMERSE_OVERFILL = 1.05
const START_SCALE_DESKTOP = 0.62
const START_SCALE_MOBILE = 0.84

export function ResultScrub({
    areaId,
    vc,
    corridors,
    titleTop,
    titleBottom,
    caption,
    hint,
    fieldA,
    fieldB,
    glow,
}: {
    areaId: string
    vc: number[] | null
    /** Passed straight through so a wall in the model can name itself. */
    corridors?: CorridorStress[]
    titleTop: ReactNode
    titleBottom: ReactNode
    caption?: ReactNode
    hint?: string
    fieldA: string
    fieldB: string
    glow: string
}) {
    const sectionRef = useRef<HTMLElement>(null)
    const cardRef = useRef<HTMLDivElement>(null)
    const topRef = useRef<HTMLDivElement>(null)
    const bottomRef = useRef<HTMLDivElement>(null)
    const fieldRef = useRef<HTMLDivElement>(null)
    const [reduced, setReduced] = useState(false)

    useEffect(() => {
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
        const update = () => setReduced(mq.matches)
        update()
        mq.addEventListener?.("change", update)
        return () => mq.removeEventListener?.("change", update)
    }, [])

    /* Entry: the field, then the card, then the headline halves from opposite
       directions -- so the page assembles rather than appearing. */
    useEffect(() => {
        if (reduced) return
        const ctx = gsap.context(() => {
            const tl = gsap.timeline({ delay: 0.15 })
            tl.from(fieldRef.current, { opacity: 0, duration: 1.2, ease: "power2.out" })
            /* Opacity only. Animating `scale` here as well put two timelines in
               charge of the same property: whichever initialised last won, and
               the card sat at 0.94 at rest instead of the 0.62 the scrub
               expects. Scale belongs to the scrub, start to finish. */
            tl.from(cardRef.current, { opacity: 0, duration: 1, ease: "power3.out" }, 0.3)
            tl.from(topRef.current, { opacity: 0, y: 26, duration: 0.9, ease: "expo.out" }, 0.45)
            tl.from(bottomRef.current, { opacity: 0, y: -26, duration: 0.9, ease: "expo.out" }, 0.56)
        }, sectionRef)
        return () => ctx.revert()
    }, [reduced])

    /* The scrub. */
    useEffect(() => {
        if (reduced) return
        gsap.registerPlugin(ScrollTrigger)
        const section = sectionRef.current
        if (!section) return

        const ctx = gsap.context(() => {
            const startScale = () =>
                window.innerWidth < 768 ? START_SCALE_MOBILE : START_SCALE_DESKTOP

            // How far the card must scale to cover the viewport from its
            // laid-out size. Recomputed on refresh so it survives a resize.
            const immerseScale = () => {
                const vw = window.innerWidth
                const vh = window.innerHeight
                const el = cardRef.current
                if (!el) return 1.8
                const r = el.getBoundingClientRect()
                const w = r.width / (gsap.getProperty(el, "scaleX") as number || 1)
                const h = r.height / (gsap.getProperty(el, "scaleY") as number || 1)
                if (w <= 0 || h <= 0) return 1.8
                return Math.max(vw / w, vh / h) * IMMERSE_OVERFILL
            }

            gsap.set(cardRef.current, { scale: startScale(), transformOrigin: "50% 50%" })

            const master = gsap.timeline({
                scrollTrigger: {
                    trigger: section,
                    start: "top top",
                    end: "bottom bottom",
                    scrub: 0.4,
                    invalidateOnRefresh: true,
                },
            })

            // 1. The card settles to full size and the headline parts.
            master.to(cardRef.current, { scale: 1, ease: "power2.out", duration: 0.15 }, 0)
            master.to(topRef.current, {
                x: () => (window.innerWidth < 768 ? "-64vw" : "-52vw"),
                ease: "power2.inOut", duration: 0.15,
            }, 0)
            master.to(bottomRef.current, {
                x: () => (window.innerWidth < 768 ? "64vw" : "52vw"),
                ease: "power2.inOut", duration: 0.15,
            }, 0)

            // 2. It takes the screen. The field dims so the model is all there is.
            master.to(cardRef.current, { scale: immerseScale, ease: "power2.in", duration: 0.63 }, 0.15)
            master.to(fieldRef.current, { opacity: 0.35, ease: "none", duration: 0.63 }, 0.15)
            master.to(topRef.current, { opacity: 0, ease: "power1.in", duration: 0.2 }, 0.15)
            master.to(bottomRef.current, { opacity: 0, ease: "power1.in", duration: 0.2 }, 0.15)

            // 3. And recedes, handing the page back to the working below.
            master.to(cardRef.current, { scale: startScale, ease: "power3.inOut", duration: 0.22 }, 0.78)
            master.to(fieldRef.current, { opacity: 1, ease: "none", duration: 0.22 }, 0.78)
            master.to(topRef.current, { x: 0, opacity: 1, ease: "power2.inOut", duration: 0.22 }, 0.78)
            master.to(bottomRef.current, { x: 0, opacity: 1, ease: "power2.inOut", duration: 0.22 }, 0.78)

            ScrollTrigger.refresh()
        }, sectionRef)

        return () => ctx.revert()
    }, [reduced, vc])

    return (
        <section
            ref={sectionRef}
            /* Addressed by scripts/validate/flow-check.mjs. The check used to
               sample the scrub at fractions of document height, which quietly
               became wrong the moment anything was added below it -- 45% of the
               page stopped landing inside the scrub at all. It now measures
               against this element's own extent. */
            data-scrub-section
            className="relative w-full overflow-clip"
            style={{ height: reduced ? "100svh" : `${(SCROLL_LENGTH + 1) * 100}vh` }}
            aria-label="Simulation result"
        >
            <div className="sticky top-0 flex h-[100svh] w-full flex-col items-center justify-center overflow-hidden">
                <div
                    ref={fieldRef}
                    aria-hidden
                    className="absolute inset-0 z-0"
                    style={{
                        background: `radial-gradient(120% 90% at 50% 8%, ${fieldA} 0%, ${fieldB} 55%, #080b0d 100%)`,
                    }}
                />
                <div
                    aria-hidden
                    className="absolute inset-0 z-0 bg-[linear-gradient(to_right,#ffffff0d_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0d_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_20%,#000_60%,transparent_100%)]"
                />
                <div
                    aria-hidden
                    className="absolute inset-0 z-0"
                    style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.5) 100%)" }}
                />

                <div className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-2 px-4">
                    <div
                        ref={topRef}
                        className="font-display text-white/40"
                        style={{ fontSize: "clamp(34px, 6.5vw, 104px)" }}
                    >
                        {titleTop}
                    </div>

                    <div
                        ref={cardRef}
                        className="relative overflow-hidden rounded-2xl ring-1 ring-white/12 will-change-transform"
                        style={{
                            width: "min(88vw, calc(42svh * 1.6))",
                            height: "min(42svh, 88vw / 1.6)",
                        }}
                    >
                        <div
                            aria-hidden
                            className="pointer-events-none absolute inset-0 z-20"
                            style={{ boxShadow: `inset 0 0 120px rgba(0,0,0,0.45), inset 0 0 60px ${glow}` }}
                        />
                        <div className="absolute inset-0 bg-black/40">
                            <CorridorModel
                                areaId={areaId}
                                vc={vc}
                                corridors={corridors}
                                className="h-full w-full"
                                fill
                            />
                        </div>
                    </div>

                    <div
                        ref={bottomRef}
                        className="font-display text-white"
                        style={{ fontSize: "clamp(42px, 8.5vw, 132px)" }}
                    >
                        {titleBottom}
                    </div>

                </div>

                {/* Pinned rather than stacked: in the flow it pushed the column
                    past the viewport and ran into the scroll hint. */}
                {caption && (
                    <p
                        className="absolute inset-x-0 bottom-16 mx-auto max-w-md px-6 text-center text-[13px] leading-relaxed text-white/70"
                    >
                        {caption}
                    </p>
                )}

                {hint && (
                    <span className="absolute bottom-7 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.3em] text-white/55">
                        {hint}
                    </span>
                )}
            </div>
        </section>
    )
}
