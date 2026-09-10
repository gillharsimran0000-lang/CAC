"use client"

/**
 * Provenance tags.
 *
 * Every number on screen carries one of these. The palette is reserved: these
 * three colours appear nowhere else in the app, so the label is legible even
 * peripherally, and there is no way to show a value while quietly omitting
 * where it came from -- the type system requires the field, and this renders it.
 */

import { Measured, Provenance } from "@/engine/types"

const STYLE: Record<Provenance, { label: string; className: string }> = {
    verified: { label: "VERIFIED DATA", className: "text-verified border-verified/35 bg-verified/10" },
    modelled: { label: "MODELLED RESULT", className: "text-modelled border-modelled/35 bg-modelled/10" },
    demo: { label: "DEMO DATA", className: "text-demo border-demo/35 bg-demo/10" },
}

export function ProvenanceTag({ level, compact }: { level: Provenance; compact?: boolean }) {
    const s = STYLE[level]
    return (
        <span
            className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase leading-none tracking-wider ${s.className}`}
        >
            {compact ? s.label.split(" ")[0] : s.label}
        </span>
    )
}

/** A measured value with its unit, tag, and -- on request -- its derivation. */
export function MeasuredRow({ name, m }: { name: string; m: Measured }) {
    return (
        <div className="flex items-baseline gap-2 border-b border-ink-800 py-1.5 last:border-0">
            <span className="flex-1 text-[11px] text-paper-300">{name}</span>
            <span className="tabular font-mono text-[11px] text-paper-100">
                {typeof m.value === "number" ? m.value.toLocaleString() : String(m.value)}
                <span className="ml-1 text-paper-400">{m.unit}</span>
            </span>
            <ProvenanceTag level={m.provenance} compact />
        </div>
    )
}
