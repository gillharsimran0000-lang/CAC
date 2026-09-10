/**
 * Pulls demand zones with real population attached.
 *
 * The obvious route -- ACS via api.census.gov -- now rejects keyless requests,
 * and returns an HTML "Missing Key" page rather than an HTTP error, so it fails
 * in a way that is easy to mistake for success. TIGERweb's Census2020 service
 * avoids the problem entirely: it carries POP100 and HU100, the 2020 Decennial
 * counts, on the block group layer itself, with no key. Summed over Arkansas it
 * reproduces the published state total of 3,011,524 exactly, which is the check
 * that says the join and the state filter are both right.
 *
 * A full enumeration is also a better planning baseline than a survey estimate:
 * ACS block group figures carry margins of error wide enough to swamp the
 * population changes a scenario is trying to model.
 *
 * Block groups are fetched once and aggregated up to counties by GEOID prefix,
 * so the statewide view and the metro view can never disagree about how many
 * people live somewhere.
 *
 *   node scripts/fetch-census.mjs
 */

import { writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { STATE_FIPS } from "./config.mjs"

const RAW = path.join(process.cwd(), "data", "raw")
const CENSUS2020 = "https://tigerweb.geo.census.gov/arcgis/rest/services/Census2020/tigerWMS_Census2020/MapServer"
const TIGER_ACS = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/MapServer"

const BLOCK_GROUP_LAYER = 8
const COUNTY_LAYER = 82 // only in the ACS service; Census2020 stops at states

/**
 * ArcGIS silently truncates past its record cap and signals it with
 * exceededTransferLimit rather than an error, so pages are walked explicitly.
 */
async function queryAll(base, layer, { where, outFields, geometry, simplifyDeg }) {
    const features = []
    for (let offset = 0; ; offset += 1000) {
        const params = new URLSearchParams({
            where,
            outFields,
            returnGeometry: String(Boolean(geometry)),
            outSR: "4326",
            f: "json",
            resultOffset: String(offset),
            resultRecordCount: "1000",
        })
        if (geometry) {
            params.set("geometryPrecision", "5")
            params.set("maxAllowableOffset", String(simplifyDeg))
        }
        const res = await fetch(`${base}/${layer}/query?${params}`, {
            signal: AbortSignal.timeout(180_000),
        })
        if (!res.ok) throw new Error(`TIGERweb HTTP ${res.status}`)
        const page = await res.json()
        if (page.error) throw new Error(`TIGERweb: ${JSON.stringify(page.error)}`)
        features.push(...(page.features ?? []))
        process.stdout.write(`\r    ${features.length} features`)
        if (!page.exceededTransferLimit) break
    }
    console.log()
    return features
}

/** The published 2020 count. If our sum misses it, the pipeline is wrong. */
const AR_POP_2020 = 3_011_524

async function run() {
    await mkdir(RAW, { recursive: true })
    console.log("== Arkansas block groups, 2020 Decennial ==")

    const bgFeatures = await queryAll(CENSUS2020, BLOCK_GROUP_LAYER, {
        where: `STATE='${STATE_FIPS}'`,
        outFields: "GEOID,BASENAME,STATE,COUNTY,TRACT,BLKGRP,POP100,HU100,AREALAND,INTPTLAT,INTPTLON",
        geometry: true,
        simplifyDeg: 0.0002, // ~22 m
    })

    const blockGroups = bgFeatures.map((f) => {
        const a = f.attributes
        return {
            geoid: a.GEOID,
            countyFips: `${a.STATE}${a.COUNTY}`,
            name: `Block Group ${a.BLKGRP}`,
            kind: "blockgroup",
            population: a.POP100 ?? 0,
            housingUnits: a.HU100 ?? 0,
            areaLandM2: a.AREALAND ?? 0,
            centroid: [Number(a.INTPTLON), Number(a.INTPTLAT)],
            rings: f.geometry?.rings ?? null,
        }
    })

    const total = blockGroups.reduce((s, b) => s + b.population, 0)
    const ok = total === AR_POP_2020
    console.log(`  block groups: ${blockGroups.length}`)
    console.log(`  population sum: ${total.toLocaleString()} vs published ${AR_POP_2020.toLocaleString()} -- ${ok ? "MATCH" : "MISMATCH"}`)
    if (!ok) {
        throw new Error(
            `population total does not match the published 2020 count; refusing to write data that would be labelled VERIFIED`,
        )
    }

    /* Counties: geometry from the ACS service, population summed from the block
       groups above so the two resolutions are guaranteed consistent. */
    console.log("\n== Arkansas counties ==")
    const countyFeatures = await queryAll(TIGER_ACS, COUNTY_LAYER, {
        where: `STATE='${STATE_FIPS}'`,
        outFields: "*",
        geometry: true,
        simplifyDeg: 0.001, // ~110 m
    })

    const byCounty = new Map()
    for (const bg of blockGroups) {
        const c = byCounty.get(bg.countyFips) ?? { population: 0, housingUnits: 0, blockGroups: 0 }
        c.population += bg.population
        c.housingUnits += bg.housingUnits
        c.blockGroups++
        byCounty.set(bg.countyFips, c)
    }

    const counties = countyFeatures.map((f) => {
        const a = f.attributes
        const agg = byCounty.get(a.GEOID) ?? { population: 0, housingUnits: 0, blockGroups: 0 }
        return {
            geoid: a.GEOID,
            name: a.BASENAME,
            kind: "county",
            population: agg.population,
            housingUnits: agg.housingUnits,
            blockGroupCount: agg.blockGroups,
            areaLandM2: a.AREALAND ?? 0,
            centroid: [Number(a.INTPTLON), Number(a.INTPTLAT)],
            rings: f.geometry?.rings ?? null,
        }
    })

    const countyTotal = counties.reduce((s, c) => s + c.population, 0)
    console.log(`  counties: ${counties.length}, population ${countyTotal.toLocaleString()}`)
    if (countyTotal !== total) {
        throw new Error(`county rollup ${countyTotal} != block group total ${total}`)
    }

    const top = [...counties].sort((a, b) => b.population - a.population).slice(0, 5)
    console.log(`  largest: ${top.map((c) => `${c.name} ${c.population.toLocaleString()}`).join(", ")}`)

    const provenance = {
        population: {
            level: "verified",
            source: "US Census Bureau, 2020 Decennial Census (TIGERweb Census2020, POP100)",
            note: "full enumeration, not a survey estimate",
            checkedAgainst: AR_POP_2020,
        },
        housingUnits: {
            level: "verified",
            source: "US Census Bureau, 2020 Decennial Census (HU100)",
        },
        geometry: {
            level: "verified",
            source: "US Census Bureau TIGERweb",
            note: "generalised for display; ~22 m for block groups, ~110 m for counties",
        },
    }

    await writeFile(
        path.join(RAW, "ar-blockgroups.json"),
        JSON.stringify({ fetchedAt: new Date().toISOString(), provenance, zones: blockGroups }),
    )
    await writeFile(
        path.join(RAW, "ar-counties.json"),
        JSON.stringify({ fetchedAt: new Date().toISOString(), provenance, zones: counties }),
    )
    console.log("\n  wrote data/raw/ar-blockgroups.json, data/raw/ar-counties.json")
}

await run()
