"use client"

/**
 * HOW CIVICFLOW THINKS.
 *
 * The claim this whole product rests on is that its numbers can be checked. A
 * page that says so and then paraphrases the model in prose would undercut it,
 * so this one is built out of the model instead:
 *
 *  - every constant is imported from the engine module that uses it, so the
 *    page cannot state a coefficient the simulator does not actually apply;
 *  - every count and provenance record is fetched from methodology.json, which
 *    is generated from the same artefacts the worker loads;
 *  - the volume-delay diagram calls the engine's own bprTime.
 *
 * A reader who finds a discrepancy between this page and the model has found a
 * bug in the pipeline, not a stale sentence, which is the only version of a
 * methodology page worth writing.
 */

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { BprCurve } from "@/components/methodology/BprCurve"
import { ProvenanceTag } from "@/components/ui/Provenance"
import { Reveal } from "@/components/ui/Reveal"
import { BlurIn, ScrollProgress } from "@/components/ui/motion"
import { PEAK_TRIPS_PER_RESIDENT, STRESS_VC } from "@/engine/model"
import { NFPA_TRAVEL_S, NFPA_FIRST_ALARM_S } from "@/engine/emergency"
import { AXIS_META, DEFAULT_WEIGHTS, UNIT_COSTS } from "@/engine/metrics"
import { AXES } from "@/engine/types"

interface AreaFacts {
    areaId: string
    label: string
    kind: string
    zoneKind: string
    generatedAt: string
    counts: { nodes: number; edges: number; routableEdges: number; corridors: number; reportableCorridors: number }
    totals: { zones: number; population: number; facilities: number }
    graphProvenance: {
        geometry: { source: string; license: string; level: string }
        lanes: { verifiedEdges: number; modelledEdges: number; defaultBasis: string }
        speed: { verifiedEdges: number; modelledEdges: number; defaultBasis: string }
        capacity: { level: string; basis: string }
    }
    zoneProvenance: Record<string, { level?: string; source?: string; note?: string }>
    deterrenceS: number
    calibratedMeanTripMin: number | null
    sampleCount: number
}

const SECTIONS = [
    ["data", "Data"],
    ["network", "Network"],
    ["demand", "Demand"],
    ["accessibility", "Accessibility"],
    ["capacity", "Capacity"],
    ["scoring", "Scoring"],
    ["weights", "Weights"],
    ["limits", "Limitations"],
] as const

export default function MethodologyPage() {
    const [facts, setFacts] = useState<AreaFacts[] | null>(null)
    const [areaId, setAreaId] = useState("nwa")

    useEffect(() => {
        let live = true
        fetch("/data/methodology.json")
            .then((r) => r.json())
            .then((d: { areas: AreaFacts[] }) => live && setFacts(d.areas))
            .catch(() => live && setFacts([]))
        return () => {
            live = false
        }
    }, [])

    const area = useMemo(
        () => facts?.find((a) => a.areaId === areaId) ?? facts?.[0] ?? null,
        [facts, areaId],
    )

    const n = (v: number | undefined) => (v == null ? "…" : v.toLocaleString())

    return (
        <main id="main" className="min-h-dvh bg-ink-950">
            <ScrollProgress />

            <header className="sticky top-0 z-20 border-b border-ink-800 bg-ink-950/95 backdrop-blur">
                <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
                    <Link href="/" className="font-pixel text-sm tracking-[0.16em] text-paper-100">
                        CIVICFLOW
                    </Link>
                    <nav className="hidden gap-4 md:flex">
                        {SECTIONS.map(([id, label]) => (
                            <a
                                key={id}
                                href={`#${id}`}
                                className="text-[11px] text-paper-400 transition-colors hover:text-paper-100"
                            >
                                {label}
                            </a>
                        ))}
                    </nav>
                    <a
                        href="/lab"
                        className="ml-auto rounded bg-accent px-3 py-1.5 font-pixel text-[11px] tracking-[0.14em] text-ink-950"
                    >
                        OPEN THE LAB
                    </a>
                </div>
            </header>

            <div className="mx-auto max-w-5xl px-6 py-16">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-400">
                    Methodology
                </p>
                <BlurIn
                    as="h1"
                    immediate
                    className="font-display mt-4 max-w-[16ch] text-paper-100"
                    style={{ fontSize: "clamp(38px, 5.4vw, 84px)" }}
                >
                    How CivicFlow thinks.
                </BlurIn>
                <p className="mt-6 max-w-[68ch] text-[14px] leading-relaxed text-paper-300">
                    Standard four-step travel modelling, minus mode choice, run in your browser
                    over real Arkansas geography. Every coefficient below is imported from the
                    module that applies it and every count is read from the file the simulator
                    loads, so this page cannot drift from the model it describes. Where a number
                    is measured it says so; where it is modelled it says so; where it is invented
                    it says that too.
                </p>

                {/* Area switch: the figures below are per-area, and saying
                    "41,403 edges" without saying of what would be exactly the
                    kind of unanchored number this page exists to avoid. */}
                <div className="mt-8 flex flex-wrap gap-1">
                    {(facts ?? []).map((a) => (
                        <button
                            key={a.areaId}
                            onClick={() => setAreaId(a.areaId)}
                            className={`rounded px-3 py-1.5 text-[11px] transition-colors ${
                                area?.areaId === a.areaId
                                    ? "bg-accent/15 text-accent"
                                    : "text-paper-300 hover:bg-ink-800"
                            }`}
                        >
                            {a.label}
                        </button>
                    ))}
                </div>

                {/* ── DATA ───────────────────────────────────────────────── */}
                <Section id="data" title="Data" lead="Four sources, three levels of confidence.">
                    <table className="w-full border-collapse text-left text-[13px]">
                        <thead>
                            <tr className="border-b border-ink-700 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-400">
                                <th className="py-2 font-normal">What</th>
                                <th className="py-2 font-normal">Source</th>
                                <th className="py-2 font-normal">Level</th>
                            </tr>
                        </thead>
                        <tbody className="text-paper-300">
                            {[
                                ["Road geometry, lanes, speeds", area?.graphProvenance.geometry.source ?? "OpenStreetMap via Overpass API", "verified", area ? `${area.graphProvenance.geometry.license} · ${n(area.counts.edges)} edges` : ""],
                                ["Population, housing units", "US Census Bureau, 2020 Decennial Census", "verified", area ? `${n(area.totals.population)} residents in ${n(area.totals.zones)} ${area.zoneKind === "county" ? "counties" : "block groups"}` : ""],
                                ["Zone geometry", "US Census Bureau TIGERweb", "verified", "generalised for display, centroids used for routing"],
                                ["Fire, EMS and hospital locations", "OpenStreetMap", "verified", area ? `${n(area.totals.facilities)} facilities` : ""],
                                ["Trips, volumes, response times, scores", "This engine", "modelled", "computed from the above and the assumptions below"],
                                ["Infrastructure unit costs", "Placeholder", "demo", "illustrative US figures, not an Arkansas estimate"],
                            ].map(([what, source, level, note]) => (
                                <tr key={what as string} className="border-b border-ink-800 align-top">
                                    <td className="py-3 pr-4 text-paper-200">{what}</td>
                                    <td className="py-3 pr-4">
                                        {source}
                                        {note && (
                                            <span className="mt-0.5 block font-mono text-[10px] text-paper-400">{note}</span>
                                        )}
                                    </td>
                                    <td className="py-3">
                                        <ProvenanceTag level={level as "verified" | "modelled" | "demo"} compact />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="mt-4 text-[12px] leading-relaxed text-paper-400">
                        The Census join is checked rather than trusted: summed over Arkansas the
                        population must reproduce the published 3,011,524 exactly, and the pipeline
                        refuses to write data if it does not. Nothing gets labelled VERIFIED on a
                        bad join.
                    </p>
                    <SourceLinks />
                </Section>

                {/* ── NETWORK ────────────────────────────────────────────── */}
                <Section
                    id="network"
                    title="Network"
                    lead="Roads become a graph: junctions are nodes, the road between two junctions is an edge."
                >
                    <Figures
                        rows={[
                            ["Nodes (junctions)", n(area?.counts.nodes)],
                            ["Edges (road segments)", n(area?.counts.edges)],
                            ["Routable edges", n(area?.counts.routableEdges)],
                            ["Named corridors", n(area?.counts.corridors)],
                        ]}
                    />
                    <p className="mt-5 text-[13px] leading-relaxed text-paper-300">
                        Only {n(area?.counts.routableEdges)} of {n(area?.counts.edges)} edges carry
                        routed traffic. Local streets are drawn but not routed, which is what
                        regional travel models do: residential streets carry access traffic, not
                        through movement, and routing over them produces shortcuts no driver takes.
                    </p>
                    <p className="mt-4 text-[13px] leading-relaxed text-paper-300">
                        Capacity is lanes × per-lane capacity, derated from the Highway Capacity
                        Manual by road class. Lane counts and speed limits come from OpenStreetMap
                        where it has them and from class defaults where it does not, and which is
                        which is recorded per edge rather than averaged away:
                    </p>
                    <Figures
                        rows={[
                            ["Lanes from OSM", n(area?.graphProvenance.lanes.verifiedEdges)],
                            ["Lanes from class default", n(area?.graphProvenance.lanes.modelledEdges)],
                            ["Speeds from OSM", n(area?.graphProvenance.speed.verifiedEdges)],
                            ["Speeds from class default", n(area?.graphProvenance.speed.modelledEdges)],
                        ]}
                    />
                </Section>

                {/* ── DEMAND ─────────────────────────────────────────────── */}
                <Section
                    id="demand"
                    title="Demand"
                    lead="Residents become trips, trips choose destinations, destinations become traffic."
                >
                    <Step
                        n="1"
                        title="Generation"
                        formula={`trips = residents × ${PEAK_TRIPS_PER_RESIDENT}`}
                    >
                        {PEAK_TRIPS_PER_RESIDENT} peak-hour vehicle trips per resident: 3.4 daily
                        person-trips (NHTS 2017) × 0.095 peak-hour share ÷ 1.67 persons per vehicle
                        = 0.193, held at two significant figures because the inputs support no more.
                        Adding 10,000 residents therefore adds about {(10000 * PEAK_TRIPS_PER_RESIDENT).toLocaleString()}{" "}
                        vehicle trips to the peak hour, not 10,000.
                    </Step>

                    <Step n="2" title="Distribution" formula="f(c) = exp(−c / c₀)">
                        A singly-constrained gravity model. Trips from a zone are shared among
                        destinations in proportion to their size and a deterrence function of the
                        travel cost between them. The deterrence constant c₀ is{" "}
                        <em className="text-paper-100 not-italic">solved for</em> per area rather
                        than hand-tuned, against a stated target journey length
                        {area?.calibratedMeanTripMin
                            ? `, and for ${area.label} that gives c₀ = ${area.deterrenceS} s against a target mean trip of ${area.calibratedMeanTripMin} minutes.`
                            : `, and for ${area?.label ?? "this area"} that gives c₀ = ${area?.deterrenceS ?? "…"} s.`}{" "}
                        A hand-tuned constant is a knob you can turn until the demo looks good; a
                        solved one is a claim that can be wrong.
                    </Step>

                    <Step
                        n="3"
                        title="Assignment"
                        formula="t = t₀(1 + 0.15(v/c)⁴)"
                    >
                        Demand is loaded onto shortest paths in four capacity-restrained slices of
                        40%, 30%, 20% and 10%, with travel times recomputed from the Bureau of Public
                        Roads volume-delay curve after each. That is what makes congestion
                        self-limiting: once a corridor fills, the next slice routes around it, which
                        is what real drivers do and what a single all-or-nothing pass cannot
                        reproduce.
                    </Step>

                    <div className="mt-6">
                        <BprCurve />
                    </div>
                </Section>

                {/* ── ACCESSIBILITY ──────────────────────────────────────── */}
                <Section
                    id="accessibility"
                    title="Accessibility"
                    lead={`Emergency access is measured against NFPA 1710: ${NFPA_TRAVEL_S} seconds of travel for the first arriving engine.`}
                >
                    <p className="text-[13px] leading-relaxed text-paper-300">
                        NFPA 1710 is the standard career fire departments are actually held to, not
                        a threshold chosen to make a chart look decisive. The model computes travel
                        time from every facility outward across the network and reports the share of
                        residents inside {NFPA_TRAVEL_S} seconds, with{" "}
                        {NFPA_FIRST_ALARM_S} seconds, full first-alarm assembly, as a secondary
                        band.
                    </p>
                    <Callout>
                        Response times run on <strong className="font-medium text-paper-100">congested</strong>{" "}
                        speeds, not free-flow. This is the single most consequential decision in the
                        model: on free-flow speeds, growth could never affect emergency access at
                        all, and the consequence chain would be drawing a link between congestion
                        and response time that did not exist.
                    </Callout>
                </Section>

                {/* ── CAPACITY ───────────────────────────────────────────── */}
                <Section
                    id="capacity"
                    title="Capacity"
                    lead="Infrastructure capacity is service headroom, deliberately measured with no reference to traffic."
                >
                    <p className="text-[13px] leading-relaxed text-paper-300">
                        Utility service headroom over the 2020 housing stock, weighted by
                        population. The first version of this axis read the same volume-to-capacity
                        field as the transportation axis, and the two correlated at r = −0.958
                        across a random scenario sweep: two axes measuring one thing, dressed as
                        two independent findings. It was redefined to respond to{" "}
                        <em className="text-paper-100 not-italic">where</em> growth goes rather than
                        to how it travels.
                    </p>
                    <Callout>
                        The independence of the five axes is enforced by the build, not asserted
                        here: <code className="font-mono text-[12px] text-accent">npm run validate</code>{" "}
                        runs {area?.sampleCount ?? 120}+ random scenarios and fails if any pair of
                        axes correlates above 0.9.
                    </Callout>
                    <p className="mt-5 text-[13px] leading-relaxed text-paper-300">
                        Cost is the one place with invented numbers, and they are labelled
                        everywhere they surface:
                    </p>
                    {/* Written out rather than mapped over the constant: one
                        of its entries is a horizon in years, and formatting
                        every value as dollars would have printed "$20". */}
                    <Figures
                        rows={[
                            ["Local street, per km", `$${UNIT_COSTS.localStreetPerKm.toLocaleString()}`],
                            ["Arterial lane, per km", `$${UNIT_COSTS.arterialLanePerKm.toLocaleString()}`],
                            ["Water and sewer, per km", `$${UNIT_COSTS.waterSewerPerKm.toLocaleString()}`],
                            ["Operations and maintenance, per km per year", `$${UNIT_COSTS.omPerKmYear.toLocaleString()}`],
                            ["Trunk or treatment upgrade, lump", `$${UNIT_COSTS.thresholdUpgrade.toLocaleString()}`],
                            ["Operating horizon", `${UNIT_COSTS.horizonYears} years`],
                        ]}
                        demo
                    />
                    <p className="mt-3 text-[12px] leading-relaxed text-paper-400">
                        Baseline and scenario are costed identically, so the comparison between two
                        scenarios holds even though the absolute figure does not.
                    </p>
                </Section>

                {/* ── SCORING ────────────────────────────────────────────── */}
                <Section
                    id="scoring"
                    title="Scoring"
                    lead="Five axes, each normalised against what the model itself can produce."
                >
                    <p className="text-[13px] leading-relaxed text-paper-300">
                        Each axis is a raw physical quantity (minutes, percent, dollars per
                        resident) min-max normalised into 0–100 against an envelope built by
                        running {area?.sampleCount ?? 120} random scenarios over the area, and
                        flipped where lower is better. A score is therefore a position within the
                        range of outcomes this model can actually produce here, not a grade against
                        an absolute standard that does not exist.
                    </p>
                    <table className="mt-6 w-full border-collapse text-left text-[13px]">
                        <thead>
                            <tr className="border-b border-ink-700 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-400">
                                <th className="py-2 font-normal">Axis</th>
                                <th className="py-2 font-normal">Measures</th>
                                <th className="py-2 font-normal">Better</th>
                            </tr>
                        </thead>
                        <tbody className="text-paper-300">
                            {AXES.map((k) => (
                                <tr key={k} className="border-b border-ink-800">
                                    <td className="py-2.5 pr-4 text-paper-200">{AXIS_META[k].label}</td>
                                    <td className="py-2.5 pr-4 font-mono text-[11px]">{AXIS_META[k].unit}</td>
                                    <td className="py-2.5 font-mono text-[11px] text-paper-400">
                                        {AXIS_META[k].higherIsBetter ? "higher" : "lower"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="mt-5 text-[13px] leading-relaxed text-paper-300">
                        Stress is counted at v/c ≥ {STRESS_VC}, the Highway Capacity Manual
                        level-of-service C/D boundary, the point where flow stops being free and
                        small increases in demand start producing large increases in delay.
                    </p>
                </Section>

                {/* ── WEIGHTS ────────────────────────────────────────────── */}
                <Section
                    id="weights"
                    title="Weights"
                    lead="The composite is a weighted mean, and the weights are yours."
                >
                    <p className="text-[13px] leading-relaxed text-paper-300">
                        The engine ships equal weights,{" "}
                        {AXES.map((k) => `${AXIS_META[k].label} ×${DEFAULT_WEIGHTS[k]}`).join(", ")}{" "}
                        because any other weighting is a value judgement about whether a minute of
                        travel is worth a dollar of capital, and that judgement is not the model&rsquo;s
                        to make. The lab exposes the weights instead of tuning them until a demo
                        looked good.
                    </p>
                    <Callout>
                        Reweighting never re-runs the simulation. Axis scores are properties of the
                        scenario; the weights only decide how they are combined, which is why a
                        drag re-scores the entire decision history on the same frame, and why the
                        lab can tell you, live, when a different set of priorities picks a different
                        scenario.
                    </Callout>
                    <a
                        href="/lab"
                        className="mt-6 inline-flex items-center gap-2 rounded-md border border-ink-600 px-4 py-2.5 text-[13px] text-paper-100 transition-colors hover:border-accent hover:text-accent"
                    >
                        Set your priorities in the lab
                        <span aria-hidden>→</span>
                    </a>
                </Section>

                {/* ── LIMITS ─────────────────────────────────────────────── */}
                <Section
                    id="limits"
                    title="Limitations"
                    lead="What this cannot tell you, stated plainly rather than buried."
                >
                    <ol className="space-y-5">
                        {[
                            ["Unit costs are invented", "The infrastructure cost figures are placeholders and are labelled DEMO wherever they appear. Both baseline and scenario are costed identically, so the comparison holds where the absolute level does not."],
                            ["Statewide traffic is coarse", "County-sized zones over-disperse trips however the gravity model is calibrated. Emergency access, service headroom, growth efficiency and burden are sound at county scale; corridor stress at that scale should be read as directional. The metro models carry the traffic claims."],
                            ["Jobs are not distributed like residents", "Trip attractions use population as an activity proxy. Employment is not distributed the way residents are, and this is the weakest assumption in the model."],
                            ["Deterrence targets are assumptions", "c₀ is solved against a stated target journey length rather than against observed travel. An ACS mean-commute figure would be a better anchor and is the obvious upgrade."],
                            ["No mode choice, no time of day", "Every trip is a peak-hour vehicle trip. There is no transit, no walking, no off-peak, and no induced demand from added capacity, so a road expansion looks better here than it would over twenty years."],
                            ["This is not a forecast", "Nothing here predicts what Arkansas will do. It states what this model, with these assumptions, produces from a change you specified. No sentence in a result is written by a language model; each is a template filled from a computed number."],
                        ].map(([term, detail], i) => (
                            <li key={term} className="border-t border-ink-800 pt-4">
                                <div className="flex items-baseline gap-3">
                                    <span className="tabular font-mono text-[11px] text-paper-400">
                                        {String(i + 1).padStart(2, "0")}
                                    </span>
                                    <h3 className="text-[15px] text-paper-100">{term}</h3>
                                </div>
                                <p className="mt-2 max-w-[70ch] pl-8 text-[13px] leading-relaxed text-paper-300">
                                    {detail}
                                </p>
                            </li>
                        ))}
                    </ol>
                </Section>

                <footer className="mt-20 border-t border-ink-800 pt-8">
                    <p className="font-mono text-[10px] leading-relaxed text-paper-400">
                        Road data © OpenStreetMap contributors, ODbL · Population: US Census Bureau,
                        2020 Decennial Census · Standards: NFPA 1710, Highway Capacity Manual, BPR
                        1964
                        {area && ` · ${area.label} graph built ${new Date(area.generatedAt).toISOString().slice(0, 10)}`}
                    </p>
                </footer>
            </div>
        </main>
    )
}

/* --- small parts ------------------------------------------------------- */

function Section({
    id,
    title,
    lead,
    children,
}: {
    id: string
    title: string
    lead: string
    children: React.ReactNode
}) {
    return (
        <Reveal as="section" className="mt-20 scroll-mt-20">
            <div id={id} className="scroll-mt-20">
                <h2 className="font-display-md text-paper-100" style={{ fontSize: "clamp(26px, 3vw, 44px)" }}>
                    {title}
                </h2>
                <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-paper-200">{lead}</p>
                <div className="mt-7">{children}</div>
            </div>
        </Reveal>
    )
}

function Step({
    n,
    title,
    formula,
    children,
}: {
    n: string
    title: string
    formula: string
    children: React.ReactNode
}) {
    return (
        <div className="mt-6 border-l-2 border-ink-700 pl-5 first:mt-0">
            <div className="flex flex-wrap items-baseline gap-3">
                <span className="tabular font-mono text-[11px] text-paper-400">{n}</span>
                <h3 className="text-[15px] text-paper-100">{title}</h3>
                <code className="rounded bg-ink-850 px-2 py-1 font-mono text-[11px] text-accent">
                    {formula}
                </code>
            </div>
            <p className="mt-2.5 max-w-[70ch] text-[13px] leading-relaxed text-paper-300">{children}</p>
        </div>
    )
}

function Figures({ rows, demo = false }: { rows: (string | number)[][]; demo?: boolean }) {
    return (
        <dl className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {rows.map(([label, value]) => (
                <div key={String(label)} className="flex items-baseline justify-between gap-4 border-b border-ink-800 py-1.5">
                    <dt className="text-[12px] text-paper-300">{label}</dt>
                    <dd className={`tabular font-mono text-[12px] ${demo ? "text-demo" : "text-paper-100"}`}>
                        {value}
                    </dd>
                </div>
            ))}
        </dl>
    )
}

function Callout({ children }: { children: React.ReactNode }) {
    return (
        <div className="mt-5 rounded-md border border-ink-700 bg-ink-900 p-4">
            <p className="max-w-[68ch] text-[13px] leading-relaxed text-paper-300">{children}</p>
        </div>
    )
}

/** Where to go and check, rather than take any of this on trust. */
function SourceLinks() {
    const LINKS = [
        ["Arkansas GIS Office", "https://gis.arkansas.gov/"],
        ["Northwest Arkansas Regional Planning Commission", "https://www.nwarpc.org/"],
        ["OpenStreetMap", "https://www.openstreetmap.org/copyright"],
        ["US Census TIGERweb", "https://tigerweb.geo.census.gov/"],
        ["NFPA 1710", "https://www.nfpa.org/codes-and-standards/nfpa-1710-standard-development/1710"],
    ]
    return (
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
            {LINKS.map(([label, href]) => (
                <a
                    key={href}
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-mono text-[10px] text-paper-400 underline decoration-ink-600 underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
                >
                    {label} ↗
                </a>
            ))}
        </div>
    )
}
