"use client"

/**
 * The run history as a flick-through carousel.
 *
 * Adapted from the momentum list in the reference: dragging does not move the
 * strip one-to-one, it imparts velocity that decays and settles onto a card.
 * That is what makes it feel like a physical object rather than a scroll area,
 * and it suits a version history -- you flick back through attempts rather than
 * scrolling a document.
 *
 * Each card carries the score it produced, so scanning the strip is scanning
 * the experiment log.
 */

import { useEffect, useRef, useState } from "react"
import { Version } from "@/state/lab"
import { prefersReducedMotion } from "@/lib/motion"

const CARD = 168
const GAP = 10
const STEP = CARD + GAP

export function VersionCarousel({
    versions,
    currentId,
    onSelect,
}: {
    versions: Version[]
    currentId: string | null
    onSelect: (id: string) => void
}) {
    const trackRef = useRef<HTMLDivElement>(null)
    const offset = useRef(0)
    const velocity = useRef(0)
    const target = useRef<number | null>(null)
    const dragging = useRef(false)
    const lastX = useRef(0)
    const lastT = useRef(0)
    const raf = useRef(0)
    const [active, setActive] = useState(0)

    const n = versions.length

    useEffect(() => {
        const i = versions.findIndex((v) => v.id === currentId)
        if (i >= 0) target.current = i * STEP
    }, [currentId, versions])

    useEffect(() => {
        if (!n) return

        const tick = () => {
            if (target.current !== null) {
                offset.current += (target.current - offset.current) * 0.18
                if (Math.abs(target.current - offset.current) < 0.5) {
                    offset.current = target.current
                    target.current = null
                }
            } else if (!dragging.current) {
                offset.current += velocity.current
                velocity.current *= 0.92
                // Below this the strip is effectively still; settle onto the
                // nearest card rather than drifting to a stop between two.
                if (Math.abs(velocity.current) < 0.35) {
                    velocity.current = 0
                    target.current = Math.max(0, Math.min(n - 1, Math.round(offset.current / STEP))) * STEP
                }
            }
            offset.current = Math.max(-STEP * 0.4, Math.min((n - 1) * STEP + STEP * 0.4, offset.current))

            const track = trackRef.current
            if (track) track.style.transform = `translateX(${-offset.current}px)`
            const near = Math.max(0, Math.min(n - 1, Math.round(offset.current / STEP)))
            setActive((p) => (p === near ? p : near))

            raf.current = requestAnimationFrame(tick)
        }
        raf.current = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf.current)
    }, [n])

    const onDown = (e: React.PointerEvent) => {
        dragging.current = true
        target.current = null
        velocity.current = 0
        lastX.current = e.clientX
        lastT.current = performance.now()
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
    }
    const onMove = (e: React.PointerEvent) => {
        if (!dragging.current) return
        const dx = lastX.current - e.clientX
        offset.current += dx
        const t = performance.now()
        velocity.current = (dx / Math.max(1, t - lastT.current)) * 14
        lastX.current = e.clientX
        lastT.current = t
    }
    const onUp = () => {
        dragging.current = false
        if (prefersReducedMotion()) {
            target.current = Math.round(offset.current / STEP) * STEP
            velocity.current = 0
        }
    }

    const step = (dir: 1 | -1) => {
        velocity.current = 0
        target.current = Math.max(0, Math.min(n - 1, active + dir)) * STEP
    }

    if (!n) return null

    return (
        <div>
            <div className="flex items-center gap-2">
                <button
                    onClick={() => step(-1)}
                    disabled={active === 0}
                    className="font-mono text-[11px] text-paper-300 disabled:opacity-30"
                    aria-label="Previous version"
                >
                    ‹ Prev
                </button>
                <button
                    onClick={() => step(1)}
                    disabled={active >= n - 1}
                    className="font-mono text-[11px] text-paper-100 disabled:opacity-30"
                    aria-label="Next version"
                >
                    Next ›
                </button>
                <span className="tabular ml-auto font-mono text-[10px] text-paper-400">
                    {active + 1} / {n}
                </span>
            </div>

            <div
                className="relative mt-2 overflow-hidden"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                style={{ touchAction: "pan-y", cursor: "grab" }}
            >
                <div ref={trackRef} className="flex gap-2.5 will-change-transform">
                    {versions.map((v) => {
                        const score = v.result?.civic.value ?? null
                        const isCurrent = v.id === currentId
                        return (
                            <button
                                key={v.id}
                                onClick={() => onSelect(v.id)}
                                style={{ width: CARD }}
                                className={`shrink-0 rounded-lg border p-3 text-left transition-colors ${
                                    isCurrent
                                        ? "border-paper-100/60 bg-black/35"
                                        : "border-white/15 bg-black/20 hover:border-white/35"
                                }`}
                            >
                                <div className="font-pixel text-[10px] tracking-[0.14em] text-paper-200">
                                    {v.label}
                                </div>
                                <div className="tabular mt-2 font-mono text-2xl text-paper-100">
                                    {score ?? "··"}
                                </div>
                                <div className="mt-1 truncate text-[10px] text-paper-300">
                                    {v.actions.length === 0
                                        ? "baseline"
                                        : `${v.actions.length} change${v.actions.length > 1 ? "s" : ""}`}
                                </div>
                            </button>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
