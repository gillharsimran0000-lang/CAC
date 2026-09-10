import puppeteer from "puppeteer"
const OUT = "/private/tmp/claude-501/-Users-harsimrangill-Documents-CAC/26d856df-de9a-4799-b8a4-ba0f34abc47c/scratchpad"
const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] })
const p = await b.newPage()
await p.setCacheEnabled(false)
await p.setViewport({ width: 1600, height: 1000 })
p.on("pageerror", e => console.log("PAGEERROR:", e.message.slice(0, 160)))
await p.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" })
await p.waitForSelector("canvas")
// past the locked hero
for (let i = 0; i < 90; i++) { await p.mouse.wheel({ deltaY: 240 }); await new Promise(r => setTimeout(r, 18)) }
await new Promise(r => setTimeout(r, 1500))
await p.evaluate(() => window.scrollTo(0, document.querySelector("section")?.offsetTop ?? 0))
await new Promise(r => setTimeout(r, 1200))
await p.screenshot({ path: `${OUT}/g1-pinned.png` })
await p.evaluate(() => window.scrollBy(0, 1300))
await new Promise(r => setTimeout(r, 2200))
await p.screenshot({ path: `${OUT}/g2-tiles.png` })
await p.evaluate(() => window.scrollBy(0, 1400))
await new Promise(r => setTimeout(r, 2200))
await p.screenshot({ path: `${OUT}/g3-tiles2.png` })
const drawn = await p.evaluate(() => {
  const cs = [...document.querySelectorAll("figure canvas")]
  return cs.map(c => {
    const ctx = c.getContext("2d")
    if (!c.width) return 0
    const { data } = ctx.getImageData(0, 0, c.width, c.height)
    let lit = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] > 30 || data[i+1] > 30 || data[i+2] > 34) lit++
    return lit
  })
})
console.log("tile canvases lit pixels:", JSON.stringify(drawn))
await b.close()
