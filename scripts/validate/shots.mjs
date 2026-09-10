import puppeteer from "puppeteer"
const OUT = process.env.OUT ?? "/private/tmp/claude-501/-Users-harsimrangill-Documents-CAC/26d856df-de9a-4799-b8a4-ba0f34abc47c/scratchpad"
const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] })
const p = await b.newPage()
await p.setCacheEnabled(false)
await p.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 })

await p.goto("http://localhost:3311/", { waitUntil: "domcontentloaded" })
await p.waitForSelector("canvas")
await new Promise(r => setTimeout(r, 2500))
await p.screenshot({ path: `${OUT}/1-hero-rest.png` })

for (let i = 0; i < 30; i++) { await p.mouse.wheel({ deltaY: 200 }); await new Promise(r => setTimeout(r, 30)) }
await new Promise(r => setTimeout(r, 1200))
await p.screenshot({ path: `${OUT}/2-hero-scrubbed.png` })

for (let i = 0; i < 45; i++) { await p.mouse.wheel({ deltaY: 200 }); await new Promise(r => setTimeout(r, 30)) }
await new Promise(r => setTimeout(r, 1200))
await p.screenshot({ path: `${OUT}/3-hero-end.png` })

await p.evaluate(() => window.scrollTo(0, 1400))
await new Promise(r => setTimeout(r, 900))
await p.screenshot({ path: `${OUT}/4-method.png` })

await p.goto("http://localhost:3311/lab", { waitUntil: "domcontentloaded" })
await p.waitForFunction(() => { const x = [...document.querySelectorAll("button")].find(b => b.textContent?.includes("RUN SIMULATION")); return x && !x.disabled }, { timeout: 120000 })
await new Promise(r => setTimeout(r, 800))
await p.screenshot({ path: `${OUT}/5-lab-baseline.png` })

await p.evaluate(() => [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "add to scenario")?.click())
await p.evaluate(() => [...document.querySelectorAll("button")].find(b => b.textContent?.includes("RUN SIMULATION"))?.click())
await p.waitForFunction(() => document.body.innerText.includes("CONSEQUENCE CHAIN"), { timeout: 120000 })
await new Promise(r => setTimeout(r, 5000))
await p.screenshot({ path: `${OUT}/6-lab-result.png` })
console.log("shots written")
await b.close()
