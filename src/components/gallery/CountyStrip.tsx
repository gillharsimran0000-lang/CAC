"use client"

/**
 * SEVENTY-FIVE COUNTIES, MOVING.
 *
 * The claim this page makes is coverage: not a demo of one metro, the whole
 * state. A static grid of seventy-five names would prove it and nobody would
 * read past the first row. A strip that keeps arriving proves the same thing as
 * a feeling -- it does not end -- and costs one line of vertical space.
 *
 * Every item is real: name and 2020 population straight from the hero payload,
 * ordered by population so the strip opens on the counties a reader recognises.
 * The three with a photograph in this page's gallery are marked, which is the
 * only reason the row is interactive at all.
 *
 * Two rows travelling in opposite directions. One row reads as a ticker; two
 * reads as a field, and the opposition is what stops the eye locking on to a
 * single item and tracking it off screen.
 *
 * Beneath them, the same claim in photographs. The names prove the coverage and
 * the photographs prove the names are places: forty of the counties in the strip
 * have a real, freely licensed photograph in the manifest, and they run past at
 * a different speed so the two rows do not read as one repeated idea. Every
 * photograph carries its own credit, which is the reason the tiles are the
 * `Photograph` component rather than an `img`.
 */

import { useEffect, useMemo, useState } from "react"
import { Marquee, Photograph } from "@/components/ui/motion"
import { PHOTOS } from "@/data/photos"
import { HeroBundle, loadHero } from "./heroData"

export function CountyStrip() {
    const [bundle, setBundle] = useState<HeroBundle | null>(null)

    useEffect(() => {
        let live = true
        loadHero().then((b) => live && setBundle(b))
        return () => {
            live = false
        }
    }, [])

    const photographed = useMemo(() => new Set(PHOTOS.map((p) => p.county)), [])

    const counties = useMemo(() => {
        if (!bundle) return []
        return [...bundle.data.counties].sort((a, b) => b.population - a.population)
    }, [bundle])

    // Split into two rows that travel against each other.
    const half = Math.ceil(counties.length / 2)
    const rows = [counties.slice(0, half), counties.slice(half)]

    return (
        <section className="overflow-hidden border-t border-ink-800 bg-ink-950 py-16">
            <div className="mx-auto mb-8 max-w-6xl px-6">
                <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-400">
                    Coverage
                </h2>
                <p className="mt-3 max-w-[60ch] text-[13px] leading-relaxed text-paper-300">
                    All seventy-five counties are in the graph, with their 2020 population and
                    their share of the 30,148 routable edges. Northwest Arkansas and Little Rock
                    have their own higher-resolution models; the rest are modelled at county
                    scale, which is stated plainly in the limits rather than hidden.
                </p>
            </div>

            {counties.length === 0 ? (
                // Reserve the height so the section does not jump when data lands.
                <div className="space-y-3 px-6">
                    <div className="skeleton h-11 w-full" />
                    <div className="skeleton h-11 w-full" />
                </div>
            ) : (
                <div className="space-y-3">
                    {rows.map((row, i) => (
                        <Marquee key={i} speed={i === 0 ? 90 : 110} reverse={i === 1}>
                            {row.map((c) => {
                                const hasPhoto = photographed.has(c.name)
                                return (
                                    <div
                                        key={c.name}
                                        className={[
                                            "flex shrink-0 items-baseline gap-2.5 rounded-md border px-3.5 py-2.5",
                                            hasPhoto
                                                ? "border-ink-600 bg-ink-850"
                                                : "border-ink-800 bg-ink-900",
                                        ].join(" ")}
                                    >
                                        <span className="whitespace-nowrap text-[12px] text-paper-200">
                                            {c.name}
                                        </span>
                                        <span className="tabular font-mono text-[10px] text-paper-400">
                                            {c.population.toLocaleString()}
                                        </span>
                                        {hasPhoto && (
                                            <span
                                                className="h-1 w-1 shrink-0 rounded-full bg-wheat-500"
                                                title="photographed in the gallery above"
                                                aria-hidden
                                            />
                                        )}
                                    </div>
                                )
                            })}
                        </Marquee>
                    ))}
                </div>
            )}

            {/* --- the same counties, photographed --- */}
            <div className="mx-auto mb-6 mt-16 max-w-6xl px-6">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-400">
                    The ground underneath
                </h3>
                <p className="mt-3 max-w-[60ch] text-[13px] leading-relaxed text-paper-300">
                    {PHOTOS.length} photographs of {photographed.size} Arkansas counties, every one
                    of them a real place the model runs over. Downtown squares, courthouses, river
                    crossings, the Ozarks and the Delta. Photographer and licence are on each tile.
                </p>
            </div>

            <Marquee speed={150}>
                {PHOTOS.map((p) => (
                    <figure
                        key={p.slug}
                        className="group relative aspect-[4/3] w-[220px] shrink-0 overflow-hidden rounded-lg border border-ink-800"
                    >
                        <Photograph
                            photo={p}
                            fill
                            parallax={0}
                            hoverZoom
                            className="brightness-[0.72] transition-[filter] duration-500 group-hover:brightness-100"
                        />
                        <div
                            aria-hidden
                            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
                            style={{ background: "linear-gradient(180deg, rgba(6,7,10,0), rgba(6,7,10,0.9))" }}
                        />
                        <figcaption className="absolute inset-x-0 bottom-0 p-3">
                            <div className="text-[12px] leading-tight text-paper-100">{p.place}</div>
                            <div className="font-mono text-[9.5px] uppercase tracking-wider text-wheat-400">
                                {p.county} County
                            </div>
                        </figcaption>
                    </figure>
                ))}
            </Marquee>
        </section>
    )
}
