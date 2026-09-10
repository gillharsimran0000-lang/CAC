import { readFile } from "node:fs/promises"
import path from "node:path"
import { prepareArea } from "../../src/engine/simulate"

async function main() {
  const areaId = process.argv[2] ?? "arkansas"
  const base = path.join(process.cwd(), "data", "generated")
  const graph = JSON.parse(await readFile(`${base}/${areaId}-graph.json`, "utf8"))
  const zones = JSON.parse(await readFile(`${base}/${areaId}-zones.json`, "utf8"))
  const env = JSON.parse(await readFile(`${base}/${areaId}-envelope.json`, "utf8"))
  const p = prepareArea({ graph, zones } as never, env)
  const b = p.baseline

  const bins = [0, 0.5, 0.85, 1, 1.5, 2, 3, 4, 99]
  const counts = new Array(bins.length - 1).fill(0)
  let kmOver = 0, kmTot = 0
  for (let e = 0; e < p.g.edgeCount; e++) {
    if (p.g.virtual[e] || !p.g.routable[e]) continue
    const v = b.vc[e], km = p.g.lengthM[e] / 1000
    kmTot += km
    if (v >= 1) kmOver += km
    for (let i = 0; i < counts.length; i++) if (v >= bins[i] && v < bins[i + 1]) { counts[i]++; break }
  }
  console.log(`=== ${areaId} ===`)
  console.log("v/c over real routable edges:")
  for (let i = 0; i < counts.length; i++) console.log(`  ${bins[i]}-${bins[i+1]}: ${counts[i]}`)
  console.log(`km at or over capacity: ${kmOver.toFixed(0)}/${kmTot.toFixed(0)} (${(100*kmOver/kmTot).toFixed(1)}%)`)

  let vhFree = 0, vhCong = 0
  for (let e = 0; e < p.g.edgeCount; e++) {
    if (!p.g.routable[e]) continue
    vhFree += b.volume[e] * p.g.freeTimeS[e]
    vhCong += b.volume[e] * b.congested[e]
  }
  console.log(`mean trip free-flow: ${(vhFree/b.assignedTrips/60).toFixed(1)} min`)
  console.log(`mean trip congested: ${(vhCong/b.assignedTrips/60).toFixed(1)} min`)
  console.log(`assigned ${Math.round(b.assignedTrips).toLocaleString()} of ${Math.round(b.totalTrips).toLocaleString()} generated`)
  console.log(`intrazonal share: ${(100*(1-b.assignedTrips/b.totalTrips)).toFixed(1)}%`)
}
main()
