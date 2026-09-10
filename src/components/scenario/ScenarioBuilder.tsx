"use client"

/**
 * Building a scenario.
 *
 * Two ways in, because there are two kinds of person at this screen.
 *
 * FROM ARKANSAS is a list of twenty real projects. You search it, you pick one,
 * and the actions it implies are resolved against whichever area is loaded and
 * dropped into the scenario. Somebody who knows the state but not this tool can
 * start here and be running a simulation in one click, and what they ran is
 * legible afterwards: "Bella Vista Bypass", not "corridor 41, +2 lanes".
 *
 * BUILD IT YOURSELF is the row that reads as a sentence:
 *
 *      Add [ more people ▾ ] in [ Benton, tract 21304.3 ]  [ 10,000 ]  (Add)
 *
 * Both the place and the number can now be TYPED. That is not a small change.
 * The place used to be a native select holding every zone in the area -- three
 * hundred at metro scale, and the browser's own type-ahead only matches from
 * the start of the string, so it could not find anything. And the count used to
 * be a slider alone, which meant every scenario in the tool's history was a
 * multiple of five hundred: an actual projection of 37,412 was unsayable.
 *
 * The list of things you can change grew from three to ten, but only as far as
 * the engine can honestly follow, and it grew in two directions.
 *
 * Sideways: ambulance posts joined fire stations, because both are first
 * response sources under NFPA 1710. Water and sewer capacity joined, because
 * headroom was already measured in dwellings a zone's systems were sized for.
 * Jobs joined, and that one is the biggest gap closed: every lever until then
 * moved trip PRODUCTIONS, so the tool could say where people sleep and never
 * where they go.
 *
 * And downwards. Every original lever added something, which quietly made the
 * whole instrument an argument for building. Losing residents, narrowing a
 * road, posting a lower limit and closing a station are all real decisions that
 * real Arkansas places make, and a model that can only be asked the optimistic
 * half of the question is a brochure. They are grouped under "take away" rather
 * than hidden behind a minus sign, because choosing to remove capacity is a
 * different act from mistyping a number.
 *
 * Parks, schools and libraries still did not join, and the panel says why
 * rather than offering a lever that quietly does nothing.
 */

import { useEffect, useMemo, useState } from "react"
import { Action, FacilityKind } from "@/engine/types"
import { useLab } from "@/state/lab"
import { Combobox, NumberScrub } from "@/components/ui/Combobox"
import {
    FORM_META,
    PlaceProfile,
    REGION_META,
    householdSize,
    placeFacts,
    profileOf,
} from "@/data/place"
import { UNIT_COSTS, UPGRADE_THRESHOLD } from "@/engine/metrics"
import {
    LeverKind,
    Project,
    genericTouches,
    placeScene,
    projectKind,
    projectsFor,
    searchProjects,
} from "@/data/projects"
import type { PreviewEffect, PreviewSpec } from "@/components/preview/ProjectPreview"
import { photosInCounty } from "@/data/photos"

type Kind = LeverKind

/** What each lever is called, in the sentence the row reads as. */
const KIND_LABEL: Record<Kind, string> = {
    residents: "more people",
    jobs: "jobs",
    corridor: "road lanes",
    fire: "a fire station",
    ems: "an ambulance post",
    utility: "water and sewer capacity",
    decline: "fewer people",
    diet: "a road diet",
    speed: "a lower speed limit",
    closure: "a station closure",
}

/**
 * The two halves of the menu.
 *
 * Grouping is not decoration here. Removing capacity is a different kind of
 * decision from adding it, and a flat list of ten put "a station closure"
 * between "an ambulance post" and "water and sewer capacity" as though the
 * three were variations on one theme.
 */
const KIND_GROUPS: { label: string; kinds: Kind[] }[] = [
    { label: "Build or grow", kinds: ["residents", "jobs", "corridor", "fire", "ems", "utility"] },
    { label: "Take away", kinds: ["decline", "diet", "speed", "closure"] },
]

/**
 * The verb the row opens with.
 *
 * Needed because one verb cannot carry ten levers. "Add" in front of every
 * option produced "Add a station closure at Avoca Fire Station", and making it
 * "Close" for that one produced "Close a station closure". The row is a
 * sentence, so it needs a verb per lever and a preposition per lever, and then
 * every one of the ten reads as something a person would actually say.
 */
const KIND_VERB: Record<Kind, string> = {
    residents: "Add",
    jobs: "Add",
    corridor: "Add",
    fire: "Add",
    ems: "Add",
    utility: "Add",
    decline: "Plan for",
    diet: "Put",
    speed: "Post",
    closure: "Model",
}

/** The preposition that makes each row read as English. */
const KIND_PREP: Record<Kind, string> = {
    residents: "in",
    jobs: "in",
    corridor: "to",
    fire: "in",
    ems: "in",
    utility: "for",
    decline: "in",
    diet: "on",
    speed: "on",
    closure: "at",
}

/** Which picker the row needs: a place, a corridor, or an existing station. */
const KIND_TARGET: Record<Kind, "zone" | "corridor" | "facility"> = {
    residents: "zone",
    jobs: "zone",
    corridor: "corridor",
    fire: "zone",
    ems: "zone",
    utility: "zone",
    decline: "zone",
    diet: "corridor",
    speed: "corridor",
    closure: "facility",
}

const KIND_ACCENT: Record<Kind, string> = {
    residents: "#7aa5e6",
    jobs: "#c084fc",
    corridor: "#f2c14e",
    fire: "#e5484d",
    ems: "#e5484d",
    utility: "#3ddc97",
    decline: "#f28f3b",
    diet: "#f28f3b",
    speed: "#f28f3b",
    closure: "#e5484d",
}

const CATEGORY_TONE: Record<ReturnType<typeof projectKind>, string> = {
    corridor: "#f2c14e",
    growth: "#7aa5e6",
    response: "#e5484d",
    utility: "#3ddc97",
}

/* --- resolving a project against whatever area is loaded ---------------- */

type Area = NonNullable<ReturnType<typeof useLab.getState>["area"]>

/**
 * A photograph of the county a hand-built change lands in, if there is one.
 *
 * Zone names carry their county in front of the tract: "Benton · tract 21304.3"
 * at metro scale, and the bare county name at state scale. Both start with the
 * county, which is the only join needed here.
 *
 * The catalogue names its own photograph, because a project is a specific place
 * and the photograph should be of THAT place. A hand-built change is only ever
 * "somewhere in this county", so a county photograph is the strongest honest
 * claim available, and none at all is better than one that implies otherwise.
 */
function countyPhoto(zoneName: string | undefined): string | undefined {
    if (!zoneName) return undefined
    const county = zoneName.split("·")[0].trim()
    return photosInCounty(county)[0]?.slug
}

/**
 * A name for a station that has none.
 *
 * OSM records a great many fire stations with geometry and no `name` tag, and
 * "unnamed" repeated forty times in a picker is useless. The coordinates are at
 * least distinguishing, and they are what the model actually used.
 */
function stationLabel(f?: { kind: string; name: string | null; lonLat: [number, number] }): string {
    if (!f) return ""
    if (f.name) return f.name
    return `${f.kind} station at ${f.lonLat[1].toFixed(3)}, ${f.lonLat[0].toFixed(3)}`
}

/**
 * The one line describing a hand-built change, in the same voice the catalogue
 * uses for its effects.
 *
 * One function rather than a ternary at each call site, because the preview and
 * the scenario list have to agree word for word: two descriptions of the same
 * pending action that differ by a comma read as two different actions.
 */
function manualLine(
    kind: Kind,
    place: string,
    v: { residents: number; lanes: number; dwellings: number; jobs: number; mph: number },
): PreviewEffect {
    const add = (text: string): PreviewEffect => ({ text, kind: "add" })
    const take = (text: string): PreviewEffect => ({ text, kind: "take" })
    switch (kind) {
        case "residents":
            return add(`${v.residents.toLocaleString()} residents in ${place}`)
        case "decline":
            return take(`${v.residents.toLocaleString()} residents gone from ${place}`)
        case "jobs":
            return add(`${v.jobs.toLocaleString()} jobs in ${place}`)
        case "utility":
            return add(`capacity for ${v.dwellings.toLocaleString()} dwellings in ${place}`)
        case "corridor":
            return add(`${v.lanes} lane${v.lanes > 1 ? "s" : ""} each way on ${place}`)
        case "diet":
            return take(`${v.lanes} lane${v.lanes > 1 ? "s" : ""} each way removed from ${place}`)
        case "speed":
            return take(`${v.mph} mph posted on ${place}`)
        case "closure":
            return take(`${place} closed`)
        case "fire":
            return add(`a fire station in ${place}`)
        case "ems":
            return add(`an ambulance post in ${place}`)
    }
}

/** Great-circle is overkill inside one state; squared degrees ranks the same. */
function nearestZone(area: Area, lonLat: [number, number]) {
    let best = area.zones[0]
    let bestD = Infinity
    for (const z of area.zones) {
        const dx = z.centroid[0] - lonLat[0]
        const dy = z.centroid[1] - lonLat[1]
        const d = dx * dx + dy * dy
        if (d < bestD) {
            bestD = d
            best = z
        }
    }
    return best
}

/**
 * The corridors a project's routes actually resolve to here.
 *
 * OSM labels a way with every route that runs along it, so I-49 through
 * Fayetteville is "I 49;US 62;US 71". Matching on a word-bounded route number
 * therefore has to be a regex over the whole label rather than an equality
 * test, and one project can legitimately match several corridor records.
 */
function matchingCorridors(area: Area, match: RegExp) {
    return area.corridors.filter((c) => match.test(c.label))
}

/**
 * A project, translated into this area's actions.
 *
 * Returns what it could resolve AND what it could not, because a template that
 * silently dropped half of itself would be worse than one that refused. The
 * statewide model has every route; the two metro models do not, so picking a
 * Delta project while Northwest Arkansas is loaded has to say so.
 */
function resolveProject(
    area: Area,
    project: Project,
): { actions: Action[]; lines: PreviewEffect[]; missing: string[] } {
    const actions: Action[] = []
    const lines: PreviewEffect[] = []
    const missing: string[] = []
    const zone = nearestZone(area, project.lonLat)

    for (const effect of project.effects) {
        if (effect.kind === "corridor") {
            const hits = matchingCorridors(area, effect.match)
            if (hits.length === 0) {
                missing.push(`${effect.routes} is not in the ${area.label} network`)
                continue
            }
            // Longest first: the route's main line before its spurs and links.
            for (const c of [...hits].sort((a, b) => b.lengthM - a.lengthM).slice(0, 3)) {
                actions.push({
                    kind: "expandCorridor",
                    corridorId: c.id,
                    addedLanesPerDir: effect.lanes,
                })
            }
            lines.push({
                text: `${effect.lanes} lane${effect.lanes > 1 ? "s" : ""} each way on ${effect.routes}`,
                kind: effect.lanes >= 0 ? "add" : "take",
            })
        } else if (effect.kind === "residents") {
            actions.push({ kind: "addResidents", zoneGeoid: zone.geoid, count: effect.count })
            lines.push({
                text: `${Math.abs(effect.count).toLocaleString()} residents ${effect.count >= 0 ? "in" : "gone from"} ${zone.name}`,
                kind: effect.count >= 0 ? "add" : "take",
            })
        } else if (effect.kind === "station") {
            actions.push({
                kind: "addFacility",
                facilityKind: effect.facility,
                lonLat: project.lonLat,
            })
            lines.push({
                text: `${effect.facility === "fire" ? "a fire station" : "an ambulance post"} at ${project.place}`,
                kind: "add",
            })
        } else {
            actions.push({
                kind: "upgradeUtility",
                zoneGeoid: zone.geoid,
                dwellings: effect.dwellings,
            })
            lines.push({
                text: `capacity for ${effect.dwellings.toLocaleString()} dwellings in ${zone.name}`,
                kind: "add",
            })
        }
    }

    return { actions, lines, missing }
}

/**
 * Which number a lever is asking for, and where it lives.
 *
 * A table rather than a chain of conditionals in the markup. Ten levers with
 * four distinct units between them had produced five near-identical blocks of
 * JSX differing only in a label and a range, which is exactly the shape that
 * gets one of them out of step with the others the next time a range changes.
 * Levers that ask for no number at all (a station, a closure) are absent from
 * the table, and the control simply does not render.
 */
interface AmountValues {
    residents: number
    lanes: number
    dwellings: number
    jobs: number
    mph: number
}
interface AmountSetters {
    setResidents: (n: number) => void
    setLanes: (n: number) => void
    setDwellings: (n: number) => void
    setJobs: (n: number) => void
    setMph: (n: number) => void
}
interface AmountControl {
    label: string
    min: number
    max: number
    step: number
    suffix?: string
    get: (v: AmountValues) => number
    set: (n: number, s: AmountSetters) => void
}

const AMOUNT_CONTROL: Partial<Record<Kind, AmountControl>> = {
    residents: {
        label: "How many people",
        min: 100, max: 80000, step: 100,
        get: (v) => v.residents,
        set: (n, s) => s.setResidents(n),
    },
    decline: {
        label: "How many people leave",
        min: 100, max: 80000, step: 100,
        get: (v) => v.residents,
        set: (n, s) => s.setResidents(n),
    },
    jobs: {
        label: "How many jobs",
        min: 100, max: 60000, step: 100,
        get: (v) => v.jobs,
        set: (n, s) => s.setJobs(n),
    },
    corridor: {
        label: "Lanes each way",
        min: 1, max: 4, step: 1,
        get: (v) => v.lanes,
        set: (n, s) => s.setLanes(n),
    },
    diet: {
        label: "Lanes removed each way",
        min: 1, max: 4, step: 1,
        get: (v) => v.lanes,
        set: (n, s) => s.setLanes(n),
    },
    speed: {
        label: "Posted limit",
        min: 15, max: 75, step: 5, suffix: "mph",
        get: (v) => v.mph,
        set: (n, s) => s.setMph(n),
    },
    utility: {
        label: "Dwellings served",
        min: 200, max: 30000, step: 100,
        get: (v) => v.dwellings,
        set: (n, s) => s.setDwellings(n),
    },
}

/* --- what the change would mean, before it is run ----------------------- */

/**
 * The consequences that can honestly be stated WITHOUT a simulation.
 *
 * There is a real line here and it is worth naming. Some of what a change does
 * is arithmetic on numbers already in hand: how many homes ten thousand people
 * need at this zone's household size, how much street those homes imply at this
 * zone's own ratio, whether that crosses the threshold that triggers a trunk
 * upgrade. None of that needs the network, so making someone press RUN to find
 * out is withholding something the tool already knows.
 *
 * Everything else -- what it does to travel time, to response coverage, to any
 * axis -- needs the assignment, and none of it is guessed at here. That is the
 * whole division: this panel does the arithmetic, the run does the physics.
 *
 * The formulas are lifted from metrics.ts deliberately, including the clamp on
 * metres per dwelling, so the figures shown before a run are the figures the
 * engine charges for during it.
 */
interface Implication {
    text: string
    tone: "plain" | "warn"
}

function implicationsFor(
    kind: Kind,
    p: PlaceProfile | null,
    corridor: { label: string; lengthM: number; lanes: number; baseVc: number } | null,
    v: { residents: number; lanes: number; dwellings: number; jobs: number; mph: number },
): Implication[] {
    const out: Implication[] = []

    if ((kind === "residents" || kind === "decline") && p) {
        const size = householdSize(p)
        const homes = v.residents / size
        const sign = kind === "decline" ? -1 : 1
        out.push({
            text: `${Math.round(homes).toLocaleString()} homes at this zone's ${size.toFixed(1)} people per household`,
            tone: "plain",
        })
        if (p.population > 0) {
            const share = (v.residents / p.population) * 100
            out.push({
                text: `${share.toFixed(share < 10 ? 1 : 0)}% of the ${p.population.toLocaleString()} residents counted here in 2020`,
                tone: share > 100 ? "warn" : "plain",
            })
        }
        if (kind === "residents") {
            // The same clamp impliedLocalKm applies, for the same reason.
            const raw = p.roadMPerDwelling ?? 200
            const perDwelling = Math.max(5, Math.min(400, raw))
            const km = (homes * perDwelling) / 1000
            out.push({
                text: `about ${km.toFixed(1)} km of new local street at ${Math.round(perDwelling)} m per home`,
                tone: "plain",
            })
            if (p.housingUnits > 0 && (p.housingUnits + homes) / p.housingUnits > UPGRADE_THRESHOLD) {
                out.push({
                    text: `past ${UPGRADE_THRESHOLD}x the 2020 housing stock, so a $${(UNIT_COSTS.thresholdUpgrade / 1e6).toFixed(0)}M trunk upgrade is triggered unless capacity is bought first`,
                    tone: "warn",
                })
            }
        } else if (sign < 0 && v.residents >= p.population) {
            out.push({ text: "more than the zone holds; the model floors it at zero", tone: "warn" })
        }
    }

    if (kind === "jobs" && p) {
        out.push({
            text: `attraction here rises from ${p.population.toLocaleString()} to ${(p.population + v.jobs).toLocaleString()}, so trips are pulled toward this zone`,
            tone: "plain",
        })
        out.push({
            text: "whether the mean journey shortens depends on where the people already are",
            tone: "plain",
        })
    }

    if (kind === "utility" && p) {
        const covered = p.housingUnits > 0 ? (v.dwellings / p.housingUnits) * 100 : 0
        out.push({
            text: `${Math.round(covered)}% more than the ${p.housingUnits.toLocaleString()} homes here in 2020`,
            tone: "plain",
        })
        out.push({
            text: `$${((v.dwellings * UNIT_COSTS.utilityCapacityPerDwelling) / 1e6).toFixed(1)}M of DEMO capital, bought outright`,
            tone: "plain",
        })
    }

    if ((kind === "corridor" || kind === "diet") && corridor) {
        const km = (corridor.lengthM / 1000) * v.lanes
        out.push({
            text: `${km.toFixed(1)} lane-km across ${(corridor.lengthM / 1000).toFixed(0)} km of ${corridor.label}`,
            tone: "plain",
        })
        if (kind === "corridor") {
            out.push({
                text: `$${((km * UNIT_COSTS.arterialLanePerKm) / 1e6).toFixed(0)}M at DEMO unit cost`,
                tone: "plain",
            })
        } else if (corridor.lanes <= 1) {
            out.push({
                text: "already one lane each way on average, so most of this diet has nothing to remove",
                tone: "warn",
            })
        }
    }

    if (kind === "speed" && corridor) {
        out.push({
            text: `applied to all ${(corridor.lengthM / 1000).toFixed(0)} km of ${corridor.label}`,
            tone: "plain",
        })
    }

    if (corridor && (kind === "corridor" || kind === "diet" || kind === "speed")) {
        out.push({
            text: `worst link runs at v/c ${corridor.baseVc.toFixed(2)} in the baseline${corridor.baseVc >= 0.85 ? ", already past the stress threshold" : ""}`,
            tone: corridor.baseVc >= 0.85 ? "warn" : "plain",
        })
    }

    return out
}

/**
 * Amounts worth offering as one click.
 *
 * Two are absolute and recognisable at Arkansas scale; the third is relative to
 * the place, which is the one that makes the control feel like it knows where
 * you are pointing it.
 */
function presetsFor(kind: Kind, p: PlaceProfile | null): { label: string; value: number }[] {
    if (kind === "residents" || kind === "decline") {
        const presets = [
            { label: "a subdivision", value: 1200 },
            { label: "a large development", value: 6000 },
        ]
        if (p && p.population > 0) {
            presets.push({
                label: kind === "decline" ? "half the zone" : "double the zone",
                value: Math.round(kind === "decline" ? p.population / 2 : p.population),
            })
        }
        return presets
    }
    if (kind === "jobs") {
        return [
            { label: "a big employer", value: 1500 },
            { label: "a distribution hub", value: 5000 },
            { label: "a district", value: 15000 },
        ]
    }
    if (kind === "utility" && p) {
        return [
            { label: "a quarter more", value: Math.max(200, Math.round(p.housingUnits * 0.25)) },
            { label: "double the stock", value: Math.max(400, p.housingUnits) },
        ]
    }
    if (kind === "speed") {
        return [
            { label: "downtown", value: 25 },
            { label: "arterial", value: 35 },
            { label: "rural highway", value: 55 },
        ]
    }
    return []
}

/* --- component ---------------------------------------------------------- */

export function ScenarioBuilder({
    onPreview,
}: {
    /** Hands the pending change up to the lab, which draws it beside the map. */
    onPreview: (spec: PreviewSpec | null) => void
}) {
    const {
        area,
        areaId,
        draft,
        addResidents,
        expandCorridor,
        addFacility,
        removeFacility,
        upgradeUtility,
        addJobs,
        setSpeedLimit,
        updateAction,
        removeAction,
        clearDraft,
    } = useLab()

    const [mode, setMode] = useState<"catalogue" | "manual">("catalogue")
    const [query, setQuery] = useState("")
    const [pickedId, setPickedId] = useState<string | null>(null)

    const [kind, setKind] = useState<Kind>("residents")
    const [zoneGeoid, setZoneGeoid] = useState("")
    const [corridorId, setCorridorId] = useState("")
    const [facilityId, setFacilityId] = useState("")
    const [residents, setResidents] = useState(10000)
    const [lanes, setLanes] = useState(1)
    const [dwellings, setDwellings] = useState(3000)
    const [jobs, setJobs] = useState(4000)
    const [mph, setMph] = useState(30)

    const zones = useMemo(
        () => [...(area?.zones ?? [])].sort((a, b) => b.population - a.population),
        [area],
    )
    const corridors = useMemo(
        () => [...(area?.corridors ?? [])].sort((a, b) => b.lengthM - a.lengthM),
        [area],
    )
    /* Only the stations that answer a call. A hospital is a destination in this
       model, never a response source, so closing one would be a control that
       changed nothing. */
    const stations = useMemo(
        () => (area?.facilities ?? []).filter((f) => f.kind !== "hospital"),
        [area],
    )

    const catalogue = useMemo(() => projectsFor(areaId), [areaId])
    const results = useMemo(() => searchProjects(catalogue, query), [catalogue, query])

    /* Derived, not reset. Switching to the Northwest Arkansas model while the
       Delta station is picked simply finds nothing in that catalogue, so the
       card disappears on its own -- and switching back to the statewide model
       brings the same selection with it, which is what someone comparing the
       two areas actually wants. Clearing the id in an effect would have thrown
       the pick away and cascaded a render to do it. */
    const picked = catalogue.find((p) => p.id === pickedId) ?? null

    const zone = zones.find((z) => z.geoid === (zoneGeoid || zones[0]?.geoid))
    const corridor = corridors.find((c) => String(c.id) === (corridorId || String(corridors[0]?.id)))
    const station = stations.find((f) => f.id === (facilityId || stations[0]?.id))
    const target = KIND_TARGET[kind]

    /* The amount in whatever unit this lever uses, so the profile that drives
       the drawing carries the size of the change as well as the place. */
    const amount =
        kind === "jobs" ? jobs
        : kind === "utility" ? dwellings
        : kind === "corridor" || kind === "diet" ? lanes
        : kind === "speed" ? mph
        : residents

    /* Which zone the drawing is OF. A corridor or a station is not in a zone,
       but it is somewhere, so the nearest zone supplies the landscape and the
       settlement around it. */
    const sceneZone =
        target === "zone"
            ? zone
            : target === "corridor"
              ? area && corridor
                  ? nearestZone(area, corridor.lonLat)
                  : zone
              : area && station
                ? nearestZone(area, station.lonLat)
                : zone
    /* Rebuilt every render, deliberately, and safe because the lab ignores a
       preview whose key it already has. Memoising it here was the obvious fix
       for the render loop this caused and the wrong one: it made this one call
       site safe while leaving the next person to add a derived object free to
       reintroduce the same loop. See onPreview in the lab. */
    const profile = sceneZone ? profileOf(sceneZone, amount) : null

    /* Not memoised. Both are a handful of arithmetic operations over values
       that change on every keystroke anyway, and `profile` is rebuilt each
       render, so a useMemo keyed on it would recompute every time regardless
       while stopping the compiler from optimising anything around it. */
    const presets = presetsFor(kind, profile)
    const implications = implicationsFor(kind, profile, corridor ?? null, {
        residents, lanes, dwellings, jobs, mph,
    })

    /** What the row is pointed at, however it was picked. */
    const targetName =
        target === "corridor"
            ? (corridor?.label ?? "")
            : target === "facility"
              ? (station?.name ?? stationLabel(station))
              : (zone?.name ?? "")

    /* The preview follows whatever is pending: the picked project in catalogue
       mode, the row being configured in manual mode. Recomputed here rather
       than in the lab page so the two modes cannot disagree about what is about
       to happen. */
    useEffect(() => {
        if (!area) {
            onPreview(null)
            return
        }

        if (mode === "catalogue") {
            if (!picked) {
                onPreview(null)
                return
            }
            const { lines, missing } = resolveProject(area, picked)
            onPreview({
                key: picked.id,
                title: picked.name,
                place: `${picked.place} · ${picked.county} County`,
                what: picked.what,
                scale: picked.scale,
                photo: picked.photo,
                effectLines: missing.length
                    ? [
                          ...lines,
                          ...missing.map(
                              (m): PreviewEffect => ({ text: `not here: ${m}`, kind: "note" }),
                          ),
                      ]
                    : lines,
                notModelled: picked.notModelled,
                touches: picked.touches,
                scene: picked.model(),
            })
            return
        }

        const place = targetName
        const line = manualLine(kind, place, { residents, lanes, dwellings, jobs, mph })

        onPreview({
            // The key restarts the build animation, so it carries everything
            // that changes the object: kind, place, and the size of the change.
            key: `${kind}-${profile?.key ?? ""}-${place}-${amount}`,
            title: KIND_LABEL[kind].replace(/^(a|an) /, "").replace(/^./, (c) => c.toUpperCase()),
            place: profile
                ? `${place || area.label} · ${REGION_META[profile.region].label} · ${FORM_META[profile.form].label}`
                : place || area.label,
            what: MANUAL_WHAT[kind],
            photo: target === "zone" ? countyPhoto(zone?.name) : undefined,
            effectLines: [line],
            notModelled: MANUAL_LIMIT[kind],
            touches: genericTouches(kind),
            scene: profile
                ? placeScene(kind, profile)
                : placeScene(kind, profileOf(zones[0], amount)),
        })
    }, [
        area, mode, picked, kind, target, targetName, zone, zones, profile, amount,
        residents, lanes, dwellings, jobs, mph, onPreview,
    ])

    if (!area) return null

    const zoneName = (g: string) => area.zones.find((z) => z.geoid === g)?.name ?? g
    const corridorName = (id: number) => area.corridors.find((c) => c.id === id)?.label ?? `#${id}`

    const addManual = () => {
        const g = zoneGeoid || zones[0]?.geoid
        const cid = corridorId ? Number(corridorId) : corridors[0]?.id
        switch (kind) {
            case "residents":
                return addResidents(g, residents)
            // A loss is the same lever with the sign turned over, which is why
            // the engine takes a signed count rather than growing a second one.
            case "decline":
                return addResidents(g, -residents)
            case "jobs":
                return addJobs(g, jobs)
            case "utility":
                return upgradeUtility(g, dwellings)
            case "corridor":
                if (cid != null) expandCorridor(cid, lanes)
                return
            case "diet":
                if (cid != null) expandCorridor(cid, -lanes)
                return
            case "speed":
                if (cid != null) setSpeedLimit(cid, mph)
                return
            case "closure":
                if (station) removeFacility(station.id)
                return
            case "fire":
            case "ems": {
                const z = area.zones.find((x) => x.geoid === g)
                if (z) addFacility(z.centroid, kind as FacilityKind)
                return
            }
        }
    }

    const addProject = () => {
        if (!picked) return
        const { actions } = resolveProject(area, picked)
        /* Routed through the same store actions the manual builder calls, so a
           template cannot put anything into a scenario that a person could not
           have put there by hand. The catalogue only ever emits four of the ten
           kinds today; the rest are here so adding a template that uses one is
           a data change rather than a code change. */
        for (const a of actions) {
            switch (a.kind) {
                case "addResidents": addResidents(a.zoneGeoid, a.count); break
                case "addJobs": addJobs(a.zoneGeoid, a.jobs); break
                case "expandCorridor": expandCorridor(a.corridorId, a.addedLanesPerDir); break
                case "setSpeedLimit": setSpeedLimit(a.corridorId, a.mph); break
                case "upgradeUtility": upgradeUtility(a.zoneGeoid, a.dwellings); break
                case "removeFacility": removeFacility(a.facilityId); break
                case "addFacility": addFacility(a.lonLat, a.facilityKind); break
            }
        }
    }

    const resolved = picked ? resolveProject(area, picked) : null

    return (
        <section>
            <h2 className="font-pixel text-[11px] tracking-[0.2em] text-paper-300">
                WHAT ARE YOU CHANGING?
            </h2>

            {/* --- the two ways in --- */}
            <div
                role="tablist"
                aria-label="How to add a change"
                className="mt-2.5 flex gap-1 rounded-md border border-ink-700 bg-ink-900 p-1"
            >
                {(
                    [
                        ["catalogue", "From Arkansas"],
                        ["manual", "Build your own"],
                    ] as const
                ).map(([id, label]) => (
                    <button
                        key={id}
                        role="tab"
                        aria-selected={mode === id}
                        onClick={() => setMode(id)}
                        className={`flex-1 rounded px-2 py-1.5 text-[11px] transition-colors ${
                            mode === id
                                ? "bg-accent/15 text-accent"
                                : "text-paper-400 hover:text-paper-200"
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {mode === "catalogue" ? (
                <div className="mt-3">
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="search 20 projects: 412, Little Rock, station…"
                        aria-label="Search the Arkansas project list"
                        className="w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-[12px] text-paper-100 placeholder:text-paper-400 focus-visible:border-accent focus-visible:outline-none"
                    />

                    <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-0.5">
                        {results.map((p) => {
                            const tone = CATEGORY_TONE[projectKind(p)]
                            const active = p.id === pickedId
                            return (
                                <li key={p.id}>
                                    <button
                                        onClick={() => setPickedId(active ? null : p.id)}
                                        aria-pressed={active}
                                        className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors ${
                                            active
                                                ? "border-accent/60 bg-ink-850"
                                                : "border-ink-800 bg-ink-900 hover:border-ink-600"
                                        }`}
                                    >
                                        <span className="flex items-baseline gap-2">
                                            <span
                                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                                style={{ background: tone }}
                                            />
                                            <span className="flex-1 truncate text-[11.5px] text-paper-100">
                                                {p.name}
                                            </span>
                                        </span>
                                        <span className="mt-0.5 block pl-3.5 truncate font-mono text-[9.5px] uppercase tracking-wider text-paper-400">
                                            {p.county} County
                                        </span>
                                    </button>
                                </li>
                            )
                        })}
                        {results.length === 0 && (
                            <li className="px-1 py-2 text-[11px] leading-relaxed text-paper-400">
                                Nothing in the {area.label} model matches that. Try the statewide
                                model, which carries every route in the list.
                            </li>
                        )}
                    </ul>

                    {picked && (
                        <div className="mt-3 rounded-lg border border-ink-700 bg-ink-900/70 p-3">
                            <p className="text-[11px] leading-relaxed text-paper-300">
                                {picked.what}
                            </p>
                            {resolved && resolved.missing.length > 0 && (
                                <p className="mt-2 border-l-2 border-flow-warm/60 pl-2 text-[10px] leading-relaxed text-flow-warm">
                                    {resolved.missing.join("; ")}. Switch to the statewide model to
                                    run this one.
                                </p>
                            )}
                            <button
                                onClick={addProject}
                                disabled={!resolved || resolved.actions.length === 0}
                                className="mt-2.5 w-full rounded-md border border-accent/45 bg-accent/10 py-2 font-mono text-[11px] text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
                            >
                                Add to scenario
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <div className="mt-3 space-y-3">
                    {/* --- pick the lever ---

                        Chips rather than a dropdown. Ten options behind a
                        select is ten options nobody knows are there, and the
                        two groups are the point: the second row is the half of
                        the instrument that takes capacity away, and burying it
                        inside a menu made it look like an afterthought. */}
                    {KIND_GROUPS.map((group) => (
                        <div key={group.label}>
                            <h3 className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-paper-400">
                                {group.label}
                            </h3>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {group.kinds.map((k) => {
                                    const on = kind === k
                                    return (
                                        <button
                                            key={k}
                                            onClick={() => setKind(k)}
                                            aria-pressed={on}
                                            className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
                                                on
                                                    ? "border-transparent bg-ink-800 text-paper-100"
                                                    : "border-ink-800 bg-ink-900 text-paper-300 hover:border-ink-600"
                                            }`}
                                            style={on ? { boxShadow: `inset 0 0 0 1px ${KIND_ACCENT[k]}` } : undefined}
                                        >
                                            <span
                                                aria-hidden
                                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                                style={{ background: KIND_ACCENT[k], opacity: on ? 1 : 0.5 }}
                                            />
                                            {KIND_LABEL[k]}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    ))}

                    <div className="space-y-2 rounded-lg border border-ink-700 bg-ink-900/70 p-3">
                        <p className="text-[12px] text-paper-300">
                            {KIND_VERB[kind]}{" "}
                            <span className="text-paper-100">{KIND_LABEL[kind]}</span>{" "}
                            {KIND_PREP[kind]}
                        </p>

                        {target === "corridor" ? (
                            <Combobox
                                label="Which corridor"
                                accent={KIND_ACCENT[kind]}
                                value={corridorId || String(corridors[0]?.id ?? "")}
                                onChange={setCorridorId}
                                items={corridors.map((c) => ({
                                    key: String(c.id),
                                    label: c.label,
                                    hint: `${(c.lengthM / 1000).toFixed(0)} km`,
                                }))}
                                placeholder="type a route: I 49, US 412, Chenal…"
                            />
                        ) : target === "facility" ? (
                            <Combobox
                                label="Which station"
                                accent={KIND_ACCENT[kind]}
                                value={facilityId || stations[0]?.id || ""}
                                onChange={setFacilityId}
                                items={stations.map((f) => ({
                                    key: f.id,
                                    label: stationLabel(f),
                                    hint: f.kind,
                                }))}
                                placeholder="type a station name…"
                            />
                        ) : (
                            <Combobox
                                label="Where"
                                accent={KIND_ACCENT[kind]}
                                value={zoneGeoid || zones[0]?.geoid || ""}
                                onChange={setZoneGeoid}
                                items={zones.map((z) => ({
                                    key: z.geoid,
                                    label: z.name,
                                    hint: `${z.population.toLocaleString()} people`,
                                }))}
                                placeholder="type a place: Benton, Pulaski, tract…"
                            />
                        )}

                        {/* --- the place, as the model already knows it ---

                            Everything here is a figure the simulation is about
                            to use. Picking a tract stops being picking a code
                            and becomes picking somewhere with 1,901 homes in
                            it, which is the number that decides whether what
                            you are about to type is a rounding error. */}
                        {profile && (
                            <div className="rounded-md border border-ink-800 bg-ink-950 p-2.5">
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                    <span className="font-mono text-[9.5px] uppercase tracking-wider text-wheat-400">
                                        {REGION_META[profile.region].label}
                                    </span>
                                    <span className="font-mono text-[9.5px] uppercase tracking-wider text-paper-400">
                                        {FORM_META[profile.form].label}
                                    </span>
                                </div>
                                <p className="mt-1 text-[10px] leading-relaxed text-paper-400">
                                    {REGION_META[profile.region].note}
                                </p>
                                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                                    {placeFacts(profile).map((f) => (
                                        <div key={f.label} className="flex items-baseline justify-between gap-1">
                                            <dt className="truncate text-[10px] text-paper-400">{f.label}</dt>
                                            <dd className="tabular shrink-0 font-mono text-[10px] text-paper-200">
                                                {f.value}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                                {target === "corridor" && corridor && (
                                    <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-ink-800 pt-1.5">
                                        <div className="flex items-baseline justify-between gap-1">
                                            <dt className="text-[10px] text-paper-400">Lanes each way</dt>
                                            <dd className="tabular font-mono text-[10px] text-paper-200">
                                                {corridor.lanes}
                                            </dd>
                                        </div>
                                        <div className="flex items-baseline justify-between gap-1">
                                            <dt className="text-[10px] text-paper-400">Peak v/c now</dt>
                                            <dd
                                                className="tabular font-mono text-[10px]"
                                                style={{ color: corridor.baseVc >= 0.85 ? "#f28f3b" : "#c9d0dc" }}
                                            >
                                                {corridor.baseVc.toFixed(2)}
                                            </dd>
                                        </div>
                                    </dl>
                                )}
                            </div>
                        )}

                        {/* --- how much --- */}
                        {AMOUNT_CONTROL[kind] && (
                            <div>
                                <NumberScrub
                                    label={AMOUNT_CONTROL[kind]!.label}
                                    value={AMOUNT_CONTROL[kind]!.get({ residents, lanes, dwellings, jobs, mph })}
                                    onChange={(n) =>
                                        AMOUNT_CONTROL[kind]!.set(n, {
                                            setResidents, setLanes, setDwellings, setJobs, setMph,
                                        })
                                    }
                                    min={AMOUNT_CONTROL[kind]!.min}
                                    max={AMOUNT_CONTROL[kind]!.max}
                                    step={AMOUNT_CONTROL[kind]!.step}
                                    suffix={AMOUNT_CONTROL[kind]!.suffix}
                                    accent={KIND_ACCENT[kind]}
                                />
                                {presets.length > 0 && (
                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                        {presets.map((preset) => (
                                            <button
                                                key={preset.label}
                                                onClick={() =>
                                                    AMOUNT_CONTROL[kind]!.set(preset.value, {
                                                        setResidents, setLanes, setDwellings, setJobs, setMph,
                                                    })
                                                }
                                                className="rounded border border-ink-700 bg-ink-900 px-1.5 py-1 font-mono text-[9.5px] text-paper-400 transition-colors hover:border-ink-600 hover:text-paper-100"
                                            >
                                                {preset.label}{" "}
                                                <span className="tabular text-paper-300">
                                                    {preset.value.toLocaleString()}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {(kind === "fire" || kind === "ems") && (
                            <p className="text-[10px] leading-relaxed text-paper-400">
                                Placed at the centre of the chosen zone, snapped to the nearest real
                                junction. Both kinds enter the response search as a first-arriving
                                unit, which is what NFPA 1710 measures.
                            </p>
                        )}

                        {kind === "closure" && (
                            <p className="text-[10px] leading-relaxed text-paper-400">
                                Removed from the response search, so the next nearest unit answers
                                instead. {stations.length.toLocaleString()} responding stations in
                                this area; hospitals are not listed, because they are destinations
                                here rather than sources.
                            </p>
                        )}

                        {/* --- what it implies, before anything is run ---

                            Arithmetic on numbers already in hand, using the
                            engine's own formulas. Nothing here needs the
                            network, so making someone press RUN to find it out
                            would be withholding what the tool already knows. */}
                        {implications.length > 0 && (
                            <ul className="space-y-1 border-t border-ink-800 pt-2">
                                {implications.map((im) => (
                                    <li
                                        key={im.text}
                                        className={`flex gap-1.5 text-[10px] leading-relaxed ${
                                            im.tone === "warn" ? "text-flow-tight" : "text-paper-400"
                                        }`}
                                    >
                                        <span aria-hidden className="shrink-0">
                                            {im.tone === "warn" ? "!" : "·"}
                                        </span>
                                        <span>{im.text}</span>
                                    </li>
                                ))}
                            </ul>
                        )}

                        <button
                            onClick={addManual}
                            className="w-full rounded-md border border-accent/45 bg-accent/10 py-2 font-mono text-[11px] text-accent transition-colors hover:bg-accent/20"
                        >
                            Add to scenario
                        </button>
                    </div>
                </div>
            )}

            {/* --- what you have added --- */}
            <div className="mt-4 flex items-baseline justify-between">
                <h3 className="font-pixel text-[11px] tracking-[0.2em] text-paper-300">
                    YOUR SCENARIO
                </h3>
                {draft.length > 0 && (
                    <button
                        onClick={clearDraft}
                        className="font-mono text-[10px] text-paper-400 hover:text-paper-200"
                    >
                        clear all
                    </button>
                )}
            </div>

            {draft.length === 0 ? (
                <p className="mt-2 text-[11px] leading-relaxed text-paper-400">
                    Empty. Add as many changes as you like, from either tab, and run them
                    together: people in several places, jobs to travel to, wider roads, new
                    stations, treatment capacity. Or a road diet, a lower limit, a station
                    closed, a county that keeps shrinking.
                </p>
            ) : (
                <ul className="mt-2 space-y-1.5">
                    {draft.map((a, i) => (
                        <ScenarioRow
                            key={`${a.kind}-${i}`}
                            action={a}
                            label={
                                a.kind === "addResidents" ||
                                a.kind === "upgradeUtility" ||
                                a.kind === "addJobs"
                                    ? zoneName(a.zoneGeoid)
                                    : a.kind === "expandCorridor" || a.kind === "setSpeedLimit"
                                      ? corridorName(a.corridorId)
                                      : a.kind === "removeFacility"
                                        ? stationLabel(stations.find((f) => f.id === a.facilityId))
                                        : a.facilityKind === "ems"
                                          ? "new ambulance post"
                                          : "new fire station"
                            }
                            onChange={(next) => updateAction(i, next)}
                            onRemove={() => removeAction(i)}
                        />
                    ))}
                </ul>
            )}

            <p className="mt-4 border-t border-ink-800 pt-3 text-[10px] leading-relaxed text-paper-400">
                Ten levers, and the four under {`"take away"`} matter as much as the six above
                them: a model that can only be asked what to build is a brochure. Parks, schools
                and libraries are still not on the list, because there is no mechanism in this
                model by which any of them would move an axis, and a lever that produced a label
                and no change in the physics would be worse than no lever at all.
            </p>
        </section>
    )
}

/** What the hand-built change is, in the same voice the catalogue uses. */
const MANUAL_WHAT: Record<Kind, string> = {
    residents:
        "Residents placed into a zone, generating peak trips at the same rate as everyone already there.",
    decline:
        "Residents removed from a zone. The streets, mains and stations that served them stay exactly where they are.",
    jobs: "Trip destinations placed into a zone: the other end of the gravity model, and the only way to say the work is over here.",
    corridor:
        "Lanes added to every link on the chosen corridor. Capacity rises; the speed limit does not.",
    diet: "Lanes taken back from the chosen corridor and given to something else. The kerbs do not move.",
    speed: "A posted limit, applied to every link on the corridor as free-flow time recomputed from length over speed.",
    fire: "An engine house, entering the response search as a first-arriving unit.",
    ems: "A staffed ambulance post, entering the response search as a first-arriving unit.",
    closure: "An existing station taken out of the response search, so the next nearest unit answers instead.",
    utility:
        "Water, sewer and treatment capacity, measured as the dwellings the zone's systems are sized for.",
}

/** And what the engine cannot see about it. */
const MANUAL_LIMIT: Record<Kind, string> = {
    residents:
        "Which buildings, and who lives in them. Growth is spread across a zone's block groups in proportion to the population already there.",
    decline:
        "Which households leave, and what happens to what they leave behind. The model reduces a population; it does not vacate a building or close a school.",
    jobs: "What kind of work. A job counts as one unit of trip attraction alongside one resident, which is a stated assumption and the first thing to attack if a jobs scenario looks wrong.",
    corridor:
        "Junction geometry. The assignment sees link capacity, not the merge that usually fails first.",
    diet: "What the space becomes. A bus lane, a bike lane and a wider footway are the same missing lane to this model, and none of the trips they carry are in it.",
    speed: "Safety, which is the actual case for a lower limit and the one thing this model does not measure at all. It also does not redistribute trips: destinations are held on baseline free-flow times.",
    fire: "Staffing and turnout. Only travel time is modelled, which is the part the network and the position control.",
    ems: "Unit availability. A post whose ambulance is out on a call covers nothing, and the model has no busy units.",
    closure: "Everything except travel time. Mutual aid, response from the next district, and whatever the closure paid for are all outside this model.",
    utility:
        "Hydraulics. Capacity here is a count of dwellings served, not a pressure or a flow.",
}

function ScenarioRow({
    action,
    label,
    onChange,
    onRemove,
}: {
    action: Action
    label: string
    onChange: (a: Action) => void
    onRemove: () => void
}) {
    const [open, setOpen] = useState(false)

    /* The sign is carried in the word, not just in a minus. "-4,000 people" and
       "4,000 people gone" are the same number and only one of them can be
       misread as a typo at a glance. */
    const value =
        action.kind === "addResidents"
            ? action.count >= 0
                ? `+${action.count.toLocaleString()} people`
                : `${Math.abs(action.count).toLocaleString()} people gone`
            : action.kind === "addJobs"
              ? `+${action.jobs.toLocaleString()} jobs`
              : action.kind === "expandCorridor"
                ? action.addedLanesPerDir >= 0
                    ? `+${action.addedLanesPerDir} lane${action.addedLanesPerDir > 1 ? "s" : ""}`
                    : `${Math.abs(action.addedLanesPerDir)} lane${action.addedLanesPerDir < -1 ? "s" : ""} removed`
                : action.kind === "setSpeedLimit"
                  ? `${action.mph} mph posted`
                  : action.kind === "upgradeUtility"
                    ? `+${action.dwellings.toLocaleString()} dwellings served`
                    : action.kind === "removeFacility"
                      ? "station closed"
                      : action.facilityKind === "ems"
                        ? "ambulance post"
                        : "fire station"

    const takesAway =
        (action.kind === "addResidents" && action.count < 0) ||
        (action.kind === "expandCorridor" && action.addedLanesPerDir < 0) ||
        action.kind === "setSpeedLimit" ||
        action.kind === "removeFacility"

    const tone = takesAway
        ? "border-flow-tight/50"
        : action.kind === "addResidents"
          ? "border-accent/40"
          : action.kind === "addJobs"
            ? "border-demo/40"
            : action.kind === "expandCorridor"
              ? "border-flow-warm/40"
              : action.kind === "upgradeUtility"
                ? "border-verified/40"
                : "border-flow-over/40"

    const editable =
        action.kind === "addResidents" ||
        action.kind === "addJobs" ||
        action.kind === "expandCorridor" ||
        action.kind === "setSpeedLimit" ||
        action.kind === "upgradeUtility"

    return (
        <li className={`animate-row-in rounded-md border ${tone} bg-ink-900 px-2.5 py-2`}>
            <div className="flex items-center gap-2">
                <span className="tabular shrink-0 font-mono text-[11px] text-paper-100">{value}</span>
                <span className="flex-1 truncate text-[11px] text-paper-300">{label}</span>
                {editable && (
                    <button
                        onClick={() => setOpen((o) => !o)}
                        aria-expanded={open}
                        className="font-mono text-[10px] text-paper-400 hover:text-paper-100"
                    >
                        {open ? "done" : "edit"}
                    </button>
                )}
                <button
                    onClick={onRemove}
                    aria-label={`Remove ${label}`}
                    className="font-mono text-[13px] leading-none text-paper-400 hover:text-flow-over"
                >
                    ×
                </button>
            </div>

            {open && action.kind === "addResidents" && (
                <div className="mt-2">
                    {/* Edited in magnitude, with the sign kept: a row that says
                        "people gone" must not silently become growth because
                        the slider only knows positive numbers. */}
                    <NumberScrub
                        label={action.count < 0 ? "people leaving" : "people"}
                        value={Math.abs(action.count)}
                        onChange={(n) => onChange({ ...action, count: action.count < 0 ? -n : n })}
                        min={100}
                        max={80000}
                        step={100}
                    />
                </div>
            )}
            {open && action.kind === "addJobs" && (
                <div className="mt-2">
                    <NumberScrub
                        label="jobs"
                        value={action.jobs}
                        onChange={(jobs) => onChange({ ...action, jobs })}
                        min={100}
                        max={60000}
                        step={100}
                        accent={KIND_ACCENT.jobs}
                    />
                </div>
            )}
            {open && action.kind === "setSpeedLimit" && (
                <div className="mt-2">
                    <NumberScrub
                        label="posted limit"
                        value={action.mph}
                        onChange={(mph) => onChange({ ...action, mph })}
                        min={15}
                        max={75}
                        step={5}
                        suffix="mph"
                        accent={KIND_ACCENT.speed}
                    />
                </div>
            )}
            {open && action.kind === "expandCorridor" && (
                <div className="mt-2">
                    <NumberScrub
                        label={
                            action.addedLanesPerDir < 0 ? "lanes removed each way" : "lanes each way"
                        }
                        value={Math.abs(action.addedLanesPerDir)}
                        onChange={(n) =>
                            onChange({
                                ...action,
                                addedLanesPerDir: action.addedLanesPerDir < 0 ? -n : n,
                            })
                        }
                        min={1}
                        max={4}
                        step={1}
                        accent={KIND_ACCENT.corridor}
                    />
                </div>
            )}
            {open && action.kind === "upgradeUtility" && (
                <div className="mt-2">
                    <NumberScrub
                        label="dwellings served"
                        value={action.dwellings}
                        onChange={(dwellings) => onChange({ ...action, dwellings })}
                        min={200}
                        max={30000}
                        step={100}
                        accent={KIND_ACCENT.utility}
                    />
                </div>
            )}
        </li>
    )
}
