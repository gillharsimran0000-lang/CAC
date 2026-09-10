/**
 * The motion kit.
 *
 * Small, hand-rolled, and deliberately not a dependency: every effect here is a
 * CSS transform driven by one rAF-throttled listener, which is a few hundred
 * bytes each and costs nothing on the compositor. Each one honours
 * prefers-reduced-motion in the way that suits it -- the marquee becomes a
 * scrollable row, the tilt stops responding, the text reveal snaps to its
 * finished state -- rather than by animating quickly, which is still animating.
 */

export { Photograph, Credit } from "./Photograph"
export { BlurIn, DrawRule } from "./Reveal"
export { Spotlight, BorderBeam, Tilt } from "./Surface"
export { Marquee, ScrollProgress, Magnetic } from "./Strip"
