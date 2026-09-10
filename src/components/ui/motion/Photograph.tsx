"use client"

/**
 * A photograph, arriving.
 *
 * Three things happen here that a bare <img> does not do.
 *
 * The 24px placeholder is painted first, scaled up under a blur, so the tile
 * has the photograph's actual colour before the file has loaded. The full image
 * cross-fades over it. A grey box snapping to a photograph is the loudest tell
 * of an unfinished page, and the fix costs about 700 bytes per image.
 *
 * The image is held slightly over-sized and translated against the scroll. Real
 * parallax, not a scale trick: the overflow is what makes the movement possible
 * without exposing an edge. It is deliberately small -- around 6% of the frame
 * -- because a photograph that slides visibly under its own caption reads as a
 * template, and this one is captioned with figures the reader is meant to read.
 *
 * And it is honest about credit. Every photograph here is someone else's work
 * under a licence that requires attribution, so `credit` is a required prop.
 * You cannot render one of these without saying whose it is.
 */

import { useEffect, useRef } from "react"
import type { Photo } from "@/data/photos"
import { prefersReducedMotion } from "@/lib/motion"

interface Props {
    photo: Photo
    /** Extra classes for the frame, not the image. */
    className?: string
    /**
     * Stretch the frame over its nearest positioned ancestor.
     *
     * Not something a caller can do with a class: the frame carries its own
     * `relative`, and whether an `absolute` passed in via className wins is
     * decided by the order Tailwind happens to emit the two utilities, not by
     * the order they appear in the attribute. That coin-flip cost an afternoon
     * -- the frame silently resolved to `relative` with `h-full` against an
     * auto-height parent, i.e. zero -- so the choice is a prop.
     */
    fill?: boolean
    /** Fraction of the frame height the image may travel. 0 disables parallax. */
    parallax?: number
    /** Slight zoom on hover of the nearest `.group` ancestor. */
    hoverZoom?: boolean
    /** Loaded eagerly only for something above the fold. */
    priority?: boolean
    /** Overlaid content: captions, figures, gradients. */
    children?: React.ReactNode
    /** Rendered into the corner as the attribution line. */
    creditPosition?: "corner" | "none"
    /**
     * Where the subject sits in the frame, as `object-position`.
     *
     * Needed because these are found photographs, not commissioned ones: a
     * rice field near Stuttgart is two thirds sky, and a centre crop of it into
     * a shorter frame is a photograph of weather.
     */
    focus?: string
}

export function Photograph({
    photo,
    className = "",
    fill = false,
    parallax = 0.06,
    hoverZoom = false,
    priority = false,
    children,
    creditPosition = "corner",
    focus,
}: Props) {
    const frameRef = useRef<HTMLDivElement>(null)
    const imgRef = useRef<HTMLImageElement>(null)

    /**
     * Mark the image loaded, in a way that survives hydration.
     *
     * An onLoad prop is the obvious approach and it silently loses the race:
     * the <img> is in the server-rendered HTML, so the browser can finish
     * fetching it before React hydrates and attaches the handler, and the load
     * event has then already fired at nobody. The photograph stays at opacity 0
     * forever behind its own placeholder -- which is exactly what happened here,
     * and only on the images high enough up the page to win that race.
     *
     * Checking `complete` on mount closes it. The state is an attribute rather
     * than React state so the cross-fade is CSS and no photograph costs a
     * render.
     */
    useEffect(() => {
        const img = imgRef.current
        if (!img) return
        const done = () => {
            img.dataset.loaded = "true"
        }
        // naturalWidth guards against a broken image, which is also `complete`.
        if (img.complete && img.naturalWidth > 0) {
            done()
            return
        }
        img.addEventListener("load", done, { once: true })
        return () => img.removeEventListener("load", done)
    }, [])

    /* Parallax runs off scroll position rather than IntersectionObserver
       thresholds: the offset is a continuous function of where the frame sits
       in the viewport, so it has to be recomputed per frame while visible.
       rAF-throttled, and only while the frame is actually on screen. */
    useEffect(() => {
        if (!parallax || prefersReducedMotion()) return
        const frame = frameRef.current
        const img = imgRef.current
        if (!frame || !img) return

        let visible = false
        let ticking = false

        const apply = () => {
            ticking = false
            const rect = frame.getBoundingClientRect()
            const vh = window.innerHeight || 1
            // -1 when the frame is entering at the bottom, +1 when leaving at
            // the top. Clamped so a very tall frame does not overshoot.
            const progress = Math.max(-1, Math.min(1, (rect.top + rect.height / 2 - vh / 2) / vh))
            img.style.transform = `translate3d(0, ${(progress * parallax * rect.height).toFixed(2)}px, 0)`
        }

        const onScroll = () => {
            if (!visible || ticking) return
            ticking = true
            requestAnimationFrame(apply)
        }

        const io = new IntersectionObserver(
            ([entry]) => {
                visible = entry.isIntersecting
                if (visible) apply()
            },
            { rootMargin: "100px" },
        )
        io.observe(frame)
        window.addEventListener("scroll", onScroll, { passive: true })
        window.addEventListener("resize", onScroll, { passive: true })
        return () => {
            io.disconnect()
            window.removeEventListener("scroll", onScroll)
            window.removeEventListener("resize", onScroll)
        }
    }, [parallax])

    // The image over-scales by twice the parallax so its edge never enters frame.
    const overscan = 1 + parallax * 2

    return (
        <div
            ref={frameRef}
            className={`${fill ? "absolute inset-0" : "relative"} overflow-hidden ${className}`}
        >
            {/* Placeholder. Sits under the photograph and is never removed:
                a photograph with transparency or a slow decode still has
                ground beneath it. */}
            <div
                aria-hidden
                className="absolute inset-0 scale-110 bg-cover bg-center blur-xl"
                style={{ backgroundImage: `url("${photo.blur}")` }}
            />

            {/* Deliberately not next/image. These files are already resized
                and re-encoded to their display size by scripts/fetch-photos.mjs,
                so the optimiser has nothing left to do, and routing them through
                it would put a server round-trip in front of a static asset that
                is committed to the repo. Width and height are set, so this costs
                no layout shift either. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                ref={imgRef}
                src={photo.src}
                width={photo.width}
                height={photo.height}
                alt={`${photo.place}, Arkansas`}
                loading={priority ? "eager" : "lazy"}
                decoding="async"
                className={[
                    "civic-photo absolute inset-0 h-full w-full object-cover will-change-transform",
                    "transition-[opacity,scale] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]",
                    hoverZoom ? "group-hover:scale-[1.05]" : "",
                ].join(" ")}
                style={{
                    height: `${overscan * 100}%`,
                    top: `${(1 - overscan) * 50}%`,
                    objectPosition: focus,
                }}
            />

            {children}

            {creditPosition === "corner" && <Credit photo={photo} />}
        </div>
    )
}

/**
 * The attribution line.
 *
 * Small and low-contrast at rest, because it is a legal requirement rather than
 * something the reader came for, and readable on hover or focus. It is a real
 * link to the Commons file page, which is where the licence actually lives.
 */
export function Credit({ photo, className = "" }: { photo: Photo; className?: string }) {
    return (
        <a
            href={photo.source}
            target="_blank"
            rel="noreferrer noopener"
            className={[
                "absolute bottom-1.5 right-2 z-10 font-mono text-[9px] leading-none text-paper-100/35",
                "transition-colors duration-200 hover:text-paper-100/85 focus-visible:text-paper-100",
                className,
            ].join(" ")}
        >
            {photo.credit} · {photo.licence}
        </a>
    )
}
