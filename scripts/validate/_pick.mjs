import puppeteer from "puppeteer"
const OUT = process.env.OUT
const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] })
const p = await b.newPage()
p.on("pageerror", e => console.log("PAGE ERR:", e.message.slice(0,300)))
p.on("console", m => { const t=m.text(); if (t.includes("PICKDBG")) console.log(t) })
await p.setViewport({ width: 1680, height: 1000, deviceScaleFactor: 2 })
await p.goto("http://localhost:3311/lab", { waitUntil: "domcontentloaded" })
await p.waitForFunction(() => [...document.querySelectorAll("button")].some(b => / County$/.test(b.textContent?.trim() ?? "")), { timeout: 180000 })
await p.evaluate(() => [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "Build your own")?.click())
await new Promise(r=>setTimeout(r,400))
await p.evaluate(() => [...document.querySelectorAll("aside button")].find(b=>b.textContent?.trim()==="more people")?.click())
await new Promise(r=>setTimeout(r,300))
await p.evaluate(() => { const rg = document.querySelector('aside input[type="range"]')
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set.call(rg,"45000")
  rg.dispatchEvent(new Event("input",{bubbles:true})) })
await new Promise(r=>setTimeout(r,300))
await p.evaluate(() => [...document.querySelectorAll("button")].find(b=>b.textContent?.trim()==="Add to scenario")?.click())
await new Promise(r=>setTimeout(r,300))
await p.evaluate(() => [...document.querySelectorAll("button")].find(x => x.textContent?.includes("RUN SIMULATION"))?.click())
await p.waitForFunction(() => location.pathname === "/result", { timeout: 180000 })
await p.waitForFunction(() => [...document.querySelectorAll("canvas")].some(c => c.width > 200), { timeout: 120000 })
// scrub so the model is large
await p.evaluate(() => { const sec = document.querySelector("[data-scrub-section]")
  const top = sec ? sec.offsetTop : 0
  const h = sec ? sec.offsetHeight - window.innerHeight : 0
  window.scrollTo(0, top + h * 0.62) })
await new Promise(r=>setTimeout(r,3500))
await p.screenshot({ path: `${OUT}/key.png` })
console.log("key text:", await p.evaluate(() => document.querySelector('canvas[aria-hidden]')?.parentElement?.innerText?.replace(/\n+/g," | ").slice(0,220)))

// click the brightest red pixel region: sample the canvas for the tallest wall
const spots = await p.evaluate(() => {
  const c = [...document.querySelectorAll("canvas")].sort((a,b)=>b.width-a.width)[0]
  const r = c.getBoundingClientRect()
  const { data } = c.getContext("2d").getImageData(0,0,c.width,c.height)
  const found = []
  for (let y=0;y<c.height;y+=3) for (let x=0;x<c.width;x+=3) {
    const i=(y*c.width+x)*4
    if (data[i]>190 && data[i+1]<100 && data[i+2]<100) {
      found.push({ x: r.left + (x/c.width)*r.width, y: r.top + (y/c.height)*r.height })
    }
  }
  // spread them out so we try genuinely different walls
  const out = []
  for (const f of found) {
    if (out.every(o => Math.hypot(o.x-f.x, o.y-f.y) > 40)) out.push(f)
    if (out.length >= 14) break
  }
  return out
})
console.log("candidate wall tops:", spots.length)
let picked = false
for (const s of spots) {
  await p.mouse.click(s.x, s.y)
  await new Promise(r=>setTimeout(r,900))
  const has = await p.evaluate(() => /show all/i.test(document.querySelector('canvas[aria-hidden]')?.parentElement?.innerText ?? ""))
  if (has) { picked = true; console.log("picked at", Math.round(s.x), Math.round(s.y)); break }
}
if (!picked) console.log("NOTHING PICKED after", spots.length, "tries")
await new Promise(r=>setTimeout(r,1800))
console.log("after pick:", await p.evaluate(() => document.querySelector('canvas[aria-hidden]')?.parentElement?.innerText?.replace(/\n+/g," | ").slice(0,320)))
await b.close()
