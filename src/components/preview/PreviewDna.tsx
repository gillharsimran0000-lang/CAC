"use client"

/**
 * THE DNA, BEFORE THERE IS A RESULT.
 *
 * This is the hardest thing on the page to do honestly, so it is worth being
 * exact about what it does and does not draw.
 *
 * It draws the CURRENT shape -- the baseline, or the last run -- and then marks
 * the axes the pending change can physically reach, with the direction the
 * mechanism pushes. Nothing else. There is no predicted silhouette, because
 * predicting one would mean running the simulation, and if we had run the
 * simulation we would be showing the result rather than a preview.
 *
 * That distinction is the entire design. A tool that draws a guessed shape and
 * then quietly replaces it with the real one teaches the reader that the guess
 * was the answer. So the pending axes pulse on their spokes and say WHY they
 * can move -- "response times are computed on congested speeds" -- and the size
 * of the move is left blank until the engine has one. The arrows are a claim
 * about mechanism, which the code can support; a length would be a claim about
 * magnitude, which only a run can support.
 */

import { AXES, Axis, AxisKey } from "@/engine/types"
import { AXIS_HUE, START_ANGLE, axisPoints, splinePath } from "@/components/dna/DecisionDna"
import type { AxisTouch } from "@/data/projects"

const SHORT: Record<AxisKey, string> = {
    transportation: "TRANSPORT",
    emergencyAccess: "EMERGENCY",
    infrastructureCapacity: "CAPACITY",
    growthEfficiency: "EFFICIENCY",
    infrastructureBurden: "BURDEN",
}

const ARROW: Record<AxisTouch["direction"], string> = {
    up: "outward",
    down: "inward",
    either: "either way",
}

export function PreviewDna({
    axes,
    touches,
    size = 210,
    label = "now",
}: {
    /** The shape as it stands. Baseline, or the last completed run. */
    axes: Record<AxisKey, Axis>
    /** Axes the pending change can reach, and why. */
    touches: AxisTouch[]
    size?: number
    label?: string
}) {
    const padX = 58
    const vbWidth = size + padX * 2
    const cx = vbWidth / 2
    const cy = size / 2
    const rOuter = size * 0.38
    const rInner = size * 0.1

    const scores = AXES.map((k) => axes[k].score.value)
    const pts = axisPoints(scores, cx, cy, rInner, rOuter)
    const path = splinePath(pts)

    const byAxis = new Map(touches.map((t) => [t.axis, t]))

    return (
        <div>
            <svg
                width="100%"
                height={size}
                viewBox={`0 0 ${vbWidth} ${size}`}
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label={`Current profile, with the ${touches.length} axes this change can move marked`}
            >
                {[0.25, 0.5, 0.75, 1].map((t) => (
                    <circle
                        key={t}
                        cx={cx}
                        cy={cy}
                        r={rInner + t * (rOuter - rInner)}
                        fill="none"
                        stroke="#1c212c"
                        strokeWidth="1"
                    />
                ))}

                {AXES.map((k, i) => {
                    const a = START_ANGLE + (i / AXES.length) * Math.PI * 2
                    const touch = byAxis.get(k)
                    return (
                        <line
                            key={k}
                            x1={cx}
                            y1={cy}
                            x2={cx + Math.cos(a) * rOuter}
                            y2={cy + Math.sin(a) * rOuter}
                            stroke={touch ? AXIS_HUE[k] : "#1c212c"}
                            strokeWidth={touch ? 1.4 : 1}
                            opacity={touch ? 0.5 : 1}
                        />
                    )
                })}

                {/* The shape as it stands: held quiet, because it is context
                    here rather than the subject. */}
                <path
                    d={path}
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeWidth="1.6"
                    strokeDasharray="3 3"
                    opacity="0.75"
                    strokeLinejoin="round"
                />

                {/* One marker per reachable axis, sitting just outside the ring
                    and pointing the way the mechanism pushes. */}
                {AXES.map((k, i) => {
                    const touch = byAxis.get(k)
                    if (!touch) return null
                    const a = START_ANGLE + (i / AXES.length) * Math.PI * 2
                    const r = rOuter + 7
                    const x = cx + Math.cos(a) * r
                    const y = cy + Math.sin(a) * r
                    const dx = Math.cos(a) * 6
                    const dy = Math.sin(a) * 6
                    const hue = AXIS_HUE[k]

                    return (
                        <g key={k}>
                            {touch.direction !== "down" && (
                                <path
                                    d={`M ${x} ${y} l ${dx} ${dy} l ${-dy * 0.55} ${dx * 0.55} M ${x + dx} ${y + dy} l ${dy * 0.55} ${-dx * 0.55}`}
                                    stroke={hue}
                                    strokeWidth="1.6"
                                    fill="none"
                                    strokeLinecap="round"
                                />
                            )}
                            {touch.direction !== "up" && (
                                <path
                                    d={`M ${x} ${y} l ${-dx} ${-dy} l ${dy * 0.55} ${-dx * 0.55} M ${x - dx} ${y - dy} l ${-dy * 0.55} ${dx * 0.55}`}
                                    stroke={hue}
                                    strokeWidth="1.6"
                                    fill="none"
                                    strokeLinecap="round"
                                />
                            )}
                            <circle cx={x} cy={y} r="2.6" fill={hue}>
                                <animate
                                    attributeName="opacity"
                                    values="0.35;1;0.35"
                                    dur="2.4s"
                                    repeatCount="indefinite"
                                />
                            </circle>
                        </g>
                    )
                })}

                {AXES.map((k, i) => {
                    const a = START_ANGLE + (i / AXES.length) * Math.PI * 2
                    const lx = cx + Math.cos(a) * (rOuter + 24)
                    const ly = cy + Math.sin(a) * (rOuter + 24)
                    const anchor =
                        Math.abs(Math.cos(a)) < 0.3 ? "middle" : Math.cos(a) > 0 ? "start" : "end"
                    return (
                        <text
                            key={k}
                            x={lx}
                            y={ly}
                            textAnchor={anchor}
                            dominantBaseline="middle"
                            className="font-mono"
                            fontSize="8"
                            fill={byAxis.has(k) ? AXIS_HUE[k] : "#6b7688"}
                            letterSpacing="0.08em"
                        >
                            {SHORT[k]}
                        </text>
                    )
                })}
            </svg>

            <p className="mt-1 text-center font-mono text-[9px] uppercase tracking-wider text-paper-400">
                dashed: {label}. arrows: what this change can reach, not how far.
            </p>

            <ul className="mt-3 space-y-1.5">
                {touches.map((t) => (
                    <li key={t.axis} className="flex gap-2 text-[10px] leading-relaxed">
                        <span
                            className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ background: AXIS_HUE[t.axis] }}
                        />
                        <span className="text-paper-400">
                            <span className="text-paper-200">{SHORT[t.axis]}</span>{" "}
                            <span className="font-mono text-[9px] uppercase tracking-wider">
                                {ARROW[t.direction]}
                            </span>
                            <br />
                            {t.because}
                        </span>
                    </li>
                ))}
                {touches.length === 0 && (
                    <li className="text-[10px] leading-relaxed text-paper-400">
                        Nothing pending. Add a change and the axes it can reach are marked here.
                    </li>
                )}
            </ul>
        </div>
    )
}
