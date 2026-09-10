"use client"

/**
 * THE VERSION DECK.
 *
 * The music-player hero, rebuilt around runs instead of tracks. Everything that
 * made that component feel physical is here and doing the same job:
 *
 *   - a floating square screen that tilts toward the cursor in 3D, with the live
 *     corridor model playing inside it instead of video
 *   - a coverflow list with real momentum -- a flick imparts velocity that
 *     decays and settles onto a detent, rather than tracking the pointer 1:1 --
 *     with each row leaning on rotateX, scaling and fading by its distance from
 *     centre
 *   - working prev / play / next controls, where "play" cycles through your runs
 *   - a synthesised detent click on every row the list passes
 *
 * What it browses is your own experiment history, so the physicality is doing
 * something: flicking back through attempts is the gesture the tool wants.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { Version } from "@/state/lab"
import { CorridorModel } from "@/components/model/CorridorModel"
import { prefersReducedMotion } from "@/lib/motion"

const ROW_HEIGHT = 56
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const mod = (n: number, m: number) => ((n % m) + m) % m

/**
 * A short filtered noise burst: the detent click of a scroll wheel. Synthesised
 * rather than loaded, so it costs nothing and cannot fail to arrive.
 */
function playClick(ctx: AudioContext, strength: number) {
    const now = ctx.currentTime
    const n = Math.floor(ctx.sampleRate * 0.012)
    const buffer = ctx.createBuffer(1, n, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const bp = ctx.createBiquadFilter()
    bp.type = "bandpass"
    bp.frequency.value = 4200 + clamp(strength, 0, 1) * 700
    bp.Q.value = 3
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.055 + clamp(strength, 0, 1) * 0.05, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018)
    src.connect(bp); bp.connect(gain); gain.connect(ctx.destination)
    src.start(now)
}

export function VersionDeck({
    versions,
    areaId,
    currentId,
    onSelect,
    sound = true,
}: {
    versions: Version[]
    areaId: string
    currentId: string | null
    onSelect: (id: string) => void
    sound?: boolean
}) {
    const cardRef = useRef<HTMLDivElement>(null)
    const screenRef = useRef<HTMLDivElement>(null)
    const listRef = useRef<HTMLDivElement>(null)
    const rowRefs = useRef<(HTMLDivElement | null)[]>([])
    const offset = useRef(0)
    const velocity = useRef(0)
    const snapTarget = useRef<number | null>(null)
    const lastDetent = useRef(0)
    const dragging = useRef(false)
    const lastY = useRef(0)
    const lastT = useRef(0)
    const audio = useRef<AudioContext | null>(null)
    const [active, setActive] = useState(0)
    const [cycling, setCycling] = useState(false)

    const n = versions.length
    const shown = versions[active]

    /* --- sound ------------------------------------------------------- */
    const click = useCallback(
        (strength: number) => {
            if (!sound) return
            try {
                if (!audio.current) {
                    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
                    audio.current = new Ctx()
                }
                const ctx = audio.current
                if (ctx.state === "suspended") ctx.resume().then(() => playClick(ctx, strength)).catch(() => {})
                else playClick(ctx, strength)
            } catch {
                /* no audio available; the deck still works silently */
            }
        },
        [sound],
    )

    // Browsers only allow audio after a gesture, so unlock on the first one.
    useEffect(() => {
        const unlock = () => {
            const ctx = audio.current
            if (ctx?.state === "suspended") ctx.resume().catch(() => {})
        }
        window.addEventListener("pointerdown", unlock, { once: true })
        return () => window.removeEventListener("pointerdown", unlock)
    }, [])

    /* --- coverflow render loop --------------------------------------- */
    useEffect(() => {
        if (!n) return
        let raf = 0
        const frame = () => {
            const centre = offset.current / ROW_HEIGHT
            rowRefs.current.forEach((el, i) => {
                if (!el) return
                const d = i - centre
                const abs = Math.abs(d)
                // Distance from centre drives lean, scale, fade and depth --
                // the wide-angle read that makes it a wheel rather than a list.
                el.style.transform =
                    `translateY(${d * ROW_HEIGHT}px) translateZ(${-abs * 22}px) ` +
                    `rotateX(${clamp(d * 11, -26, 26)}deg) scale(${clamp(1 - abs * 0.11, 0.7, 1)})`
                el.style.opacity = String(clamp(1 - abs * 0.36, 0, 1))
                el.style.pointerEvents = abs < 0.5 ? "auto" : "none"
                el.style.zIndex = String(100 - Math.round(abs * 10))
            })
            const near = clamp(Math.round(centre), 0, n - 1)
            setActive((p) => (p === near ? p : near))
            raf = requestAnimationFrame(frame)
        }
        raf = requestAnimationFrame(frame)
        return () => cancelAnimationFrame(raf)
    }, [n])

    /* --- momentum physics -------------------------------------------- */
    useEffect(() => {
        if (!n) return
        let raf = 0
        const step = () => {
            if (snapTarget.current !== null) {
                offset.current += (snapTarget.current - offset.current) * 0.22
                if (Math.abs(snapTarget.current - offset.current) < 0.4) {
                    offset.current = snapTarget.current
                    snapTarget.current = null
                }
            } else if (!dragging.current) {
                offset.current += velocity.current
                velocity.current *= 0.93
                if (Math.abs(velocity.current) < 0.02) velocity.current = 0
            }
            offset.current = clamp(offset.current, -ROW_HEIGHT * 0.5, (n - 1) * ROW_HEIGHT + ROW_HEIGHT * 0.5)

            const detent = Math.round(offset.current / ROW_HEIGHT)
            if (detent !== lastDetent.current) {
                lastDetent.current = detent
                click(clamp(Math.abs(velocity.current) / ROW_HEIGHT, 0.15, 1))
            }
            raf = requestAnimationFrame(step)
        }
        raf = requestAnimationFrame(step)
        return () => cancelAnimationFrame(raf)
    }, [n, click])

    /* --- input, scoped to the list ----------------------------------- */
    useEffect(() => {
        const el = listRef.current
        if (!el || !n) return
        const onWheel = (e: WheelEvent) => {
            e.preventDefault()
            snapTarget.current = null
            velocity.current = clamp(velocity.current + e.deltaY * 0.04, -12, 12)
        }
        const onDown = (e: PointerEvent) => {
            dragging.current = true
            snapTarget.current = null
            velocity.current = 0
            lastY.current = e.clientY
            lastT.current = performance.now()
        }
        const onMove = (e: PointerEvent) => {
            if (!dragging.current) return
            const dy = lastY.current - e.clientY
            offset.current += dy
            const t = performance.now()
            velocity.current = (dy / Math.max(1, t - lastT.current)) * 15
            lastY.current = e.clientY
            lastT.current = t
        }
        const onUp = () => {
            dragging.current = false
        }
        el.addEventListener("wheel", onWheel, { passive: false })
        el.addEventListener("pointerdown", onDown)
        window.addEventListener("pointermove", onMove)
        window.addEventListener("pointerup", onUp)
        return () => {
            el.removeEventListener("wheel", onWheel)
            el.removeEventListener("pointerdown", onDown)
            window.removeEventListener("pointermove", onMove)
            window.removeEventListener("pointerup", onUp)
        }
    }, [n])

    /* --- the tilting screen ------------------------------------------ */
    const onCardMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (prefersReducedMotion()) return
        const rect = cardRef.current?.getBoundingClientRect()
        const el = screenRef.current
        if (!rect || !el) return
        const px = (e.clientX - rect.left) / rect.width - 0.5
        const py = (e.clientY - rect.top) / rect.height - 0.5
        el.style.transition = "transform 0.05s linear"
        el.style.transform = `scale(1.06) rotateY(${px * 22}deg) rotateX(${-py * 17}deg)`
    }, [])

    const onCardLeave = useCallback(() => {
        const el = screenRef.current
        if (!el) return
        el.style.transition = "transform 0.6s cubic-bezier(.2,.8,.2,1)"
        el.style.transform = "scale(1.06) rotateY(0deg) rotateX(0deg)"
    }, [])

    /* --- controls ----------------------------------------------------- */
    const goStep = (dir: 1 | -1) => {
        velocity.current = 0
        snapTarget.current = clamp(Math.round(offset.current / ROW_HEIGHT) + dir, 0, n - 1) * ROW_HEIGHT
        click(0.5)
    }

    // "Play" walks the deck through every run, one per beat.
    useEffect(() => {
        if (!cycling || !n) return
        const id = setInterval(() => {
            const next = mod(Math.round(offset.current / ROW_HEIGHT) + 1, n)
            snapTarget.current = next * ROW_HEIGHT
            click(0.4)
        }, 1400)
        return () => clearInterval(id)
    }, [cycling, n, click])

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); goStep(1) }
        else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); goStep(-1) }
        else if (e.key === " " || e.key === "Enter") { e.preventDefault(); setCycling((c) => !c) }
    }

    if (!n) return null

    return (
        <div
            ref={cardRef}
            onPointerMove={onCardMove}
            onPointerLeave={onCardLeave}
            onKeyDown={onKeyDown}
            tabIndex={0}
            role="application"
            aria-label={`Run history. Showing ${shown?.label}. Arrow keys change run, space cycles.`}
            className="relative aspect-square w-full overflow-hidden rounded-2xl ring-1 ring-white/12"
            style={{ perspective: "1700px", transformStyle: "preserve-3d" }}
        >
            {/* the screen: the model, tilting in 3D behind everything */}
            <div
                ref={screenRef}
                className="absolute inset-0 bg-black/45"
                style={{ transform: "scale(1.06)", transformStyle: "preserve-3d" }}
            >
                <CorridorModel
                    areaId={areaId}
                    vc={shown?.result?.vc ?? null}
                    corridors={shown?.result?.corridors}
                    className="h-full w-full"
                    fill
                />
            </div>
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                    background:
                        "radial-gradient(ellipse 85% 85% at 50% 50%, transparent 52%, rgba(0,4,14,0.6) 100%), linear-gradient(180deg, rgba(3,5,14,0.15) 0%, rgba(3,5,14,0) 26%, rgba(3,5,14,0.35) 58%, rgba(3,5,14,0.9) 100%)",
                }}
            />

            {/* the coverflow */}
            <div
                ref={listRef}
                className="absolute inset-x-0 bottom-[104px] h-[46%] overflow-hidden"
                style={{
                    perspective: "1400px",
                    perspectiveOrigin: "50% 30%",
                    touchAction: "none",
                    maskImage:
                        "linear-gradient(to bottom, transparent 0%, black 24%, black 76%, transparent 100%)",
                    WebkitMaskImage:
                        "linear-gradient(to bottom, transparent 0%, black 24%, black 76%, transparent 100%)",
                }}
            >
                <div className="absolute inset-x-0 top-[30%] h-0" style={{ transformStyle: "preserve-3d" }}>
                    {versions.map((v, i) => (
                        <div
                            key={v.id}
                            ref={(el) => { rowRefs.current[i] = el }}
                            className="absolute inset-x-0 flex items-center gap-3 px-6"
                            style={{ height: ROW_HEIGHT }}
                        >
                            <button
                                onClick={() => onSelect(v.id)}
                                className="flex w-full items-center gap-3 text-left"
                            >
                                <span className="tabular w-10 shrink-0 font-mono text-xl text-white">
                                    {v.result?.civic.value ?? "··"}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate font-pixel text-[11px] tracking-[0.12em] text-white">
                                        {v.label}
                                    </span>
                                    <span className="block truncate text-[10px] text-white/60">
                                        {v.actions.length === 0
                                            ? "baseline"
                                            : `${v.actions.length} change${v.actions.length > 1 ? "s" : ""}`}
                                    </span>
                                </span>
                                {v.id === currentId && (
                                    <span className="shrink-0 rounded border border-white/40 px-1.5 py-0.5 font-mono text-[9px] text-white/80">
                                        SHOWN
                                    </span>
                                )}
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* controls */}
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-4 px-6 pb-5">
                <div className="min-w-0 flex-1">
                    <div className="truncate font-pixel text-[11px] tracking-[0.14em] text-white">
                        {shown?.label}
                    </div>
                    <div className="truncate text-[10px] text-white/60">
                        {shown?.result ? `Civic impact ${shown.result.civic.value}` : "no result"}
                    </div>
                </div>
                <button onClick={() => goStep(-1)} aria-label="Previous run" className="text-white/75 hover:text-white">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 5v14l-11-7zM6 5h2v14H6z" /></svg>
                </button>
                <button
                    onClick={() => setCycling((c) => !c)}
                    aria-label={cycling ? "Stop cycling runs" : "Cycle through runs"}
                    className="grid h-10 w-10 place-content-center rounded-full bg-white text-black"
                >
                    {cycling ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
                    ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                    )}
                </button>
                <button onClick={() => goStep(1)} aria-label="Next run" className="text-white/75 hover:text-white">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M5 5v14l11-7zM16 5h2v14h-2z" /></svg>
                </button>
            </div>
        </div>
    )
}
