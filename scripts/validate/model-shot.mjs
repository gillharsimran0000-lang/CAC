import puppeteer from "puppeteer"
const OUT = "/private/tmp/claude-501/-Users-harsimrangill-Documents-CAC/26d856df-de9a-4799-b8a4-ba0f34abc47c/scratchpad"
const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] })
const p = await b.newPage()
await p.setCacheEnabled(false)
await p.setViewport({ width: 1600, height: 1000 })
p.on("pageerror", e => console.log("PAGEERROR:", e.message.slice(0,160)))
await p.goto("http://localhost:3000/lab", { waitUntil: "domcontentloaded" })
await p.waitForFunction(() => { const x=[...document.querySelectorAll("button")].find(b=>b.textContent?.includes("RUN SIMULATION")); return x&&!x.disabled }, { timeout: 180000 })
await p.evaluate(() => { const s=document.querySelector('input[type="range"]')
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set.call(s,"30000")
  s.dispatchEvent(new Event("input",{bubbles:true})) })
await p.evaluate(() => [...document.querySelectorAll("button")].find(b=>b.textContent?.trim()==="add to scenario")?.click())
await p.evaluate(() => [...document.querySelectorAll("button")].find(b=>b.textContent?.includes("RUN SIMULATION"))?.click())
await p.waitForFunction(() => document.body.innerText.includes("CONGESTION, EXTRUDED"), { timeout: 180000 })
await new Promise(r => setTimeout(r, 3200))

// scroll the results column so the model is in frame
await p.evaluate(() => {
  const el = [...document.querySelectorAll("h3")].find(h => h.textContent?.includes("CONGESTION"))
  el?.scrollIntoView({ block: "center" })
})
await new Promise(r => setTimeout(r, 1600))
await p.screenshot({ path: `${OUT}/m1-model.png` })

const lit = await p.evaluate(() => {
  const cs = [...document.querySelectorAll("canvas")]
  const c = cs[cs.length - 1]
  const ctx = c.getContext("2d")
  if (!c.width) return { w: 0 }
  const { data } = ctx.getImageData(0, 0, c.width, c.height)
  let n = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 12) n++
  return { w: c.width, h: c.height, lit: n }
})
console.log("model canvas:", JSON.stringify(lit))
await b.close()
