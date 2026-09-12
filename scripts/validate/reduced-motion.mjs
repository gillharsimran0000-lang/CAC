/**
 * Checks the reduced-motion path end to end.
 *
 * The CSS override in globals.css cannot switch off Lenis, because Lenis is not
 * a CSS transition -- it replaces the browser's scrolling with its own eased
 * one. So the check is whether Lenis is actually absent, not whether durations
 * are short.
 */
import puppeteer from "puppeteer"

const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] })
const fails = []

async function check(reduce) {
  const p = await b.newPage()
  await p.setCacheEnabled(false)
  await p.setViewport({ width: 1400, height: 900 })
  await p.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" },
  ])
  p.on("pageerror", (e) => fails.push(`page error (reduce=${reduce}): ${e.message.slice(0, 140)}`))
  // Honours BASE like every other check; this one had the port hardcoded.
  await p.goto(`${process.env.BASE ?? "http://localhost:3000"}/`, { waitUntil: "domcontentloaded" })
  await p.waitForSelector("canvas")
  await new Promise((r) => setTimeout(r, 2500))

  // Lenis marks the root element when it is running.
  const lenisOn = await p.evaluate(() =>
    document.documentElement.className.includes("lenis") ||
    Boolean(document.querySelector("[data-lenis-prevent], .lenis"))
  )
  // The page must still render its content either way.
  // Case-insensitive: the display headings are sentence case now, and
  // innerText also reflects any text-transform applied to them.
  const rendered = await p.evaluate(() => {
    const t = document.body.innerText
    return /seventy-five counties/i.test(t) && /not a\s+planning form/i.test(t)
  })
  // Under reduced motion the hero holds its finished frame instead of locking.
  const bodyFixed = await p.evaluate(() => getComputedStyle(document.body).position === "fixed")

  console.log(`  reduce=${String(reduce).padEnd(5)} lenis=${lenisOn}  content=${rendered}  scrollLocked=${bodyFixed}`)
  if (!rendered) fails.push(`content missing with reduce=${reduce}`)
  if (reduce && lenisOn) fails.push("Lenis still active under prefers-reduced-motion")
  if (!reduce && !lenisOn) fails.push("Lenis not active when motion is allowed")
  if (reduce && bodyFixed) fails.push("hero still scroll-locks under reduced motion")
  await p.close()
}

console.log("\n[reduced motion]")
await check(false)
await check(true)
await b.close()

console.log("\n" + "=".repeat(46))
if (fails.length) { console.log("FAILED:"); fails.forEach((f) => console.log("  - " + f)); process.exit(1) }
console.log("reduced-motion path verified")
