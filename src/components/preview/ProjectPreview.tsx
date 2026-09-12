"use client"

/**
 * THE PENDING CHANGE, SHOWN THREE WAYS.
 *
 * A photograph of the ground, a model of the thing, and the axes it can reach.
 * Reading left to right that is: where this is, what it is, what it touches.
 *
 * The photograph earns its place by being the only part of this screen that is
 * not an abstraction. Everything else in the lab is a graph coloured by a
 * ratio, and after enough of that a corridor at v/c 0.91 stops being a road
 * anyone sits on. The photograph is a real one of the real place, from the same
 * credited Wikimedia manifest the gallery uses, so the credit travels with it.
 *
 * The panel deliberately does not show a number. Everything here is available
 * before the simulation runs, and any figure it printed would either be an
 * input the user just typed or a guess at an output. The numbers arrive on the
 * result page, which is where they have been earned.
 */

import Link from "next/link"
import type { Scene } from "@/render/solids"
import type { AxisTouch } from "@/data/projects"
import type { Axis, AxisKey } from "@/engine/types"
import { photo as findPhoto } from "@/data/photos"
import { Photograph } from "@/components/ui/motion"
import { BlueprintView } from "./BlueprintView"
import { PreviewDna } from "./PreviewDna"

/**
 * One line of "what this puts into the model".
 *
 * Typed rather than a bare string because the marker in front of it is a claim.
 * Every line used to be prefixed with a plus, which was true when every lever
 * added something and became a small lie the moment they did not: "+1 lane each
 * way removed from US 412" reads as a gain and is the opposite of one.
 */
export interface PreviewEffect {
    text: string
    /** add: capacity or people arrive. take: they leave. note: neither. */
    kind: "add" | "take" | "note"
}

export interface PreviewSpec {
    /** Restarts the build animation when it changes. */
    key: string
    title: string
    /** Where it is, as a person would say it. */
    place: string
    /** What the thing is. */
    what: string
    /** A concrete figure about it, for scale. Optional for hand-built changes. */
    scale?: string
    /** Slug in the photo manifest. */
    photo?: string
    /** What this puts into the model, in the engine's own terms. */
    effectLines: PreviewEffect[]
    /** What the model cannot see about it. */
    notModelled?: string
    touches: AxisTouch[]
    scene: Scene
}

export function ProjectPreview({
    spec,
    axes,
    axesLabel,
}: {
    spec: PreviewSpec | null
    /** The shape as it stands, for the DNA panel to draw as context. */
    axes: Record<AxisKey, Axis> | null
    axesLabel: string
}) {
    if (!spec) {
        return (
            <div className="flex h-full items-center justify-center border-t border-ink-800 bg-ink-950 px-6">
                <p className="max-w-md text-center text-[11px] leading-relaxed text-paper-400">
                    Pick a project or build a change on the left, and it is drawn here before you
                    run it: the place, the thing itself, and the axes it can reach.
                </p>
            </div>
        )
    }

    const pic = spec.photo ? findPhoto(spec.photo) : undefined

    return (
        <div className="grid h-full grid-cols-1 gap-px overflow-hidden border-t border-ink-800 bg-ink-800 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_260px]">
            {/* --- the ground --- */}
            <div className="relative flex min-h-[220px] flex-col bg-ink-950 p-3">
                <h3 className="font-pixel text-[11px] tracking-[0.2em] text-paper-300">
                    WHAT YOU ARE CHANGING
                </h3>
                <p className="mt-2 font-display-md text-paper-100" style={{ fontSize: "clamp(17px, 1.5vw, 22px)" }}>
                    {spec.title}
                </p>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-paper-400">
                    {spec.place}
                </p>

                {pic ? (
                    <div className="relative mt-3 min-h-0 flex-1 overflow-hidden rounded-md">
                        {/* Photograph renders its own credit, which is the
                            point of the component: a CC BY-SA image cannot be
                            shown here without naming the photographer. */}
                        <Photograph photo={pic} fill parallax={0} hoverZoom />
                    </div>
                ) : (
                    /* No photograph rather than a stand-in. The manifest only
                       holds images of real Arkansas places, and a corridor that
                       runs through nine counties has no single one; borrowing a
                       nearby photograph would make a claim about where this is
                       that nothing here can support. */
                    <div className="mt-3 grid min-h-0 flex-1 place-content-center rounded-md border border-dashed border-ink-700 px-4">
                        <p className="max-w-[28ch] text-center text-[10px] leading-relaxed text-paper-400">
                            No photograph of one place, because this change is not in one place.
                        </p>
                    </div>
                )}

                <p className="mt-3 text-[11px] leading-relaxed text-paper-300">{spec.what}</p>
                {spec.scale && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-paper-400">{spec.scale}</p>
                )}
            </div>

            {/* --- the thing --- */}
            <div className="flex min-h-[220px] flex-col bg-ink-950 p-3">
                <div className="flex items-baseline justify-between">
                    <h3 className="font-pixel text-[11px] tracking-[0.2em] text-paper-300">
                        THE PROJECT
                    </h3>
                    <span className="font-mono text-[9px] uppercase tracking-wider text-paper-400">
                        generated geometry, not a photograph
                    </span>
                </div>
                <BlueprintView scene={spec.scene} sceneKey={spec.key} className="mt-2 min-h-0 flex-1" />
                <ul className="mt-2.5 space-y-1">
                    {spec.effectLines.map((l) => (
                        <li key={l.text} className="flex gap-2 font-mono text-[10px] text-paper-300">
                            <span
                                aria-hidden
                                className={
                                    l.kind === "add"
                                        ? "text-accent"
                                        : l.kind === "take"
                                          ? "text-flow-tight"
                                          : "text-flow-warm"
                                }
                            >
                                {l.kind === "add" ? "+" : l.kind === "take" ? "↓" : "!"}
                            </span>
                            <span>{l.text}</span>
                        </li>
                    ))}
                </ul>
                {spec.notModelled && (
                    /* Clamped to three lines, with the whole sentence on hover.
                       Some catalogue entries run to five lines, and every line
                       here comes straight out of the height of the blueprint
                       above it. */
                    <p
                        title={spec.notModelled}
                        className="mt-2 line-clamp-3 border-l-2 border-demo/50 pl-2 text-[10px] leading-relaxed text-paper-400"
                    >
                        <span className="font-mono uppercase tracking-wider text-demo">
                            not modelled
                        </span>{" "}
                        {spec.notModelled}
                    </p>
                )}
            </div>

            {/* --- what it reaches --- */}
            <div className="overflow-y-auto bg-ink-950 p-3">
                <h3 className="font-pixel text-[11px] tracking-[0.2em] text-paper-300">
                    WHAT IT REACHES
                </h3>
                {axes ? (
                    <div className="mt-2">
                        <PreviewDna axes={axes} touches={spec.touches} label={axesLabel} />
                    </div>
                ) : (
                    <p className="mt-2 text-[11px] text-paper-400">Preparing the area.</p>
                )}
                <p className="mt-3 border-t border-ink-800 pt-2 text-[10px] leading-relaxed text-paper-400">
                    No shape is predicted here. The arrows say which axes the mechanism can move;
                    how far is what the run is for.{" "}
                    <Link href="/methodology" className="text-paper-300 underline underline-offset-2">
                        Methodology
                    </Link>
                </p>
            </div>
        </div>
    )
}
