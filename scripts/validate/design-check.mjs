/**
 * Verifies the redesign items that a build cannot prove: that focus is visible,
 * that presses give feedback, that the skip link works, that the 404 and social
 * card exist, and that skeletons appear instead of bare text.
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
await p.setViewport({ width: 1500, height: 950 })
p.on("pageerror", (e) => fails.push(`page error: ${e.message.slice(0, 140)}`))

console.log("\n[identity + completeness]")
for (const [path, label] of [["/icon.svg", "branded icon"], ["/opengraph-image", "social card"]]) {
  const r = await p.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" })
  ok(label, r.status() === 200, `${path} → ${r.status()} ${r.headers()["content-type"] ?? ""}`)
}
const nf = await p.goto(`${BASE}/does-not-exist`, { waitUntil: "domcontentloaded" })
const nfText = await p.evaluate(() => document.body.innerText)
/* Case-insensitive: innerText reflects text-transform, and this headline is set
   in the display face at its natural case rather than uppercased in CSS. The
   check was asserting on a styling decision, not on the thing it cares about --
   that a dead end lands on the custom page rather than the framework default. */
ok(
  "custom 404",
  nf.status() === 404 && /off the network/i.test(nfText),
  `status ${nf.status()}`,
)

console.log("\n[accessibility]")
await p.goto(BASE, { waitUntil: "domcontentloaded" })
await p.waitForSelector("canvas")
await new Promise((r) => setTimeout(r, 1200))
await p.keyboard.press("Tab")
const skip = await p.evaluate(() => {
  const el = document.activeElement
  const r = el?.getBoundingClientRect()
  return { text: el?.textContent?.trim(), visible: !!r && r.width > 0 && r.height > 0, href: el?.getAttribute("href") }
})
ok("skip link is first tab stop and visible", skip.text === "Skip to content" && skip.visible && skip.href === "#main",
  JSON.stringify(skip))
ok("skip target exists", await p.evaluate(() => !!document.getElementById("main")))

await p.goto(`${BASE}/lab`, { waitUntil: "domcontentloaded" })
/* RUN is disabled until the scenario holds a change, so wait on the composer.
   The composer opens on the Arkansas project catalogue, where "Add to scenario"
   appears only once something is picked, so switch to the hand-built tab first
   and check the focus ring on the control that is always there. */
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
const focusRing = await p.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "Add to scenario")
  btn.focus()
  const cs = getComputedStyle(btn)
  return { width: cs.outlineWidth, style: cs.outlineStyle, color: cs.outlineColor }
})
ok("lab controls show a focus ring",
  focusRing.style !== "none" && parseFloat(focusRing.width) >= 2,
  `${focusRing.width} ${focusRing.style}`)

const press = await p.evaluate(() => getComputedStyle(document.querySelector("button")).transitionProperty)
ok("buttons have press transition", press.includes("transform"), press)

console.log("\n[surface]")
const grain = await p.evaluate(() => {
  const el = document.querySelector(".civic-grain")
  if (!el) return null
  const cs = getComputedStyle(el)
  return { pos: cs.position, pe: cs.pointerEvents, op: cs.opacity, bg: cs.backgroundImage.slice(0, 24) }
})
ok("grain overlay present and inert", grain?.pos === "fixed" && grain?.pe === "none" && Number(grain.op) > 0,
  grain ? `opacity ${grain.op}, ${grain.pe}` : "missing")

const accent = await p.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim())
ok("accent desaturated", accent === "#7aa5e6", accent)

console.log("\n[loading state]")
const p2 = await b.newPage()
await p2.setCacheEnabled(false)
await p2.setViewport({ width: 1500, height: 950 })
await p2.goto(`${BASE}/lab`, { waitUntil: "domcontentloaded" })
const skel = await p2.evaluate(() => document.querySelectorAll(".skeleton").length)
ok("skeletons render while the area prepares", skel > 0, `${skel} skeleton blocks`)
await p2.close()

await b.close()
console.log("\n" + "=".repeat(50))
if (fails.length) { console.log("FAILED:"); fails.forEach(f => console.log("  - " + f)); process.exit(1) }
console.log("redesign items verified")
