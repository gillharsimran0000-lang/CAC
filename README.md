# CivicFlow · Arkansas

A civic planning simulator. Place growth somewhere in Arkansas, and watch the
decision propagate through the road network, emergency response coverage and
infrastructure cost until it reaches a score, with every step open to
inspection.

Built on real data. Nothing on screen is placeholder except the infrastructure
unit costs, and those are labelled `DEMO DATA` wherever they appear.

## The four signature features

**Decision DNA**: five axes as one shape you can recognise at a glance. A radar
chart was the obvious choice and the wrong one: radar polygons all read as
"pentagon, slightly dented", so two genuinely different scenarios look like
siblings. The values instead drive a closed cardinal spline, where curvature
amplifies difference into distinct silhouettes.

The five axes are tested for independence. `scripts/validate/sweep.ts` runs 120
random scenarios and prints the correlation matrix; **any |r| above 0.9 fails the
build**. This is not ceremony: the first run failed at r = −0.958 between
Transportation and Infrastructure Capacity, because both were readings of the
same volume/capacity field. Capacity was redefined as utility service headroom
over 2020 housing stock, which responds to *where* growth goes with no reference
to traffic at all.

**Consequence Chain**: residents → trips → corridors → response times → cost →
score, revealed in causal order, every step expandable to its arithmetic, inputs
and affected corridors by name. The numbers exist before the animation starts;
the reveal is timing only.

Every percentage names its own denominator. "+18% travel demand" is meaningless
without saying what it is 18% *of*. Adding 10,000 residents to a 471,162-person
metro moves citywide trips about 2%, not 18%. If a judge divides the numbers on
screen, they get the number on screen.

**Twenty Arkansas projects**: the lab opens on a searchable catalogue of real
things the state would build, from the I-30 Crossing to the Beaver Water
District. Each one resolves into the same actions the manual builder emits, and
each carries its own generated 3D model, a photograph of the ground it sits on,
and a plain statement of what the simulation cannot see about it (an airport is
mostly aviation; this model has no aviation layer). Picking one draws it before
you run anything, and marks the axes its mechanism can reach without predicting
how far any of them will move. See `src/data/projects.ts`.

**The blueprint**: whatever is picked, catalogue project or hand-built change,
is drawn in three.js and played as four acts: the site as it stands, the
proposal drafted over it, the proposal built, and the mechanism by which it
reaches the model (trips leaving, flow running, a response band reaching,
basins filling). The last act animates a mechanism and never a result, and says
so. anime.js drives the act timeline, so it can be scrubbed, replayed or jumped
to, and the panel expands to full screen. Without WebGL it falls back to the
painted renderer. See `src/components/preview/BlueprintView.tsx` and
`src/render/three/blueprint.ts`.

**Decision History**: every run is kept with its result and can be restored.
Deliberately not an undo stack: undo discards the path not taken, and the path
not taken is the experiment. Restoring branches rather than overwrites.

**Your Priorities**: the five axes measure things no fact can trade against each
other. Whether a minute of travel is worth a dollar of capital is a value
judgement, not a finding, so the engine ships equal weights and hands the
judgement to the user.

Reweighting never re-runs the simulation. Axis scores are properties of the
scenario; the weights only decide how they are combined, so a slider drag
re-scores the entire decision history on the same frame, and the panel can say,
live and only when it is literally true, **"your priorities changed the optimal
scenario"**, naming the run that now leads and the one that used to.

## Data

| What | Source | Provenance |
|---|---|---|
| Road network | OpenStreetMap via Overpass (ODbL) | VERIFIED |
| Population, housing | US Census 2020 Decennial, TIGERweb `POP100`/`HU100` | VERIFIED |
| Zone geometry | US Census TIGERweb | VERIFIED |
| Fire stations, hospitals | OpenStreetMap (ODbL) | VERIFIED |
| Trips, volumes, response times, scores | this engine | MODELLED |
| Photographs of Arkansas places | Wikimedia Commons (CC0 / CC BY / CC BY-SA / PD) | VERIFIED |
| Infrastructure unit costs | placeholder | DEMO |

**No API key is required.** The ACS endpoint now rejects keyless requests, but
TIGERweb's Census2020 service carries the Decennial counts directly. Summed over
Arkansas they reproduce the published total of **3,011,524 exactly**, and the
pipeline refuses to write data if that check ever fails. Nothing gets labelled
VERIFIED on a bad join.

A full enumeration is also a better planning baseline than ACS, whose
block-group margins of error would swamp the changes a scenario models.

## Photographs

Eighteen photographs of real Arkansas places, fetched from Wikimedia Commons by
`scripts/fetch-photos.mjs`, filtered to licences that permit reuse, downloaded
and re-encoded to their display size rather than hotlinked, and turned into a
generated manifest by `scripts/build-photos.mjs`. Photographer and licence travel
with the file, so a component cannot render one without its credit.

They are not decoration. In the county gallery each photograph sits *under* the
live network render of that same town, composited in `screen`, so the abstraction
and the place it abstracts are one image. In the place band each is captioned
with its county's real 2020 population.

Where a photograph's county cannot be established it is not captioned with one.
The Buffalo National River runs through four counties and its Commons record has
no coordinates, so it appears in a section that claims nothing rather than in the
grid that joins images to figures.

## Methodology

`/methodology` is generated out of the model rather than written about it: every
coefficient is imported from the engine module that applies it, every count and
provenance record is read from `methodology.json` (built from the same artefacts
the worker loads), and the volume-delay diagram calls the engine's own `bprTime`.
A discrepancy between that page and the model is a pipeline bug, not a stale
sentence.

## Method

Standard four-step travel modelling, minus mode choice:

- **Generation**: 0.19 peak vehicle trips per resident (3.4 daily person-trips ×
  0.095 peak share ÷ 1.67 occupancy, NHTS 2017)
- **Distribution**: singly-constrained gravity, `f(c) = exp(-c/c0)`, with `c0`
  *solved for* per area against a stated target journey rather than hand-tuned
  (`scripts/validate/calibrate.ts`)
- **Assignment**: incremental capacity-restrained, 4 slices, BPR volume-delay
  `t = t₀(1 + 0.15(v/c)⁴)` (Bureau of Public Roads, 1964)
- **Stress**: v/c ≥ 0.85, the Highway Capacity Manual LOS C/D boundary
- **Emergency access**: NFPA 1710's 240 s first-engine travel time, computed on
  *congested* speeds. If it ran on free-flow, growth could never affect emergency
  access and the consequence chain would be showing a link that does not exist

Local streets are drawn but not routed, which is what regional travel models do:
they carry access traffic, not through movement.

`Measured<T>` carries value, unit, provenance, source, formula and the inputs it
was derived from. A component cannot render a number without its provenance in
hand, and the step inspector is just a walk down `inputs`.

## Known limits

- **Statewide traffic is coarse.** County-sized zones over-disperse trips no
  matter how the gravity model is calibrated. Emergency access, service headroom,
  growth efficiency and burden are all sound at county scale; corridor stress
  should be read as directional. The metro views carry the traffic claims.
- **Unit costs are invented.** Both baseline and scenario are costed identically,
  so the comparison holds where the absolute level does not.
- **Attractions use population as an activity proxy.** Jobs are not distributed
  like residents. This is the weakest assumption in the model.
- **Deterrence targets are assumptions.** An ACS mean-commute figure would be a
  better calibration anchor and is the obvious upgrade.

## Running it

```bash
npm install
npm run dev            # the data is committed; this just works
```

Rebuilding the data from source (slow, because Overpass rate-limits):

```bash
npm run data:all       # fetch → graph → zones → calibrate → sweep → hero → methodology → publish
npm run data:images    # photographs from Wikimedia Commons, then the manifest
```

The photographs are a separate command on purpose: they come from a rate-limited
public API rather than from the graph, and there is no reason to re-fetch them
when the road network changes.

Validation:

```bash
npm run validate       # scenario sweep + axis independence gate
npm run demo           # one scenario end to end, printed
npm run smoke          # browser test: worker, canvas, chain, history
npm run check          # smoke + full flow + motion + reduced motion + design
```

## Stack

Next.js 16, React 19, TypeScript, Tailwind v4, Zustand, Lenis. Geist Sans, Geist
Mono, and Geist Pixel Grid, the last confined to headlines and result numerals,
since it is a display face and unreadable below about 18px.

The map and the hero share one Canvas2D renderer rather than using deck.gl or
MapLibre. The hero draws the network *becoming* itself under scroll control,
which is not what a map library is shaped for, and two renderers would let the
opening sequence drift from the tool it introduces.

There is no basemap. The road network drawn against dark ground *is* the map, so
nothing on screen is decoration: every line is a modelled object with a capacity
and a volume.

The motion kit in `src/components/ui/motion` is hand-rolled rather than a
dependency: each effect is one rAF-throttled listener writing a CSS transform, a
few hundred bytes apiece. The text reveals and photograph cross-fades are driven
by data attributes rather than React state, which means a page of thirty of them
causes zero re-renders, and, less obviously, that a photograph which finishes
loading *before* React hydrates still appears. An `onLoad` prop loses that race
silently, and did.
