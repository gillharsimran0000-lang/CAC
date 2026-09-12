"use client"

/**
 * The laboratory.
 *
 * Layout follows the argument: what you changed on the left, where it happened
 * in the middle, what it did on the right. The Decision DNA sits above the
 * consequence chain because the profile is the summary and the chain is the
 * proof; history runs underneath because it is the record of everything tried.
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLab, useCurrentVersion } from "@/state/lab"
import { NetworkMap } from "@/components/map/NetworkMap"
import { DecisionDna, DnaWords } from "@/components/dna/DecisionDna"
import { DecisionHistory } from "@/components/history/DecisionHistory"
import { ProvenanceTag } from "@/components/ui/Provenance"
import { useCountUp } from "@/lib/motion"
import { ScenarioBuilder } from "@/components/scenario/ScenarioBuilder"
import { ProjectPreview, type PreviewSpec } from "@/components/preview/ProjectPreview"
import { Priorities } from "@/components/priorities/Priorities"
import { axisScores, compositeScore } from "@/engine/metrics"

const AREAS = [
    { id: "arkansas", label: "Arkansas", note: "75 counties" },
    { id: "nwa", label: "Northwest Arkansas", note: "262 block groups" },
    { id: "little-rock", label: "Little Rock", note: "304 block groups" },
]

/**
 * What the results panel looks like while the worker prepares an area.
 *
 * Shaped like the thing it is standing in for -- a score, a shape, five rows --
 * so the panel does not reflow when the real content lands. A centred spinner
 * would say "wait" without saying what for.
 */
function ResultsSkeleton() {
    return (
        <section aria-busy="true" aria-label="Preparing the area">
            <div className="flex items-baseline justify-between">
                <div className="skeleton h-3 w-28" />
                <div className="skeleton h-7 w-10" />
            </div>
            <div className="mt-4 flex gap-2">
                <div className="skeleton h-3 w-20" />
                <div className="skeleton h-3 w-16" />
                <div className="skeleton h-3 w-24" />
            </div>
            <div className="mt-6 flex justify-center">
                <div className="skeleton h-[250px] w-[250px] rounded-full" />
            </div>
            <div className="mt-6 space-y-2.5">
                {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center gap-2">
                        <div className="skeleton h-1.5 w-1.5 rounded-full" />
                        <div className="skeleton h-2.5 flex-1" />
                        <div className="skeleton h-2.5 w-10" />
                    </div>
                ))}
            </div>
            <p className="mt-5 font-mono text-[10px] text-paper-400">
                building the network graph and running the baseline…
            </p>
        </section>
    )
}

/**
 * The headline score, counting into place.
 *
 * A score that swaps 81 for 64 between frames reads as a label being replaced.
 * Counting makes it read as a result being reached, which is what it is -- and
 * the duration is short enough that nobody waits on it to find out the answer.
 */
function CivicScore({ value }: { value: number }) {
    const shown = useCountUp(value)
    return (
        <span className="tabular font-mono text-2xl font-medium text-paper-100">
            {Math.round(shown)}
        </span>
    )
}

export default function LabPage() {
    const {
        areaId, area, loading, running, error,
        draft, setArea, run, compareId, versions,
    } = useLab()
    const weights = useLab((s) => s.weights)
    const hydrateWeights = useLab((s) => s.hydrateWeights)
    const current = useCurrentVersion()

    const router = useRouter()
    const justCompleted = useLab((s) => s.justCompleted)
    const acknowledgeCompletion = useLab((s) => s.acknowledgeCompletion)

    /* A finished run leaves the lab and lands on its own page. The store is
       module state, so it survives the client-side navigation -- the result
       does not have to be refetched or serialised into the URL. */
    useEffect(() => {
        if (!justCompleted) return
        acknowledgeCompletion()
        router.push("/result")
    }, [justCompleted, acknowledgeCompletion, router])

    const [zoneGeoid, setZoneGeoid] = useState<string | null>(null)

    /* What the builder is about to do, held here because it is drawn in the
       middle column rather than in the rail that produced it. A callback rather
       than a store field: this is transient interface state that no other route
       and no saved version ever needs to see.
       
       The key check is load-bearing. The builder rebuilds its spec on every
       render, so accepting each one unconditionally set state, re-rendered the
       builder, produced a fresh spec and set state again: the page never
       stopped rendering. It did not look broken, which is the worst part -- the
       only symptom was that a finished run stopped navigating to its own result
       page, because the render queue never drained. A spec's key already
       encodes everything that decides what is drawn, so an equal key means an
       equal spec and the old object can stand. */
    const [preview, setPreview] = useState<PreviewSpec | null>(null)
    const onPreview = useCallback((spec: PreviewSpec | null) => {
        setPreview((prev) => (prev?.key === spec?.key ? prev : spec))
    }, [])

    useEffect(() => {
        if (!area && !loading) setArea(areaId)
    }, [area, loading, areaId, setArea])

    /* After mount, not during store creation: the server has no localStorage,
       so reading it any earlier would render one set of weights on the server
       and a different set on the client. */
    useEffect(() => {
        hydrateWeights()
    }, [hydrateWeights])

    /* Default the map's highlight to the largest zone, so the tool is usable
       immediately rather than requiring a click first.
       
       Derived, not written into state from an effect. Storing it meant the
       default arrived on a second render after the area landed, and the effect
       had to re-run on every change to a value it also set. Falling back at the
       point of use gives the same result on the first paint, and a map click
       still wins because it sets the state this reads. */
    const selectedGeoid =
        zoneGeoid ??
        (area ? [...area.zones].sort((a, b) => b.population - a.population)[0]?.geoid ?? null : null)

    const compare = versions.find((v) => v.id === compareId) ?? null

    /* While a run is in flight the current version has no result yet. Falling
       back to the baseline here made the headline score jump to the baseline
       and back -- 70, then 81, then 21 -- which reads as a result rather than
       as a placeholder, and the DNA silhouette flashed the baseline shape on
       its way past. Hold the last completed run instead: it is the last thing
       that was actually true, and the button already says SIMULATING. */
    const result =
        current?.result ??
        [...versions].reverse().find((v) => v.result)?.result ??
        null

    return (
        <main id="main" className="min-h-dvh bg-ink-950">
            <header className="sticky top-0 z-20 border-b border-ink-800 bg-ink-950/95 backdrop-blur">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
                    <Link href="/" className="font-pixel text-sm tracking-[0.16em] text-paper-100">
                        CIVICFLOW
                    </Link>
                    <nav className="flex gap-1">
                        {AREAS.map((a) => (
                            <button
                                key={a.id}
                                onClick={() => setArea(a.id)}
                                className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
                                    areaId === a.id
                                        ? "bg-accent/15 text-accent"
                                        : "text-paper-300 hover:bg-ink-800"
                                }`}
                            >
                                {a.label}
                            </button>
                        ))}
                    </nav>
                    <a
                        href="/methodology"
                        className="text-[11px] text-paper-400 transition-colors hover:text-paper-100"
                    >
                        Methodology
                    </a>
                    {area && (
                        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-paper-400">
                            <span>{area.totals.population.toLocaleString()} residents</span>
                            <span>{area.graphCounts.edges.toLocaleString()} edges</span>
                            <span>{area.totals.facilities.toLocaleString()} facilities</span>
                            <span>c0 {area.deterrenceS}s</span>
                        </div>
                    )}
                </div>
            </header>

            {error && (
                <div className="border-b border-flow-over/40 bg-flow-over/10 px-4 py-2 font-mono text-[11px] text-flow-over">
                    {error}
                </div>
            )}

            <div className="grid gap-px bg-ink-800 lg:grid-cols-[300px_1fr_400px]">
                {/* --- controls --- */}
                {/* Scrolls on its own, like the results panel opposite it. The
                    builder grew a place card, presets and a list of what the
                    change implies, and without this the whole page scrolled to
                    reach the run button while the map stayed pinned. */}
                <aside className="space-y-6 overflow-y-auto bg-ink-950 p-4 lg:max-h-[calc(100dvh-53px)]">
                    <ScenarioBuilder onPreview={onPreview} />

                    <button
                        onClick={run}
                        disabled={running || !area || draft.length === 0}
                        className="w-full rounded-md bg-accent py-2.5 font-pixel text-[12px] tracking-[0.14em] text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                        {running ? "SIMULATING…" : "RUN SIMULATION"}
                    </button>
                    {draft.length === 0 && (
                        <p className="-mt-4 text-[10px] text-paper-400">
                            Add at least one change to run.
                        </p>
                    )}
                </aside>

                {/* --- map, and beneath it the thing you are about to build ---

                    The map answers "where", and it answered "what" badly: every
                    change, whatever it was, showed up as the same coloured
                    network. The preview strip under it answers "what" with the
                    specific object, so the two halves of the column are the two
                    halves of the question. */}
                <div className="flex min-h-[420px] flex-col bg-ink-950 lg:h-[calc(100dvh-53px)]">
                    <div className="relative min-h-[280px] flex-1">
                        <NetworkMap
                            areaId={areaId}
                            vc={result?.vc ?? null}
                            zones={area?.zones}
                            facilities={area?.facilities}
                            selectedGeoid={selectedGeoid}
                            onSelectZone={setZoneGeoid}
                        />
                    </div>
                    {/* 410 rather than 330. The blueprint grew act buttons, a
                        scrubber and a caption, and at the old height they left the
                        3D view 101 pixels tall: a sliver that technically rendered
                        and could not be read. */}
                    <div className="h-[410px] shrink-0">
                        <ProjectPreview
                            spec={preview}
                            axes={result?.axes ?? area?.baseline.axes ?? null}
                            axesLabel={current?.result ? (current.label ?? "last run") : "baseline"}
                        />
                    </div>
                </div>

                {/* --- results --- */}
                <aside className="space-y-8 overflow-y-auto bg-ink-950 p-4 lg:max-h-[calc(100dvh-53px)]">
                    {!area && <ResultsSkeleton />}

                    {area && (
                        <section>
                            <div className="flex items-baseline justify-between">
                                <h2 className="font-pixel text-sm tracking-[0.2em] text-paper-200">
                                    DECISION DNA
                                </h2>
                                {/* Recomputed from the axis scores under the
                                    user's weights rather than read off the
                                    stored composite, so the headline number
                                    moves with the priority sliders without any
                                    re-simulation. */}
                                <CivicScore
                                    value={compositeScore(
                                        axisScores(result?.axes ?? area.baseline.axes),
                                        weights,
                                    )}
                                />
                            </div>
                            <div className="mt-2">
                                <DnaWords axes={result?.axes ?? area.baseline.axes} />
                            </div>
                            <div
                                className="mt-4 transition-opacity duration-200"
                                style={{ opacity: running ? 0.55 : 1 }}
                            >
                                <DecisionDna
                                    axes={result?.axes ?? area.baseline.axes}
                                    compareAxes={compare?.result?.axes ?? (result ? area.baseline.axes : null)}
                                    compareLabel={compare ? compare.label : result ? "Baseline" : undefined}
                                    label={current?.label ?? "Baseline"}
                                    size={250}
                                />
                            </div>

                            <div className="mt-5 flex flex-wrap gap-1.5">
                                <ProvenanceTag level="verified" />
                                <span className="font-mono text-[10px] text-paper-400">
                                    population, housing, geometry, facilities
                                </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                <ProvenanceTag level="modelled" />
                                <span className="font-mono text-[10px] text-paper-400">
                                    trips, volumes, response times, scores
                                </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                <ProvenanceTag level="demo" />
                                <span className="font-mono text-[10px] text-paper-400">
                                    infrastructure unit costs
                                </span>
                            </div>
                        </section>
                    )}

                    <section>
                        <Priorities />
                    </section>

                    <section>
                        <DecisionHistory />
                    </section>
                </aside>
            </div>
        </main>
    )
}
