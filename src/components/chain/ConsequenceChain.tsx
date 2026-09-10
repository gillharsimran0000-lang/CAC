"use client"

/**
 * THE CONSEQUENCE CHAIN.
 *
 * One decision, followed through the model until it reaches a score. Steps
 * reveal in causal order because the order is the argument: residents produce
 * trips, trips load corridors, loaded corridors slow the ambulance, and all of
 * it costs money. Showing them at once would make it a dashboard; showing them
 * in sequence makes it a mechanism.
 *
 * The animation is timing only -- the numbers exist before the first step
 * appears, and nothing about the reveal changes them. Any step can be opened to
 * see the arithmetic that produced it, down to the inputs and their sources,
 * which is the difference between an explanation and a decoration.
 */

import { useEffect, useState } from "react"
import { ChainStep } from "@/engine/types"
import { ProvenanceTag, MeasuredRow } from "@/components/ui/Provenance"
import { vcColor } from "@/render/network"

/**
 * Delay between steps.
 *
 * Was 520 ms, which put the score 3.1 seconds behind the click. Running
 * scenarios is the most repeated action in the app -- the whole premise is that
 * you try things -- so three seconds of choreography per attempt taxes the
 * thing the tool exists for. At 200 ms the sequence still reads as one step
 * causing the next, and the chain lands in about 1.2 s.
 */
const STEP_MS = 200

export function ConsequenceChain({
    steps,
    runtimeMs,
}: {
    steps: ChainStep[]
    runtimeMs?: number
}) {
    const [revealed, setRevealed] = useState(0)
    const [open, setOpen] = useState<string | null>(null)

    useEffect(() => {
        setRevealed(0)
        setOpen(null)
        if (!steps.length) return

        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        if (reduce) {
            setRevealed(steps.length)
            return
        }
        // A chain of timeouts rather than an interval: an interval that outlives
        // a fast re-run would reveal steps belonging to the previous scenario.
        const timers: number[] = []
        for (let i = 1; i <= steps.length; i++) {
            timers.push(window.setTimeout(() => setRevealed(i), i * STEP_MS))
        }
        return () => timers.forEach(clearTimeout)
    }, [steps])

    if (!steps.length) return null

    return (
        <div className="relative">
            <header className="mb-5 flex items-baseline justify-between">
                <h2 className="font-pixel text-sm tracking-[0.2em] text-paper-200">
                    CONSEQUENCE CHAIN
                </h2>
                {runtimeMs != null && (
                    <span className="font-mono text-[10px] text-paper-400">
                        simulated in {runtimeMs} ms
                    </span>
                )}
            </header>

            <ol className="relative space-y-0">
                {steps.map((step, i) => {
                    const shown = i < revealed
                    const isOpen = open === step.id
                    const last = i === steps.length - 1
                    return (
                        <li
                            key={step.id}
                            className="relative pl-7 transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                            style={{
                                opacity: shown ? 1 : 0,
                                transform: shown ? "translateY(0)" : "translateY(10px)",
                            }}
                        >
                            {/* Spine and node */}
                            {!last && (
                                <span
                                    /* Drawn at full height and scaled, rather
                                       than animated on `height`: height is a
                                       layout property, so the old version ran
                                       layout on every frame of every step
                                       instead of staying on the compositor. */
                                    className="absolute left-[7px] top-5 w-px origin-top bg-ink-600 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                                    style={{
                                        height: "calc(100% - 12px)",
                                        transform: `scaleY(${shown ? 1 : 0})`,
                                    }}
                                    aria-hidden
                                />
                            )}
                            <span
                                className={`absolute left-0 top-[6px] h-3.5 w-3.5 rounded-full border-2 transition-colors ${
                                    last
                                        ? "border-accent bg-accent"
                                        : shown
                                          ? "border-accent bg-ink-950"
                                          : "border-ink-600 bg-ink-950"
                                }`}
                                aria-hidden
                            />

                            <button
                                type="button"
                                onClick={() => setOpen(isOpen ? null : step.id)}
                                aria-expanded={isOpen}
                                className="group w-full pb-5 text-left"
                            >
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                    <span
                                        className={`font-pixel tracking-[0.1em] ${
                                            last ? "text-base text-paper-100" : "text-[13px] text-paper-100"
                                        }`}
                                    >
                                        {step.headline}
                                    </span>
                                    <ProvenanceTag level={step.value.provenance} compact />
                                    <span className="ml-auto font-mono text-[10px] text-paper-400 opacity-0 transition-opacity group-hover:opacity-100">
                                        {isOpen ? "hide working" : "show working"}
                                    </span>
                                </div>
                                <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-paper-300">
                                    {step.detail}
                                </p>
                            </button>

                            {isOpen && <StepInspector step={step} />}
                        </li>
                    )
                })}
            </ol>
        </div>
    )
}

/**
 * The working behind one step.
 *
 * Everything here is read off the `Measured` the engine already produced -- the
 * formula it recorded, the inputs it was derived from, the corridors it looked
 * at. Nothing is recomputed for display, so what is shown cannot drift from
 * what was calculated.
 */
function StepInspector({ step }: { step: ChainStep }) {
    const inputs = step.value.inputs ?? {}
    const corridors = step.evidence?.corridors ?? []

    return (
        <div className="mb-5 rounded-md border border-ink-700 bg-ink-900 p-4">
            {step.value.formula && (
                <div className="mb-3">
                    <div className="font-mono text-[9px] uppercase tracking-wider text-paper-400">
                        How this was calculated
                    </div>
                    <p className="mt-1 font-mono text-[11px] leading-relaxed text-paper-200">
                        {step.value.formula}
                    </p>
                </div>
            )}

            <div className="mb-3">
                <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-paper-400">
                    Source
                </div>
                <p className="font-mono text-[11px] text-paper-200">{step.value.source}</p>
            </div>

            {Object.keys(inputs).length > 0 && (
                <div className="mb-3">
                    <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-paper-400">
                        Inputs
                    </div>
                    {Object.entries(inputs).map(([name, m]) => (
                        <MeasuredRow key={name} name={name} m={m} />
                    ))}
                </div>
            )}

            {corridors.length > 0 && (
                <div>
                    <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-paper-400">
                        Affected corridors, worst link on each
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[440px] border-collapse text-[11px]">
                            <thead>
                                <tr className="text-left font-mono text-[9px] uppercase tracking-wider text-paper-400">
                                    <th className="pb-1 pr-3 font-normal">Corridor</th>
                                    <th className="pb-1 pr-3 text-right font-normal">Base vol</th>
                                    <th className="pb-1 pr-3 text-right font-normal">New vol</th>
                                    <th className="pb-1 pr-3 text-right font-normal">Capacity</th>
                                    <th className="pb-1 pr-3 text-right font-normal">Base v/c</th>
                                    <th className="pb-1 text-right font-normal">New v/c</th>
                                </tr>
                            </thead>
                            <tbody className="tabular font-mono">
                                {corridors.map((c) => (
                                    <tr key={c.corridorId} className="border-t border-ink-800">
                                        <td className="py-1 pr-3 text-paper-200">{c.label}</td>
                                        <td className="py-1 pr-3 text-right text-paper-400">
                                            {c.baseVolume.toLocaleString()}
                                        </td>
                                        <td className="py-1 pr-3 text-right text-paper-200">
                                            {c.scenarioVolume.toLocaleString()}
                                        </td>
                                        <td className="py-1 pr-3 text-right text-paper-400">
                                            {c.capacityVph.toLocaleString()}
                                        </td>
                                        <td className="py-1 pr-3 text-right" style={{ color: vcColor(c.baseVc) }}>
                                            {c.baseVc.toFixed(2)}
                                        </td>
                                        <td className="py-1 text-right font-medium" style={{ color: vcColor(c.scenarioVc) }}>
                                            {c.scenarioVc.toFixed(2)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="mt-2 text-[10px] leading-relaxed text-paper-400">
                        Volumes are modelled peak-hour vehicles. Capacity is lanes × per-lane flow,
                        derated from the Highway Capacity Manual. A corridor is summarised by its
                        worst link, because that is the bottleneck a driver meets.
                    </p>
                </div>
            )}
        </div>
    )
}
