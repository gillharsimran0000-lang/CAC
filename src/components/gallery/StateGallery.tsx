"use client"

/**
 * THE STATE, TILE BY TILE.
 *
 * The sticky-column gallery pattern, with each tile built in two layers: a
 * photograph of the place, and the live network render of that same place drawn
 * over it.
 *
 * The photographs are not stock imagery, which would have broken the rule the
 * project rests on. Each one is a real photograph of the specific town whose
 * network is drawn on top of it, sourced from Wikimedia Commons under a licence
 * that permits reuse, and joined to that county's actual figures -- population
 * from the Census, segments and stress from the model. The photograph answers a
 * question the abstract render cannot: Emma Avenue in Springdale is four lanes
 * of small-town main street, and knowing that changes how you read a v/c number
 * on it.
 *
 * The network is composited in `screen` blend so the lines sit in the
 * photograph's light rather than on a card above it, and the photograph is held
 * dark and desaturated until hover so the modelled layer stays the thing being
 * read. Photographer and licence are rendered from the same record that
 * produced the file. See scripts/build-photos.mjs.
 *
 * The middle column pins while the outer two scroll past it. That is the whole
 * point of the pattern and it happens to suit the content: the statewide totals
 * are the constant, and the places are what move against them.
 *
 * Tiles render only once they are near the viewport, and only once. Drawing
 * thirteen copies of a 17,562-edge network eagerly would cost about a quarter of
 * a million path operations before the reader has scrolled anywhere.
 */

import { useEffect, useRef, useState } from "react"
import { fitBbox, renderNetwork } from "@/render/network"
import { HeroBundle, loadHero, windowStats } from "./heroData"
import { Reveal } from "@/components/ui/Reveal"
import { Credit, Photograph } from "@/components/ui/motion"
import { photo as findPhoto } from "@/data/photos"
import { useCountUp, useInView } from "@/lib/motion"

/** Places worth a tile, with the window each one is framed in. */
interface Subject {
    name: string
    centre: [number, number]
    span: number
    note: string
    /** Slug in src/data/photos.ts. The photograph must be OF this county. */
    photo: string
}

/* Nine a side rather than five.
   
   The section's claim is the whole state, and ten tiles clustered on the two
   metros and three regional cities was making that claim with the evidence for
   a smaller one. These are the counties the photograph manifest can actually
   support, which is the only constraint: a tile whose photograph is not OF that
   county would break the join the whole section rests on. */
const LEFT: Subject[] = [
    { name: "Pulaski", centre: [-92.33, 34.75], span: 0.52, note: "Little Rock · the capital" , photo: "little-rock" },
    { name: "Benton", centre: [-94.22, 36.35], span: 0.44, note: "Bentonville · Rogers" , photo: "bentonville" },
    { name: "Washington", centre: [-94.15, 35.99], span: 0.44, note: "Fayetteville · Springdale" , photo: "fayetteville" },
    { name: "Sebastian", centre: [-94.32, 35.30], span: 0.44, note: "Fort Smith · the western edge" , photo: "fort-smith" },
    { name: "Craighead", centre: [-90.66, 35.83], span: 0.52, note: "Jonesboro · the delta" , photo: "jonesboro" },
    { name: "Jefferson", centre: [-91.95, 34.24], span: 0.55, note: "Pine Bluff · the Arkansas River" , photo: "pine-bluff" },
    { name: "Pope", centre: [-93.09, 35.35], span: 0.55, note: "Russellville · Lake Dardanelle" , photo: "russellville" },
    { name: "Crittenden", centre: [-90.28, 35.17], span: 0.44, note: "West Memphis · the I-40 crossing" , photo: "west-memphis" },
    { name: "Carroll", centre: [-93.66, 36.35], span: 0.48, note: "Eureka Springs" , photo: "eureka-springs" },
]

const RIGHT: Subject[] = [
    { name: "Faulkner", centre: [-92.35, 35.15], span: 0.44, note: "Conway · the I-40 commute" , photo: "conway" },
    { name: "Garland", centre: [-93.15, 34.55], span: 0.48, note: "Hot Springs" , photo: "hot-springs" },
    { name: "White", centre: [-91.75, 35.25], span: 0.55, note: "Searcy" , photo: "searcy" },
    { name: "Union", centre: [-92.65, 33.20], span: 0.55, note: "El Dorado · the southern line" , photo: "el-dorado" },
    { name: "Mississippi", centre: [-90.05, 35.75], span: 0.55, note: "Blytheville · the river" , photo: "blytheville" },
    { name: "Miller", centre: [-93.88, 33.47], span: 0.5, note: "Texarkana · the Texas line" , photo: "texarkana" },
    { name: "Boone", centre: [-93.08, 36.28], span: 0.48, note: "Harrison · the Ozark plateau" , photo: "harrison" },
    { name: "Crawford", centre: [-94.25, 35.55], span: 0.48, note: "Van Buren · the I-40 corridor" , photo: "van-buren" },
    { name: "Independence", centre: [-91.60, 35.75], span: 0.52, note: "Batesville · the White River" , photo: "batesville" },
]

export function StateGallery() {
    const [bundle, setBundle] = useState<HeroBundle | null>(null)

    useEffect(() => {
        let live = true
        loadHero().then((b) => live && setBundle(b))
        return () => {
            live = false
        }
    }, [])

    return (
        <section className="relative w-full bg-ink-950">
            {/* --- pinned opening --- */}
            <div className="sticky top-0 grid h-dvh w-full place-content-center overflow-hidden">
                {/* Drafting grid, masked to a soft ellipse so it fades rather than
                    ending on a hard edge. */}
                <div
                    className="absolute inset-0 bg-[linear-gradient(to_right,#2a314033_1px,transparent_1px),linear-gradient(to_bottom,#2a314033_1px,transparent_1px)] bg-[size:54px_54px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"
                    aria-hidden
                />
                <div className="relative px-8 text-center">
                    <h2 className="font-display" style={{ fontSize: "clamp(46px, 8vw, 150px)" }}>
                        <span className="text-paper-100">Seventy-five counties</span>
                        <br />
                        <span className="text-clay-400">one network</span>
                    </h2>
                    <p className="mx-auto mt-6 max-w-xl text-[13px] leading-relaxed text-paper-300">
                        Each tile is a photograph of a real Arkansas town with its own road
                        network drawn over it, coloured by the same modelled volume-to-capacity
                        the simulator reports. Nothing here is an illustration.
                    </p>
                </div>
            </div>

            {/* --- the gallery --- */}
            {/* Opaque, and it has to be: the opening panel above is still
                pinned behind this grid, and without a ground of its own its
                headline shows through the 8px gutters between tiles. */}
            <div className="relative grid grid-cols-1 gap-2 bg-ink-950 px-2 pb-2 md:grid-cols-12">
                <div className="grid gap-2 md:col-span-4">
                    {LEFT.map((s, i) => (
                        <Reveal key={s.name} delay={i * 60}>
                            <Tile subject={s} bundle={bundle} />
                        </Reveal>
                    ))}
                </div>

                <div className="grid gap-2 md:sticky md:top-0 md:col-span-4 md:h-dvh md:grid-rows-3">
                    <PinnedStat
                        label="RESIDENTS"
                        value={bundle?.data.totals.population ?? null}
                        format={(v) => Math.round(v).toLocaleString()}
                        note="2020 Decennial Census, counted not estimated"
                        tone="wheat"
                    />
                    <PinnedStat
                        label="SEGMENTS OVER 0.85 v/c"
                        value={bundle?.data.counts.stressedEdges ?? null}
                        format={(v) => Math.round(v).toLocaleString()}
                        note={`of ${bundle?.data.counts.edges.toLocaleString() ?? "…"} modelled, at the HCM C/D boundary`}
                        tone="clay"
                    />
                    <PinnedStat
                        label="WITHIN 4 MINUTES"
                        value={bundle?.data.totals.emergencySharePct ?? null}
                        format={(v) => `${v.toFixed(1)}%`}
                        note="of an engine, NFPA 1710, on congested speeds"
                        tone="pine"
                    />
                </div>

                <div className="grid gap-2 md:col-span-4">
                    {RIGHT.map((s, i) => (
                        <Reveal key={s.name} delay={i * 60}>
                            <Tile subject={s} bundle={bundle} />
                        </Reveal>
                    ))}
                </div>
            </div>
        </section>
    )
}

/* --- one place --- */

function Tile({ subject, bundle }: { subject: Subject; bundle: HeroBundle | null }) {
    const wrapRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const drawn = useRef(false)
    const [near, setNear] = useState(false)
    const [stats, setStats] = useState<{ segments: number; stressed: number; stations: number } | null>(null)
    const pic = findPhoto(subject.photo)

    // Only pay for a tile the reader is about to see.
    useEffect(() => {
        const el = wrapRef.current
        if (!el) return
        const io = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setNear(true)
                    io.disconnect()
                }
            },
            { rootMargin: "300px" },
        )
        io.observe(el)
        return () => io.disconnect()
    }, [])

    useEffect(() => {
        if (!near || !bundle || drawn.current) return
        const canvas = canvasRef.current
        const wrap = wrapRef.current
        if (!canvas || !wrap) return
        /* Transparent, unlike the hero: this canvas is composited over a
           photograph in `screen`, so anything it paints as background would
           wash the photograph out. */
        const ctx = canvas.getContext("2d", { alpha: true })
        if (!ctx) return

        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const w = wrap.clientWidth
        const h = wrap.clientHeight
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`

        const half = subject.span / 2
        const [lon, lat] = subject.centre
        const view = fitBbox([lat - half / 1.24, lon - half, lat + half / 1.24, lon + half], w, h, 1)

        renderNetwork(ctx, bundle.geo, view, {
            reveal: 1,
            stress: 1,
            vc: bundle.vc,
            facilities: bundle.data.facilities.map((lonLat) => ({ lonLat, kind: "fire" })),
            facilityOpacity: 0.75,
            dpr,
        })

        setStats(windowStats(bundle, subject.centre, subject.span))
        drawn.current = true
    }, [near, bundle, subject])

    const county = bundle?.data.counties.find((c) => c.name === subject.name)

    return (
        <figure className="group relative h-80 w-full overflow-hidden rounded-lg border border-ink-800 bg-ink-900 transition-colors duration-300 hover:border-ink-600">
            {/* The place. Held dark and drained of colour so the modelled layer
                on top of it stays the thing being read; hovering a tile is the
                gesture for "show me where this actually is", so the photograph
                comes up to full strength then. */}
            {pic && (
                <Photograph
                    photo={pic}
                    parallax={0.05}
                    fill
                    creditPosition="none"
                    className="saturate-[0.3] brightness-[0.42] transition-[filter] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:saturate-[0.85] group-hover:brightness-[0.72]"
                />
            )}

            {/* The network of that same place, in `screen` so the lines sit in
                the photograph's light instead of on a card above it. */}
            <div
                ref={wrapRef}
                className="absolute inset-0 mix-blend-screen transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03]"
            >
                <canvas ref={canvasRef} className="h-full w-full" aria-hidden />
            </div>

            {/* Legibility floor for the caption, not a mood effect. */}
            <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5"
                style={{ background: "linear-gradient(180deg, rgba(6,7,10,0), rgba(6,7,10,0.55) 45%, rgba(6,7,10,0.95))" }}
                aria-hidden
            />

            <figcaption className="absolute inset-x-0 bottom-0 p-4 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-0.5">
                <div className="flex items-baseline gap-2">
                    <span className="font-display-md text-[19px] text-paper-100">
                        {subject.name}
                    </span>
                    {county && (
                        <span className="tabular font-mono text-[11px] text-wheat-400">
                            {county.population.toLocaleString()}
                        </span>
                    )}
                </div>
                <p className="mt-0.5 text-[11px] text-paper-300">{subject.note}</p>
                {stats && (
                    <dl className="mt-2 flex gap-4 font-mono text-[10px] text-paper-400">
                        <div>
                            <dt className="sr-only">segments in view</dt>
                            <dd className="tabular">{stats.segments.toLocaleString()} segments</dd>
                        </div>
                        <div>
                            <dt className="sr-only">at or over stress</dt>
                            <dd className={`tabular ${stats.stressed > 0 ? "text-flow-tight" : ""}`}>
                                {stats.stressed} over 0.85
                            </dd>
                        </div>
                        <div>
                            <dt className="sr-only">stations in view</dt>
                            <dd className="tabular">{stats.stations} stations</dd>
                        </div>
                    </dl>
                )}
            </figcaption>

            {/* Attribution. Required by the licence, so it renders whether or
                not anyone hovers; it just stays out of the way until then. */}
            {pic && <Credit photo={pic} />}
        </figure>
    )
}

/* --- the constant --- */

const TONE = {
    wheat: { rule: "bg-wheat-500", value: "text-wheat-400" },
    clay: { rule: "bg-clay-500", value: "text-clay-400" },
    pine: { rule: "bg-pine-500", value: "text-pine-500" },
} as const

/**
 * A statewide constant, counting up the first time it is scrolled to.
 *
 * Deferred until the panel is actually in view: a figure that finished counting
 * while it was off screen might as well have been printed.
 */
function PinnedStat({
    label,
    value,
    format,
    note,
    tone,
}: {
    label: string
    value: number | null
    format: (v: number) => string
    note: string
    tone: keyof typeof TONE
}) {
    const t = TONE[tone]
    const { ref, inView } = useInView<HTMLDivElement>()
    // Held at zero until both the data has landed and the panel is on screen.
    const shown = useCountUp(inView && value != null ? value : 0, 900)
    return (
        <div
            ref={ref}
            className="relative flex h-full min-h-40 flex-col justify-center overflow-hidden rounded-lg border border-ink-800 bg-ink-900 p-6"
        >
            <span className={`absolute left-0 top-0 h-full w-0.5 ${t.rule}`} aria-hidden />
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-400">
                {label}
            </div>
            <div className={`tabular font-display mt-2 ${t.value}`} style={{ fontSize: "clamp(30px, 3.2vw, 52px)" }}>
                {value == null ? "…" : format(shown)}
            </div>
            <p className="mt-2 max-w-[26ch] text-[11px] leading-relaxed text-paper-300">{note}</p>
        </div>
    )
}
