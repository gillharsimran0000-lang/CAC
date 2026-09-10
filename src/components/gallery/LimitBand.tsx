"use client"

/**
 * THE BAND THAT ADMITS SOMETHING.
 *
 * Every other section of this page is an argument for the model. This one is
 * the counter-argument, and it is placed last on purpose: a tool that states
 * its limits only in a footnote is asking not to be checked.
 *
 * The photograph is the Buffalo National River. It carries no county caption
 * and no figure, unlike everything above it, because its Commons record has no
 * coordinates and the river runs through four counties -- so any join would be
 * invented. That is the same standard the rest of the page holds itself to,
 * applied to an image rather than a number.
 */

import { photo as findPhoto } from "@/data/photos"
import { BlurIn, Credit, Photograph } from "@/components/ui/motion"

const LIMITS = [
    ["Costs are placeholders", "Infrastructure unit costs are invented and labelled DEMO wherever they appear. Baseline and scenario are costed identically, so the comparison holds where the absolute figure does not."],
    ["Statewide traffic is coarse", "County-sized zones over-disperse trips however the gravity model is calibrated. Corridor stress at state scale is directional; the metro models carry the traffic claims."],
    ["Jobs are not where people are", "Trip attractions use population as an activity proxy. Employment is not distributed like residents, and this is the weakest assumption in the model."],
]

export function LimitBand() {
    const pic = findPhoto("buffalo-river")

    return (
        <section className="relative isolate overflow-hidden border-t border-ink-800">
            {pic && (
                <Photograph
                    photo={pic}
                    parallax={0.12}
                    priority={false}
                    fill
                    creditPosition="none"
                    focus="center 45%"
                    className="-z-10 brightness-[0.62] saturate-[0.8]"
                />
            )}
            {/* Reads as a graded ground rather than a photograph with text on
                top of it; the copy needs a contrast floor it can rely on at any
                viewport width. */}
            <div
                aria-hidden
                className="absolute inset-0 -z-10"
                style={{ background: "linear-gradient(180deg, rgba(6,7,10,0.62), rgba(6,7,10,0.5) 40%, rgba(6,7,10,0.9))" }}
            />

            <div className="mx-auto max-w-6xl px-6 py-24">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-paper-400">
                    What this cannot tell you
                </p>
                <BlurIn
                    as="h2"
                    className="font-display mt-4 max-w-[20ch] text-paper-100"
                    style={{ fontSize: "clamp(30px, 3.8vw, 62px)" }}
                >
                    A model is an argument, not a forecast.
                </BlurIn>

                <dl className="mt-12 grid gap-x-10 gap-y-8 md:grid-cols-3">
                    {LIMITS.map(([term, detail], i) => (
                        <div key={term} className="border-t border-paper-100/15 pt-4">
                            <dt className="flex items-baseline gap-3">
                                <span className="tabular font-mono text-[11px] text-paper-400">
                                    {String(i + 1).padStart(2, "0")}
                                </span>
                                <span className="text-[15px] text-paper-100">{term}</span>
                            </dt>
                            <dd className="mt-2 max-w-[42ch] text-[13px] leading-relaxed text-paper-300">
                                {detail}
                            </dd>
                        </div>
                    ))}
                </dl>

                <p className="mt-10 max-w-[64ch] text-[13px] leading-relaxed text-paper-300">
                    Nothing CivicFlow produces is an official forecast, and none of its wording is
                    written by a language model. Every sentence in a result is a template filled
                    from a number the simulation computed. Where a figure is measured it says so,
                    where it is modelled it says so, and where it is invented it says that too.
                </p>

                <a
                    href="/methodology"
                    className="mt-6 inline-flex items-center gap-2 rounded-md border border-paper-100/25 px-4 py-2.5 text-[13px] text-paper-100 transition-colors hover:border-accent hover:text-accent"
                >
                    Read the full methodology
                    <span aria-hidden>→</span>
                </a>
            </div>

            {pic && <Credit photo={pic} className="bottom-2 right-3" />}
        </section>
    )
}
