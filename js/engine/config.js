// Every tunable number in the game lives here.
export const DEFAULT_CONFIG = {
  minPlayers: 2,
  maxPlayers: 10,

  defaultTarget: 21,        // win condition when no New Target rune is active
  startingLives: 10,
  startingBet: 1,           // bet in round 1
  betIncreasePerRound: 1,   // bet grows by this every round
  minBet: 1,                // runes can't push the bet below this

  unitValues: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],

  // --- unit card deck scaling (a fresh deck is built every round) ---
  unitDeckScaling: 'scaled',  // 'scaled' = copies grow with the table (1v1 is a single 1–11 set); 'fixed' = always `unitCopies`
  playersPerDeck: 2,          // 'scaled': one copy of the unit set per N living players, rounded up (2 players = 1 copy, 3–4 = 2, 5–6 = 3 ...)
  minUnitCopies: 1,           // never fewer copies than this
  maxUnitCopies: 0,           // cap on copies (0 = no cap)
  unitCopies: 1,              // 'fixed': how many copies of every unit card

  runeDeckMultiplier: 'auto', // multiplies every rune's copies in the deck: 'auto' (see runeDeckAuto) or a number (0.5, 1, 2 ...)
  runeDeckAuto: [[8, 2]],
  // Rarity per rune colour: multiplies how many copies of those runes are in the deck (so how likely they are to be drawn).
  // 1 = as designed (white 3 copies, cyan 2, violet 2, special 1). 2 = twice as common, 0.5 = half as common, 0 = none at all.
  rarityWhite: 1, rarityCyan: 1, rarityViolet: 1, raritySpecial: 1,     // 'auto' tiers as [minPlayers, multiplier]: x2 once the table starts with 8+ players (8-10)
  startingRunes: 2,         // rune cards each player gets in round 1
  runesPerRound: 1,         // rune cards each player draws at the start of later rounds
  runeHandLimit: 6,
  maxRunesPerTurn: 3,

  // --- table rules (all configurable; the lobby host / start screen can change them) ---
  turnDirection: 'alternate', // 'cw' = clockwise every round, 'ccw' = counter-clockwise, 'alternate' = flips each round
  showDirection: true,        // false = hide which way the turn order runs (no direction indicator, seats shown in fixed order)
  showLives: true,            // false = you can only see your own lives; opponents' lives stay hidden until the game ends
  showRuneCount: true,        // true = you can see how many rune cards each opponent holds; false = that number is hidden
  twistPreset: 'off',         // round twists between rounds: 'off' | 'mild' | 'wild' | 'chaos' (see twists.js; the start screen defaults to 'mild')
  turnTimer: 0,               // seconds a human gets per turn / vote / pick before the game acts for them (0 = off)
  runeDrawChance: 0.25,       // chance (0..1) that a normal unit-card draw also gives a free rune card

  // --- round scoring (rules.js) ---
  // Everyone is ranked by distance from the target (a bust ranks worse than any non-bust; among busts the bigger overshoot is worse).
  // lossFrac: null = classic Twenty One (only the closest player(s) are safe).
  //           0..1 = the worst `lossFrac` of the table lose lives equal to the bet (0.5 = half the table). Ties at the cutoff all lose,
  //           and if everyone ties nobody loses. lossFrac 0 therefore means nobody loses.
  lossFrac: null,
  lossRounding: 'ceil',       // how lossFrac x players becomes a head count: 'ceil' | 'round' | 'floor'
  lossTies: 'lose',           // players tied with the cutoff rank: 'lose' (they all lose) | 'safe' (they are spared)

  timeoutAction: 'stand',     // when a human's turn timer runs out: 'stand' = the game stands for them | 'lose' = they forfeit the round (no more turns, they lose the bet)

  // --- disconnects (online rooms) ---
  onDisconnect: 'eliminate',  // 'eliminate' = a player who drops is out of the game | 'bot' = a computer plays their seat until they return
  disconnectGraceSecs: 20,    // how long a dropped player has to reconnect before the rule above applies (0 = immediately)

  devMode: false,           // enables the "give me any rune" test action
};
