"use client"

/**
 * Surfaces that respond to the pointer.
 *
 * Two effects, both driven by the same idea: a card that reacts to where the
 * cursor is reads as a physical object under glass, and one that does not reads
 * as a printed rectangle. Both write CSS custom properties from a pointermove
 * handler rather than re-rendering React -- at 120Hz on a trackpad, a setState
 * per move would put the whole subtree through reconciliation for a lighting
 * change.
 *
 * Everything here is decoration in the strict sense: it carries no measurement.
 * That is exactly why it is kept quiet. The rule this project runs on is that
 * colour means volume-to-capacity and nothing else, so these effects are built
 * from white at very low alpha and never from the flow ramp.
 */

import { useCallback, useRef } from "react"
import { prefersReducedMotion } from "@/lib/motion"

/**
 * A cursor-following highlight, clipped to the card.
 *
 * The radial gradient is painted into a pseudo-element via CSS variables for
 * position, and only becomes visible on hover, so a page full of these is
 * static until the pointer is actually over one.
 */
export function Spotlight({
    children,
    className = "",
    size = 340,
    strength = 0.06,
}: {
    children: React.ReactNode
    className?: string
    size?: number
    strength?: number
}) {
    const ref = useRef<HTMLDivElement>(null)

    const onMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const el = ref.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        el.style.setProperty("--mx", `${e.clientX - rect.left}px`)
        el.style.setProperty("--my", `${e.clientY - rect.top}px`)
    }, [])

    return (
        <div
            ref={ref}
            onPointerMove={onMove}
            className={`group/spot relative ${className}`}
            style={
                {
                    "--spot-size": `${size}px`,
                    "--spot-strength": strength,
                } as React.CSSProperties
            }
        >
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-300 group-hover/spot:opacity-100"
                style={{
                    background:
                        "radial-gradient(var(--spot-size) circle at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,var(--spot-strength)), transparent 70%)",
                }}
            />
            {children}
        </div>
    )
}

/**
 * A light travelling the border of a panel.
 *
 * Reserved for the one thing on a screen that is currently live -- a simulation
 * running, a result that just landed. If more than one of these is visible at
 * once the effect has been misused: a border that moves is the strongest
 * attention cue on a dark page, and there is only ever one most-important thing.
 *
 * Implemented as a rotating conic gradient behind a masked inset, so it follows
 * whatever border-radius the parent has without any path maths.
 */
export function BorderBeam({
    duration = 6,
    className = "",
    colour = "var(--color-accent)",
}: {
    duration?: number
    className?: string
    colour?: string
}) {
    return (
        <div
            aria-hidden
            className={`pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] ${className}`}
        >
            <div
                className="absolute left-1/2 top-1/2 aspect-square w-[200%] -translate-x-1/2 -translate-y-1/2 motion-safe:animate-[civic-spin_var(--beam-duration)_linear_infinite]"
                style={
                    {
                        "--beam-duration": `${duration}s`,
                        background: `conic-gradient(from 0deg, transparent 0deg, transparent 300deg, ${colour} 350deg, transparent 360deg)`,
                    } as React.CSSProperties
                }
            />
            {/* Punches the middle out, leaving only a 1px rim lit. */}
            <div className="absolute inset-px rounded-[inherit] bg-ink-900" />
        </div>
    )
}

/**
 * A card that tips toward the cursor.
 *
 * Kept to about 4 degrees. Larger tilts look impressive in isolation and make a
 * grid of them feel like a carousel of toys; at this amplitude it registers as
 * the surface having a normal rather than as an effect.
 */
export function Tilt({
    children,
    className = "",
    max = 4,
}: {
    children: React.ReactNode
    className?: string
    max?: number
}) {
    const ref = useRef<HTMLDivElement>(null)
    const frame = useRef(0)

    const onMove = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (prefersReducedMotion()) return
            const el = ref.current
            if (!el) return
            cancelAnimationFrame(frame.current)
            frame.current = requestAnimationFrame(() => {
                const r = el.getBoundingClientRect()
                const x = (e.clientX - r.left) / r.width - 0.5
                const y = (e.clientY - r.top) / r.height - 0.5
                el.style.transform = `perspective(900px) rotateX(${(-y * max).toFixed(2)}deg) rotateY(${(x * max).toFixed(2)}deg)`
            })
        },
        [max],
    )

    const reset = useCallback(() => {
        cancelAnimationFrame(frame.current)
        const el = ref.current
        if (el) el.style.transform = "perspective(900px) rotateX(0deg) rotateY(0deg)"
    }, [])

    return (
        <div
            ref={ref}
            onPointerMove={onMove}
            onPointerLeave={reset}
            className={`transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform ${className}`}
        >
            {children}
        </div>
    )
}
