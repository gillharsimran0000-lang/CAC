"use client"

/**
 * YOUR PRIORITIES.
 *
 * The five axes measure things that no fact can trade against each other. Is a
 * minute of travel time worth a dollar of capital? Is four minutes to an engine
 * worth a corridor at 0.9? Those are not findings, they are values, and a tool
 * that answers them silently -- by shipping a weighting and never saying so --
 * is making a political argument while claiming to do arithmetic.
 *
 * So the weights are a control. Equal by default, stated as such, and movable.
 *
 * Two things make this more than a settings panel:
 *
 * Reweighting never re-runs the simulation. Axis scores are properties of the
 * scenario; the weights only decide how they are combined. So the whole saved
 * history re-scores on the same frame as the drag, which is what lets the panel
 * show, live, that a different set of priorities picks a different scenario.
 *
 * And when the ranking actually changes, it says so by name. "Your priorities
 * changed the optimal scenario" is the single most important sentence in this
 * product, and it is only ever shown when it is literally true -- computed by
 * comparing the top-ranked version under the user's weights against the top
 * under equal weights.
 */

import { useMemo } from "react"
import { useLab } from "@/state/lab"
import { axisScores, compositeScore, DEFAULT_WEIGHTS } from "@/engine/metrics"
import { AXES, AxisKey } from "@/engine/types"

const LABEL: Record<AxisKey, string> = {
    transportation: "Transportation",
    emergencyAccess: "Emergency access",
    infrastructureCapacity: "Infrastructure capacity",
    growthEfficiency: "Growth efficiency",
    infrastructureBurden: "Infrastructure burden",
}

/** What each axis is actually asking you to value, in one line. */
const MEANS: Record<AxisKey, string> = {
    transportation: "how long the average modelled trip takes",
    emergencyAccess: "share of residents inside the NFPA 1710 four minutes",
    infrastructureCapacity: "utility service headroom left over the 2020 housing stock",
    growthEfficiency: "residents added per kilometre of road they need",
    infrastructureBurden: "capital and 20-year operating cost per resident",
}

export function Priorities() {
    const weights = useLab((s) => s.weights)
    const setWeight = useLab((s) => s.setWeight)
    const resetWeights = useLab((s) => s.resetWeights)
    const versions = useLab((s) => s.versions)

    const sum = (Object.keys(weights) as AxisKey[]).reduce((s, k) => s + weights[k], 0)
    const isDefault = (Object.keys(DEFAULT_WEIGHTS) as AxisKey[]).every(
        (k) => weights[k] === DEFAULT_WEIGHTS[k],
    )

    /**
     * Who wins under these weights, and who would win under equal ones.
     *
     * Only runs versions that have a result. Ties are left to the first,
     * matching the order they were run in, so "the ranking changed" is never
     * announced because two scenarios scored the same.
     */
    const ranking = useMemo(() => {
        const scored = versions
            .filter((v) => v.result)
            .map((v) => {
                const scores = axisScores(v.result!.axes)
                return {
                    id: v.id,
                    label: v.label,
                    mine: compositeScore(scores, weights),
                    equal: compositeScore(scores, DEFAULT_WEIGHTS),
                }
            })
        if (scored.length < 2) return null

        const best = (key: "mine" | "equal") =>
            scored.reduce((a, b) => (b[key] > a[key] ? b : a))

        const mine = best("mine")
        const equal = best("equal")
        return { scored, mine, equal, changed: mine.id !== equal.id }
    }, [versions, weights])

    return (
        <section aria-labelledby="priorities-heading">
            <div className="flex items-baseline justify-between">
                <h2 id="priorities-heading" className="font-pixel text-sm tracking-[0.2em] text-paper-200">
                    YOUR PRIORITIES
                </h2>
                <button
                    onClick={resetWeights}
                    disabled={isDefault}
                    className="font-mono text-[10px] text-paper-400 transition-colors hover:text-paper-200 disabled:opacity-40 disabled:hover:text-paper-400"
                >
                    {isDefault ? "equal weights" : "reset to equal"}
                </button>
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-paper-400">
                Whether a minute of travel is worth a dollar of capital is a value judgement, not
                a finding. The engine weights the five axes equally and hands the judgement to
                you. Moving these re-scores every saved run instantly. No simulation re-runs,
                because the axis scores belong to the scenario and the weights only decide how
                they are combined.
            </p>

            <ul className="mt-4 space-y-3">
                {AXES.map((axis) => {
                    const share = sum > 0 ? (weights[axis] / sum) * 100 : 0
                    return (
                        <li key={axis}>
                            <label className="flex items-baseline justify-between gap-2">
                                <span className="text-[12px] text-paper-200">{LABEL[axis]}</span>
                                <span className="tabular font-mono text-[10px] text-accent">
                                    {share.toFixed(0)}%
                                </span>
                            </label>
                            <input
                                type="range"
                                min={0}
                                max={5}
                                step={0.25}
                                value={weights[axis]}
                                onChange={(e) => setWeight(axis, Number(e.target.value))}
                                aria-label={`${LABEL[axis]} weight`}
                                aria-describedby={`means-${axis}`}
                                /* Value text as well as the number, because a
                                   screen reader reading "2.75" off a slider in a
                                   panel of five identical sliders learns nothing. */
                                aria-valuetext={`${share.toFixed(0)} percent of the score`}
                                className="civic-range mt-1.5 w-full"
                            />
                            <p id={`means-${axis}`} className="mt-1 text-[10px] leading-snug text-paper-400">
                                {MEANS[axis]}
                            </p>
                        </li>
                    )
                })}
            </ul>

            {ranking && (
                <div
                    className={`mt-5 rounded-md border p-3 ${
                        ranking.changed
                            ? "border-wheat-500/50 bg-wheat-500/[0.07]"
                            : "border-ink-800 bg-ink-900"
                    }`}
                >
                    {ranking.changed ? (
                        <>
                            <p className="text-[12px] leading-relaxed text-wheat-400">
                                Your priorities changed the optimal scenario.
                            </p>
                            <p className="mt-1.5 text-[11px] leading-relaxed text-paper-300">
                                Under equal weights <strong className="font-medium text-paper-100">{ranking.equal.label}</strong> leads
                                at {ranking.equal.equal}. Under yours,{" "}
                                <strong className="font-medium text-paper-100">{ranking.mine.label}</strong> does, at{" "}
                                {ranking.mine.mine}, the same five axis scores combined differently.
                            </p>
                        </>
                    ) : (
                        <p className="text-[11px] leading-relaxed text-paper-300">
                            <strong className="font-medium text-paper-100">{ranking.mine.label}</strong> leads at{" "}
                            {ranking.mine.mine}, under your weights and under equal ones alike.
                            {!isDefault && " Your priorities did not change which scenario wins."}
                        </p>
                    )}

                    <ol className="mt-3 space-y-1">
                        {[...ranking.scored]
                            .sort((a, b) => b.mine - a.mine)
                            .map((v) => (
                                <li key={v.id} className="flex items-baseline gap-2 font-mono text-[10px]">
                                    <span className="flex-1 truncate text-paper-300">{v.label}</span>
                                    <span className="tabular text-paper-400">{v.equal}</span>
                                    <span aria-hidden className="text-paper-400">→</span>
                                    <span
                                        className={`tabular w-6 text-right ${
                                            v.mine > v.equal
                                                ? "text-flow-free"
                                                : v.mine < v.equal
                                                  ? "text-flow-tight"
                                                  : "text-paper-300"
                                        }`}
                                    >
                                        {v.mine}
                                    </span>
                                </li>
                            ))}
                    </ol>
                    <p className="mt-2 font-mono text-[9px] text-paper-400">
                        equal weights → your weights
                    </p>
                </div>
            )}
        </section>
    )
}
