"use client"

/**
 * DECISION HISTORY.
 *
 * Every run is kept, with the actions that produced it and the result they
 * produced, and any of them can be restored. That is deliberately not an undo
 * stack: undo throws away the path not taken, and the path not taken is the
 * experiment. Restoring an earlier version loads its actions back for editing
 * without deleting anything after it, so the timeline accumulates attempts the
 * way a lab notebook does.
 *
 * Versions record their parent, so a restore followed by a change reads as a
 * branch rather than as a straight line that silently lost its middle.
 */

import { Version, useLab } from "@/state/lab"
import { Action } from "@/engine/types"

/**
 * One line per action, in the same words the builder used.
 *
 * A switch rather than a chain ending in a fallback, and that is the whole
 * lesson from the last time this changed: the fallback said "new fire station"
 * for anything it did not recognise, so when six new levers arrived the history
 * cheerfully reported four fire stations that nobody had asked for. A switch
 * over the union makes the compiler name every kind that is missing.
 */
function describe(
    actions: Action[],
    zoneName: (geoid: string) => string,
    corridorName: (id: number) => string,
    facilityName: (id: string) => string,
): string[] {
    if (!actions.length) return ["baseline, no changes"]
    return actions.map((a): string => {
        switch (a.kind) {
            case "addResidents":
                return a.count >= 0
                    ? `+${a.count.toLocaleString()} residents · ${zoneName(a.zoneGeoid)}`
                    : `${Math.abs(a.count).toLocaleString()} residents gone · ${zoneName(a.zoneGeoid)}`
            case "addJobs":
                return `+${a.jobs.toLocaleString()} jobs · ${zoneName(a.zoneGeoid)}`
            case "upgradeUtility":
                return `+${a.dwellings.toLocaleString()} dwellings served · ${zoneName(a.zoneGeoid)}`
            case "expandCorridor":
                return a.addedLanesPerDir >= 0
                    ? `+${a.addedLanesPerDir} lane${a.addedLanesPerDir > 1 ? "s" : ""}/dir · ${corridorName(a.corridorId)}`
                    : `${Math.abs(a.addedLanesPerDir)} lane${a.addedLanesPerDir < -1 ? "s" : ""}/dir removed · ${corridorName(a.corridorId)}`
            case "setSpeedLimit":
                return `${a.mph} mph posted · ${corridorName(a.corridorId)}`
            case "removeFacility":
                return `closed · ${facilityName(a.facilityId)}`
            case "addFacility":
                return a.facilityKind === "ems" ? "new ambulance post" : "new fire station"
        }
    })
}

export function DecisionHistory() {
    const versions = useLab((s) => s.versions)
    const currentId = useLab((s) => s.currentId)
    const compareId = useLab((s) => s.compareId)
    const restore = useLab((s) => s.restore)
    const setCompare = useLab((s) => s.setCompare)
    const area = useLab((s) => s.area)

    const zoneName = (geoid: string) =>
        area?.zones.find((z) => z.geoid === geoid)?.name ?? geoid
    const corridorName = (id: number) =>
        area?.corridors.find((c) => c.id === id)?.label ?? `corridor ${id}`
    const facilityName = (id: string) => {
        const f = area?.facilities.find((x) => x.id === id)
        return f?.name ?? (f ? `${f.kind} station` : "a station")
    }

    if (!versions.length) {
        return (
            <div className="rounded-md border border-dashed border-ink-700 p-4">
                <h2 className="font-pixel text-[11px] tracking-[0.2em] text-paper-300">
                    DECISION HISTORY
                </h2>
                <p className="mt-2 text-[11px] leading-relaxed text-paper-400">
                    Every simulation you run is kept here with its result. Restore any version to
                    branch from it.
                </p>
            </div>
        )
    }

    return (
        <div>
            <header className="mb-3 flex items-baseline justify-between">
                <h2 className="font-pixel text-[11px] tracking-[0.2em] text-paper-300">
                    DECISION HISTORY
                </h2>
                <span className="font-mono text-[10px] text-paper-400">
                    {versions.length} version{versions.length === 1 ? "" : "s"}
                </span>
            </header>

            <ol className="space-y-1.5">
                {versions.map((v, i) => (
                    <HistoryRow
                        key={v.id}
                        version={v}
                        previous={versions[i - 1] ?? null}
                        isCurrent={v.id === currentId}
                        isCompare={v.id === compareId}
                        lines={describe(v.actions, zoneName, corridorName, facilityName)}
                        onRestore={() => restore(v.id)}
                        onCompare={() => setCompare(compareId === v.id ? null : v.id)}
                    />
                ))}
            </ol>
        </div>
    )
}

function HistoryRow({
    version,
    previous,
    isCurrent,
    isCompare,
    lines,
    onRestore,
    onCompare,
}: {
    version: Version
    previous: Version | null
    isCurrent: boolean
    isCompare: boolean
    lines: string[]
    onRestore: () => void
    onCompare: () => void
}) {
    const score = version.result?.civic.value ?? null
    const prevScore = previous?.result?.civic.value ?? null
    const delta = score != null && prevScore != null ? score - prevScore : null

    return (
        <li
            className={`animate-row-in rounded-md border px-3 py-2.5 transition-colors ${
                isCurrent
                    ? "border-accent/60 bg-accent/[0.07]"
                    : "border-ink-700 bg-ink-900 hover:border-ink-600"
            }`}
        >
            <div className="flex items-center gap-2">
                <span className="font-pixel text-[11px] tracking-[0.14em] text-paper-200">
                    {version.label}
                </span>
                {version.parentId && (
                    <span
                        className="font-mono text-[9px] text-paper-400"
                        title="branched from an earlier version"
                    >
                        ↳ branch
                    </span>
                )}
                <span className="ml-auto flex items-baseline gap-1.5">
                    {score != null ? (
                        <>
                            <span className="tabular font-mono text-sm font-medium text-paper-100">
                                {score}
                            </span>
                            {delta !== null && delta !== 0 && (
                                <span
                                    className={`tabular font-mono text-[10px] ${
                                        delta > 0 ? "text-flow-free" : "text-flow-over"
                                    }`}
                                >
                                    {delta > 0 ? "+" : ""}
                                    {delta}
                                </span>
                            )}
                        </>
                    ) : (
                        <span className="font-mono text-[10px] text-paper-400">running…</span>
                    )}
                </span>
            </div>

            <ul className="mt-1.5 space-y-0.5">
                {lines.map((l, i) => (
                    <li key={i} className="truncate text-[11px] text-paper-400">
                        {l}
                    </li>
                ))}
            </ul>

            <div className="mt-2 flex gap-3">
                <button
                    type="button"
                    onClick={onRestore}
                    disabled={isCurrent}
                    className="font-mono text-[10px] text-accent transition-opacity hover:opacity-70 disabled:cursor-default disabled:text-paper-400 disabled:opacity-60"
                >
                    {isCurrent ? "current" : "restore"}
                </button>
                <button
                    type="button"
                    onClick={onCompare}
                    disabled={!version.result}
                    className={`font-mono text-[10px] transition-opacity hover:opacity-70 disabled:cursor-default disabled:opacity-40 ${
                        isCompare ? "text-flow-warm" : "text-paper-300"
                    }`}
                >
                    {isCompare ? "comparing" : "compare"}
                </button>
            </div>
        </li>
    )
}
