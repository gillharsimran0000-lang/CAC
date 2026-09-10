"use client"

/**
 * A strip of places, moving.
 *
 * The list of counties this model covers is seventy-five long. A grid of
 * seventy-five names is a wall; a strip that drifts past is a scale cue -- it
 * says "this keeps going" without asking anyone to read all of it.
 *
 * Duplicated once and translated by exactly -50%, which is what makes the loop
 * seamless: at the moment the first copy has fully left, the second is exactly
 * where the first began. Set aria-hidden on the duplicate so a screen reader
 * gets the list once.
 *
 * Pauses on hover, because the items are links and a moving target cannot be
 * clicked. Under prefers-reduced-motion the animation is switched off entirely
 * in globals.css and the strip becomes an ordinary scrollable row -- handled
 * there rather than here so a component added later cannot forget to do it.
 */

import { prefersReducedMotion } from "@/lib/motion"
import { useEffect, useRef, useState } from "react"

export function Marquee({
    children,
    speed = 60,
    reverse = false,
    className = "",
}: {
    children: React.ReactNode
    /** Seconds for one full pass. Higher is slower. */
    speed?: number
    reverse?: boolean
    className?: string
}) {
    return (
        <div className={`civic-marquee group/marquee relative flex overflow-hidden ${className}`}>
            {[0, 1].map((copy) => (
                <div
                    key={copy}
                    aria-hidden={copy === 1}
                    className="flex shrink-0 gap-3 pr-3 will-change-transform group-hover/marquee:[animation-play-state:paused]"
                    style={{
                        animation: `civic-marquee ${speed}s linear infinite`,
                        animationDirection: reverse ? "reverse" : "normal",
                    }}
                >
                    {children}
                </div>
            ))}
        </div>
    )
}

/**
 * How far down the document the reader is.
 *
 * A one-pixel rule at the top of the viewport. On a page that is mostly full-
 * height panels, the browser's own scrollbar is the only depth cue and Lenis
 * hides how much is left; this puts it back without adding chrome.
 */
export function ScrollProgress({ className = "" }: { className?: string }) {
    const [pct, setPct] = useState(0)

    useEffect(() => {
        let ticking = false
        const measure = () => {
            ticking = false
            const max = document.documentElement.scrollHeight - window.innerHeight
            setPct(max > 0 ? Math.min(1, window.scrollY / max) : 0)
        }
        const onScroll = () => {
            if (ticking) return
            ticking = true
            requestAnimationFrame(measure)
        }
        measure()
        window.addEventListener("scroll", onScroll, { passive: true })
        window.addEventListener("resize", onScroll, { passive: true })
        return () => {
            window.removeEventListener("scroll", onScroll)
            window.removeEventListener("resize", onScroll)
        }
    }, [])

    return (
        <div
            aria-hidden
            className={`fixed inset-x-0 top-0 z-50 h-px origin-left bg-accent ${className}`}
            style={{ transform: `scaleX(${pct})` }}
        />
    )
}

/**
 * A button that leans toward the cursor as it approaches.
 *
 * Six pixels of travel inside a 90px radius. The point is not the movement, it
 * is that the target feels like it wants to be hit -- which matters most for
 * the one control this whole page exists to get someone to press.
 *
 * The transform lives on an inner span so the button's own :active translate,
 * defined once in globals.css, is not fighting it.
 */
export function Magnetic({
    children,
    className = "",
    radius = 90,
    pull = 6,
    ...rest
}: {
    children: React.ReactNode
    className?: string
    radius?: number
    pull?: number
} & React.ComponentPropsWithoutRef<"a">) {
    const ref = useRef<HTMLAnchorElement>(null)

    useEffect(() => {
        if (prefersReducedMotion()) return
        const el = ref.current
        if (!el) return

        let frame = 0
        const onMove = (e: PointerEvent) => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => {
                const r = el.getBoundingClientRect()
                const dx = e.clientX - (r.left + r.width / 2)
                const dy = e.clientY - (r.top + r.height / 2)
                // Measured from the button's edge, not its centre, so a wide
                // button is not harder to attract than a small one.
                const reach = radius + Math.max(r.width, r.height) / 2
                const dist = Math.hypot(dx, dy)
                if (dist > reach) {
                    el.style.transform = "translate3d(0,0,0)"
                    return
                }
                // Falls off toward the edge of reach, so the pull arrives
                // gradually instead of snapping on at the boundary.
                const k = (1 - dist / reach) * pull
                el.style.transform = `translate3d(${((dx / Math.max(dist, 1)) * k).toFixed(1)}px, ${((dy / Math.max(dist, 1)) * k).toFixed(1)}px, 0)`
            })
        }

        window.addEventListener("pointermove", onMove, { passive: true })
        return () => {
            cancelAnimationFrame(frame)
            window.removeEventListener("pointermove", onMove)
        }
    }, [radius, pull])

    return (
        <a
            {...rest}
            ref={ref}
            className={className}
            style={{ ...rest.style, transition: "transform 420ms cubic-bezier(0.16,1,0.3,1)" }}
        >
            {children}
        </a>
    )
}
