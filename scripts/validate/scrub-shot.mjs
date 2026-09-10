import puppeteer from "puppeteer"
const OUT = "/private/tmp/claude-501/-Users-harsimrangill-Documents-CAC/26d856df-de9a-4799-b8a4-ba0f34abc47c/scratchpad"
const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] })
const p = await b.newPage()
await p.setCacheEnabled(false); await p.setViewport({ width: 1600, height: 1000 })
p.on("pageerror", e => console.log("PAGEERROR:", e.message.slice(0,170)))
await p.goto("http://localhost:3000/lab", { waitUntil: "domcontentloaded" })
await p.waitForFunction(() => document.body.innerText.includes("Add to scenario"), { timeout: 180000 })
await p.evaluate(() => void 0)
await new Promise(r=>setTimeout(r,300))
await p.evaluate(() => { const rg=document.querySelector('input[type="range"]')
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set.call(rg,"28000")
  rg.dispatchEvent(new Event("input",{bubbles:true})) })
await p.evaluate(() => [...document.querySelectorAll("button")].find(b=>b.textContent?.trim()==="Add to scenario")?.click())
await new Promise(r=>setTimeout(r,300))
await p.evaluate(() => [...document.querySelectorAll("button")].find(b=>b.textContent?.includes("RUN SIMULATION"))?.click())
await p.waitForFunction(() => location.pathname === "/result", { timeout: 180000 })
await new Promise(r=>setTimeout(r,3500))
await p.screenshot({ path: `${OUT}/s1-start.png` })

const H = await p.evaluate(() => document.body.scrollHeight)
const shots = [0.10, 0.24, 0.42]
for (let i = 0; i < shots.length; i++) {
  await p.evaluate((f) => window.scrollTo(0, document.body.scrollHeight * f), shots[i])
  await new Promise(r => setTimeout(r, 1400))
  await p.screenshot({ path: `${OUT}/s${i+2}-scrub.png` })
}
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.78))
await new Promise(r => setTimeout(r, 1500))
await p.screenshot({ path: `${OUT}/s5-reading.png` })
console.log("scrollHeight", H, "· shots written")
await b.close()
