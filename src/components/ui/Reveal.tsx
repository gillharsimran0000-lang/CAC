"use client"

/**
 * Scroll-driven entry.
 *
 * Elements rise and fade as they come into view, staggered by position so a
 * group cascades rather than arriving as one block. The observer disconnects
 * after firing: this is an entrance, and re-animating on every scroll past
 * turns a page into a slideshow.
 *
 * `once: false` on the wrapper is deliberately not offered. Reduced-motion
 * readers get the finished state immediately -- not a faster animation.
 */

import { useEffect, useRef, useState } from "react"
import { prefersReducedMotion } from "@/lib/motion"

export function Reveal({
    children,
    delay = 0,
    y = 14,
    className,
    as: Tag = "div",
}: {
    children: React.ReactNode
    /** Stagger, in ms. */
    delay?: number
    y?: number
    className?: string
    as?: "div" | "li" | "section" | "figure"
}) {
    const ref = useRef<HTMLElement>(null)
    const [shown, setShown] = useState(false)

    useEffect(() => {
        if (prefersReducedMotion()) {
            setShown(true)
            return
        }
        const el = ref.current
        if (!el) return
        const io = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting) return
                setShown(true)
                io.disconnect()
            },
            // Fire a little before the edge, so the motion is finishing as the
            // element becomes properly readable rather than starting then.
            { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
        )
        io.observe(el)
        return () => io.disconnect()
    }, [])

    return (
        <Tag
            ref={ref as never}
            className={className}
            style={{
                opacity: shown ? 1 : 0,
                transform: shown ? "none" : `translateY(${y}px)`,
                transition: `opacity 520ms cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 520ms cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
                willChange: shown ? "auto" : "opacity, transform",
            }}
        >
            {children}
        </Tag>
    )
}

/**
 * Staged entry, keyed to an event rather than to scroll.
 *
 * The results panel used to swap its contents in one frame the moment the
 * worker returned: the shape, the tradeoff, the model and the chain all arrived
 * together, which gave the eye no order to read them in. Staging replays the
 * causal order the chain already argues -- profile, then tradeoff, then the
 * model, then the working -- every time `trigger` changes.
 */
export function Staged({
    children,
    step = 0,
    trigger,
    className,
}: {
    children: React.ReactNode
    /** Position in the sequence; multiplied by the stagger. */
    step?: number
    /** Changing this replays the entry. Usually the run's id. */
    trigger: string | number | null
    className?: string
}) {
    const [shown, setShown] = useState(false)

    useEffect(() => {
        if (trigger == null) return
        if (prefersReducedMotion()) {
            setShown(true)
            return
        }
        setShown(false)
        const t = window.setTimeout(() => setShown(true), 60 + step * 150)
        return () => window.clearTimeout(t)
    }, [trigger, step])

    return (
        <div
            className={className}
            style={{
                opacity: shown ? 1 : 0,
                transform: shown ? "none" : "translateY(10px)",
                transition:
                    "opacity 460ms cubic-bezier(0.16,1,0.3,1), transform 460ms cubic-bezier(0.16,1,0.3,1)",
            }}
        >
            {children}
        </div>
    )
}
