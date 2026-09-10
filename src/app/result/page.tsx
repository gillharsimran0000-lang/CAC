"use client"

/**
 * THE RESULT.
 *
 * A run now lands on its own page instead of a side panel. That is not only
 * presentation: giving the result a page means it gets a headline, a single
 * dominant object, and room for the reader to stop and take it in before
 * deciding what to try next. A panel competes with the controls that produced
 * it; a page does not.
 *
 * The visual language is taken from the two references -- a rounded field on a
 * dark ground, a headline whose words carry different weights of emphasis, one
 * floating object lit from behind, a hairline-ruled right rail, and a meta strip
 * along the bottom. The one change is that the colour of the field is not a
 * brand choice: it leans pine when the scenario improved on the baseline and
 * clay when it did not, so even the background is reporting the result.
 *
 * Scroll parallax is GSAP ScrollTrigger, driven off the Lenis instance the site
 * already runs, so there is one scroll authority rather than two competing.
 */

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useLab } from "@/state/lab"
import { ResultScrub } from "@/components/model/ResultScrub"
import { ConsequenceChain } from "@/components/chain/ConsequenceChain"
import { DecisionDna, DnaWords } from "@/components/dna/DecisionDna"
import { VersionDeck } from "@/components/scenario/VersionDeck"
import { Priorities } from "@/components/priorities/Priorities"
import { ProvenanceTag } from "@/components/ui/Provenance"
import { useCountUp, prefersReducedMotion } from "@/lib/motion"
import { AXES } from "@/engine/types"
import { axisScores, compositeScore, DEFAULT_WEIGHTS } from "@/engine/metrics"
import { scoreStep } from "@/engine/chain"

export default function ResultPage() {
    const router = useRouter()
    const { area, areaId, versions, currentId, restore } = useLab()
    const weights = useLab((s) => s.weights)
    const hydrateWeights = useLab((s) => s.hydrateWeights)
    const current = versions.find((v) => v.id === currentId) ?? null
    const result = current?.result ?? null
    const rootRef = useRef<HTMLDivElement>(null)

    // A direct visit or a refresh has no run in memory; send them back rather
    // than rendering an empty page that looks broken.
    useEffect(() => {
        if (!area && versions.length === 0) router.replace("/lab")
    }, [area, versions.length, router])

    useEffect(() => {
        hydrateWeights()
    }, [hydrateWeights])

    /* --- parallax ------------------------------------------------------ */
    useEffect(() => {
        if (!result || prefersReducedMotion()) return
        gsap.registerPlugin(ScrollTrigger)

        /* No Lenis here, deliberately. The reveal above scrubs a ScrollTrigger
           against native scroll position; adding smooth-scrolling underneath it
           would mean two systems deciding where the page is, and the reveal
           would drift out of step with the pointer. One authority per page. */
        const ctx = gsap.context(() => {
            const trigger = rootRef.current?.querySelector("[data-parallax-layers]")
            if (!trigger) return
            const tl = gsap.timeline({
                scrollTrigger: { trigger, start: "0% 0%", end: "100% 0%", scrub: 0 },
            })
            // Furthest layer moves least; the headline outruns the model, which
            // is what reads as depth rather than as things sliding.
            const layers = [
                { layer: "1", yPercent: 18 },
                { layer: "3", yPercent: 6 },
                { layer: "4", yPercent: -6 },
            ]
            layers.forEach((l, i) => {
                tl.to(
                    trigger.querySelectorAll(`[data-parallax-layer="${l.layer}"]`),
                    { yPercent: l.yPercent, ease: "none" },
                    i === 0 ? undefined : "<",
                )
            })
        }, rootRef)

        return () => {
            ctx.revert()
        }
    }, [result])

    if (!area || !result) {
        return (
            <main id="main" className="grid min-h-dvh place-content-center">
                <p className="font-mono text-[11px] text-paper-400">no run in memory, returning…</p>
            </main>
        )
    }

    /* The composite is the one figure on this page that depends on a value
       judgement rather than on the model, so it is recomputed here from the
       axis scores under whatever weights the reader set in the lab, rather than
       read off the number the run happened to be stored with. Under the default
       equal weights this reproduces `result.civic.value` exactly. */
    const custom = AXES.some((k) => weights[k] !== DEFAULT_WEIGHTS[k])
    const civicNow = compositeScore(axisScores(result.axes), weights)
    const civicBase = custom
        ? compositeScore(axisScores(area.baseline.axes), weights)
        : result.baseCivic

    /* And the chain's last step is rebuilt to match, so the score in the
       headline and the score at the end of the causal chain can never be two
       different numbers on the same screen. */
    const chain = custom
        ? result.chain.map((step) =>
              step.id === "score" ? scoreStep(civicBase, civicNow, "custom") : step,
          )
        : result.chain

    const delta = civicNow - civicBase
    const improved = delta >= 0
    // The field reports the direction of the result.
    const fieldA = improved ? "#1c5c4a" : "#7a3418"
    const fieldB = improved ? "#0d2b25" : "#3a1a0d"

    const added = result.addedResidents
    const growth = current!.actions.filter((a) => a.kind === "addResidents")
    const place =
        growth.length === 1
            ? area.zones.find((z) => z.geoid === (growth[0] as { zoneGeoid: string }).zoneGeoid)?.name
            : growth.length > 1
              ? `${growth.length} places`
              : area.label

    return (
        <main id="main" ref={rootRef} className="min-h-dvh bg-ink-950 p-2 sm:p-3">
            {/* ── the reveal ───────────────────────────────────────────── */}
            <ResultScrub
                areaId={areaId}
                vc={result.vc}
                corridors={result.corridors}
                fieldA={fieldA}
                fieldB={fieldB}
                glow={improved ? "#3ddc9733" : "#f28f3b33"}
                titleTop={<span>Civic impact</span>}
                titleBottom={
                    <span>
                        <span className="text-white/45">{civicBase}</span>
                        <span className="text-white/30"> → </span>
                        <span className={improved ? "text-flow-free" : "text-flow-tight"}>
                            <ScoreNumber value={civicNow} from={civicBase} />
                        </span>
                    </span>
                }
                caption={
                    added > 0
                        ? `You placed ${added.toLocaleString()} residents in ${place}. This is what the model says happened.`
                        : `You changed the network in ${area.label}. This is what the model says happened.`
                }
                hint="SCROLL TO OPEN THE MODEL"
            />

            {/* ── the reading ──────────────────────────────────────────── */}
            <section
                data-parallax-layers
                className="relative overflow-hidden rounded-2xl"
                style={{
                    background: `radial-gradient(120% 90% at 72% 0%, ${fieldA} 0%, ${fieldB} 58%, #080b0d 100%)`,
                }}
            >
                <div
                    data-parallax-layer="1"
                    aria-hidden
                    className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff0d_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0d_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,#000_60%,transparent_100%)]"
                />

                {/* nav: dotted items and an outlined pill, as in the reference */}
                <nav className="relative z-20 flex flex-wrap items-center gap-x-8 gap-y-3 px-7 py-6 sm:px-12">
                    <Link href="/" className="font-pixel text-[13px] tracking-[0.16em] text-white">
                        CIVICFLOW
                    </Link>
                    <ul className="hidden gap-7 md:flex">
                        {["Model", "Chain", "Profile", "History"].map((x) => (
                            <li key={x} className="flex items-center gap-2 text-[13px] text-white/70">
                                <span className="h-1 w-1 rounded-full bg-white/45" />
                                {x}
                            </li>
                        ))}
                    </ul>
                    <Link
                        href="/lab"
                        className="ml-auto rounded-md border border-white/40 px-5 py-2.5 text-[13px] text-white transition-colors hover:bg-white/10"
                    >
                        Back to the lab
                    </Link>
                </nav>

                <div className="relative grid gap-10 px-7 pb-10 sm:px-12 lg:grid-cols-[1.5fr_0.85fr]">
                    {/* left: the claim, set large and light */}
                    <div data-parallax-layer="4" className="relative z-10 flex flex-col justify-between">
                        <p className="max-w-sm text-[15px] leading-relaxed text-white/70">
                            {added > 0
                                ? `You placed ${added.toLocaleString()} residents in ${place}.`
                                : `You changed the network in ${area.label}.`}
                        </p>

                        <h2
                            className="font-display mt-14 max-w-[14ch]"
                            style={{ fontSize: "clamp(40px, 5.6vw, 104px)" }}
                        >
                            <span className="text-white/40">The cost of</span>{" "}
                            <span className="text-white">{added > 0 ? added.toLocaleString() : "this"}</span>{" "}
                            <span className="text-white/40">more</span>{" "}
                            <span className="text-white">residents</span>
                        </h2>

                        <div className="mt-12 flex flex-wrap items-center gap-6">
                            <Link
                                href="/lab"
                                className="group inline-flex items-center gap-3 rounded-md bg-black px-7 py-4 text-[14px] font-medium text-white transition-colors hover:bg-black/80"
                            >
                                Try another change
                                <span className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">↗</span>
                            </Link>
                            <p className="max-w-xs text-[13px] leading-relaxed text-white/70">
                                {result.tradeoff.sentence}
                            </p>
                        </div>
                    </div>

                    {/* right rail, split by a hairline */}
                    <div
                        data-parallax-layer="3"
                        className="relative z-10 flex flex-col gap-6 lg:border-l lg:border-white/15 lg:pl-9"
                    >
                        <p className="max-w-[26ch] text-[14px] leading-relaxed text-white/70">
                            Browse every run you have made. Flick the list, or press play.
                        </p>
                        <VersionDeck
                            versions={versions}
                            areaId={areaId}
                            currentId={currentId}
                            onSelect={(id) => restore(id)}
                        />
                        <ul className="space-y-2">
                            {AXES.map((k) => {
                                const ax = result.axes[k]
                                return (
                                    <li key={k} className="flex items-baseline gap-2 text-[12px]">
                                        <span className="flex-1 truncate text-white/70">{ax.label}</span>
                                        <span className="tabular font-mono text-[11px] text-white/50">
                                            {ax.raw.value.toLocaleString()} {ax.raw.unit}
                                        </span>
                                        <span className="tabular w-8 text-right font-mono text-white">
                                            {ax.score.value}
                                        </span>
                                    </li>
                                )
                            })}
                        </ul>
                    </div>
                </div>

                {/* bottom strip: light / mid / dark panels, as in the reference */}
                <div className="relative z-10 grid grid-cols-1 border-t border-white/15 md:grid-cols-[1.2fr_1fr_1fr]">
                    <div className="bg-paper-100 px-7 py-7 sm:px-12">
                        <p className="font-display-md max-w-[18ch] text-ink-950" style={{ fontSize: "clamp(20px, 2vw, 28px)" }}>
                            Start the next version from this one
                        </p>
                        <Link href="/lab" className="mt-3 inline-block border-b border-ink-950/40 text-[13px] text-ink-950">
                            Back to the lab
                        </Link>
                    </div>
                    <div className="bg-[#f4f5f7] px-7 py-7 sm:px-9">
                        <div className="font-mono text-[10px] uppercase tracking-wider text-ink-600">
                            Simulated in
                        </div>
                        <div className="tabular mt-1 font-mono text-2xl text-ink-950">{result.runtimeMs} ms</div>
                        <p className="mt-2 text-[12px] leading-relaxed text-ink-600">
                            {area.totals.zones} zones · {Math.round(result.totalTrips).toLocaleString()} peak trips
                        </p>
                    </div>
                    <div className="bg-ink-950 px-7 py-7 sm:px-9">
                        <div className="tabular font-display text-flow-free" style={{ fontSize: "clamp(28px, 3vw, 44px)" }}>
                            {(result.coverage.share * 100).toFixed(1)}%
                        </div>
                        <p className="mt-2 max-w-[24ch] text-[12px] leading-relaxed text-paper-300">
                            of residents within four minutes of a fire engine, on congested speeds
                        </p>
                    </div>
                </div>
            </section>

            {/* ── below the fold: the working ─────────────────────────── */}
            <section className="mx-auto grid max-w-6xl gap-10 px-4 py-20 lg:grid-cols-[340px_1fr]">
                <div>
                    <h2 className="font-display-md text-paper-100" style={{ fontSize: "clamp(24px, 2.4vw, 38px)" }}>
                        Decision DNA
                    </h2>
                    <div className="mt-3">
                        <DnaWords axes={result.axes} />
                    </div>
                    <div className="mt-5">
                        <DecisionDna
                            axes={result.axes}
                            morphFrom={area.baseline.axes}
                            compareAxes={area.baseline.axes}
                            compareLabel="Baseline"
                            label={current!.label}
                            size={250}
                        />
                    </div>
                    <div className="mt-6 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <ProvenanceTag level="verified" />
                            <span className="font-mono text-[10px] text-paper-400">
                                population, housing, geometry
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <ProvenanceTag level="modelled" />
                            <span className="font-mono text-[10px] text-paper-400">
                                trips, volumes, response times
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <ProvenanceTag level="demo" />
                            <span className="font-mono text-[10px] text-paper-400">unit costs</span>
                        </div>
                    </div>

                    {/* The weights belong next to the number they produce. A
                        reader looking at a score is exactly the reader who
                        should be able to ask what it would be if they cared
                        about something else -- and the answer arrives without
                        re-running anything, because only the combination
                        changes. */}
                    <div className="mt-10 border-t border-ink-800 pt-8">
                        <Priorities />
                    </div>
                </div>

                <ConsequenceChain steps={chain} runtimeMs={result.runtimeMs} />
            </section>
        </main>
    )
}

/** The headline figure, counting into place as the page arrives. */
function ScoreNumber({ value, from }: { value: number; from: number }) {
    // Counts out of the baseline, so the headline shows the distance travelled
    // rather than just the destination.
    const shown = useCountUp(value, 900, from)
    return <span className="tabular">{Math.round(shown)}</span>
}
