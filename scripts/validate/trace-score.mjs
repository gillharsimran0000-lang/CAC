import puppeteer from "puppeteer"
const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] })
const p = await b.newPage()
await p.setCacheEnabled(false)
await p.setViewport({ width: 1500, height: 950 })
await p.goto("http://localhost:3000/lab", { waitUntil: "domcontentloaded" })
await p.waitForFunction(() => { const x=[...document.querySelectorAll("button")].find(b=>b.textContent?.includes("RUN SIMULATION")); return x&&!x.disabled }, { timeout: 180000 })

const run = async (n) => {
  await p.evaluate((r) => {
    const s = document.querySelector('input[type="range"]')
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(s, String(r))
    s.dispatchEvent(new Event("input", { bubbles: true }))
  }, n)
  await p.evaluate(() => [...document.querySelectorAll("button")].find(b=>b.textContent?.trim()==="add to scenario")?.click())
  await p.evaluate(() => [...document.querySelectorAll("button")].find(b=>b.textContent?.includes("RUN SIMULATION"))?.click())
}

await run(6000)
await p.waitForFunction(() => document.body.innerText.includes("CONSEQUENCE CHAIN"), { timeout: 180000 })
await new Promise(r => setTimeout(r, 4500))

// Sample the rendered score every 40ms straight through the second run.
await p.evaluate(() => {
  window.__trace = []
  const read = () => {
    const el = [...document.querySelectorAll("span")].find(s => /^\d+$/.test(s.textContent?.trim() ?? "") && s.className.includes("text-2xl"))
    if (el) window.__trace.push(el.textContent.trim())
  }
  window.__iv = setInterval(read, 40)
})
await run(45000)
await new Promise(r => setTimeout(r, 5000))
const trace = await p.evaluate(() => { clearInterval(window.__iv); return window.__trace })
// collapse runs of equal values
const seq = trace.filter((v, i) => v !== trace[i - 1])
console.log("score sequence:", seq.join(" → "))
await b.close()
