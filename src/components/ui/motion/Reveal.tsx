"use client"

/**
 * Text that assembles.
 *
 * A headline that fades in as one block says "this page loaded". A headline
 * whose words arrive in reading order says "this page is being written for
 * you", which is the note the opening of a simulator wants -- the whole product
 * is about watching something resolve.
 *
 * Each word rises 0.42em, unblurs and settles. The blur is what separates this
 * from the usual staggered fade: focus pulling in reads as depth, and it hides
 * the sub-pixel jitter of a transform landing on a fractional pixel.
 *
 * The stagger is capped. A twelve-word headline at 55ms each would take two
 * thirds of a second to finish, and by then the reader has moved on -- so the
 * per-word delay shrinks as the line gets longer and every line completes
 * inside about 500ms.
 *
 * Nothing here is React state. The observer flips a data attribute on the
 * element and CSS does the rest, which means a page of thirty reveals causes
 * zero re-renders, and -- more importantly -- reduced motion is handled by the
 * blanket rule in globals.css rather than by a second code path that has to be
 * remembered. The delays are per-word custom properties for the same reason.
 *
 * Words are wrapped in an inline-block span, which breaks `text-wrap: balance`.
 * That is the cost of animating per word, and it is why this is used on
 * headlines rather than on running text.
 */

import { useEffect, useRef } from "react"

interface Props {
    children: string
    className?: string
    /** Milliseconds before the first word moves. */
    delay?: number
    as?: "h1" | "h2" | "h3" | "p" | "span" | "div"
    /** Display type on this page is sized with clamp() inline, not by class. */
    style?: React.CSSProperties
    /** Play on mount rather than waiting to be scrolled to. */
    immediate?: boolean
}

/** Flips `data-play` on the node once it is worth playing. */
function usePlayOnView<T extends HTMLElement>(immediate: boolean) {
    const ref = useRef<T>(null)

    useEffect(() => {
        const el = ref.current
        if (!el) return
        if (immediate) {
            el.dataset.play = "true"
            return
        }
        const io = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting) return
                el.dataset.play = "true"
                io.disconnect()
            },
            { threshold: 0.2, rootMargin: "0px 0px -10% 0px" },
        )
        io.observe(el)
        return () => io.disconnect()
    }, [immediate])

    return ref
}

export function BlurIn({
    children,
    className = "",
    delay = 0,
    as: Tag = "div",
    style,
    immediate = false,
}: Props) {
    const ref = usePlayOnView<HTMLElement>(immediate)

    const words = children.split(" ")
    const step = Math.min(55, 480 / Math.max(words.length, 1))

    return (
        <Tag ref={ref as never} className={`civic-blur-in ${className}`} style={style}>
            {words.map((word, i) => (
                <span key={`${word}-${i}`} className="inline-block overflow-hidden align-bottom">
                    <span
                        className="inline-block"
                        style={{ "--civic-delay": `${delay + i * step}ms` } as React.CSSProperties}
                    >
                        {word}
                    </span>
                    {i < words.length - 1 && <span>&nbsp;</span>}
                </span>
            ))}
        </Tag>
    )
}

/**
 * A single line drawing itself across a section boundary.
 *
 * Used where a section is meant to feel like it arrived rather than like it had
 * always been there. Scales from the left on a transform, so it costs nothing
 * on the compositor.
 */
export function DrawRule({ className = "", delay = 0 }: { className?: string; delay?: number }) {
    const ref = usePlayOnView<HTMLDivElement>(false)

    return (
        <div ref={ref} className={`civic-draw-rule h-px w-full bg-ink-700 ${className}`} aria-hidden>
            <div
                className="h-full w-full origin-left bg-accent/60"
                style={{ "--civic-delay": `${delay}ms` } as React.CSSProperties}
            />
        </div>
    )
}
