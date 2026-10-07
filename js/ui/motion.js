// ---------------------------------------------------------------------------
// MOTION TOKENS: one set of easings and durations for the whole UI (JS side).
// The CSS mirrors them as --ease-* / --t-* custom properties in css/style.css.
// Change a value here and every flight, banner, pop and panel follows.
// ---------------------------------------------------------------------------
export const EASE = {
  out: 'cubic-bezier(.22,.8,.25,1)',      // things arriving: fast start, soft landing
  spring: 'cubic-bezier(.2,1.1,.3,1)',    // small overshoot for pops and impacts
  inOut: 'cubic-bezier(.65,0,.35,1)',     // things that move and settle (panels, flips)
  linear: 'linear',
};
export const DUR = {
  fast: 140,        // hovers, presses
  med: 260,         // panels, chips, pops
  slow: 420,        // flips, big pops
  fly: 560,         // a card crossing the table
  swap: 640,        // two cards trading places
  banner: 1900,     // how long a cast banner stays up
  bannerBig: 2800,  // special runes
  settle: 700,      // time from "card leaves" to "effect lands" for a cast
};
/** Scale a duration by the backlog factor (busy tables play faster) and reduced motion. */
export const dur = (ms, speed = 1, reduced = false) => (reduced ? Math.min(ms, 160) : Math.round(ms * Math.max(0.5, speed)));
