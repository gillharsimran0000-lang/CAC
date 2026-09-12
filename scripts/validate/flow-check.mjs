/**
 * The full loop: compose a scenario out of SEVERAL changes, run it, land on the
 * result page, and confirm the model, score and chain are all there.
 */
import puppeteer from "puppeteer"

const BASE = process.env.BASE ?? "http://localhost:3000"
const fails = []
const ok = (l, pass, d = "") => { console.log(`  ${pass ? "PASS" : "FAIL"}  ${l}${d ? `  · ${d}` : ""}`); if (!pass) fails.push(l) }

/* No software GPU here, deliberately. This check drives the result page, whose
   scroll scrub needs a real frame rate: under SwiftShader it ran at about two
   frames a second and the GSAP-driven card had not caught up within the wait,
   so a working reveal reported as stuck (506px -> 690px at 900ms, 506px ->
   1337px at 3000ms, 506px -> 1343px at 900ms with no flags). smoke.mjs runs
   with SwiftShader and owns the WebGL blueprint; this one tests whichever
   renderer the browser actually gets, which covers the no-WebGL fallback too. */
const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] })
const p = await b.newPage()
await p.setCacheEnabled(false)
await p.setViewport({ width: 1600, height: 1000 })
p.on("pageerror", (e) => fails.push(`page error: ${e.message.slice(0, 150)}`))

await p.goto(`${BASE}/lab`, { waitUntil: "domcontentloaded" })
await p.waitForFunction(
  () => [...document.querySelectorAll("button")].some(b => / County$/.test(b.textContent?.trim() ?? "")),
  { timeout: 180000 },
)

const clickText = (needle, exact = false) =>
  p.evaluate((n, ex) => {
    const btn = [...document.querySelectorAll("button")].find(b =>
      ex ? b.textContent?.trim() === n : b.textContent?.includes(n),
    )
    btn?.click()
    return !!btn
  }, needle, exact)

/* --- the catalogue, which is the front door ------------------------------ */
console.log("\n[catalogue: twenty Arkansas projects, searchable]")

const search = async (q) => {
  await p.evaluate((text) => {
    const input = document.querySelector('input[aria-label="Search the Arkansas project list"]')
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
    set.call(input, text)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }, q)
  await new Promise(r => setTimeout(r, 260))
  return p.evaluate(() =>
    [...document.querySelectorAll("button")].filter(b => / County$/.test(b.textContent?.trim() ?? "")).length,
  )
}

const all = await search("")
const narrowed = await search("bypass")
ok("typing narrows the project list", narrowed > 0 && narrowed < all, `${all} → ${narrowed} for "bypass"`)

await clickText("Bypass")
await new Promise(r => setTimeout(r, 1200))
/* Seek to the BUILT act before reading pixels: the early acts are drafting
   lines and a timed read lands mid-drawing. Also exercises act navigation. */
await clickText("Built", true)
await new Promise(r => setTimeout(r, 1500))

/* The preview is the point of picking: a specific object, drawn, with the
   axes it can reach marked beside it. */
const preview = await p.evaluate(() => {
  /* Whichever renderer the browser got. With WebGL the blueprint draws into a
     WebGL canvas, read back with readPixels -- possible only because the
     renderer sets preserveDrawingBuffer. Without WebGL, BlueprintView hands
     over to the painted ProjectModel, whose canvas carries data-preview-model
     and is read with getImageData. Both are outcomes a real user can get. */
  const webgl = [...document.querySelectorAll("canvas")].find(
    (x) => x.getContext("webgl2") || x.getContext("webgl"),
  )
  const painted = document.querySelector("canvas[data-preview-model]")
  const c = webgl ?? painted
  let lit = 0
  const total = c?.width ? c.width * c.height : 0
  const cssH = c ? Math.round(c.getBoundingClientRect().height) : 0
  if (webgl?.width) {
    const gl = webgl.getContext("webgl2") || webgl.getContext("webgl")
    const px = new Uint8Array(webgl.width * webgl.height * 4)
    gl.readPixels(0, 0, webgl.width, webgl.height, gl.RGBA, gl.UNSIGNED_BYTE, px)
    for (let i = 3; i < px.length; i += 4) if (px[i] > 12) lit++
  } else if (painted?.width) {
    const { data } = painted.getContext("2d").getImageData(0, 0, painted.width, painted.height)
    for (let i = 3; i < data.length; i += 4) if (data[i] > 12) lit++
  }
  return {
    mode: webgl ? "webgl" : painted ? "painted" : "none",
    lit,
    total,
    cssH,
    panel: document.body.innerText.includes("THE PROJECT"),
    // The label is uppercased by CSS, and innerText reflects that.
    limits: /not modelled/i.test(document.body.innerText),
    reaches: document.body.innerText.includes("WHAT IT REACHES"),
    acts: ["Site", "Blueprint", "Built", "Mechanism"].every((n) =>
      [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === n),
    ),
  }
})
// A fraction, because the canvas is sized by the viewport; see smoke.mjs.
const litFrac = preview.total ? preview.lit / preview.total : 0
ok(
  "picking a project draws its own model",
  litFrac > 0.02,
  `${preview.mode}: ${(litFrac * 100).toFixed(1)}% of ${preview.total} pixels lit`,
)
ok("the preview gets room to be seen", preview.cssH >= 150, `${preview.cssH}px tall`)
if (preview.mode === "webgl") {
  // The four acts are the feature; their absence is a broken panel.
  ok("the blueprint runs in four acts", preview.acts)
} else {
  // The fallback has no acts by design. What matters is that it drew.
  ok("without WebGL the preview falls back to the painted model", preview.mode === "painted")
}
ok("preview states what the model cannot see", preview.panel && preview.limits, JSON.stringify(preview))
ok("preview marks the axes the change can reach", preview.reaches)

await clickText("Add to scenario", true)
await new Promise(r => setTimeout(r, 320))
const fromCatalogue = await p.evaluate(() => document.querySelectorAll("li.animate-row-in").length)
ok("a project resolves into real actions", fromCatalogue >= 1, `${fromCatalogue} entries`)

/* --- and the hand-built path -------------------------------------------- */
console.log("\n[compose: several changes, not one]")

await clickText("Build your own", true)
await new Promise(r => setTimeout(r, 260))

/* One row: pick the lever, TYPE the target, set the amount, press Add.
   The lever is a labelled chip rather than a select option, so it is addressed
   by the words on it: an index into a menu silently means a different lever the
   next time one is added, and this way a rename breaks the test loudly. */
const addChange = async ({ kind = "more people", type = null, amount = null }) => {
  const picked = await p.evaluate((k) => {
    const chip = [...document.querySelectorAll("aside button")].find(
      b => b.textContent?.trim() === k,
    )
    chip?.click()
    return !!chip
  }, kind)
  if (!picked) fails.push(`no lever chip labelled "${kind}"`)
  await new Promise(r => setTimeout(r, 250))

  if (type !== null) {
    // The place is a combobox now, so this exercises the typing path: focus,
    // type, and take the first match with Enter.
    const box = await p.$('aside input[role="combobox"]')
    await box.click()
    await box.type(type, { delay: 12 })
    await new Promise(r => setTimeout(r, 220))
    await box.press("Enter")
    await new Promise(r => setTimeout(r, 200))
  }

  if (amount !== null) {
    await p.evaluate((amt) => {
      const rg = document.querySelector('aside input[type="range"]')
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(rg, String(amt))
      rg.dispatchEvent(new Event("input", { bubbles: true }))
    }, amount)
    await new Promise(r => setTimeout(r, 200))
  }

  await clickText("Add to scenario", true)
  await new Promise(r => setTimeout(r, 280))
}

/* One of each family: growth, capacity, the new destination lever, and two of
   the take-away levers that did not exist at all before. */
await addChange({ kind: "more people", type: "Benton", amount: 12000 })
await addChange({ kind: "road lanes", amount: 2 })
await addChange({ kind: "water and sewer capacity", amount: 4000 })
await addChange({ kind: "jobs", amount: 6000 })
await addChange({ kind: "a lower speed limit", amount: 30 })
await addChange({ kind: "a station closure" })

const rows = await p.evaluate(() => document.querySelectorAll("li.animate-row-in").length)
ok("scenario holds multiple changes", rows >= 6, `${rows} entries`)

/* The place card is the reason picking a zone stopped being picking a code.
   Assert on a figure that can only have come from the loaded area. */
const placeCard = await p.evaluate(() => {
  const t = document.querySelector("aside")?.innerText ?? ""
  return {
    region: /(OZARK PLATEAUS|ARKANSAS RIVER VALLEY|OUACHITA MOUNTAINS|MISSISSIPPI ALLUVIAL PLAIN|GULF COASTAL PLAIN)/.test(t),
    form: /(URBAN CORE|TOWN CENTRE|SUBURBAN|COUNTRY TOWN|OPEN COUNTRY)/.test(t),
    figures: /Residents/.test(t) && /Homes/.test(t) && /Density/.test(t),
  }
})
ok("the place is described before it is changed",
  placeCard.region && placeCard.form && placeCard.figures, JSON.stringify(placeCard))

const txtLab = await p.evaluate(() => document.body.innerText)
ok("utility capacity is one of them", txtLab.includes("dwellings served"))
ok("destinations are expressible", /\+[\d,]+ jobs/.test(txtLab))
ok("capacity can be taken away, not only added",
  /mph posted/.test(txtLab) && /station closed/i.test(txtLab),
  `speed=${/mph posted/.test(txtLab)} closure=${/station closed/i.test(txtLab)}`)

const editable = await p.evaluate(() => [...document.querySelectorAll("button")].filter(b => b.textContent?.trim() === "edit").length)
ok("entries are individually editable", editable >= 2, `${editable} edit controls`)

// remove one, confirm the list shrinks
await p.evaluate(() => [...document.querySelectorAll("button")].find(b => b.getAttribute("aria-label")?.startsWith("Remove"))?.click())
await new Promise(r => setTimeout(r, 250))
const afterRemove = await p.evaluate(() => document.querySelectorAll("li.animate-row-in").length)
ok("entries are individually removable", afterRemove === rows - 1, `${rows} → ${afterRemove}`)

console.log("\n[run → result page]")
await p.evaluate(() => [...document.querySelectorAll("button")].find(b => b.textContent?.includes("RUN SIMULATION"))?.click())
await p.waitForFunction(() => location.pathname === "/result", { timeout: 180000 })
ok("navigates to its own result page", true, location => true)
// The model on the result page renders in `fill` mode -- a bare canvas with no
// heading -- so wait on the canvas itself rather than on panel chrome.
await p.waitForFunction(
  () => [...document.querySelectorAll("canvas")].some((c) => c.width > 200),
  { timeout: 120000 },
)
await new Promise(r => setTimeout(r, 3800))

const txt = await p.evaluate(() => document.body.innerText)
ok("headline shows the score transition", /CIVIC\s+IMPACT/i.test(txt) && /\d+\s*→\s*\d+/.test(txt.replace(/\n/g, " ")))
ok("consequence chain present", txt.includes("CONSEQUENCE CHAIN"))
/* The chain has to name the decisions that were made, and name them before
   their consequences: a step reporting a posted limit after the step reporting
   the emergency access it changed would put the effect in front of the cause. */
const chainOrder = (a, b) => txt.indexOf(a) >= 0 && txt.indexOf(a) < txt.indexOf(b)
ok("chain reports the new levers",
  /SPEED LIMIT POSTED/i.test(txt) && /STATION.? CLOSED/i.test(txt) && /DESTINATIONS/i.test(txt))
ok("decisions are reported before their consequences",
  chainOrder("SPEED LIMIT POSTED", "EMERGENCY ACCESS"),
  "speed before emergency")
// The deck uses icon controls, so assert on its structure rather than on label
// text, and on the light panels that close the page.
const deck = await p.evaluate(() => ({
  app: !!document.querySelector('[role="application"][aria-label^="Run history"]'),
  prev: !!document.querySelector('[aria-label="Previous run"]'),
  next: !!document.querySelector('[aria-label="Next run"]'),
  play: !!document.querySelector('[aria-label="Cycle through runs"], [aria-label="Stop cycling runs"]'),
}))
ok("version deck with working controls", deck.app && deck.prev && deck.next && deck.play, JSON.stringify(deck))
// innerText reflects text-transform, and these labels are uppercased.
ok("meta strip present", /simulated in/i.test(txt) && /peak trips/i.test(txt))

// The reveal is a scrubbed sticky section, so the page must be tall enough to
// scrub through -- a one-viewport page would mean the timeline never runs.
const tall = await p.evaluate(() => document.body.scrollHeight / window.innerHeight)
ok("reveal has scroll length to scrub", tall > 3, `${tall.toFixed(1)}x viewport`)

/* And the card must actually change size across that scrub.
   Sampled against the scrub section's OWN height, not against the document's.
   The fraction-of-document version broke as soon as content was added below the
   scrub -- 0.45 of the page landed past the end of it, and the check reported a
   card that had already collapsed. */
const scaleAt = (f) => p.evaluate((frac) => {
  const sec = document.querySelector("[data-scrub-section]")
  const top = sec ? sec.offsetTop : 0
  const height = sec ? sec.offsetHeight - window.innerHeight : document.body.scrollHeight
  window.scrollTo(0, top + height * frac)
  return new Promise((res) => setTimeout(() => {
    const el = document.querySelector("[class*='ring-white']")
    res(el ? el.getBoundingClientRect().width : 0)
  }, 900))
}, f)
// The timeline holds the card near its laid-out size for the first fifth of the
// scrub, then drives it past the viewport.
const wA = await scaleAt(0.02)
const wB = await scaleAt(0.7)
ok("model expands across the scrub", wB > wA * 1.6, `${Math.round(wA)}px → ${Math.round(wB)}px`)
await p.evaluate(() => window.scrollTo(0, 0))
await new Promise(r => setTimeout(r, 600))

const modelLit = await p.evaluate(() => {
  const cs = [...document.querySelectorAll("canvas")]
  const c = cs[cs.length - 1]
  if (!c?.width) return 0
  const { data } = c.getContext("2d").getImageData(0, 0, c.width, c.height)
  let n = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 12) n++
  return n
})
ok("3D model rendered on the result page", modelLit > 3000, `${modelLit} lit pixels`)

const parallax = await p.evaluate(() => ({
  layers: document.querySelectorAll("[data-parallax-layer]").length,
  trigger: !!document.querySelector("[data-parallax-layers]"),
}))
ok("parallax layers wired", parallax.trigger && parallax.layers >= 3, JSON.stringify(parallax))

await b.close()
console.log("\n" + "=".repeat(50))
if (fails.length) { console.log("FAILED:"); fails.forEach(f => console.log("  - " + f)); process.exit(1) }
console.log("full flow verified")
