/**
 * THE SAME SCENES, AS REAL GEOMETRY.
 *
 * Everything in src/data/projects.ts and src/data/placeScenes.ts describes its
 * subject as footprints and polylines in metres. The 2D renderer in
 * src/render/solids.ts turns those into a painted picture; this turns the
 * identical description into three.js meshes. Nothing about the twenty projects
 * or the ten levers had to change to get here, which is the payoff for having
 * kept the scenes as data rather than as drawing code.
 *
 * Three things are genuinely better for having a real renderer, and they are
 * the three the painted version kept losing:
 *
 * DEPTH. A painter's algorithm sorts whole objects by one number, so a bridge
 * deck either passes in front of every pier or behind every one of them. A
 * depth buffer sorts fragments, so a deck passes in front of the near piers and
 * behind the far ones without anybody writing a comparator.
 *
 * SURFACE. Translucent quads stacked into a wash of colour. Lit surfaces with
 * flat shading give every face its own value, so a box reads as a box from any
 * angle rather than only from the one the strokes were tuned for.
 *
 * SEQUENCE. A blueprint is not a picture, it is an argument in an order: this
 * is the site, this is what is proposed on it, this is it built, this is what
 * it then does. Holding two representations of every solid -- its edges and its
 * surfaces -- lets that argument be a transition rather than four drawings.
 *
 * AXES. The scenes use x east, y north, z up, in metres. three.js uses y up, so
 * this maps (x, y, z) to (x, z * zScale, -y): north becomes -Z, which is the
 * convention every other three.js scene in the world uses and therefore the one
 * to match.
 */

import * as THREE from "three"
import type { Mechanism, Point, Scene, Solid, Strand } from "@/render/solids"
import { strip } from "@/render/solids"

/** Drafting cyan. Not the accent: a blueprint should look like a blueprint. */
export const DRAFT = "#6fb3d9"

export interface BuiltScene {
    root: THREE.Group
    /** Metres from the centre to the furthest thing drawn. */
    radius: number
    /**
     * The proposal's own geometry, subsampled, in three.js coordinates.
     *
     * What the camera frames, and not the same thing as the whole scene. A
     * scene is mostly site: a kilometre of Ozark ridges around three hundred
     * metres of new housing, and framing all of it is technically a fit and
     * practically a picture of an empty hillside.
     *
     * Points rather than a radius or a box, because the proposals are not one
     * shape. A housing development is round and a widened corridor is sixteen
     * hundred metres long and fifty wide; a radius frames the road as though it
     * were a disc and wastes four fifths of the panel, and a box frames the
     * housing by its corners and wastes the same. Projecting the actual points
     * fits whatever the thing turns out to be.
     */
    changePoints: THREE.Vector3[]
    /** Highest point, so the camera can clear it. */
    top: number
    /** Applies phase 0..1 across site, blueprint, built and mechanism. */
    update: (phase: number, elapsed: number) => void
    /** Meshes the pointer can pick, tagged with what they are. */
    pickable: THREE.Object3D[]
    dispose: () => void
}

/* --- geometry ----------------------------------------------------------- */

/** A footprint polygon as a three.js Shape, in the XY plane. */
function shapeOf(base: Point[]): THREE.Shape {
    const s = new THREE.Shape()
    s.moveTo(base[0][0], base[0][1])
    for (const [x, y] of base.slice(1)) s.lineTo(x, y)
    s.closePath()
    return s
}

/**
 * An extruded footprint, standing on the ground plane.
 *
 * ExtrudeGeometry pushes along +Z, so the result is rotated a quarter turn to
 * stand up, and translated so its BASE sits at the origin rather than its
 * centre. That second part matters more than it sounds: the build animation
 * scales these on Y, and a mesh centred on its middle grows downward through
 * the ground as fast as it grows upward.
 */
function solidGeometry(s: Solid, zScale: number): THREE.BufferGeometry {
    const height = Math.max(s.height * zScale, 0)
    const geo =
        height > 0
            ? new THREE.ExtrudeGeometry(shapeOf(s.base), { depth: height, bevelEnabled: false })
            : new THREE.ShapeGeometry(shapeOf(s.base))
    geo.rotateX(-Math.PI / 2)
    return geo
}

/** A ribbon, as a flat strip lying at its own height. */
function ribbonGeometry(st: Strand, zScale: number): THREE.BufferGeometry {
    const flat: Point[] = st.points.map(([x, y]) => [x, y])
    const geo = new THREE.ShapeGeometry(shapeOf(strip(flat, st.ribbon!)))
    geo.rotateX(-Math.PI / 2)
    // A ribbon's height varies along its length (a bridge deck rises), so the
    // strip's vertices are lifted individually rather than the whole mesh.
    const pos = geo.attributes.position as THREE.BufferAttribute
    const n = flat.length
    for (let i = 0; i < pos.count; i++) {
        const src = i < n ? i : Math.max(0, n * 2 - 1 - i)
        pos.setY(i, (st.points[Math.min(src, n - 1)]?.[2] ?? 0) * zScale + 0.35)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    return geo
}

/** A polyline, as line segments in world space. */
function strandGeometry(st: Strand, zScale: number): THREE.BufferGeometry {
    const pts = st.points.map(([x, y, z]) => new THREE.Vector3(x, z * zScale, -y))
    return new THREE.BufferGeometry().setFromPoints(pts)
}

/* --- materials ---------------------------------------------------------- */

/**
 * Two states per solid, and both exist the whole time.
 *
 * Cross-fading between a line version and a surface version is the entire
 * blueprint idea, and doing it by swapping objects means a frame where neither
 * is right. Both are built once and their opacities are driven against each
 * other, which also means the built state can keep a hairline of the drawing
 * over it -- which is what an architectural render actually looks like.
 */
interface Piece {
    /** The lit surface. */
    mesh: THREE.Mesh
    /** Its edges, used as the blueprint and then as an outline. */
    edges: THREE.LineSegments
    layer: "site" | "change"
    /** Order within the build, 0..1, straight from the scene. */
    t: number
    baseHeight: number
    /**
     * How much of the picture this piece is, 0..1, from the scene's own opacity.
     *
     * The scenes already say what is context: every catalogue project draws its
     * terrain, fields and grids with a low `opacity`, and the painted renderer
     * honoured it. The first version of this one ignored the field, so the
     * Bella Vista Bypass came out as a stack of solid brown ridges with the
     * road it exists to show buried underneath them.
     */
    weight: number
}

/** Floor-to-floor, metres. An ordinary residential storey. */
const FLOOR = 3.2

/**
 * The face opacity a Solid has when it does not specify one, in the painted
 * renderer. A solid's own opacity is read relative to this.
 */
const DEFAULT_FACE = 0.16

/**
 * A scene opacity as a weight.
 *
 * Squared, because a lit surface reads as far more solid than a flat fill at
 * the same alpha: the ridges at 0.05 translated linearly came out at about a
 * third strength and still dominated the frame. Squaring puts them near a
 * tenth, which is where the painted version sat.
 */
const weightOf = (opacity: number | undefined, reference: number) =>
    opacity == null ? 1 : Math.pow(clamp01(opacity / reference), 2)

/** Below this weight a piece is context: drawn faint, never framed. */
const CONTEXT = 0.5

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

/* --- the build ---------------------------------------------------------- */

export function buildScene(scene: Scene): BuiltScene {
    const zScale = scene.zScale ?? 1
    const root = new THREE.Group()
    const pieces: Piece[] = []
    const disposables: { dispose(): void }[] = []
    const pickable: THREE.Object3D[] = []

    const keep = <T extends { dispose(): void }>(x: T) => {
        disposables.push(x)
        return x
    }

    let radius = scene.extent
    let top = 1
    const changePoints: THREE.Vector3[] = []
    const floorLines: { line: THREE.LineSegments; t: number }[] = []

    /* --- the drafting grid ---
    
       A blueprint is a drawing on ruled paper, and the ruling is not decoration:
       it is what gives a reader a sense of the size of what they are looking at
       before any dimension is quoted. A hundred metres a cell, so the spacing
       means something -- roughly a city block, or a quarter of a Delta
       quarter-quarter section. It leads the sequence and gets out of the way
       once the thing is built. */
    const cell = 100
    const span = Math.ceil((scene.extent * 2.2) / cell) * cell
    const grid = new THREE.GridHelper(span, span / cell, 0x6fb3d9, 0x6fb3d9)
    const gridMat = grid.material as THREE.LineBasicMaterial
    gridMat.transparent = true
    gridMat.opacity = 0
    gridMat.depthWrite = false
    grid.position.y = -0.2
    keep(grid.geometry)
    keep(gridMat)
    root.add(grid)

    /* --- the ground, so nothing floats in a void --- */
    if (scene.ground) {
        const g = keep(new THREE.CircleGeometry(scene.extent * 1.12, 64))
        g.rotateX(-Math.PI / 2)
        const m = keep(
            new THREE.MeshStandardMaterial({
                color: new THREE.Color(scene.ground),
                roughness: 1,
                metalness: 0,
                transparent: true,
                opacity: 0.9,
            }),
        )
        const disc = new THREE.Mesh(g, m)
        disc.position.y = -0.4
        disc.renderOrder = -2
        root.add(disc)
    }

    /* --- solids --- */
    for (const s of scene.solids) {
        const geo = keep(solidGeometry(s, zScale))
        const lift = (s.lift ?? 0) * zScale
        const color = new THREE.Color(s.color)
        const isChange = (s.layer ?? "change") === "change"
        const weight = weightOf(s.opacity, DEFAULT_FACE)

        const mesh = new THREE.Mesh(
            geo,
            keep(
                new THREE.MeshStandardMaterial({
                    color,
                    roughness: 0.82,
                    metalness: 0.02,
                    flatShading: true,
                    transparent: true,
                    opacity: 0,
                    // Site geometry never competes with the proposal.
                    emissive: color,
                    emissiveIntensity: isChange ? 0.1 : 0.02,
                }),
            ),
        )
        mesh.position.y = lift
        mesh.userData.piece = true

        const edges = new THREE.LineSegments(
            keep(new THREE.EdgesGeometry(geo, 18)),
            keep(
                new THREE.LineBasicMaterial({
                    color: new THREE.Color(isChange ? DRAFT : s.color),
                    transparent: true,
                    opacity: 0,
                    depthWrite: false,
                }),
            ),
        )
        edges.position.y = lift

        root.add(mesh, edges)

        /* Storeys.
        
           A building is not a box, and the cheapest thing that says so is a
           line every floor. Three point two metres is an ordinary residential
           floor-to-floor; anything shorter than two of them is a shed and gets
           none. This is also the one piece of real dimensional information in
           the panel: count the lines and you have the storeys. */
        if (isChange && weight >= CONTEXT && !s.flat && s.height * zScale > FLOOR * 2) {
            const floors = Math.min(24, Math.floor((s.height * zScale) / FLOOR))
            const pts: THREE.Vector3[] = []
            for (let f = 1; f < floors; f++) {
                const y = (f * FLOOR) / Math.max(s.height * zScale, 1e-6)
                for (let i = 0; i < s.base.length; i++) {
                    const a = s.base[i]
                    const b = s.base[(i + 1) % s.base.length]
                    pts.push(new THREE.Vector3(a[0], y, -a[1]), new THREE.Vector3(b[0], y, -b[1]))
                }
            }
            if (pts.length) {
                const fl = new THREE.LineSegments(
                    keep(new THREE.BufferGeometry().setFromPoints(pts)),
                    keep(
                        new THREE.LineBasicMaterial({
                            color: new THREE.Color(DRAFT),
                            transparent: true,
                            opacity: 0,
                            depthWrite: false,
                        }),
                    ),
                )
                /* Scaled with the mesh, so the floors rise WITH the building
                   rather than sitting in the air waiting for it. The unit
                   heights above are what make that work. */
                fl.position.y = lift
                fl.scale.y = s.height * zScale
                floorLines.push({ line: fl, t: s.t })
                root.add(fl)
            }
        }

        if (isChange) pickable.push(mesh)
        pieces.push({
            mesh,
            edges,
            layer: isChange ? "change" : "site",
            t: s.t,
            baseHeight: Math.max(s.height * zScale, 0),
            weight,
        })

        top = Math.max(top, lift + s.height * zScale)
        for (const [x, y] of s.base) {
            radius = Math.max(radius, Math.hypot(x, y))
            /* Context never drives the framing. Letting a kilometre of faint
               ridge count as the proposal is what shrank the bypass road to a
               sliver in the middle of its own panel. */
            if (isChange && weight >= CONTEXT) {
                changePoints.push(new THREE.Vector3(x, lift, -y))
                changePoints.push(new THREE.Vector3(x, lift + s.height * zScale, -y))
            }
        }
    }

    /* --- strands: ribbons get a surface, everything else stays a line --- */
    const strandLines: {
        line: THREE.Line
        t: number
        layer: "site" | "change"
        count: number
        weight: number
    }[] = []

    for (const st of scene.strands) {
        const isChange = (st.layer ?? "change") === "change"
        const color = new THREE.Color(st.color)

        if (st.ribbon) {
            const geo = keep(ribbonGeometry(st, zScale))
            const mesh = new THREE.Mesh(
                geo,
                keep(
                    new THREE.MeshStandardMaterial({
                        color,
                        roughness: 0.95,
                        metalness: 0,
                        transparent: true,
                        opacity: 0,
                        emissive: color,
                        emissiveIntensity: isChange ? 0.08 : 0.02,
                    }),
                ),
            )
            root.add(mesh)
            if (isChange) pickable.push(mesh)
            pieces.push({
                mesh,
                edges: new THREE.LineSegments(),
                layer: isChange ? "change" : "site",
                t: st.t,
                baseHeight: 0,
                // Strands default to 0.9 in the painted renderer.
                weight: weightOf(st.opacity, 0.9),
            })
        }

        const geo = keep(strandGeometry(st, zScale))
        const mat = keep(
            st.dashed
                ? new THREE.LineDashedMaterial({
                      color,
                      transparent: true,
                      opacity: 0,
                      dashSize: 9,
                      gapSize: 7,
                      depthWrite: false,
                  })
                : new THREE.LineBasicMaterial({
                      color,
                      transparent: true,
                      opacity: 0,
                      depthWrite: false,
                  }),
        )
        const line = new THREE.Line(geo, mat)
        if (st.dashed) line.computeLineDistances()
        root.add(line)
        strandLines.push({
            line,
            t: st.t,
            layer: isChange ? "change" : "site",
            count: st.points.length,
            /* Linear, not squared. weightOf squares because a lit surface reads
               as more solid than a flat fill at the same alpha; a one-pixel line
               has no surface, and squaring it would have halved the response
               bands a fire station scene exists to show. */
            weight: st.opacity == null ? 1 : clamp01(st.opacity / 0.9),
        })

        for (const [x, y, z] of st.points) {
            radius = Math.max(radius, Math.hypot(x, y))
            if (isChange) changePoints.push(new THREE.Vector3(x, z * zScale, -y))
            top = Math.max(top, z * zScale)
        }
    }

    /* --- the mechanism, built once and animated in the last phase --- */
    const mech = scene.mechanism ? buildMechanism(scene.mechanism, zScale, keep) : null
    if (mech) root.add(mech.group)

    /**
     * PHASE, 0 to 1, across four acts.
     *
     *   0.00 - 0.25  SITE        what is already there, lines only
     *   0.25 - 0.55  BLUEPRINT   the proposal, drawn as edges
     *   0.55 - 0.80  BUILT       surfaces resolve, edges drop to an outline
     *   0.80 - 1.00  MECHANISM   what it does, moving
     *
     * Expressed as one number so the whole thing can be scrubbed, autoplayed or
     * jumped to, and so a caller never has to know the act boundaries.
     */
    const update = (phase: number, elapsed: number) => {
        const p = clamp01(phase)

        // Site: in early, then held as quiet context for the rest.
        const siteIn = clamp01(p / 0.22)
        /* The site steps back twice: once when the proposal starts being drawn
           over it, and again when the proposal becomes solid. Without the first
           step the drafting lines land on top of a fully lit settlement and the
           one thing the act exists to show is the hardest thing to see. */
        const siteFade =
            (1 - clamp01((p - 0.2) / 0.2) * 0.45) * (1 - clamp01((p - 0.54) / 0.3) * 0.35)

        // Blueprint: the proposal's edges, drawn in over act two.
        const draft = clamp01((p - 0.24) / 0.3)
        // Built: surfaces, over act three.
        const built = clamp01((p - 0.54) / 0.26)

        /* The paper leads and then withdraws: strongest under the drawing,
           gone by the time there is a building standing on it. */
        gridMat.opacity = 0.1 * clamp01(p / 0.16) * (1 - clamp01((p - 0.5) / 0.3))
        grid.visible = gridMat.opacity > 0.004

        for (const floor of floorLines) {
            const g = clamp01((draft - floor.t * 0.55) / 0.45)
            const m = floor.line.material as THREE.LineBasicMaterial
            // Held through the built act: storeys are the one dimension here.
            m.opacity = g * Math.min(draft * 0.5, 0.34)
            floor.line.visible = m.opacity > 0.004
        }

        for (const piece of pieces) {
            const own = piece.layer === "change" ? draft : siteIn
            // Pieces arrive in the order the scene gave them.
            const g = clamp01((own - piece.t * 0.55) / 0.45)
            const mat = piece.mesh.material as THREE.MeshStandardMaterial
            const line = piece.edges.material as THREE.LineBasicMaterial

            if (piece.layer === "site") {
                mat.opacity = 0.16 * g * siteFade
                line.opacity = 0.3 * g * siteFade
                piece.mesh.scale.y = 1
            } else {
                // Rises out of its own footprint as the surfaces resolve.
                piece.mesh.scale.y = Math.max(0.001, easeOut(clamp01(built / 0.8)))
                mat.opacity = 0.92 * built * g * piece.weight
                // The drawing stays as a hairline over the built surface.
                line.opacity = g * (draft - built * 0.55) * piece.weight
                piece.edges.scale.y = piece.mesh.scale.y
            }
            piece.mesh.visible = mat.opacity > 0.004
            piece.edges.visible = line.opacity > 0.004
        }

        for (const s of strandLines) {
            const own = s.layer === "change" ? draft : siteIn
            const g = clamp01((own - s.t * 0.55) / 0.45)
            const mat = s.line.material as THREE.LineBasicMaterial
            mat.opacity = (s.layer === "site" ? 0.5 * siteFade : 0.85) * g * s.weight
            s.line.visible = mat.opacity > 0.004
            // Lines draw along their length rather than fading in place.
            s.line.geometry.setDrawRange(0, Math.max(2, Math.ceil(s.count * easeOut(g))))
        }

        mech?.update(clamp01((p - 0.78) / 0.22), elapsed)
    }

    /* Padded outward from the middle, so the proposal sits in its setting
       rather than filling the frame edge to edge. A change with no geometry of
       its own falls back to the whole scene. */
    const PAD = 1.5
    const framed = changePoints.length
        ? changePoints.map((v) => v.clone().multiplyScalar(PAD))
        : [
              new THREE.Vector3(radius, 0, radius),
              new THREE.Vector3(-radius, top, -radius),
              new THREE.Vector3(radius, 0, -radius),
              new THREE.Vector3(-radius, top, radius),
          ]

    return {
        root,
        radius,
        changePoints: framed,
        top,
        update,
        pickable,
        dispose: () => {
            for (const d of disposables) d.dispose()
            root.clear()
        },
    }
}

/* --- mechanisms --------------------------------------------------------- */

/**
 * The last act: what the change DOES, as motion.
 *
 * Each of these is drawn from the geometry and the standard, never from a
 * result. The response band is a circle because NFPA 1710 is a time and the
 * model turns time into distance; the trips are arrows because the engine
 * generates trips per resident. How far any of it moves an axis is what the run
 * is for, and the panel around this says so in words.
 */
function buildMechanism(
    m: Mechanism,
    zScale: number,
    keep: <T extends { dispose(): void }>(x: T) => T,
) {
    const group = new THREE.Group()
    const tick: ((k: number, elapsed: number) => void)[] = []

    if (m.kind === "band") {
        /* An expanding ring, reaching what a first engine reaches. Repeats,
           because the point is the reaching rather than the arrival. */
        const geo = keep(new THREE.RingGeometry(0.97, 1, 96))
        geo.rotateX(-Math.PI / 2)
        for (let i = 0; i < 3; i++) {
            const mat = keep(
                new THREE.MeshBasicMaterial({
                    color: new THREE.Color("#e5484d"),
                    transparent: true,
                    opacity: 0,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                }),
            )
            const ring = new THREE.Mesh(geo, mat)
            ring.position.set(m.at[0], 1.5, -m.at[1])
            group.add(ring)
            tick.push((k, elapsed) => {
                const phase = ((elapsed / 2600 + i / 3) % 1)
                const r = m.radius * (0.12 + phase * 0.88)
                ring.scale.setScalar(r)
                mat.opacity = k * 0.75 * (1 - phase) * Math.min(1, phase * 6)
                ring.visible = mat.opacity > 0.01
            })
        }
    }

    if (m.kind === "trips") {
        /* Trips leaving the new dwellings for the rest of the network. Short
           darts rather than a flow field: the engine generates a COUNT of
           journeys per resident, and a smooth stream would imply it knows
           where each one goes. */
        const dir = new THREE.Vector2(Math.cos(m.heading), Math.sin(m.heading))
        for (const [i, origin] of m.from.entries()) {
            const mat = keep(
                new THREE.LineBasicMaterial({
                    color: new THREE.Color("#7aa5e6"),
                    transparent: true,
                    opacity: 0,
                    depthWrite: false,
                }),
            )
            const geo = keep(
                new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(0, 0, 0),
                    new THREE.Vector3(dir.x * 54, 0, -dir.y * 54),
                ]),
            )
            const dart = new THREE.Line(geo, mat)
            dart.position.y = 6 * zScale
            group.add(dart)
            tick.push((k, elapsed) => {
                const phase = (elapsed / 2200 + i * 0.13) % 1
                const travel = 520 * phase
                dart.position.x = origin[0] + dir.x * travel
                dart.position.z = -(origin[1] + dir.y * travel)
                mat.opacity = k * 0.85 * Math.sin(Math.PI * phase)
                dart.visible = mat.opacity > 0.01
            })
        }
    }

    if (m.kind === "flow") {
        /* Vehicles along the corridor, one lane per lane. */
        const path = m.along
        const lanes = Math.max(1, m.lanes)
        for (let lane = 0; lane < lanes; lane++) {
            const offset = (lane - (lanes - 1) / 2) * 11
            for (let i = 0; i < 7; i++) {
                const mat = keep(
                    new THREE.MeshBasicMaterial({
                        color: new THREE.Color("#f2c14e"),
                        transparent: true,
                        opacity: 0,
                        depthWrite: false,
                    }),
                )
                const geo = keep(new THREE.BoxGeometry(16, 2.5, 6))
                const car = new THREE.Mesh(geo, mat)
                group.add(car)
                tick.push((k, elapsed) => {
                    const phase = (elapsed / 3400 + i / 7 + lane * 0.09) % 1
                    const at = phase * (path.length - 1)
                    const a = path[Math.floor(at)]
                    const b = path[Math.min(path.length - 1, Math.floor(at) + 1)]
                    const f = at - Math.floor(at)
                    const nx = -(b[1] - a[1])
                    const ny = b[0] - a[0]
                    const len = Math.hypot(nx, ny) || 1
                    car.position.set(
                        a[0] + (b[0] - a[0]) * f + (nx / len) * offset,
                        (m.z ?? 0) * zScale + 2,
                        -(a[1] + (b[1] - a[1]) * f + (ny / len) * offset),
                    )
                    car.rotation.y = Math.atan2(b[1] - a[1], b[0] - a[0])
                    mat.opacity = k * 0.9
                    car.visible = mat.opacity > 0.01
                })
            }
        }
    }

    if (m.kind === "fill") {
        /* Capacity arriving: the basins come up to level. */
        for (const [i, b] of m.basins.entries()) {
            const geo = keep(new THREE.CircleGeometry(b.radius, 40))
            geo.rotateX(-Math.PI / 2)
            const mat = keep(
                new THREE.MeshStandardMaterial({
                    color: new THREE.Color("#3ddc97"),
                    roughness: 0.25,
                    metalness: 0.1,
                    transparent: true,
                    opacity: 0,
                }),
            )
            const water = new THREE.Mesh(geo, mat)
            water.position.set(b.at[0], 0, -b.at[1])
            group.add(water)
            tick.push((k, elapsed) => {
                const swell = 0.5 + 0.5 * Math.sin(elapsed / 900 + i)
                water.position.y = (b.z * zScale + 1) * (0.25 + 0.75 * k)
                mat.opacity = k * (0.5 + swell * 0.28)
                water.visible = mat.opacity > 0.01
            })
        }
    }

    return {
        group,
        update: (k: number, elapsed: number) => {
            group.visible = k > 0.001
            if (!group.visible) return
            for (const f of tick) f(k, elapsed)
        },
    }
}
