/**
 * Photographs of the places the model runs on.
 *
 * Every county tile in the gallery names a real place. This fetches a real
 * photograph of that place from Wikimedia Commons, keeps only images under a
 * licence that permits reuse, and records the photographer and licence next to
 * the file so the credit travels with it.
 *
 * Nothing is hotlinked: the file is downloaded into public/photos so the app
 * works offline and does not lean on Wikimedia's bandwidth. Anything whose
 * licence cannot be read as free is dropped rather than guessed at.
 */

import fs from "node:fs/promises"
import path from "node:path"

const API = "https://commons.wikimedia.org/w/api.php"
const OUT_DIR = path.join(process.cwd(), "public", "photos")
const MANIFEST = path.join(process.cwd(), "data", "raw", "photos.json")
const WIDTH = 1800

/** Words that mean the photograph is of an event, not of the place. */
const REJECT = [
    /damage|tornado|destroy|debris|wreck|crash|fire|flood|storm/i,
    /\bmap\b|logo|seal|diagram|chart|plaque|sign\b|marker|postcard|scan/i,
    /\bgrave|cemetery|tomb/i,
]

/**
 * Credits that mean the image is a period postcard rather than a photograph.
 * The Tichnor Brothers collection is public domain and turns up first for a
 * lot of Arkansas main streets, but a 1940s linen postcard sits badly beside
 * photographs of the place as it is now.
 */
const REJECT_CREDIT = [/tichnor|curt teich|postcard|publisher/i]

/** Licences we will ship. Anything else is dropped. */
const FREE = [
    /^cc0/i, /^cc by(-sa)? [0-9.]+/i, /^public domain/i, /^pd/i,
    /^attribution/i,
]

/**
 * Subjects, in the order the gallery wants them. `slug` is the key the app
 * refers to; `search` is what Commons is asked; `must` filters the candidate
 * titles so a search for "Rogers Arkansas" cannot return Rogers, Minnesota.
 */
const SUBJECTS = [
    { slug: "bentonville", place: "Bentonville", county: "Benton", search: "Crystal Bridges Museum of American Art Bentonville", must: ["bentonville", "crystal bridges"] },
    { slug: "rogers", place: "Rogers", county: "Benton", search: "Downtown Rogers Arkansas historic district", must: ["rogers"] },
    { slug: "fayetteville", place: "Fayetteville", county: "Washington", search: "Old Main University of Arkansas Fayetteville", must: ["fayetteville", "old main"] },
    { slug: "springdale", place: "Springdale", county: "Washington", search: "Springdale Arkansas Emma Avenue downtown street", pick: "Emma Avenue, downtown Springdale, Arkansas.jpg", must: ["springdale"] },
    { slug: "little-rock", place: "Little Rock", county: "Pulaski", search: "Little Rock Arkansas skyline river", must: ["little rock"] },
    { slug: "state-capitol", place: "Little Rock", county: "Pulaski", search: "Arkansas State Capitol building", must: ["capitol"] },
    { slug: "fort-smith", place: "Fort Smith", county: "Sebastian", search: "Fort Smith Arkansas downtown", pick: "Fort Smith, AR 005.jpg", must: ["fort smith"] },
    { slug: "jonesboro", place: "Jonesboro", county: "Craighead", search: "Jonesboro Arkansas Main Street downtown courthouse", also: ["Craighead County Courthouse Jonesboro", "Arkansas State University Jonesboro campus"], must: ["jonesboro", "craighead"] },
    { slug: "conway", place: "Conway", county: "Faulkner", search: "Conway Arkansas downtown Front Street", also: ["Faulkner County Courthouse Conway Arkansas", "Hendrix College Conway Arkansas"], must: ["conway", "faulkner"] },
    { slug: "hot-springs", place: "Hot Springs", county: "Garland", search: "Bathhouse Row Hot Springs Arkansas", must: ["hot springs", "bathhouse"] },
    { slug: "searcy", place: "Searcy", county: "White", search: "Searcy Arkansas courthouse square", also: ["White County Courthouse Searcy Arkansas", "Harding University Searcy"], must: ["searcy", "white county"] },
    { slug: "el-dorado", place: "El Dorado", county: "Union", search: "El Dorado Arkansas downtown square", also: ["Union County Courthouse El Dorado Arkansas", "El Dorado Commercial Historic District"], must: ["el dorado", "union county"] },
    { slug: "blytheville", place: "Blytheville", county: "Mississippi", search: "Blytheville Arkansas Main Street commercial historic district", must: ["blytheville"] },
    { slug: "buffalo-river", place: "Buffalo National River", county: "Newton", search: "Buffalo National River Arkansas bluff", must: ["buffalo"] },
    { slug: "hawksbill-crag", place: "Hawksbill Crag", county: "Newton", search: "Hawksbill Crag Whitaker Point Arkansas", must: ["hawksbill", "whitaker"] },
    { slug: "ozarks", place: "The Ozarks", county: "Madison", search: "Ozark National Forest Arkansas overlook", also: ["Boston Mountains Arkansas", "Ozark Mountains Arkansas"], must: ["ozark", "boston mountain"] },
    { slug: "delta", place: "The Delta", county: "Phillips", search: "Rice field Arkansas farm", also: ["Arkansas Delta landscape", "Helena Arkansas Mississippi River"], must: ["arkansas", "helena", "rice"] },
    { slug: "arkansas-river", place: "Arkansas River", county: "Pulaski", search: "Big Dam Bridge Arkansas River Little Rock", must: ["bridge", "arkansas river"] },

    /* The second pass. The first eighteen covered the metros the simulator
       ships higher-resolution models for; these cover the rest of the state,
       so a reader scrolling the county strip meets places rather than a list
       of names, and so every project in the Arkansas catalog can be shown the
       ground it would actually be built on. */
    { slug: "pine-bluff", place: "Pine Bluff", county: "Jefferson", search: "Pine Bluff Arkansas downtown Main Street", also: ["Jefferson County Courthouse Pine Bluff Arkansas"], must: ["pine bluff", "jefferson county"] },
    { slug: "texarkana", place: "Texarkana", county: "Miller", search: "Texarkana Arkansas Union Station post office", also: ["Texarkana Arkansas downtown"], must: ["texarkana"] },
    { slug: "russellville", place: "Russellville", county: "Pope", search: "Russellville Arkansas downtown Arkansas Tech", also: ["Lake Dardanelle Russellville Arkansas", "Pope County Courthouse Arkansas"], must: ["russellville", "dardanelle", "pope county"] },
    { slug: "north-little-rock", place: "North Little Rock", county: "Pulaski", search: "Argenta Historic District North Little Rock Arkansas", also: ["Old Mill North Little Rock Arkansas", "North Little Rock Arkansas Main Street"], must: ["north little rock", "argenta", "old mill"] },
    { slug: "eureka-springs", place: "Eureka Springs", county: "Carroll", search: "Eureka Springs Arkansas Spring Street historic district buildings", also: ["Basin Park Hotel Eureka Springs", "Crescent Hotel Eureka Springs Arkansas"], must: ["eureka springs"] },
    { slug: "harrison", place: "Harrison", county: "Boone", search: "Harrison Arkansas courthouse square downtown", also: ["Boone County Courthouse Harrison Arkansas"], must: ["harrison", "boone county"] },
    { slug: "mountain-home", place: "Mountain Home", county: "Baxter", search: "Mountain Home Arkansas downtown square", also: ["Norfork Lake Arkansas", "Baxter County Courthouse Arkansas"], must: ["mountain home", "norfork", "baxter county"] },
    { slug: "batesville", place: "Batesville", county: "Independence", search: "Batesville Arkansas Main Street historic district", also: ["Independence County Courthouse Batesville Arkansas"], must: ["batesville", "independence county"] },
    { slug: "paragould", place: "Paragould", county: "Greene", search: "Paragould Arkansas downtown Pruett Street", also: ["Greene County Courthouse Paragould Arkansas"], must: ["paragould", "greene county"] },
    { slug: "west-memphis", place: "West Memphis", county: "Crittenden", search: "Hernando de Soto Bridge Mississippi River Interstate 40", also: ["West Memphis Arkansas"], must: ["hernando", "west memphis", "memphis bridge"] },
    { slug: "van-buren", place: "Van Buren", county: "Crawford", search: "Van Buren Arkansas Main Street historic district", also: ["Crawford County Courthouse Van Buren Arkansas"], must: ["van buren", "crawford county"] },
    { slug: "petit-jean", place: "Petit Jean Mountain", county: "Conway", search: "Cedar Falls Petit Jean State Park Arkansas", also: ["Petit Jean Mountain Arkansas overlook"], must: ["petit jean", "cedar falls"] },
    { slug: "mount-magazine", place: "Mount Magazine", county: "Logan", search: "Mount Magazine State Park Arkansas overlook", must: ["magazine"] },
    { slug: "lake-ouachita", place: "Lake Ouachita", county: "Montgomery", search: "Lake Ouachita State Park Arkansas water", also: ["Ouachita National Forest Arkansas view", "Ouachita Mountains Arkansas overlook"], must: ["ouachita"] },
    { slug: "murfreesboro", place: "Murfreesboro", county: "Pike", search: "Crater of Diamonds State Park search field diamond mine", also: ["Pike County Courthouse Arkansas", "Murfreesboro Arkansas"], must: ["crater of diamonds", "murfreesboro", "pike county"] },
    { slug: "arkadelphia", place: "Arkadelphia", county: "Clark", search: "Arkadelphia Arkansas downtown Ouachita Baptist University", also: ["Clark County Courthouse Arkadelphia Arkansas", "Henderson State University Arkadelphia"], must: ["arkadelphia", "ouachita baptist", "henderson state", "clark county"] },
    { slug: "magnolia", place: "Magnolia", county: "Columbia", search: "Magnolia Arkansas courthouse square", also: ["Columbia County Courthouse Magnolia Arkansas", "Southern Arkansas University Magnolia"], must: ["magnolia", "columbia county"] },
    { slug: "bella-vista", place: "Bella Vista", county: "Benton", search: "Bella Vista Arkansas lake", also: ["Bella Vista Bypass Arkansas", "Interstate 49 Arkansas"], must: ["bella vista", "interstate 49"] },
    { slug: "stuttgart", place: "Stuttgart", county: "Arkansas", search: "Stuttgart Arkansas rice field grain", also: ["Arkansas County Courthouse Stuttgart", "Rice harvest Arkansas"], must: ["stuttgart", "arkansas county", "rice"] },
    { slug: "xna", place: "Northwest Arkansas National Airport", county: "Benton", search: "Northwest Arkansas National Airport terminal", also: ["XNA airport Arkansas"], must: ["northwest arkansas national", "xna"] },
    { slug: "pinnacle-mountain", place: "Pinnacle Mountain", county: "Pulaski", search: "Pinnacle Mountain State Park Arkansas", must: ["pinnacle mountain"] },
    { slug: "razorback-greenway", place: "Razorback Greenway", county: "Washington", search: "Razorback Regional Greenway trail Arkansas", also: ["Fayetteville Arkansas trail bridge"], must: ["razorback", "greenway", "trail"] },
]

const strip = (html) =>
    (html ?? "")
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
        .replace(/\s+/g, " ")
        .trim()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * One Commons request, throttled and backed off.
 *
 * Commons answers a burst of searches with 429. Waiting between requests and
 * doubling the wait on a rejection is the difference between ten photographs
 * and eighteen; the whole fetch still finishes inside a minute.
 */
async function api(params, attempt = 0) {
    const url = new URL(API)
    for (const [k, v] of Object.entries({ format: "json", origin: "*", ...params })) {
        url.searchParams.set(k, v)
    }
    const res = await fetch(url, { headers: { "user-agent": "CivicFlow/0.1 (civic planning simulator; contact via repo)" } })
    if (res.status === 429 && attempt < 5) {
        await sleep(2000 * 2 ** attempt)
        return api(params, attempt + 1)
    }
    if (!res.ok) throw new Error(`commons ${res.status}`)
    return res.json()
}

/** One named file, for subjects where search keeps returning the wrong thing. */
async function exact(title) {
    const json = await api({
        action: "query",
        titles: `File:${title}`,
        prop: "imageinfo",
        iiprop: "url|extmetadata|size|mime",
        iiurlwidth: WIDTH,
    })
    return Object.values(json?.query?.pages ?? {}).filter((p) => p.imageinfo)
}

/** Candidate files for a subject, best match first. */
async function candidates(subject) {
    const json = await api({
        action: "query",
        generator: "search",
        gsrsearch: `${subject.search} filetype:bitmap`,
        gsrnamespace: 6,
        gsrlimit: 25,
        prop: "imageinfo",
        iiprop: "url|extmetadata|size|mime",
        iiurlwidth: WIDTH,
    })
    const pages = Object.values(json?.query?.pages ?? {})
    // The generator returns pages unordered; `index` carries the search rank.
    return pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
}

function evaluate(page, subject) {
    const ii = page.imageinfo?.[0]
    if (!ii) return null
    if (!/^image\/(jpeg|png|webp)$/.test(ii.mime ?? "")) return null
    // Portraits and near-squares crop badly into a wide tile.
    if (!ii.width || !ii.height || ii.width / ii.height < 1.05) return null
    if (ii.width < 1000) return null

    const title = page.title.replace(/^File:/, "")
    const hay = title.toLowerCase()
    if (subject.must.length && !subject.must.some((m) => hay.includes(m))) return null
    if (REJECT.some((re) => re.test(hay))) return null

    const em = ii.extmetadata ?? {}
    const credit = strip(em.Artist?.value) || "Unknown photographer"
    if (REJECT_CREDIT.some((re) => re.test(credit))) return null

    const licence = strip(em.LicenseShortName?.value) || strip(em.License?.value)
    if (!licence || !FREE.some((re) => re.test(licence))) return null

    return {
        slug: subject.slug,
        place: subject.place,
        county: subject.county,
        file: title,
        credit,
        licence,
        licenceUrl: strip(em.LicenseUrl?.value) || null,
        source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
        width: ii.thumbwidth ?? ii.width,
        height: ii.thumbheight ?? ii.height,
        thumb: ii.thumburl ?? ii.url,
    }
}

async function download(url, dest) {
    const res = await fetch(url, { headers: { "user-agent": "CivicFlow/0.1 (civic planning simulator)" } })
    if (!res.ok) throw new Error(`download ${res.status}`)
    await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()))
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true })
    await fs.mkdir(path.dirname(MANIFEST), { recursive: true })

    // --only=fort-smith re-fetches one subject and merges it back into the
    // manifest, so replacing a bad pick does not mean re-downloading eighteen.
    const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",")
    const previous = only
        ? JSON.parse(await fs.readFile(MANIFEST, "utf8").catch(() => '{"photos":[]}')).photos
        : []

    const kept = previous.filter((p) => !only?.includes(p.slug))
    for (const subject of SUBJECTS.filter((s) => !only || only.includes(s.slug))) {
        try {
            let picked = null
            // The primary search first, then any fallbacks, so a specific
            // subject is preferred over a merely-correct one.
            if (subject.pick) {
                for (const page of await exact(subject.pick)) {
                    picked = evaluate(page, subject)
                    if (picked) break
                }
                if (!picked) console.warn(`  ! ${subject.slug}: named file rejected, falling back to search`)
                await sleep(900)
            }
            for (const term of picked ? [] : [subject.search, ...(subject.also ?? [])]) {
                const pages = await candidates({ ...subject, search: term })
                for (const page of pages) {
                    picked = evaluate(page, subject)
                    if (picked) break
                }
                if (picked) break
                await sleep(900)
            }
            if (!picked) {
                console.warn(`  ✗ ${subject.slug}: no freely licensed landscape image found`)
                continue
            }
            const ext = picked.file.match(/\.(jpe?g|png|webp)$/i)?.[1].toLowerCase() ?? "jpg"
            const name = `${picked.slug}.${ext === "jpeg" ? "jpg" : ext}`
            await download(picked.thumb, path.join(OUT_DIR, name))
            const { thumb, ...rest } = picked
            kept.push({ ...rest, src: `/photos/${name}` })
            console.log(`  ✓ ${subject.slug.padEnd(16)} ${picked.licence.padEnd(14)} ${picked.file.slice(0, 60)}`)
        } catch (err) {
            console.warn(`  ✗ ${subject.slug}: ${err.message}`)
        }
        await sleep(1200)
    }

    // Keep manifest order matching SUBJECTS regardless of what was re-fetched.
    const order = new Map(SUBJECTS.map((s, i) => [s.slug, i]))
    kept.sort((a, b) => (order.get(a.slug) ?? 99) - (order.get(b.slug) ?? 99))

    await fs.writeFile(MANIFEST, JSON.stringify({ fetchedAt: new Date().toISOString(), source: "Wikimedia Commons", photos: kept }, null, 2))
    console.log(`\n${kept.length}/${SUBJECTS.length} photographs in the manifest`)
}

main()
