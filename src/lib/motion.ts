"use client"

/**
 * Shared motion primitives.
 *
 * These exist so timing is decided once rather than re-invented per component.
 * Every animation in the results panel is an ENTRANCE or a VALUE CHANGE, and
 * both want the same shape: fast out of the gate, settling gently, never
 * bouncing. A dashboard that overshoots its numbers reads as unserious, and
 * these numbers are the whole argument.
 *
 * Reduced motion is honoured by snapping to the target on the first frame, not
 * by animating quickly -- a fast animation is still an animation.
 */

import { useEffect, useRef, useState } from "react"

/** Entrance/settle curve. Matches cubic-bezier(0.16, 1, 0.3, 1) closely enough. */
export const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5)

/** CSS equivalent, for anything animated by the compositor instead. */
export const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)"

export const DURATION = {
    /** Numbers settling into place. */
    value: 620,
    /** The DNA silhouette morphing between scenarios. */
    shape: 460,
    /** Congestion flooding the map. */
    crossfade: 420,
} as const

export function prefersReducedMotion(): boolean {
    if (typeof window === "undefined") return false
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
}

/**
 * Tweens an array of numbers toward a target whenever the target changes.
 *
 * Interpolation starts from wherever the previous tween had got to, not from
 * the last committed target, so a result arriving mid-animation continues
 * smoothly instead of snapping back and starting again. Users run scenarios in
 * quick succession, so this case is common rather than exotic.
 */
export function useTweenedArray(
    target: number[],
    duration: number = DURATION.shape,
    /** Where the first tween starts. Defaults to the target, i.e. no entry. */
    initial?: number[],
): number[] {
    const [, force] = useState(0)
    const current = useRef<number[]>(initial ?? target)
    const from = useRef<number[]>(initial ?? target)
    const start = useRef(0)
    const raf = useRef(0)
    const key = target.join(",")

    useEffect(() => {
        if (prefersReducedMotion()) {
            current.current = target
            force((n) => n + 1)
            return
        }
        from.current = [...current.current]
        start.current = performance.now()

        const frame = () => {
            const t = Math.min(1, (performance.now() - start.current) / duration)
            const e = easeOutQuint(t)
            current.current = target.map((v, i) => {
                const a = from.current[i] ?? v
                return a + (v - a) * e
            })
            force((n) => n + 1)
            if (t < 1) raf.current = requestAnimationFrame(frame)
        }
        raf.current = requestAnimationFrame(frame)
        return () => cancelAnimationFrame(raf.current)
        // `key` stands in for a deep compare on the target array.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, duration])

    return current.current
}

/**
 * Single-value form of the above, for a score counting into place.
 *
 * The first version kept the displayed number in React state and, on cleanup,
 * wrote that state into the start ref. That looks reasonable and is wrong: the
 * effect only re-runs when the target changes, so its closure still holds the
 * value from whenever that last happened, not the value currently on screen.
 * A score settled at 70 would therefore start its next tween from 81 -- the
 * number it had been showing one target ago -- and visibly jump up before
 * falling to 21. Tracking the animated value in a ref, as useTweenedArray
 * already does, removes the stale closure entirely.
 */
export function useCountUp(
    target: number,
    duration: number = DURATION.value,
    /** Where the first count starts. Defaults to the target, i.e. no entry. */
    initial?: number,
): number {
    const [, force] = useState(0)
    const current = useRef(initial ?? target)
    const from = useRef(initial ?? target)
    const raf = useRef(0)

    useEffect(() => {
        if (prefersReducedMotion()) {
            current.current = target
            force((n) => n + 1)
            return
        }
        // Continue from whatever is actually on screen right now.
        from.current = current.current
        const t0 = performance.now()

        const frame = () => {
            const t = Math.min(1, (performance.now() - t0) / duration)
            current.current = from.current + (target - from.current) * easeOutQuint(t)
            force((n) => n + 1)
            if (t < 1) raf.current = requestAnimationFrame(frame)
        }
        raf.current = requestAnimationFrame(frame)
        return () => cancelAnimationFrame(raf.current)
    }, [target, duration])

    return current.current
}


/**
 * Fires once when an element first enters view.
 *
 * Used to defer a count-up until the number is actually on screen -- a figure
 * that has already finished counting by the time you scroll to it might as well
 * be static.
 */
export function useInView<T extends HTMLElement>(rootMargin = "0px 0px -15% 0px") {
    const ref = useRef<T>(null)
    const [inView, setInView] = useState(false)

    useEffect(() => {
        const el = ref.current
        if (!el) return
        const io = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting) return
                setInView(true)
                io.disconnect()
            },
            { rootMargin, threshold: 0.15 },
        )
        io.observe(el)
        return () => io.disconnect()
    }, [rootMargin])

    return { ref, inView }
}
