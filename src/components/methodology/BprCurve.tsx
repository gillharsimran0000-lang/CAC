"use client"

/**
 * The volume-delay curve, with a handle on it.
 *
 * Every congestion claim this tool makes comes out of one equation, and that
 * equation is the least intuitive thing in the model: a fourth power means the
 * road is fine, fine, fine, and then it is not. Printing `t = t₀(1 + 0.15(v/c)⁴)`
 * conveys none of that to most readers. Letting them drag a point along it does.
 *
 * The curve is drawn by calling the same `bprTime` the simulator calls, not by
 * a copy of the formula written for the diagram. If the engine's exponent ever
 * changes, this picture changes with it -- a diagram that can disagree with the
 * code it illustrates is worse than no diagram.
 */

import { useId, useState } from "react"
import { BPR_ALPHA, BPR_BETA, BPR_MAX_VC, STRESS_VC, bprTime } from "@/engine/model"

const W = 520
const H = 240
const PAD = { l: 44, r: 16, t: 16, b: 32 }

/**
 * The plot stops at v/c 2.5, not at the engine's clamp of 4.
 *
 * A fourth power climbs to 39× free flow by v/c 4, and drawing that range
 * linearly squashes the entire decision-relevant band -- everything between
 * free flow and failure -- into the bottom two pixels. The first version of this
 * chart instead clipped the curve at the top of the frame, which was worse: it
 * drew a flat line above v/c 2.1 and so appeared to claim the model caps delay
 * there, which it does not. Truncating the axis and saying so is honest;
 * flattening the curve is not.
 */
const X_MAX = 2.5
const Y_MAX = 7

const x = (vc: number) => PAD.l + (vc / X_MAX) * (W - PAD.l - PAD.r)
const y = (mult: number) => H - PAD.b - ((mult - 1) / (Y_MAX - 1)) * (H - PAD.t - PAD.b)

/** Delay multiple at a given v/c, straight from the engine. */
const multiple = (vc: number) => bprTime(1, vc, 1)

export function BprCurve() {
    const [vc, setVc] = useState(0.85)
    const id = useId()

    const path = Array.from({ length: 121 }, (_, i) => {
        const v = (i / 120) * X_MAX
        return `${i === 0 ? "M" : "L"}${x(v).toFixed(1)},${y(multiple(v)).toFixed(1)}`
    }).join("")

    const m = multiple(vc)
    const minutes = 20 * m

    return (
        <figure className="rounded-lg border border-ink-800 bg-ink-900 p-4">
            <svg
                viewBox={`0 0 ${W} ${H}`}
                className="w-full"
                role="img"
                aria-label={`Volume-delay curve. At volume-to-capacity ${vc.toFixed(2)}, travel time is ${m.toFixed(2)} times free flow.`}
            >
                {/* free-flow floor and the stress threshold */}
                <line x1={PAD.l} y1={y(1)} x2={W - PAD.r} y2={y(1)} stroke="var(--color-ink-600)" strokeWidth="1" />
                <line
                    x1={x(STRESS_VC)}
                    y1={PAD.t}
                    x2={x(STRESS_VC)}
                    y2={H - PAD.b}
                    stroke="var(--color-flow-warm)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                    opacity="0.7"
                />
                <text x={x(STRESS_VC) + 5} y={PAD.t + 10} className="fill-[var(--color-flow-warm)] text-[9px]">
                    0.85 · HCM C/D
                </text>
                <line
                    x1={x(1)}
                    y1={PAD.t}
                    x2={x(1)}
                    y2={H - PAD.b}
                    stroke="var(--color-flow-over)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                    opacity="0.55"
                />
                <text x={x(1) + 5} y={PAD.t + 22} className="fill-[var(--color-flow-over)] text-[9px]">
                    1.0 · at capacity
                </text>

                <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth="2" />

                {/* the reader's handle */}
                <line
                    x1={x(vc)}
                    y1={y(m)}
                    x2={x(vc)}
                    y2={H - PAD.b}
                    stroke="var(--color-paper-300)"
                    strokeWidth="1"
                />
                <circle cx={x(vc)} cy={y(m)} r="4.5" fill="var(--color-paper-100)" />

                {/* axes */}
                {[1, 3, 5, 7].map((t) => (
                    <g key={t}>
                        <text x={PAD.l - 8} y={y(t) + 3} textAnchor="end" className="fill-[var(--color-paper-400)] text-[9px]">
                            {t}×
                        </text>
                    </g>
                ))}
                {[0, 0.5, 1, 1.5, 2, 2.5].map((v) => (
                    <text
                        key={v}
                        x={x(v)}
                        y={H - PAD.b + 14}
                        textAnchor="middle"
                        className="fill-[var(--color-paper-400)] text-[9px]"
                    >
                        {v.toFixed(1)}
                    </text>
                ))}
                <text
                    x={(W + PAD.l) / 2}
                    y={H - 2}
                    textAnchor="middle"
                    className="fill-[var(--color-paper-400)] text-[9px]"
                >
                    volume / capacity
                </text>
            </svg>

            <label htmlFor={id} className="mt-3 flex items-baseline justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-400">
                    volume / capacity
                </span>
                <span className="tabular font-mono text-[11px] text-accent">{vc.toFixed(2)}</span>
            </label>
            <input
                id={id}
                type="range"
                min={0}
                max={X_MAX}
                step={0.01}
                value={vc}
                onChange={(e) => setVc(Number(e.target.value))}
                className="civic-range mt-1 w-full"
                aria-valuetext={`${vc.toFixed(2)}, travel time ${m.toFixed(2)} times free flow`}
            />

            <figcaption className="mt-3 text-[12px] leading-relaxed text-paper-300">
                A twenty-minute free-flow trip takes{" "}
                <strong className="tabular font-medium text-paper-100">{minutes.toFixed(1)} minutes</strong>{" "}
                at this loading, {m.toFixed(2)}× free flow.{" "}
                {vc < STRESS_VC
                    ? "Below 0.85 the road absorbs demand almost without penalty, which is why adding residents to a corridor with headroom barely moves the transportation axis."
                    : vc < 1
                      ? "Past 0.85 each additional vehicle costs more than the last. This is the band the stress count reports."
                      : "Over capacity. The curve is still rising steeply; past this point the model reports the link as failed rather than trusting the exact figure."}
            </figcaption>
            <p className="mt-2 font-mono text-[10px] leading-relaxed text-paper-400">
                t = t₀(1 + {BPR_ALPHA}(v/c)<sup>{BPR_BETA}</sup>) · Bureau of Public Roads, 1964
                <br />
                Axis truncated at v/c {X_MAX}; the engine clamps the ratio at {BPR_MAX_VC}, where
                the curve reaches {multiple(BPR_MAX_VC).toFixed(0)}× and stops describing anything
                physical.
            </p>
        </figure>
    )
}
