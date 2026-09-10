/**
 * WHAT KIND OF PLACE THIS IS.
 *
 * The preview used to draw one picture per lever: every "more people" looked
 * like the same twelve blocks whether it was downtown Little Rock or a county
 * in the Delta with four people to the square kilometre. That is a diagram of
 * the LEVER, and the lever is the least interesting half of the decision.
 *
 * So a place is classified on two independent axes before anything is drawn.
 *
 * FORM comes from the zone's own measured density, which is a real number the
 * simulation already uses. It decides what the settlement looks like: a tight
 * grid, a courthouse square, cul-de-sacs, or a section road with farmsteads on
 * it. Nothing about it is a judgement; 3,000 people per square kilometre is a
 * city block and 6 is not, in any state.
 *
 * REGION comes from where the zone's centroid actually sits, and it is the one
 * approximation in this file. Arkansas genuinely divides into five
 * physiographic regions, and they genuinely look different: the Ozarks are
 * dissected plateau, the Ouachitas are long parallel east-west ridges (almost
 * uniquely in North America), the Arkansas River Valley is a trough between
 * them, the Delta is dead-flat alluvium on a section grid, and the Gulf Coastal
 * Plain is rolling pine. The boundaries below are straight lines through a
 * bounding box, which no real boundary is.
 *
 * That approximation is safe for exactly one reason, and it is the same reason
 * the preview may exaggerate its vertical: NOTHING IS MEASURED OFF THIS. The
 * region decides which landscape is drawn behind the change and nothing else.
 * No score, no cost and no axis has ever heard of it. If a reader in Izard
 * County thinks the ridges look wrong, they are looking at a drawing that is
 * wrong about ridges and right about every number on the page.
 */

/* --- region ------------------------------------------------------------- */

export type Region = "ozarks" | "valley" | "ouachitas" | "delta" | "coastal"

export const REGION_META: Record<Region, { label: string; note: string }> = {
    ozarks: {
        label: "Ozark Plateaus",
        note: "dissected plateau: steep hollows, winding roads, thin soil over limestone",
    },
    valley: {
        label: "Arkansas River Valley",
        note: "the trough between the two mountain ranges, following the river",
    },
    ouachitas: {
        label: "Ouachita Mountains",
        note: "long parallel ridges running east to west, unusually for North America",
    },
    delta: {
        label: "Mississippi Alluvial Plain",
        note: "flat alluvium on the section grid, drained by ditches and bayous",
    },
    coastal: {
        label: "Gulf Coastal Plain",
        note: "rolling pine timberland over sand and gravel",
    },
}

/**
 * Which region a point falls in, approximately.
 *
 * An ordered list of half-plane tests rather than real geometry. Reading them in
 * order is the documentation: south first, then the eastern lowlands, then the
 * highlands, then the valley between them.
 *
 * Known to be wrong at the edges, and the two it is most wrong about are worth
 * naming. Crowley's Ridge is a 200-mile loess ridge standing 60 metres above the
 * Delta, and this calls all of it Delta. Pulaski County straddles the fall line,
 * with Ouachita foothills west of Little Rock and alluvium east of it, and this
 * calls the whole county River Valley.
 */
export function regionOf(lon: number, lat: number): Region {
    // South Arkansas: timberland, all the way across.
    if (lat < 34.0) return "coastal"
    // The eastern third, from the Missouri line to Louisiana.
    if (lon > -91.2) return "delta"
    // The highlands north of the valley.
    if (lat > 35.6 && lon < -91.4) return "ozarks"
    // The valley itself, Fort Smith through Little Rock along the river.
    if (lat >= 34.6 && lat <= 35.6 && lon <= -92.0) return "valley"
    // The Arkansas lowlands: Pine Bluff, Stuttgart, the Grand Prairie.
    if (lon > -92.2 && lat < 35.6) return "delta"
    if (lat < 34.95 && lon < -92.6) return "ouachitas"
    if (lat < 34.6) return "coastal"
    return "ozarks"
}

/* --- settlement form ---------------------------------------------------- */

export type Form = "core" | "town" | "suburban" | "village" | "rural"

export const FORM_META: Record<Form, { label: string; note: string; from: number }> = {
    core: { label: "urban core", note: "continuous blocks, buildings to the kerb", from: 2500 },
    town: { label: "town centre", note: "a gridded centre around a square", from: 800 },
    suburban: { label: "suburban", note: "curving streets and detached lots", from: 150 },
    village: { label: "country town", note: "a main street with the county around it", from: 15 },
    rural: { label: "open country", note: "section roads and scattered farmsteads", from: 0 },
}

/**
 * Form from measured density, in residents per square kilometre.
 *
 * Absolute thresholds, deliberately. Density is density whatever the zone
 * system is, so a statewide model made of counties honestly lands almost
 * everywhere in "open country" or "country town": a county-sized zone IS mostly
 * field, and drawing downtown Fayetteville because Washington County contains
 * it would be the picture lying about what the model actually has hold of.
 */
export function formOf(densityPerKm2: number): Form {
    const order: Form[] = ["core", "town", "suburban", "village", "rural"]
    return order.find((f) => densityPerKm2 >= FORM_META[f].from) ?? "rural"
}

/* --- the profile the scenes and the interface share --------------------- */

export interface PlaceProfile {
    /** Stable identity, so the scatter in a scene is the same every visit. */
    key: string
    name: string
    region: Region
    form: Form
    population: number
    housingUnits: number
    densityPerKm2: number
    roadMPerDwelling: number | null
    /** Size of the change being previewed, in whatever unit the lever uses. */
    amount: number
}

export function profileOf(
    zone: {
        geoid: string
        name: string
        population: number
        housingUnits: number
        centroid: [number, number]
        densityPerKm2: number
        roadMPerDwelling: number | null
    },
    amount = 0,
): PlaceProfile {
    return {
        key: zone.geoid,
        name: zone.name,
        region: regionOf(zone.centroid[0], zone.centroid[1]),
        form: formOf(zone.densityPerKm2),
        population: zone.population,
        housingUnits: zone.housingUnits,
        densityPerKm2: zone.densityPerKm2,
        roadMPerDwelling: zone.roadMPerDwelling,
        amount,
    }
}

/* --- what the interface says about a place ------------------------------ */

export interface PlaceFact {
    label: string
    value: string
    /** Where the number came from, in the app's own vocabulary. */
    provenance: "verified" | "modelled" | "demo"
}

/**
 * The facts worth showing before someone commits to a change.
 *
 * Every one of these is already in the model. Showing them costs nothing and
 * changes the act of adding a scenario completely: picking a tract stops being
 * picking a code and becomes picking a place with 1,901 homes in it, which is
 * the number that decides whether the growth you are about to type is a
 * rounding error or a doubling.
 */
export function placeFacts(p: PlaceProfile): PlaceFact[] {
    const facts: PlaceFact[] = [
        { label: "Residents", value: p.population.toLocaleString(), provenance: "verified" },
        { label: "Homes", value: p.housingUnits.toLocaleString(), provenance: "verified" },
        {
            label: "Density",
            value: `${Math.round(p.densityPerKm2).toLocaleString()} / km²`,
            provenance: "verified",
        },
    ]
    if (p.roadMPerDwelling != null) {
        facts.push({
            label: "Street per home",
            value: `${Math.round(p.roadMPerDwelling)} m`,
            provenance: "modelled",
        })
    }
    return facts
}

/**
 * Household size, from the zone's own count of people and homes.
 *
 * The same expression metrics.ts uses, so the dwellings quoted in the interface
 * before a run are the dwellings the engine charges for during it. Falling back
 * to 2.5 where a zone has no housing matches the engine too.
 */
export function householdSize(p: { population: number; housingUnits: number }): number {
    return p.housingUnits > 0 ? Math.max(p.population / p.housingUnits, 1) : 2.5
}
