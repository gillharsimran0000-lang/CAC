/**
 * The Consequence Chain.
 *
 * The rule this file exists to enforce: no sentence here is written by a
 * language model, and none is written by hand at runtime. Every headline is a
 * template with numeric slots, and every slot is filled from a value the
 * simulation produced. The templates branch on sign and magnitude, so the
 * wording follows the result rather than the result being fitted to wording.
 *
 * The other rule concerns denominators. "+18% travel demand" is meaningless
 * without saying what it is 18% OF: adding 10,000 residents to a metro of half
 * a million moves citywide trips by about 2%, and a headline claiming 18% is
 * either wrong or silently talking about a subarea. Every percentage below
 * names its own base in the text, so the arithmetic can be checked from what is
 * on screen.
 */

import { ChainStep, CorridorStress, Measured, measured } from "./types"
import { PreparedArea, ScenarioOutcome } from "./simulate"
import { MAX_SPEED_MPH, MIN_SPEED_MPH, PEAK_TRIPS_PER_RESIDENT, STRESS_VC } from "./model"
import { NFPA_TRAVEL_S, EMERGENCY_PRIORITY_FACTOR } from "./emergency"
import { UNIT_COSTS, UPGRADE_THRESHOLD } from "./metrics"

const pct = (v: number, dp = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`
const int = (v: number) => Math.round(v).toLocaleString()
const money = (v: number) =>
    Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}B`
    : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M`
    : `$${int(v)}`

/**
 * Builds the chain for one scenario against its baseline.
 *
 * Steps are emitted in causal order, and each one's `value` carries the inputs
 * it was derived from so the inspector can show the working without recomputing
 * anything.
 */
export function buildChain(
    p: PreparedArea,
    scenario: ScenarioOutcome,
    corridors: CorridorStress[],
    baseCivic: number,
    scenarioCivic: number,
): ChainStep[] {
    const base = p.baseline
    const steps: ChainStep[] = []
    const added = scenario.addedResidents

    /* 1 -- the decision itself. Verified only in the sense that it is what the
       user asked for; the population it is added to is Census-counted. */
    if (added !== 0) {
        steps.push({
            id: "residents",
            /* A loss says LOSES rather than "+-4,000", which is what the old
               template produced the first time a scenario removed anyone. */
            headline:
                added > 0
                    ? `+${int(added)} RESIDENTS`
                    : `${int(Math.abs(added))} RESIDENTS LOST`,
            detail: `${pct((added / base.totalPopulation) * 100, 2)} against a 2020 base of ${int(base.totalPopulation)} in ${p.label}`,
            value: measured(added, "residents", "modelled", "scenario input", {
                formula: "sum of residents placed by the scenario",
                inputs: {
                    "Base population (2020 Census)": measured(
                        base.totalPopulation,
                        "residents",
                        "verified",
                        "US Census Bureau, 2020 Decennial (POP100)",
                    ),
                },
            }),
        })
    }

    /* Everything above and below this line is an INPUT: something the person
       using the tool decided. They are grouped here, before demand, because the
       chain's whole claim is causal order, and a step reading "SPEED LIMIT
       POSTED" after the step reporting the emergency access it changed puts the
       consequence in front of the cause. That is precisely the kind of ordering
       a reader is entitled to trust without checking. */
    /* 1b -- destinations.
       
       Jobs are the half of the gravity model the interface could not reach
       until now, and they are reported separately from residents because they
       act on the opposite end of it: residents decide how many trips there are,
       jobs decide where those trips go. A scenario with both is the only way to
       ask about jobs-housing balance, and the mean trip time is where the
       answer shows up. */
    if (scenario.addedJobs !== 0) {
        const j = scenario.addedJobs
        const tripDeltaMin = (scenario.raw.meanTripTimeS - base.raw.meanTripTimeS) / 60
        steps.push({
            id: "jobs",
            headline: `${j > 0 ? "+" : ""}${int(j)} ${j > 0 ? "DESTINATIONS" : "DESTINATIONS REMOVED"}`,
            detail: `mean modelled trip ${Math.abs(tripDeltaMin) < 0.05 ? "holds at" : tripDeltaMin > 0 ? "rises to" : "falls to"} ${(scenario.raw.meanTripTimeS / 60).toFixed(1)} minutes, against ${(base.raw.meanTripTimeS / 60).toFixed(1)} in the baseline`,
            value: measured(j, "jobs", "modelled", "scenario input", {
                formula:
                    "added to the zone's trip attraction, where one job counts as one unit of attraction alongside one resident",
                inputs: {
                    "Baseline mean trip": measured(
                        +(base.raw.meanTripTimeS / 60).toFixed(2),
                        "minutes",
                        "modelled",
                        "baseline run",
                    ),
                    "Scenario mean trip": measured(
                        +(scenario.raw.meanTripTimeS / 60).toFixed(2),
                        "minutes",
                        "modelled",
                        "scenario run",
                    ),
                },
            }),
        })
    }

    /* 1c -- posted limits, lanes given up, stations closed.
       
       Both are capacity or speed taken away on purpose, and both are worth a
       line of their own: a reader who sees emergency access fall has to be able
       to find the decision that did it. */
    if (scenario.speedChangedKm > 0) {
        steps.push({
            id: "speed",
            headline: `SPEED LIMIT POSTED ON ${scenario.speedChangedKm.toFixed(1)} KM`,
            detail: `free-flow time recomputed as length over the posted limit; the BPR curve then degrades that slower baseline exactly as it degrades a faster one`,
            value: measured(
                +scenario.speedChangedKm.toFixed(2),
                "km",
                "modelled",
                "scenario input",
                {
                    formula: `free-flow seconds = link length / posted speed, clamped to ${MIN_SPEED_MPH}-${MAX_SPEED_MPH} mph`,
                },
            ),
        })
    }

    if (scenario.removedLaneKm > 0) {
        steps.push({
            id: "diet",
            headline: `${scenario.removedLaneKm.toFixed(1)} LANE-KM REMOVED`,
            detail: `capacity given up on the corridor, floored at one lane each way; a narrower road is modelled, a closed one is not`,
            value: measured(
                +scenario.removedLaneKm.toFixed(2),
                "lane-km",
                "modelled",
                "scenario input",
                { formula: "sum over affected links of length x lanes actually removed" },
            ),
        })
    }

    if (scenario.closedFacilities > 0) {
        steps.push({
            id: "closures",
            headline: `${scenario.closedFacilities} ${scenario.closedFacilities === 1 ? "STATION" : "STATIONS"} CLOSED`,
            detail: `removed from the multi-source response search, so the nearest remaining unit answers instead`,
            value: measured(
                scenario.closedFacilities,
                "stations",
                "modelled",
                "scenario input",
                { formula: "facilities dropped before the response field is computed" },
            ),
        })
    }

    /* 2 -- demand. Stated against the whole modelled area, because that is the
       denominator the trip figure actually uses. */
    const tripDelta = scenario.totalTrips - base.totalTrips
    const tripPct = (tripDelta / base.totalTrips) * 100
    steps.push({
        id: "demand",
        headline: `${pct(tripPct)} MODELLED PEAK TRIPS`,
        detail: `${int(scenario.totalTrips)} vehicle trips in the peak hour, against ${int(base.totalTrips)} in the baseline, across all of ${p.label}`,
        value: measured(scenario.totalTrips, "peak-hour vehicle trips", "modelled", "trip generation", {
            formula: `population x ${PEAK_TRIPS_PER_RESIDENT} peak vehicle trips per resident (3.4 daily person-trips x 0.095 peak share / 1.67 occupancy)`,
            inputs: {
                "Baseline trips": measured(Math.round(base.totalTrips), "trips/h", "modelled", "baseline run"),
                "Scenario trips": measured(Math.round(scenario.totalTrips), "trips/h", "modelled", "scenario run"),
                "Trips per resident": measured(
                    PEAK_TRIPS_PER_RESIDENT,
                    "peak trips/resident",
                    "modelled",
                    "derived from NHTS 2017 national averages",
                ),
            },
        }),
    })

    /* 3 -- the network's response, named by corridor. This is the step whose
       denominator is a subarea, and it says so. */
    const newlyStressed = corridors.filter((c) => c.newlyStressed)
    const worsened = corridors
        .filter((c) => c.scenarioVc > c.baseVc + 0.005)
        .sort((a, b) => b.scenarioVc - b.baseVc - (a.scenarioVc - a.baseVc))

    if (newlyStressed.length > 0) {
        const names = newlyStressed.slice(0, 3).map((c) => c.label).join(", ")
        steps.push({
            id: "corridors",
            headline: `${newlyStressed.length} ${newlyStressed.length === 1 ? "CORRIDOR CROSSES" : "CORRIDORS CROSS"} INTO MODELLED STRESS`,
            detail: `${names}${newlyStressed.length > 3 ? ` and ${newlyStressed.length - 3} more` : ""} ${newlyStressed.length === 1 ? "passes" : "pass"} v/c ${STRESS_VC}, the HCM level-of-service C/D boundary`,
            value: measured(newlyStressed.length, "corridors", "modelled", `volume/capacity crossing ${STRESS_VC}`, {
                formula: "corridors whose worst link moves from below 0.85 v/c to at or above it",
            }),
            evidence: { corridors: newlyStressed.slice(0, 12) },
        })
    } else if (worsened.length > 0) {
        const top = worsened[0]
        steps.push({
            id: "corridors",
            headline: `NO CORRIDOR CROSSES INTO MODELLED STRESS`,
            detail: `${worsened.length} corridor${worsened.length === 1 ? "" : "s"} carry more traffic; the largest change is ${top.label}, v/c ${top.baseVc.toFixed(2)} to ${top.scenarioVc.toFixed(2)}`,
            value: measured(0, "corridors", "modelled", `volume/capacity crossing ${STRESS_VC}`, {
                formula: "no corridor's worst link moved from below 0.85 v/c to at or above it",
            }),
            evidence: { corridors: worsened.slice(0, 12) },
        })
    }

    /* 4 -- emergency access, which only moves because congestion moved. */
    const covDelta = (scenario.coverage.share - base.coverage.share) * 100
    const peopleDelta = scenario.coverage.coveredPopulation - base.coverage.coveredPopulation
    steps.push({
        id: "emergency",
        headline:
            Math.abs(covDelta) < 0.05
                ? `EMERGENCY ACCESS HOLDS AT ${(scenario.coverage.share * 100).toFixed(1)}%`
                : `EMERGENCY ACCESS ${covDelta > 0 ? "RISES" : "FALLS"} TO ${(scenario.coverage.share * 100).toFixed(1)}%`,
        detail: `${int(scenario.coverage.coveredPopulation)} residents within the NFPA 1710 four-minute engine travel time, ${peopleDelta >= 0 ? "up" : "down"} ${int(Math.abs(peopleDelta))} on the baseline`,
        value: measured(
            +(scenario.coverage.share * 100).toFixed(2),
            "% of residents",
            "modelled",
            "NFPA 1710, 240 s first-engine travel time",
            {
                formula: `multi-source shortest path from ${p.facilities.filter((f) => f.kind !== "hospital").length} stations over BPR-congested times x ${EMERGENCY_PRIORITY_FACTOR} priority factor`,
                inputs: {
                    "Baseline covered": measured(base.coverage.coveredPopulation, "residents", "modelled", "baseline run"),
                    "Scenario covered": measured(scenario.coverage.coveredPopulation, "residents", "modelled", "scenario run"),
                    "Threshold": measured(NFPA_TRAVEL_S, "seconds", "verified", "NFPA 1710 standard"),
                    "Mean response": measured(
                        Math.round(scenario.coverage.meanResponseS),
                        "seconds",
                        "modelled",
                        "population-weighted over block groups",
                    ),
                },
            },
        ),
    })

    /* 5 -- capacity bought on purpose.
       
       Only when the scenario contains a utility expansion, and stated in the
       unit the axis is actually measured in: dwellings the zone's systems are
       sized for. This is the one step that can appear in a scenario with no
       growth at all, which is exactly the case worth being able to run -- a
       plant expanded ahead of the housing scores differently from one expanded
       after it, and without this step that difference would be a movement on
       the fingerprint with nothing on screen explaining it. */
    const upgradedDwellings = scenario.upgradedDwellings
    if (upgradedDwellings > 0) {
        const c = scenario.cost
        const headroomDelta = (scenario.raw.capacityHeadroom - base.raw.capacityHeadroom) * 100
        steps.push({
            id: "capacity",
            headline: `CAPACITY FOR ${int(upgradedDwellings)} MORE DWELLINGS`,
            detail: `service headroom ${headroomDelta >= 0 ? "up" : "down"} ${Math.abs(headroomDelta).toFixed(1)} points against the baseline, at ${money(c.utilityCapacity)} of DEMO capital`,
            value: measured(upgradedDwellings, "dwellings", "modelled", "scenario input", {
                formula: `capacity added to the dwelling count each zone's system was designed for, then compared against ${UPGRADE_THRESHOLD}x the 2020 housing stock`,
                inputs: {
                    "Baseline headroom": measured(
                        +(base.raw.capacityHeadroom * 100).toFixed(2),
                        "% headroom",
                        "modelled",
                        "baseline run",
                    ),
                    "Scenario headroom": measured(
                        +(scenario.raw.capacityHeadroom * 100).toFixed(2),
                        "% headroom",
                        "modelled",
                        "scenario run",
                    ),
                    "Capacity capital": measured(
                        c.utilityCapacity,
                        "$",
                        "demo",
                        `DEMO unit cost of $${UNIT_COSTS.utilityCapacityPerDwelling.toLocaleString()} per dwelling served`,
                    ),
                },
            }),
        })
    }

    /* 6 -- what it costs. Loudly DEMO, because the unit costs are. */
    if (added > 0) {
        const c = scenario.cost
        const perResident = (c.capital + c.om20) / added
        steps.push({
            id: "burden",
            headline: `${money(c.capital + c.om20)} MODELLED INFRASTRUCTURE BURDEN`,
            detail: `${money(perResident)} per new resident: ${c.impliedNewLocalKm.toFixed(1)} km of implied local street${c.addedLaneKm > 0 ? `, ${c.addedLaneKm.toFixed(1)} lane-km of widening` : ""}${c.thresholdUpgrades > 0 ? `, plus ${money(c.thresholdUpgrades)} in threshold upgrades` : ""}${c.utilityCapacity > 0 ? `, plus ${money(c.utilityCapacity)} of utility capacity bought outright` : ""}`,
            value: measured(Math.round(perResident), "$ per resident", "demo", "DEMO unit costs, illustrative only", {
                formula: `(capital + ${UNIT_COSTS.horizonYears} yr O&M) / added residents`,
                inputs: {
                    "Capital": measured(c.capital, "$", "demo", "DEMO unit costs"),
                    "20-year O&M": measured(c.om20, "$", "demo", "DEMO unit costs"),
                    "Implied local street": measured(
                        +c.impliedNewLocalKm.toFixed(2),
                        "km",
                        "modelled",
                        "added dwellings x the zone's existing metres of street per dwelling",
                    ),
                    "Threshold upgrades": measured(
                        c.thresholdUpgrades,
                        "$",
                        "demo",
                        `lump upgrade where growth exceeds ${UPGRADE_THRESHOLD}x the zone's 2020 housing stock`,
                    ),
                },
            }),
        })
    }

    /* 7 -- the score, last, so it reads as a consequence rather than a verdict. */
    steps.push(scoreStep(baseCivic, scenarioCivic, "equal"))

    return steps
}

/**
 * The final step of the chain, as a function of the two composites.
 *
 * Extracted so the interface can rebuild it. The composite is the one number
 * here that depends on a value judgement rather than on the model -- the
 * weights are the user's -- so when someone reweights, this step has to be
 * recomputed rather than left contradicting the headline three inches above it.
 * The wording says which weighting produced it, in both cases.
 */
export function scoreStep(
    baseCivic: number,
    scenarioCivic: number,
    weighting: "equal" | "custom",
): ChainStep {
    const how =
        weighting === "equal"
            ? "equally weighted across the five axes"
            : "weighted by your priorities, not equally"
    return {
        id: "score",
        headline: `CIVIC IMPACT ${baseCivic} → ${scenarioCivic}`,
        detail:
            scenarioCivic === baseCivic
                ? `no net change across the five axes, ${how}`
                : `${scenarioCivic > baseCivic ? "up" : "down"} ${Math.abs(scenarioCivic - baseCivic)} points, ${how}`,
        value: measured(scenarioCivic, "score 0-100", "modelled", "CivicFlow composite", {
            formula:
                weighting === "equal"
                    ? "unweighted mean of the five normalised axis scores"
                    : "weighted mean of the five normalised axis scores, using the priorities set in the lab",
            inputs: {
                "Baseline": measured(baseCivic, "score 0-100", "modelled", "baseline run"),
                "Scenario": measured(scenarioCivic, "score 0-100", "modelled", "scenario run"),
            },
        }),
    }
}

/**
 * THE TRADEOFF: the single most important thing this scenario gives up, and
 * what it buys.
 *
 * Chosen by comparing normalised axis movements and taking the largest gain
 * against the largest loss. Returns null when nothing moved meaningfully, which
 * is a real answer and better than manufacturing tension that is not there.
 */
export function findTradeoff(
    baseScores: Record<string, number>,
    scenarioScores: Record<string, number>,
    labels: Record<string, string>,
): { gain: string | null; loss: string | null; sentence: string } {
    const deltas = Object.keys(scenarioScores).map((k) => ({
        key: k,
        label: labels[k],
        delta: scenarioScores[k] - baseScores[k],
    }))
    const gains = deltas.filter((d) => d.delta > 1).sort((a, b) => b.delta - a.delta)
    const losses = deltas.filter((d) => d.delta < -1).sort((a, b) => a.delta - b.delta)

    /* This used to return null whenever every axis moved the same way, and the
       UI rendered that as "nothing moved by more than a point" -- which was
       flatly untrue of a scenario that had just cost forty points across the
       board. A scenario with no tradeoff is not a scenario with no effect, and
       saying so was the single most misleading sentence in the app. Each case
       now gets its own reading. */
    if (gains.length && losses.length) {
        const gain = gains[0]
        const loss = losses[0]
        return {
            gain: gain.label,
            loss: loss.label,
            sentence: `This scenario improves modelled ${gain.label.toLowerCase()} by ${gain.delta.toFixed(0)} points and gives up ${Math.abs(loss.delta).toFixed(0)} points of modelled ${loss.label.toLowerCase()}.`,
        }
    }

    if (losses.length) {
        const worst = losses[0]
        const others = losses.length - 1
        return {
            gain: null,
            loss: worst.label,
            sentence: `There is no tradeoff here: every axis that moved, moved against you. Modelled ${worst.label.toLowerCase()} falls furthest, by ${Math.abs(worst.delta).toFixed(0)} points${others > 0 ? `, and ${others} other ${others === 1 ? "axis follows" : "axes follow"} it down` : ""}.`,
        }
    }

    if (gains.length) {
        const best = gains[0]
        const others = gains.length - 1
        return {
            gain: best.label,
            loss: null,
            sentence: `There is no tradeoff here: nothing measurably worsened. Modelled ${best.label.toLowerCase()} gains most, by ${best.delta.toFixed(0)} points${others > 0 ? `, with ${others} other ${others === 1 ? "axis" : "axes"} also up` : ""}.`,
        }
    }

    return {
        gain: null,
        loss: null,
        sentence: "No axis moved by more than a point against the baseline.",
    }
}
