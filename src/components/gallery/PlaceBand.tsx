"use client"

/**
 * ARKANSAS, BEFORE IT IS A NETWORK.
 *
 * The rest of this page is abstraction: graphs, volume-to-capacity ramps,
 * response isochrones. That abstraction is the product, but it has a failure
 * mode -- after enough of it, a corridor at v/c 0.91 stops being a road people
 * sit on and becomes a number that went up. This section exists to spend a
 * screen putting the place back.
 *
 * The photographs are not mood. Each is captioned with the county it was taken
 * in and that county's real 2020 population, read from the same hero payload
 * the gallery and the simulator use, so the caption is a join between a
 * photograph and a figure, not a slogan. If the data changes, the captions
 * change with it.
 *
 * Movement is the point of the composition: three columns at different parallax
 * rates, which is what gives a flat page depth without a single shadow. The
 * middle column is deliberately the slowest, so the eye settles there.
 */

import { useEffect, useState } from "react"
import { photo as findPhoto } from "@/data/photos"
import { BlurIn, DrawRule, Photograph, Tilt } from "@/components/ui/motion"
import { HeroBundle, loadHero } from "./heroData"

/**
 * Photograph, and the county whose figures caption it.
 *
 * Only photographs whose county is unambiguous are here. The landscape shots in
 * the manifest -- the Buffalo, the Ozarks -- are beautiful and cannot be used in
 * this grid: the Buffalo National River runs through four counties and its
 * Commons record carries no coordinates, so captioning one with a county
 * population would be inventing the join this section exists to demonstrate.
 * It appears further down the page instead, where it claims nothing.
 */
const COLUMNS: {
    slug: string
    county: string
    caption: string
    /** Parallax rate. The middle column is slowest, so the eye settles there. */
    rate: number
    /** object-position, where a centre crop would miss the subject. */
    focus?: string
}[][] = [
    [
        { slug: "springdale", county: "Washington", caption: "Emma Avenue, Springdale", rate: 0.1 },
        { slug: "arkansas-river", county: "Pulaski", caption: "The Arkansas River at Little Rock", rate: 0.1 },
        { slug: "pine-bluff", county: "Jefferson", caption: "The courthouse, Pine Bluff", rate: 0.1 },
        { slug: "van-buren", county: "Crawford", caption: "Main Street, Van Buren", rate: 0.1 },
    ],
    [
        { slug: "hot-springs", county: "Garland", caption: "Bathhouse Row, Hot Springs", rate: 0.04 },
        { slug: "rogers", county: "Benton", caption: "Downtown Rogers", rate: 0.04 },
        { slug: "eureka-springs", county: "Carroll", caption: "Downtown Eureka Springs", rate: 0.04 },
        { slug: "batesville", county: "Independence", caption: "East Main Street, Batesville", rate: 0.04 },
    ],
    [
        { slug: "delta", county: "Arkansas", caption: "Rice ground near Stuttgart", rate: 0.12, focus: "center 86%" },
        { slug: "state-capitol", county: "Pulaski", caption: "The State Capitol", rate: 0.12, focus: "center 62%" },
        { slug: "texarkana", county: "Miller", caption: "State Line Avenue, Texarkana", rate: 0.12 },
        { slug: "north-little-rock", county: "Pulaski", caption: "Argenta, North Little Rock", rate: 0.12 },
    ],
]

export function PlaceBand() {
    const [bundle, setBundle] = useState<HeroBundle | null>(null)
    useEffect(() => {
        let live = true
        loadHero().then((b) => live && setBundle(b))
        return () => {
            live = false
        }
    }, [])

    const population = (county: string) =>
        bundle?.data.counties.find((c) => c.name === county)?.population ?? null

    return (
        <section className="relative border-t border-ink-800 bg-ink-950 px-6 py-24">
            <div className="mx-auto max-w-6xl">
                <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] lg:items-end">
                    <div>
                        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-400">
                            Before the abstraction
                        </p>
                        <BlurIn
                            as="h2"
                            className="font-display mt-4 text-paper-100"
                            style={{ fontSize: "clamp(30px, 3.6vw, 56px)" }}
                            delay={80}
                        >
                            Every edge in this model is a street somebody drives.
                        </BlurIn>
                    </div>
                    <p className="max-w-[52ch] text-[13px] leading-relaxed text-paper-300">
                        A corridor at 0.91 volume-to-capacity is not a number that went up. It is
                        a lane of Emma Avenue at five in the afternoon. These are photographs of
                        places the simulator has an opinion about, captioned with what the Census
                        actually counted there, so the two halves of this tool, the place and the
                        figure, are on screen together at least once.
                    </p>
                </div>

                <DrawRule className="mt-12" />

                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
                    {COLUMNS.map((column, ci) => (
                        <div
                            key={ci}
                            className={[
                                "grid gap-3",
                                // The middle column drops, so the three do not read as a
                                // single ruled row. Hidden below md, where a two-column
                                // grid has no middle to offset.
                                ci === 1 ? "md:mt-14" : "",
                                ci === 2 ? "hidden md:grid" : "",
                            ].join(" ")}
                        >
                            {column.map((item) => {
                                const pic = findPhoto(item.slug)
                                if (!pic) return null
                                const pop = population(item.county)
                                return (
                                    <Tilt key={item.slug} max={3}>
                                        {/* Landscape frames, because every source
                                            photograph is landscape: a portrait
                                            crop of a wide photograph throws away
                                            the two thirds of it that hold the
                                            subject. */}
                                        <figure className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-ink-800">
                                            <Photograph
                                                photo={pic}
                                                parallax={item.rate}
                                                focus={item.focus}
                                                fill
                                                hoverZoom
                                                className="brightness-[0.78] transition-[filter] duration-700 group-hover:brightness-100"
                                            />
                                            <div
                                                aria-hidden
                                                className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
                                                style={{ background: "linear-gradient(180deg, rgba(6,7,10,0), rgba(6,7,10,0.9))" }}
                                            />
                                            <figcaption className="absolute inset-x-0 bottom-0 p-3.5">
                                                <div className="text-[12px] text-paper-100">{item.caption}</div>
                                                <div className="tabular mt-0.5 font-mono text-[10px] text-wheat-400">
                                                    {item.county} County
                                                    {pop != null && ` · ${pop.toLocaleString()} residents`}
                                                </div>
                                            </figcaption>
                                        </figure>
                                    </Tilt>
                                )
                            })}
                        </div>
                    ))}
                </div>

                <p className="mt-4 font-mono text-[10px] leading-relaxed text-paper-400">
                    Photographs from Wikimedia Commons under CC0, CC BY, CC BY-SA or public
                    domain; photographer and licence are on each image. Population: US Census
                    Bureau, 2020 Decennial Census.
                </p>
            </div>
        </section>
    )
}
