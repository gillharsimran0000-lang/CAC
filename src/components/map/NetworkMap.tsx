"use client"

/**
 * The network map.
 *
 * Same renderer as the hero, different arguments. There is no basemap: the road
 * network drawn against dark ground IS the map, which avoids a tile provider
 * entirely and, more usefully, means nothing on screen is decoration. Every line
 * is a modelled object with a capacity and a volume.
 *
 * Colour is always volume-to-capacity, on the Highway Capacity Manual's bands,
 * and it means the same thing here as in the chain and the hero.
 */

import { useEffect, useRef, useState } from "react"
import { DURATION, easeOutQuint, prefersReducedMotion } from "@/lib/motion"
import {
    DrawGeometry,
    Viewport,
    buildDrawGeometry,
    fitBbox,
    renderNetwork,
} from "@/render/network"
import type { RawGraph } from "@/engine/graph"

export interface NetworkMapProps {
    areaId: string
    /** Per-edge v/c from the current run; falls back to the baseline. */
    vc?: number[] | null
    zones?: { centroid: [number, number]; population: number; geoid: string; name: string }[]
    facilities?: { lonLat: [number, number]; kind: string }[]
    /** Zone the user is placing growth in, highlighted. */
    selectedGeoid?: string | null
    onSelectZone?: (geoid: string) => void
}

export function NetworkMap({
    areaId,
    vc,
    zones,
    facilities,
    selectedGeoid,
    onSelectZone,
}: NetworkMapProps) {
    const wrapRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const geoRef = useRef<DrawGeometry | null>(null)
    const viewRef = useRef<Viewport | null>(null)
    // Previous run's v/c, so a new result can be faded in from it.
    const prevVc = useRef<Float32Array | null>(null)
    const fadeRaf = useRef(0)
    const [graph, setGraph] = useState<RawGraph | null>(null)

    useEffect(() => {
        let cancelled = false
        setGraph(null)
        fetch(`/data/${areaId}-graph.json`)
            .then((r) => r.json())
            .then((g: RawGraph) => {
                if (cancelled) return
                geoRef.current = buildDrawGeometry(g)
                setGraph(g)
            })
        return () => {
            cancelled = true
        }
    }, [areaId])

    useEffect(() => {
        const canvas = canvasRef.current
        const wrap = wrapRef.current
        const geo = geoRef.current
        if (!canvas || !wrap || !geo || !graph) return
        const ctx = canvas.getContext("2d", { alpha: false })
        if (!ctx) return

        const vcArray = vc ? Float32Array.from(vc) : undefined

        /**
         * Renders one state of the network into an offscreen buffer.
         *
         * Crossfading between two results means compositing two pictures, and
         * the naive way -- re-rendering the whole network each frame with an
         * interpolated v/c -- would redraw 41,000 edges twelve times for one
         * transition. Rendering each state ONCE into its own buffer and then
         * fading between them with globalAlpha costs two renders total and
         * turns every frame after that into a pair of drawImage calls.
         */
        const renderTo = (target: HTMLCanvasElement, field: Float32Array | undefined, view: Viewport, dpr: number) => {
            const c = target.getContext("2d", { alpha: false })
            if (!c) return
            c.save()
            c.scale(dpr, dpr)
            c.fillStyle = "#06070a"
            c.fillRect(0, 0, view.width, view.height)
            c.restore()
            renderNetwork(c, geo, view, {
                reveal: 1,
                stress: field ? 1 : 0,
                vc: field,
                facilities,
                facilityOpacity: 0.5,
                dpr,
            })
        }

        const draw = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2)
            const w = wrap.clientWidth
            const h = wrap.clientHeight
            canvas.width = Math.round(w * dpr)
            canvas.height = Math.round(h * dpr)
            canvas.style.width = `${w}px`
            canvas.style.height = `${h}px`
            const view = fitBbox(graph.bbox, w, h, 0.94)
            viewRef.current = view

            /* Congestion arrives rather than appearing. Watching the corridor
               flood is what connects the decision to the picture; a hard swap
               leaves the reader to spot the difference between two stills. */
            const previous = prevVc.current
            const changed = vcArray && previous && previous.length === vcArray.length
            if (changed && !prefersReducedMotion()) {
                const before = document.createElement("canvas")
                const after = document.createElement("canvas")
                for (const c of [before, after]) {
                    c.width = canvas.width
                    c.height = canvas.height
                }
                renderTo(before, previous, view, dpr)
                renderTo(after, vcArray, view, dpr)

                const t0 = performance.now()
                const step = () => {
                    const t = Math.min(1, (performance.now() - t0) / DURATION.crossfade)
                    const e = easeOutQuint(t)
                    ctx.save()
                    ctx.globalAlpha = 1
                    ctx.drawImage(before, 0, 0)
                    ctx.globalAlpha = e
                    ctx.drawImage(after, 0, 0)
                    ctx.restore()
                    overlay(view, w, h, dpr)
                    if (t < 1) fadeRaf.current = requestAnimationFrame(step)
                }
                cancelAnimationFrame(fadeRaf.current)
                fadeRaf.current = requestAnimationFrame(step)
            } else {
                renderTo(canvas, vcArray, view, dpr)
                overlay(view, w, h, dpr)
            }
            if (vcArray) prevVc.current = vcArray
        }

        // The selected zone is marked after the network, so it sits on top.
        function overlay(view: Viewport, w: number, h: number, dpr: number) {
            if (!selectedGeoid || !zones) return
            const z = zones.find((x) => x.geoid === selectedGeoid)
            if (!z) return
            const cosLat = Math.cos((view.centerLat * Math.PI) / 180)
            const x = w / 2 + (z.centroid[0] - view.centerLon) * view.scale
            const y = h / 2 - (z.centroid[1] - view.centerLat) * (view.scale / cosLat)
            ctx!.save()
            ctx!.scale(dpr, dpr)
            ctx!.strokeStyle = "#6ea8fe"
            ctx!.lineWidth = 1.5
            ctx!.beginPath()
            ctx!.arc(x, y, 11, 0, Math.PI * 2)
            ctx!.stroke()
            ctx!.fillStyle = "rgba(110,168,254,0.22)"
            ctx!.fill()
            ctx!.restore()
        }

        draw()
        window.addEventListener("resize", draw)
        return () => {
            window.removeEventListener("resize", draw)
            cancelAnimationFrame(fadeRaf.current)
        }
    }, [graph, vc, zones, facilities, selectedGeoid])

    /** Click selects the nearest zone centroid, which is how growth is placed. */
    const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const view = viewRef.current
        if (!view || !zones?.length || !onSelectZone) return
        const rect = e.currentTarget.getBoundingClientRect()
        const px = e.clientX - rect.left
        const py = e.clientY - rect.top
        const cosLat = Math.cos((view.centerLat * Math.PI) / 180)

        let best: string | null = null
        let bestD = Infinity
        for (const z of zones) {
            const x = view.width / 2 + (z.centroid[0] - view.centerLon) * view.scale
            const y = view.height / 2 - (z.centroid[1] - view.centerLat) * (view.scale / cosLat)
            const d = (x - px) ** 2 + (y - py) ** 2
            if (d < bestD) {
                bestD = d
                best = z.geoid
            }
        }
        if (best && bestD < 60 ** 2) onSelectZone(best)
    }

    return (
        <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-ink-950">
            <canvas
                ref={canvasRef}
                onClick={onClick}
                className={onSelectZone ? "cursor-crosshair" : undefined}
            />
            {!graph && (
                <div
                    className="absolute inset-0 grid place-content-center gap-3"
                    aria-busy="true"
                    aria-label="Loading the road network"
                >
                    {/* Suggests the shape of what is coming -- a network, not a
                        document -- rather than a spinner that could mean anything. */}
                    <div className="skeleton h-1 w-56" />
                    <div className="skeleton h-1 w-40" />
                    <div className="skeleton h-1 w-64" />
                    <div className="skeleton h-1 w-32" />
                    <span className="mt-2 font-mono text-[10px] text-paper-400">
                        loading the road network…
                    </span>
                </div>
            )}
            <Legend />
        </div>
    )
}

function Legend() {
    const bands: [string, string][] = [
        ["#3ddc97", "< 0.50"],
        ["#8ed081", "0.50"],
        ["#f2c14e", "0.70"],
        ["#f28f3b", "0.85"],
        ["#e5484d", "≥ 1.00"],
    ]
    return (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded border border-ink-700 bg-ink-950/85 px-2.5 py-2">
            <div className="font-mono text-[9px] uppercase tracking-wider text-paper-400">
                volume / capacity
            </div>
            <div className="mt-1.5 flex items-center gap-0">
                {bands.map(([c]) => (
                    <span key={c} className="h-2 w-7" style={{ background: c }} />
                ))}
            </div>
            <div className="mt-1 flex justify-between font-mono text-[9px] text-paper-400">
                <span>free</span>
                <span>over capacity</span>
            </div>
        </div>
    )
}
