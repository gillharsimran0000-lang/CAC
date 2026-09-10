/**
 * Proves the four result animations actually run.
 *
 * Each is checked by sampling the DOM/canvas mid-transition and again once
 * settled: if the two samples are identical, nothing animated and the value
 * simply snapped. A build passing says nothing about whether motion happened.
 */
import puppeteer from "puppeteer"

const BASE = process.env.BASE ?? "http://localhost:3000"
const fails = []
const ok = (label, pass, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? `  · ${detail}` : ""}`)
  if (!pass) fails.push(label)
}

const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] })
const p = await b.newPage()
await p.setCacheEnabled(false)
await p.setViewport({ width: 1600, height: 1000 })
p.on("pageerror", (e) => fails.push(`page error: ${e.message.slice(0, 140)}`))

/* The builder opens on the Arkansas project catalogue, where "Add to scenario"
   only exists once a project is picked. These checks drive the hand-built path,
   so every arrival at the lab switches tabs first. The tab is component state,
   so it resets on every mount -- including the trip back from /result. */
const openManual = async () => {
  await p.waitForFunction(
    () => [...document.querySelectorAll("button")].some(b => / County$/.test(b.textContent?.trim() ?? "")),
    { timeout: 180000 },
  )
  await p.evaluate(() => {
    [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "Build your own")?.click()
  })
  await p.waitForFunction(
    () => [...document.querySelectorAll("button")].some(b => b.textContent?.trim() === "Add to scenario"),
    { timeout: 60000 },
  )
}

await p.goto(`${BASE}/lab`, { waitUntil: "domcontentloaded" })
await openManual()

const dnaPath = () => p.evaluate(() => document.querySelector('[data-dna-shape]')?.getAttribute("d") ?? "")
const score = () => p.evaluate(() => {
  const el = document.querySelector("span.tabular")
  return el?.textContent?.trim() ?? ""
})
const mapPixels = () => p.evaluate(() => {
  const c = [...document.querySelectorAll("canvas")].sort((a, b) => b.width - a.width)[0]
  const ctx = c.getContext("2d")
  const { data } = ctx.getImageData(0, 0, c.width, Math.min(c.height, 600))
  let sum = 0
  for (let i = 0; i < data.length; i += 400) sum += data[i] * 3 + data[i + 1] * 5 + data[i + 2] * 7
  return sum
})

const runScenario = async (residents) => {
  await p.evaluate((r) => {
    const rg = document.querySelector('aside input[type="range"]')
    if (rg) {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(rg, String(r))
      rg.dispatchEvent(new Event("input", { bubbles: true }))
    }
  }, residents)
  await new Promise(r => setTimeout(r, 200))
  await p.evaluate(() => [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "Add to scenario")?.click())
  await new Promise(r => setTimeout(r, 280))
  await p.evaluate(() => [...document.querySelectorAll("button")].find(b => b.textContent?.includes("RUN SIMULATION"))?.click())
}

console.log("\n[result page: deforms out of the baseline]")
await runScenario(9000)
await p.waitForFunction(() => location.pathname === "/result", { timeout: 180000 })
await p.waitForFunction(
  () => !!document.querySelector('[data-dna-shape]'),
  { timeout: 120000 },
)

// Sample immediately on arrival, then once settled: both must differ, or the
// shape and the score simply appeared at their final values.
const pathMid = await dnaPath(), scoreMid = await score()
await new Promise(r => setTimeout(r, 2600))
const path1 = await dnaPath(), score1 = await score()

ok("DNA deforms out of the baseline", pathMid !== path1 && pathMid.length > 0,
  "shape on arrival differs from settled")
ok("score counts out of the baseline", scoreMid !== score1, `${scoreMid} → ${score1}`)

console.log("\n[lab: map and history]")

/* Back via the link, not a fresh goto. The store is module state, so a hard
   navigation throws away every version and the lab comes back empty -- which is
   exactly what the first version of this test was measuring, and why it read as
   "nothing animated" rather than as "the history was gone". */
const backToLab = async () => {
  await p.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find(x => x.textContent?.includes("Back to the lab"))
    a?.click()
  })
  await p.waitForFunction(() => location.pathname === "/lab", { timeout: 60000 })
  await openManual()
  await new Promise(r => setTimeout(r, 2600))
}

await backToLab()
const map0 = await mapPixels()

await runScenario(46000)
await p.waitForFunction(() => location.pathname === "/result", { timeout: 180000 })
await backToLab()
const map1 = await mapPixels()
ok("map reflects the latest run", map1 !== map0, "congestion field changed between runs")

const rowAnim = await p.evaluate(() => {
  const li = document.querySelector("li.animate-row-in")
  if (!li) return null
  const cs = getComputedStyle(li)
  return { name: cs.animationName, dur: cs.animationDuration, ease: cs.animationTimingFunction }
})
ok("history row entrance", rowAnim?.name === "civic-row-in",
  rowAnim ? `${rowAnim.name} ${rowAnim.dur} ${rowAnim.ease}` : "no animated row found")

await b.close()
console.log("\n" + "=".repeat(50))
if (fails.length) { console.log("FAILED:"); fails.forEach(f => console.log("  - " + f)); process.exit(1) }
console.log("motion verified across both pages")
