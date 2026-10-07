// ROUND TWISTS: random modifiers rolled BETWEEN rounds. The next round's twist is rolled when a round
// ends (and before round 1), shown on the results screen as a teaser, then announced and applied
// when the round starts. Each twist is data; rules.js / game.js read the fields it returns:
//   target     replaces the default win condition (a New Target rune still overrides it)
//   betMult    multiplies the final bet
//   maxRunes   runes per turn this round (instead of config.maxRunesPerTurn)
//   handLimit  rune hand limit this round (instead of config.runeHandLimit)
//   extraRunes everyone draws this many runes when the round starts
//   timer      seconds per turn this round (only offered when turn timers are on)
//   rarity     'high' = rune draws favour rarer runes this round
//
// Difficulty presets (config.twistPreset) pick how often twists happen and which ones can appear.
// Advanced overrides in the config: twistChance, twistFirstRound, twists: { id: true|false }.
export const TWISTS = {
  target: { name: 'Shifted Target', icon: '\u25CE', text: (t) => `The win condition is ${t.target} this round.`, roll: (rng) => ({ target: [17, 24, 27][rng.int(3)] }) },
  double: { name: 'High Stakes', icon: '\u00D72', text: () => 'The bet is doubled this round.', roll: () => ({ betMult: 2 }) },
  grip: { name: 'Tight Grip', icon: '\u2297', text: (t) => `Rune hand limit ${t.handLimit} and only ${t.maxRunes} rune per turn this round.`, roll: () => ({ maxRunes: 1, handLimit: 3 }) },
  rain: { name: 'Rune Rain', icon: '\u2726', text: (t) => `Everyone draws ${t.extraRunes} extra rune cards.`, roll: () => ({ extraRunes: 2 }) },
  rush: { name: 'Speed Round', icon: '\u25D4', text: (t) => `Only ${t.timer} seconds per turn this round.`, available: (cfg) => cfg.turnTimer > 0, roll: (rng, cfg) => ({ timer: Math.max(5, Math.round(cfg.turnTimer / 3)) }) },
  rare: { name: 'Rare Tide', icon: '\u25C6', text: () => 'Rune draws favour rarer runes this round.', roll: () => ({ rarity: 'high' }) },
};

const ALL = Object.keys(TWISTS);
export const TWIST_PRESETS = {
  off:   { label: 'Off',   chance: 0,    first: 2, ids: [],                              blurb: 'No twists.' },
  mild:  { label: 'Mild',  chance: 0.25, first: 2, ids: ['target', 'rain', 'rare'],      blurb: 'About 1 round in 4. Gentle changes: new target, extra runes, rarer runes.' },
  wild:  { label: 'Wild',  chance: 0.5,  first: 2, ids: ALL,                             blurb: 'About every other round. Every twist can appear.' },
  chaos: { label: 'Chaos', chance: 0.85, first: 1, ids: ALL,                             blurb: 'Almost every round, from round 1. Every twist can appear.' },
};

/** Roll the twist for `round` (or null). `prev` = last round's twist id, never repeated back to back. */
export function rollTwist(cfg, round, rng, prev) {
  const P = TWIST_PRESETS[cfg.twistPreset] || TWIST_PRESETS.off;
  const chance = cfg.twistChance ?? P.chance, first = cfg.twistFirstRound ?? P.first;
  if (!(chance > 0) || round < first || rng.next() >= chance) return null;
  const allowed = cfg.twists ? ALL.filter((id) => cfg.twists[id]) : P.ids;
  const ids = allowed.filter((id) => id !== prev && (!TWISTS[id].available || TWISTS[id].available(cfg)));
  if (!ids.length) return null;
  const id = ids[rng.int(ids.length)];
  const t = { id, name: TWISTS[id].name, icon: TWISTS[id].icon, ...TWISTS[id].roll(rng, cfg) };
  t.desc = TWISTS[id].text(t);
  return t;
}
