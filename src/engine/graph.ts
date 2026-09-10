/**
 * Road graph in a form that is fast to route over.
 *
 * The JSON on disk is column-oriented for size; this turns it into a
 * compressed-sparse-row adjacency, which is what makes repeated Dijkstra runs
 * cheap: every neighbour of a node lives in one contiguous slice, so a search
 * walks memory in order instead of chasing object pointers. On the statewide
 * graph one full shortest-path tree over 17,850 nodes runs in about 9 ms, and a
 * scenario needs a few hundred of them.
 *
 * Two-way roads become two directed arcs sharing an edge id, so per-edge volume
 * accumulates across both directions the way capacity is defined.
 */

export interface RawGraph {
    areaId: string
    label: string
    kind: "state" | "metro"
    bbox: [number, number, number, number]
    counts: {
        nodes: number
        edges: number
        routableEdges: number
        corridors: number
        reportableCorridors: number
    }
    provenance: Record<string, unknown>
    nodes: { lon: number[]; lat: number[] }
    edges: {
        from: number[]
        to: number[]
        lengthM: number[]
        lanes: number[]
        capacityVph: number[]
        speedMph: number[]
        freeTimeS: number[]
        oneway: number[]
        cls: string[]
        corridor: number[]
        lanesVerified: number[]
        speedVerified: number[]
        geomOffset: number[]
        geomCount: number[]
        routable: number[]
    }
    geometry: { lon: number[]; lat: number[] }
    corridors: {
        id: number
        label: string
        kind: "route" | "street"
        cls: string
        edgeCount: number
        lengthM: number
        reportable: boolean
    }[]
}

export interface Graph {
    raw: RawGraph
    nodeCount: number
    edgeCount: number
    /** CSR: arcs of node n are [arcStart[n], arcStart[n+1]). */
    arcStart: Int32Array
    arcTo: Int32Array
    arcEdge: Int32Array
    lengthM: Float32Array
    capacityVph: Float32Array
    freeTimeS: Float32Array
    corridorOf: Int32Array
    /** 1 where the assignment may route; 0 for display-only local streets. */
    routable: Uint8Array
    /** 1 for artificial centroid connectors, which are not real road. */
    virtual: Uint8Array
    /** Graph node that carries each zone's demand: its virtual centroid. */
    zoneNode: Int32Array
    /** Count of real edges; virtual connectors occupy indices at or above it. */
    realEdgeCount: number
    nodeLon: Float32Array
    nodeLat: Float32Array
}

/**
 * Time to reach the routable network from a zone centroid, seconds.
 *
 * This is not padding. The assignment deliberately excludes residential streets,
 * so every real trip begins and ends with a stretch the model does not route
 * over; the connector is where that stretch is accounted for. One minute at each
 * end is a modest allowance for it.
 */
export const CONNECTOR_TIME_S = 60

export interface ZoneConnector {
    node: number
    weight: number
}

/**
 * Builds the routing graph, optionally with a virtual centroid per zone.
 *
 * A centroid is an artificial node joined to several real ones, so a zone's
 * demand enters the network at each of its population centres rather than at a
 * single point. Which connector a given trip uses falls out of the shortest
 * path -- trips leaving Pulaski County northbound take a northern connector,
 * southbound trips a southern one -- which is what spreads the load. Connectors
 * are given effectively unlimited capacity and flagged `virtual`, so they never
 * appear as congestion and never count as road in any metric.
 */
export function buildGraph(raw: RawGraph, connectors: ZoneConnector[][] = []): Graph {
    const realNodes = raw.counts.nodes
    const realEdges = raw.counts.edges
    const zoneCount = connectors.length
    const connectorCount = connectors.reduce((s, c) => s + c.length, 0)

    const n = realNodes + zoneCount
    const m = realEdges + connectorCount
    const { from, to, oneway } = raw.edges

    /* Only routable edges enter the adjacency. Local streets stay in the raw
       arrays so the map can draw them, but the search never walks them: it
       roughly halves the node degree and it is the modelling choice a regional
       travel model would make anyway. */
    /* Edge attributes, real then virtual. Building the extended arrays up front
       means the search loop never has to ask which kind of edge it is on. */
    const eFrom = new Int32Array(m)
    const eTo = new Int32Array(m)
    const eOneway = new Uint8Array(m)
    const routable = new Uint8Array(m)
    const virtual = new Uint8Array(m)
    const lengthM = new Float32Array(m)
    const capacityVph = new Float32Array(m)
    const freeTimeS = new Float32Array(m)
    const corridorOf = new Int32Array(m)

    for (let e = 0; e < realEdges; e++) {
        eFrom[e] = from[e]
        eTo[e] = to[e]
        eOneway[e] = oneway[e] ? 1 : 0
        routable[e] = raw.edges.routable[e]
        lengthM[e] = raw.edges.lengthM[e]
        capacityVph[e] = raw.edges.capacityVph[e]
        freeTimeS[e] = raw.edges.freeTimeS[e]
        corridorOf[e] = raw.edges.corridor[e]
    }

    const zoneNode = new Int32Array(Math.max(zoneCount, 0))
    let ve = realEdges
    for (let z = 0; z < zoneCount; z++) {
        const centroid = realNodes + z
        zoneNode[z] = centroid
        for (const c of connectors[z]) {
            eFrom[ve] = centroid
            eTo[ve] = c.node
            eOneway[ve] = 0
            routable[ve] = 1
            virtual[ve] = 1
            lengthM[ve] = 0
            // Effectively uncapacitated: a connector must never be the thing
            // that congests, or the model would be reporting its own scaffolding.
            capacityVph[ve] = 1e9
            freeTimeS[ve] = CONNECTOR_TIME_S
            corridorOf[ve] = -1
            ve++
        }
    }

    let arcCount = 0
    for (let e = 0; e < m; e++) {
        if (!routable[e]) continue
        arcCount += eOneway[e] ? 1 : 2
    }

    const degree = new Int32Array(n + 1)
    for (let e = 0; e < m; e++) {
        if (!routable[e]) continue
        degree[eFrom[e]]++
        if (!eOneway[e]) degree[eTo[e]]++
    }

    const arcStart = new Int32Array(n + 1)
    for (let i = 0; i < n; i++) arcStart[i + 1] = arcStart[i] + degree[i]

    const cursor = arcStart.slice(0, n)
    const arcTo = new Int32Array(arcCount)
    const arcEdge = new Int32Array(arcCount)
    for (let e = 0; e < m; e++) {
        if (!routable[e]) continue
        const a = cursor[eFrom[e]]++
        arcTo[a] = eTo[e]
        arcEdge[a] = e
        if (!eOneway[e]) {
            const b = cursor[eTo[e]]++
            arcTo[b] = eFrom[e]
            arcEdge[b] = e
        }
    }

    return {
        raw,
        nodeCount: n,
        edgeCount: m,
        arcStart,
        arcTo,
        arcEdge,
        lengthM,
        capacityVph,
        freeTimeS,
        corridorOf,
        routable,
        virtual,
        zoneNode,
        realEdgeCount: realEdges,
        // Centroids are given the coordinates of their heaviest connector so
        // anything that draws by node id still lands somewhere sensible.
        nodeLon: extendCoords(raw.nodes.lon, connectors, raw.nodes.lon),
        nodeLat: extendCoords(raw.nodes.lat, connectors, raw.nodes.lat),
    }
}

/**
 * Binary heap over node ids keyed by tentative cost.
 *
 * Reused across runs: allocating a fresh heap per origin dominated the profile
 * once there were a few hundred origins. `clear` resets the size only, since
 * everything below `size` is overwritten before it is read.
 */
class NodeHeap {
    private readonly nodes: Int32Array
    private readonly keys: Float64Array
    private size = 0

    constructor(capacity: number) {
        this.nodes = new Int32Array(capacity)
        this.keys = new Float64Array(capacity)
    }

    clear() {
        this.size = 0
    }

    get empty() {
        return this.size === 0
    }

    push(node: number, key: number) {
        let i = this.size++
        this.nodes[i] = node
        this.keys[i] = key
        while (i > 0) {
            const parent = (i - 1) >> 1
            if (this.keys[parent] <= this.keys[i]) break
            this.swap(i, parent)
            i = parent
        }
    }

    /** Returns the node id; its key is read separately via `topKey` before pop. */
    pop(): number {
        const top = this.nodes[0]
        const last = --this.size
        if (last > 0) {
            this.nodes[0] = this.nodes[last]
            this.keys[0] = this.keys[last]
            let i = 0
            for (;;) {
                const l = 2 * i + 1
                const r = l + 1
                let small = i
                if (l < this.size && this.keys[l] < this.keys[small]) small = l
                if (r < this.size && this.keys[r] < this.keys[small]) small = r
                if (small === i) break
                this.swap(i, small)
                i = small
            }
        }
        return top
    }

    private swap(a: number, b: number) {
        const tn = this.nodes[a]
        this.nodes[a] = this.nodes[b]
        this.nodes[b] = tn
        const tk = this.keys[a]
        this.keys[a] = this.keys[b]
        this.keys[b] = tk
    }
}

/**
 * Scratch buffers for shortest-path runs.
 *
 * Dijkstra here is lazy-deletion rather than decrease-key: a node can be pushed
 * more than once and stale pops are skipped by comparing against `dist`. On
 * road networks, where degree averages under three, that is faster than
 * maintaining heap positions.
 */
export interface PathScratch {
    dist: Float64Array
    /** Edge used to reach each node, -1 at the source and at unreached nodes. */
    parentEdge: Int32Array
    parentNode: Int32Array
    /** Nodes in the order they were settled, so path loading can sweep backwards. */
    order: Int32Array
    /** Set once a node's distance is final; the lazy-deletion guard. */
    done: Uint8Array
    settled: number
    heap: NodeHeap
}

export function makeScratch(g: Graph): PathScratch {
    return {
        dist: new Float64Array(g.nodeCount),
        parentEdge: new Int32Array(g.nodeCount),
        parentNode: new Int32Array(g.nodeCount),
        order: new Int32Array(g.nodeCount),
        done: new Uint8Array(g.nodeCount),
        settled: 0,
        heap: new NodeHeap(g.nodeCount * 4),
    }
}

/**
 * Shortest-path tree from `src` under the given per-edge cost.
 *
 * `cost` is indexed by edge id, so congested travel times can be swapped in
 * between assignment slices without touching the topology.
 */
export function shortestPathTree(g: Graph, src: number, cost: Float64Array, s: PathScratch) {
    const { dist, parentEdge, parentNode, order, done, heap } = s
    dist.fill(Infinity)
    parentEdge.fill(-1)
    parentNode.fill(-1)
    done.fill(0)
    heap.clear()

    dist[src] = 0
    heap.push(src, 0)
    let settled = 0

    while (!heap.empty) {
        const u = heap.pop()
        // Lazy deletion: a node can be pushed several times, and every entry
        // after the first to surface is stale by definition.
        if (done[u]) continue
        done[u] = 1
        const du = dist[u]
        order[settled++] = u

        const end = g.arcStart[u + 1]
        for (let a = g.arcStart[u]; a < end; a++) {
            const e = g.arcEdge[a]
            const v = g.arcTo[a]
            const nd = du + cost[e]
            if (nd < dist[v]) {
                dist[v] = nd
                parentEdge[v] = e
                parentNode[v] = u
                heap.push(v, nd)
            }
        }
    }
    s.settled = settled
    return s
}

function extendCoords(base: number[], connectors: ZoneConnector[][], src: number[]): Float32Array {
    const out = new Float32Array(base.length + connectors.length)
    out.set(base, 0)
    for (let z = 0; z < connectors.length; z++) {
        const heaviest = connectors[z].reduce(
            (best, c) => (c.weight > best.weight ? c : best),
            connectors[z][0] ?? { node: 0, weight: 0 },
        )
        out[base.length + z] = src[heaviest.node] ?? 0
    }
    return out
}
