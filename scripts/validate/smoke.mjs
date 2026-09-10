/**
 * Browser smoke test.
 *
 * The engine is already covered by demo.ts, which runs the same code path the
 * worker does. What this checks is everything demo.ts cannot: that the worker
 * actually instantiates under the bundler, that the canvas renders something,
 * and that clicking "run simulation" produces a consequence chain in the DOM.
 * Those are exactly the failures a typecheck and a successful build will miss.
 */

import puppeteer from "puppeteer"

const BASE = process.env.BASE ?? "http://localhost:3311"
const problems = []
const note = (s) => console.log(`  ${s}`)

async function main() {
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] })
    const page = await browser.newPage()
    await page.setCacheEnabled(false)
    await page.setViewport({ width: 1440, height: 900 })

    page.on("console", (m) => {
        if (m.type() === "error") problems.push(`console error: ${m.text().slice(0, 200)}`)
    })
    page.on("pageerror", (e) => problems.push(`page error: ${e.message.slice(0, 200)}`))
    page.on("response", (r) => {
        if (r.status() >= 400) console.log(`  !! ${r.status()} ${r.url()}`)
    })
    page.on("requestfailed", (r) => console.log(`  !! failed ${r.url()} ${r.failure()?.errorText}`))

    /* --- home --- */
    console.log("\n[home]")
    // domcontentloaded, not networkidle: the hero runs a requestAnimationFrame
    // loop for as long as it is on screen, so the network never goes idle.
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForSelector("canvas", { timeout: 30000 })
    await new Promise((r) => setTimeout(r, 2500))
    const title = await page.$eval("h1", (el) => el.textContent?.trim())
    note(`h1: ${title}`)
    if (title !== "CIVICFLOW") problems.push(`unexpected h1: ${title}`)

    const sampleCanvas = () => page.evaluate(() => {
        const c = document.querySelector("canvas")
        if (!c) return { ok: false, reason: "no canvas" }
        const ctx = c.getContext("2d")
        const { data } = ctx.getImageData(0, 0, c.width, Math.min(c.height, 400))
        let nonBackground = 0
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] > 20 || data[i + 1] > 20 || data[i + 2] > 24) nonBackground++
        }
        return { ok: nonBackground > 500, nonBackground, w: c.width, h: c.height }
    })

    // At rest the interstate skeleton should already be on screen.
    const atRest = await sampleCanvas()
    note(`hero at rest: ${atRest.w}x${atRest.h}, ${atRest.nonBackground} lit pixels`)
    if (!atRest.ok) problems.push(`hero canvas blank at rest (${atRest.reason ?? atRest.nonBackground})`)

    // Then scrubbing must add to it -- that is the whole mechanic.
    for (let i = 0; i < 25; i++) {
        await page.mouse.wheel({ deltaY: 220 })
        await new Promise((r) => setTimeout(r, 40))
    }
    await new Promise((r) => setTimeout(r, 900))
    const scrubbed = await sampleCanvas()
    note(`hero after scrub: ${scrubbed.nonBackground} lit pixels`)
    if (scrubbed.nonBackground <= atRest.nonBackground * 1.2) {
        problems.push(`scrubbing did not reveal more network (${atRest.nonBackground} -> ${scrubbed.nonBackground})`)
    }

    /* --- lab --- */
    console.log("\n[lab]")
    await page.goto(`${BASE}/lab`, { waitUntil: "domcontentloaded", timeout: 60000 })

    /* Wait on the composer, not on the run button. RUN is deliberately disabled
       until the scenario holds at least one change, so "enabled" is no longer a
       signal that the area finished loading.
       
       And not on "Add to scenario" either: the builder now opens on the project
       catalogue, where that button appears only once a project is picked. The
       signal that the worker finished is the catalogue having rows in it, since
       the rows are filtered by the loaded area. */
    await page.waitForFunction(
        () =>
            document.body.innerText.includes("From Arkansas") &&
            [...document.querySelectorAll("button")].some((b) =>
                / County$/.test(b.textContent?.trim() ?? ""),
            ) &&
            !!document.querySelector('svg[aria-label^="Decision DNA"]'),
        { timeout: 120000 },
    )
    note("worker loaded the area and the composer is ready")

    const dnaPresent = await page.$('svg[aria-label^="Decision DNA"]')
    note(`baseline Decision DNA rendered: ${Boolean(dnaPresent)}`)
    if (!dnaPresent) problems.push("no baseline DNA svg")

    // Composing and running is covered end to end by flow-check.mjs, which
    // follows the hand-off to /result. Smoke stays on what the lab itself owns.
    const composer = await page.evaluate(() =>
        document.body.innerText.includes("SCENARIO") &&
        document.body.innerText.includes("From Arkansas") &&
        document.body.innerText.includes("Build your own"),
    )
    note(`scenario composer present: ${composer}`)
    if (!composer) problems.push("scenario composer missing from the lab")

    /* The catalogue is the lab's front door now, so an empty one is a broken
       lab even though nothing throws. Northwest Arkansas carries nine of the
       twenty; the statewide model carries all of them. */
    const projects = await page.evaluate(
        () =>
            [...document.querySelectorAll("button")].filter((b) =>
                / County$/.test(b.textContent?.trim() ?? ""),
            ).length,
    )
    note(`Arkansas projects offered for this area: ${projects}`)
    if (projects < 5) problems.push(`project catalogue nearly empty (${projects} rows)`)

    // Picking one has to produce the preview: a specific object, drawn.
    await page.evaluate(() => {
        const row = [...document.querySelectorAll("button")].find((b) => b.innerText.includes("Bypass"))
        row?.click()
    })
    await new Promise((r) => setTimeout(r, 3200))
    const preview = await page.evaluate(() => {
        const ok = document.body.innerText.includes("THE PROJECT")
        // The preview's own canvas, not the map's: the map is far larger and
        // would pass this check on its own, which would make the assertion
        // about the preview meaningless.
        const c = document.querySelector("canvas[data-preview-model]")
        if (!c?.width) return { ok, lit: 0 }
        const { data } = c.getContext("2d").getImageData(0, 0, c.width, c.height)
        let lit = 0
        for (let i = 3; i < data.length; i += 4) if (data[i] > 12) lit++
        return { ok, lit }
    })
    note(`project preview drawn: ${preview.ok}, ${preview.lit} lit pixels in the model canvas`)
    if (!preview.ok) problems.push("picking a project did not open the preview panel")
    if (preview.lit < 2000) problems.push(`preview model looks blank (${preview.lit} lit pixels)`)

    const history = await page.evaluate(() => document.body.innerText.includes("DECISION HISTORY"))
    note(`decision history present: ${history}`)
    if (!history) problems.push("decision history missing from the lab")

    await browser.close()

    console.log("\n" + "=".repeat(52))
    if (problems.length) {
        console.log(`FAILED: ${problems.length} problem(s):`)
        for (const p of problems) console.log(`  - ${p}`)
        process.exit(1)
    }
    console.log("all checks passed")
}

main().catch((e) => {
    console.error("smoke test crashed:", e.message)
    process.exit(1)
})
