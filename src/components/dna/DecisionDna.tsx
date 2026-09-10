"use client"

/**
 * DECISION DNA: a scenario's tradeoff profile as a single shape.
 *
 * The obvious way to plot five axes is a radar chart, and it is the wrong one.
 * Radar polygons all read as "roughly a pentagon, a bit dented"; two scenarios
 * that differ meaningfully still look like siblings, which defeats the entire
 * purpose of a fingerprint you are supposed to recognise at a glance. So the
 * five values instead drive a smooth closed curve through a cardinal spline.
 * Curvature amplifies difference: a scenario strong on two adjacent axes bulges
 * into a lobe, one strong on opposite axes pinches into a waist, and those are
 * different SHAPES rather than different dent depths.
 *
 * The shape is never the whole story on its own, so the raw measurement always
 * sits beside the score. This matters more than it looks: axis scores are
 * min-max normalised against the area's sweep envelope, so a six-point swing in
 * real emergency coverage can span the full 0-100. That makes the score an
 * excellent comparator and a terrible absolute, and showing both is what keeps
 * it honest.
 */

import { AXES, Axis, AxisKey } from "@/engine/types"
import { DURATION, useTweenedArray } from "@/lib/motion"

const AXIS_HUE: Record<AxisKey, string> = {
    transportation: "#7aa5e6",
    emergencyAccess: "#3ddc97",
    infrastructureCapacity: "#f2c14e",
    growthEfficiency: "#c084fc",
    infrastructureBurden: "#f28f3b",
}

const SHORT: Record<AxisKey, string> = {
    transportation: "TRANSPORT",
    emergencyAccess: "EMERGENCY",
    infrastructureCapacity: "CAPACITY",
    growthEfficiency: "EFFICIENCY",
    infrastructureBurden: "BURDEN",
}

/**
 * Adjectives per axis, high and low.
 *
 * These are a lookup table indexed by a number, not a description generated at
 * runtime. The spec is explicit that no conclusion may be invented, and a
 * scenario's headline words are a conclusion.
 */
const WORDS: Record<AxisKey, [high: string, low: string]> = {
    transportation: ["CONNECTED", "CONGESTED"],
    emergencyAccess: ["ACCESSIBLE", "EXPOSED"],
    infrastructureCapacity: ["PROVISIONED", "STRAINED"],
    growthEfficiency: ["EFFICIENT", "DISPERSED"],
    infrastructureBurden: ["AFFORDABLE", "COSTLY"],
}

/** The three axes furthest from the middle, in either direction. */
export function dnaWords(axes: Record<AxisKey, Axis>): { word: string; key: AxisKey; high: boolean }[] {
    return AXES.map((k) => ({
        key: k,
        score: axes[k].score.value,
        distance: Math.abs(axes[k].score.value - 50),
    }))
        .sort((a, b) => b.distance - a.distance)
        .slice(0, 3)
        .map(({ key, score }) => ({ key, high: score >= 50, word: WORDS[key][score >= 50 ? 0 : 1] }))
}

/* --- geometry ---------------------------------------------------------- */

export const START_ANGLE = -Math.PI / 2

export function axisPoints(scores: number[], cx: number, cy: number, rInner: number, rOuter: number) {
    return scores.map((s, i) => {
        const angle = START_ANGLE + (i / scores.length) * Math.PI * 2
        const r = rInner + (Math.max(0, Math.min(100, s)) / 100) * (rOuter - rInner)
        return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as [number, number]
    })
}

/**
 * Closed cardinal spline through the five points.
 *
 * Tension 0.5 is a Catmull-Rom: it passes exactly through every value -- which
 * it must, or the picture would be lying about the numbers -- while curving
 * between them.
 */
export function splinePath(pts: [number, number][], tension = 0.5): string {
    const n = pts.length
    if (n < 3) return ""
    const at = (i: number) => pts[(i + n) % n]
    let d = `M ${at(0)[0].toFixed(2)} ${at(0)[1].toFixed(2)}`
    for (let i = 0; i < n; i++) {
        const p0 = at(i - 1)
        const p1 = at(i)
        const p2 = at(i + 1)
        const p3 = at(i + 2)
        const c1 = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension]
        const c2 = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension]
        d += ` C ${c1[0].toFixed(2)} ${c1[1].toFixed(2)}, ${c2[0].toFixed(2)} ${c2[1].toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`
    }
    return `${d} Z`
}

/* --- component --------------------------------------------------------- */

export interface DnaProps {
    axes: Record<AxisKey, Axis>
    /** Drawn as an outline behind, for comparison. */
    compareAxes?: Record<AxisKey, Axis> | null
    compareLabel?: string
    label?: string
    size?: number
    showValues?: boolean
    /** Deform from these scores on mount. Used on the result page, where the
        shape should be seen changing out of the baseline rather than simply
        appearing in its final form. */
    morphFrom?: Record<AxisKey, Axis> | null
}

export function DecisionDna({
    axes,
    compareAxes,
    compareLabel,
    label,
    size = 260,
    showValues = true,
    morphFrom,
}: DnaProps) {
    /* The shape is square, but the left and right axis labels sit outside it
       and were being clipped to "DEN" and "EME". The viewBox is therefore wider
       than it is tall, with the geometry still centred -- the labels name the
       axes, so a truncated one makes the whole chart unreadable. */
    const padX = 62
    const vbWidth = size + padX * 2
    const cx = vbWidth / 2
    const cy = size / 2
    const rOuter = size * 0.38
    const rInner = size * 0.1

    /* The silhouette morphs between scenarios rather than being replaced.
       Snapping made the comparison something you had to remember -- you saw the
       old shape, then a different one, and had to reconstruct the difference.
       Interpolating the five radii means the collapse of an axis is something
       you WATCH happen, which is the entire point of a fingerprint. The vertices
       still land exactly on the values; only the journey there is animated. */
    const targetScores = AXES.map((k) => axes[k].score.value)
    const initialScores = morphFrom ? AXES.map((k) => morphFrom[k].score.value) : undefined
    const scores = useTweenedArray(targetScores, DURATION.shape, initialScores)
    const pts = axisPoints(scores, cx, cy, rInner, rOuter)
    const path = splinePath(pts)

    // The comparison outline is a fixed reference, so it does not animate --
    // two moving shapes would give the eye nothing to measure against.
    const comparePts = compareAxes
        ? axisPoints(AXES.map((k) => compareAxes[k].score.value), cx, cy, rInner, rOuter)
        : null
    const comparePath = comparePts ? splinePath(comparePts) : null

    const gradId = `dna-${label?.replace(/\W/g, "") ?? "x"}`

    return (
        <div className="flex flex-col items-center">
            <svg
                width="100%"
                height={size}
                viewBox={`0 0 ${vbWidth} ${size}`}
                preserveAspectRatio="xMidYMid meet"
                role="img"
                 aria-label={`Decision DNA profile${label ? ` for ${label}` : ""}`}>
                <defs>
                    <radialGradient id={gradId}>
                        <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.34" />
                        <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.06" />
                    </radialGradient>
                </defs>

                {/* Reference rings at 25/50/75/100, so the shape can be read as
                    a magnitude and not just admired as a silhouette. */}
                {[0.25, 0.5, 0.75, 1].map((t) => (
                    <circle key={t} cx={cx} cy={cy} r={rInner + t * (rOuter - rInner)}
                            fill="none" stroke="#1c212c" strokeWidth="1" />
                ))}

                {/* Spokes and axis dots */}
                {AXES.map((k, i) => {
                    const a = START_ANGLE + (i / AXES.length) * Math.PI * 2
                    return (
                        <line key={k} x1={cx} y1={cy}
                              x2={cx + Math.cos(a) * rOuter} y2={cy + Math.sin(a) * rOuter}
                              stroke="#1c212c" strokeWidth="1" />
                    )
                })}

                {comparePath && (
                    <path d={comparePath} fill="none" stroke="#6b7688" strokeWidth="1.5"
                          strokeDasharray="4 3" opacity="0.9" />
                )}

                {/* The stroke reads the accent token rather than repeating its
                    hex: the literal here was left behind when the accent was
                    desaturated, so the signature shape was still drawn in the
                    old colour. */}
                <path
                    data-dna-shape
                    d={path}
                    fill={`url(#${gradId})`}
                    stroke="var(--color-accent)"
                    strokeWidth="2"
                    strokeLinejoin="round"
                />

                {pts.map(([x, y], i) => (
                    <circle key={AXES[i]} cx={x} cy={y} r="3.5" fill={AXIS_HUE[AXES[i]]}
                            stroke="#06070a" strokeWidth="1.5" />
                ))}

                {/* Axis labels sit outside the outer ring. */}
                {AXES.map((k, i) => {
                    const a = START_ANGLE + (i / AXES.length) * Math.PI * 2
                    const lx = cx + Math.cos(a) * (rOuter + 16)
                    const ly = cy + Math.sin(a) * (rOuter + 16)
                    const anchor = Math.abs(Math.cos(a)) < 0.3 ? "middle" : Math.cos(a) > 0 ? "start" : "end"
                    return (
                        <text key={k} x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle"
                              className="font-mono" fontSize="8.5" fill="#8a94a6" letterSpacing="0.08em">
                            {SHORT[k]}
                        </text>
                    )
                })}
            </svg>

            {compareLabel && (
                <div className="mt-1 flex items-center gap-3 font-mono text-[10px] text-paper-400">
                    <span className="flex items-center gap-1.5">
                        <span className="h-0.5 w-4 bg-accent" /> {label}
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="h-0.5 w-4 border-t border-dashed border-paper-400" /> {compareLabel}
                    </span>
                </div>
            )}

            {showValues && (
                <dl className="mt-4 w-full space-y-1.5">
                    {AXES.map((k, i) => {
                        const ax = axes[k]
                        const shown = Math.round(scores[i] ?? ax.score.value)
                        const delta = compareAxes ? ax.score.value - compareAxes[k].score.value : null
                        return (
                            <div key={k} className="flex items-baseline gap-2 text-[11px]">
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full"
                                      style={{ background: AXIS_HUE[k] }} />
                                <dt className="flex-1 truncate text-paper-300">{ax.label}</dt>
                                <dd className="tabular font-mono text-paper-400">
                                    {ax.raw.value.toLocaleString()} {ax.raw.unit}
                                </dd>
                                <dd className="tabular w-8 text-right font-mono font-medium text-paper-100">
                                    {shown}
                                </dd>
                                {delta !== null && (
                                    <dd className={`tabular w-9 text-right font-mono ${
                                        delta > 0 ? "text-flow-free" : delta < 0 ? "text-flow-over" : "text-paper-400"
                                    }`}>
                                        {delta > 0 ? "+" : ""}{delta}
                                    </dd>
                                )}
                            </div>
                        )
                    })}
                </dl>
            )}
        </div>
    )
}

/** The three-word read, shown above the shape. */
export function DnaWords({ axes }: { axes: Record<AxisKey, Axis> }) {
    return (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
            {dnaWords(axes).map(({ word, key, high }) => (
                <span key={key} className="font-pixel text-[13px] tracking-[0.14em]"
                      style={{ color: high ? AXIS_HUE[key] : "#6b7688" }}>
                    {word}
                </span>
            ))}
        </div>
    )
}

export { AXIS_HUE }
