import puppeteer from "puppeteer"

const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] })
const p = await b.newPage()
await p.setCacheEnabled(false)
await p.setViewport({ width: 1600, height: 1000 })
await p.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" })
await p.waitForSelector("canvas")
await new Promise((r) => setTimeout(r, 2500))

// TaskDuration is cumulative main-thread task time; the delta over a fixed
// wall-clock window is how busy the page is doing nothing in particular.
async function busy(label, ms = 3000) {
  const a = await p.metrics()
  await new Promise((r) => setTimeout(r, ms))
  const c = await p.metrics()
  const task = ((c.TaskDuration - a.TaskDuration) * 1000).toFixed(0)
  const script = ((c.ScriptDuration - a.ScriptDuration) * 1000).toFixed(0)
  const pct = (((c.TaskDuration - a.TaskDuration) / (ms / 1000)) * 100).toFixed(1)
  console.log(`${label.padEnd(26)} main-thread ${task} ms / ${ms} ms  (${pct}% busy), script ${script} ms`)
}

await busy("hero on screen")

await p.evaluate(() => window.scrollTo(0, 0))
for (let i = 0; i < 120; i++) {
  await p.mouse.wheel({ deltaY: 260 })
  await new Promise((r) => setTimeout(r, 10))
}
await p.evaluate(() => window.scrollBy(0, 8000))
await new Promise((r) => setTimeout(r, 1500))
const y = await p.evaluate(() => Math.round(window.scrollY))
const heroVisible = await p.evaluate(() => {
  const c = document.querySelector("canvas")
  if (!c) return "no canvas"
  const r = c.getBoundingClientRect()
  return r.bottom > 0 && r.top < window.innerHeight
})
await busy(`scrolled y=${y}, hero visible=${heroVisible}`)

await b.close()
