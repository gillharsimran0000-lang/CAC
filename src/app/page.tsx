"use client"

/**
 * The opening.
 *
 * Hero, then the method, then the way in. The scrollytelling section uses the
 * sticky-column pattern -- one pinned panel while the explanation scrolls past
 * it -- because the method has a fixed subject (the state) and a sequence of
 * things to say about it, which is exactly what sticky positioning is for.
 *
 * Everything quoted below is a real figure from the pipeline, not copy. If the
 * data changes, these numbers change with it.
 */

import { useEffect, useState } from "react"
import { ReactLenis } from "lenis/react"
import CivicHero from "@/components/hero/CivicHero"
import { StateGallery } from "@/components/gallery/StateGallery"
import { PlaceBand } from "@/components/gallery/PlaceBand"
import { CountyStrip } from "@/components/gallery/CountyStrip"
import { LimitBand } from "@/components/gallery/LimitBand"
import { ProvenanceTag } from "@/components/ui/Provenance"
import { Reveal } from "@/components/ui/Reveal"
import { BlurIn, Magnetic, ScrollProgress, Spotlight } from "@/components/ui/motion"

const METHOD = [
    {
        step: "01",
        title: "Real network",
        body: "39,575 OpenStreetMap ways across Arkansas, split at every junction into a routable graph. Lane counts and speed limits are used where OSM has them and derived from Highway Capacity Manual class defaults where it does not, and which is which is recorded per edge.",
        stat: "30,148 routable edges",
        level: "verified" as const,
    },
    {
        step: "02",
        title: "Real people",
        body: "Population and housing come from the 2020 Decennial Census, a full enumeration rather than a survey estimate. Summed over the state it reproduces the published total of 3,011,524 exactly, and the pipeline refuses to build if it ever stops matching.",
        stat: "3,011,524 residents · 2,294 block groups",
        level: "verified" as const,
    },
    {
        step: "03",
        title: "Real method",
        body: "Trips are generated per resident, distributed by a gravity model calibrated against a stated target journey, and assigned to the network in capacity-restrained slices using the Bureau of Public Roads volume-delay curve. The same method regional planning agencies run, at a smaller scale.",
        stat: "BPR α=0.15 β=4 · HCM stress at v/c 0.85",
        level: "modelled" as const,
    },
    {
        step: "04",
        title: "Real standard",
        body: "Emergency access is measured against NFPA 1710, the 240-second first-engine travel time career departments are actually held to. Response times run on congested speeds, so growth reaches the ambulance the same way it reaches the commuter.",
        stat: "1,731 facilities · 240 s threshold",
        level: "verified" as const,
    },
    {
        step: "05",
        title: "Honest limits",
        body: "Infrastructure unit costs are placeholders and are labelled DEMO everywhere they appear. Statewide traffic is coarse, because county-sized zones over-disperse trips no matter how they are calibrated. Both are said plainly rather than hidden behind a confident number.",
        stat: "every value carries its provenance",
        level: "demo" as const,
    },
]

const FEATURES = [
    {
        t: "Decision DNA",
        d: "Five axes (transportation, emergency access, infrastructure capacity, growth efficiency, burden) as one shape you can recognise at a glance. The axes are tested for independence: if any two correlate above 0.9 across a 100-scenario sweep, the build fails.",
        span: "md:col-span-7",
    },
    {
        t: "Consequence chain",
        d: "Residents to trips to corridors to response times to cost to score, revealed in causal order. Click any step to see the arithmetic, the inputs, and the affected corridors by name.",
        span: "md:col-span-5 md:pt-10",
    },
    {
        t: "Decision history",
        d: "Every run is kept with its result and can be restored. Restoring branches rather than overwrites, so the timeline is a record of experiments instead of an undo stack.",
        span: "md:col-span-6 md:col-start-4",
    },
]

export default function Home() {
    /* Lenis smooths and carries the scroll, which is scroll-hijacking by
       another name and a known vestibular trigger. The blanket rule in
       globals.css cannot switch it off, because none of this is a CSS
       transition. Readers who asked for reduced motion get the browser's own
       scrolling instead.

       Resolved after mount rather than during render, so the server and the
       first client pass agree on the markup. */
    const [smooth, setSmooth] = useState(true)
    useEffect(() => {
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
        const apply = () => setSmooth(!mq.matches)
        apply()
        mq.addEventListener("change", apply)
        return () => mq.removeEventListener("change", apply)
    }, [])

    const content = (
            <main id="main" className="bg-ink-950">
                <ScrollProgress />
                <CivicHero />

                {/* The place, then the abstraction of it. This order matters:
                    the gallery below draws networks over photographs, and that
                    composite only reads if the photographs came first. */}
                <PlaceBand />

                <StateGallery />

                {/* --- method --- */}
                <section className="relative mx-auto max-w-6xl px-6 py-24">
                    <div className="grid gap-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                        <div className="lg:sticky lg:top-24 lg:h-fit">
                            <h2 className="font-display" style={{ fontSize: "clamp(40px, 5vw, 88px)" }}>
                                <span className="text-paper-400">Not a</span>
                                <br />
                                <span className="text-paper-100">planning form</span>
                            </h2>
                            <p className="mt-5 max-w-sm text-[13px] leading-relaxed text-paper-300">
                                Most civic tools ask you to fill in fields and hand back a score
                                you cannot check. CivicFlow shows the chain: you change one thing,
                                and every step between that change and its consequence is on screen
                                and open to inspection.
                            </p>
                            <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-paper-400">
                                No conclusion here is written by a language model. Every sentence in
                                the results is a template filled from a number the simulation
                                produced.
                            </p>
                            <a
                                href="/lab"
                                className="mt-8 inline-block rounded bg-accent px-5 py-2.5 font-pixel text-[12px] tracking-[0.14em] text-ink-950 transition-opacity hover:opacity-90"
                            >
                                OPEN THE LAB
                            </a>
                        </div>

                        <ol className="space-y-px">
                            {METHOD.map((m, i) => (
                                <Reveal
                                    as="li"
                                    key={m.step}
                                    delay={i * 70}
                                    className="border-t border-ink-800 py-8 first:border-t-0 first:pt-0"
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="font-mono text-[10px] text-paper-400">{m.step}</span>
                                        <h3 className="font-display-md text-paper-100" style={{ fontSize: "clamp(19px, 1.7vw, 26px)" }}>
                                            {m.title}
                                        </h3>
                                        <span className="ml-auto">
                                            <ProvenanceTag level={m.level} compact />
                                        </span>
                                    </div>
                                    <p className="mt-3 text-[13px] leading-relaxed text-paper-300">
                                        {m.body}
                                    </p>
                                    <p className="tabular mt-3 font-mono text-[11px] text-accent">
                                        {m.stat}
                                    </p>
                                </Reveal>
                            ))}
                        </ol>
                    </div>
                </section>

                {/* --- three features --- */}
                <section className="border-t border-ink-800 bg-ink-900/40">
                    <div className="mx-auto max-w-6xl px-6 py-20">
                        <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-400">
                            What you get back
                        </h2>
                        {/* Word-by-word, in reading order. The product is a
                            thing that resolves step by step, and the headline
                            introducing it may as well behave the same way. */}
                        <BlurIn
                            as="p"
                            className="font-display mt-4 max-w-[18ch] text-paper-100"
                            style={{ fontSize: "clamp(28px, 3.4vw, 54px)" }}
                        >
                            Three things a score alone cannot tell you.
                        </BlurIn>
                        {/* Deliberately not three equal columns. Each of these is
                            a different size of idea, and giving them identical
                            boxes flattens that; the offsets and spans let the
                            first one lead and the last one sit quietly. */}
                        <div className="mt-10 grid gap-x-10 gap-y-14 md:grid-cols-12">
                            {FEATURES.map((f, i) => (
                                <Reveal
                                    key={f.t}
                                    delay={i * 90}
                                    className={f.span}
                                >
                                  <Spotlight className="-m-4 rounded-lg p-4">
                                    <div className="relative flex items-start gap-4">
                                        <span className="tabular mt-1 font-mono text-[11px] text-paper-400">
                                            {String(i + 1).padStart(2, "0")}
                                        </span>
                                        <div>
                                            <h3 className="font-display-md text-paper-100" style={{ fontSize: "clamp(22px, 2.2vw, 34px)" }}>
                                                {f.t}
                                            </h3>
                                            <p className="mt-3 max-w-[62ch] text-[13px] leading-relaxed text-paper-300">
                                                {f.d}
                                            </p>
                                        </div>
                                    </div>
                                  </Spotlight>
                                </Reveal>
                            ))}
                        </div>
                    </div>
                </section>

                <CountyStrip />

                <LimitBand />

                <section className="grid border-t border-ink-800 md:grid-cols-[1.3fr_1fr]">
                    <div className="bg-paper-100 px-8 py-16 sm:px-14">
                        <p className="font-display max-w-[16ch] text-ink-950" style={{ fontSize: "clamp(32px, 4vw, 68px)" }}>
                            <span className="text-ink-600">Change one thing.</span>{" "}
                            <span>Watch it travel.</span>
                        </p>
                        {/* The one control this whole page exists to get
                            someone to press, so it is the one that leans
                            toward the cursor. */}
                        <Magnetic
                            href="/lab"
                            className="group mt-8 inline-flex items-center gap-3 rounded-md bg-ink-950 px-7 py-4 text-[14px] font-medium text-paper-100"
                        >
                            Open the lab
                            <span className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">↗</span>
                        </Magnetic>
                    </div>
                    <div className="grid gap-6 bg-[#f4f5f7] px-8 py-16 sm:px-10">
                        {[
                            ["3,011,524", "residents, counted in the 2020 Census"],
                            ["30,148", "modelled road edges across Arkansas"],
                            ["1,731", "fire stations, hospitals and ambulance stations"],
                        ].map(([n, d]) => (
                            <div key={n}>
                                <div className="tabular font-display-md text-ink-950" style={{ fontSize: "clamp(24px, 2.4vw, 36px)" }}>
                                    {n}
                                </div>
                                <p className="mt-1 max-w-[30ch] text-[12px] leading-relaxed text-ink-600">{d}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <footer className="border-t border-ink-800 px-6 py-10">
                    <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 font-mono text-[10px] text-paper-400">
                        <a
                            href="/methodology"
                            className="text-paper-200 underline decoration-ink-600 underline-offset-4 transition-colors hover:text-accent"
                        >
                            How CivicFlow thinks: the full methodology
                        </a>
                        <span>Road data © OpenStreetMap contributors, ODbL</span>
                        <span>Population: US Census Bureau, 2020 Decennial Census</span>
                        <span>Standards: NFPA 1710, Highway Capacity Manual, BPR 1964</span>
                    </div>
                </footer>
        </main>
    )

    return smooth ? <ReactLenis root>{content}</ReactLenis> : content
}
