// ---------------------------------------------------------------------------
// CARD ART MAP  — the one place that says which image is which card.
//
// To swap in new art: replace the file in assets/cards/ (same name), or point
// an entry below at a different file. Any card whose image is missing or fails
// to load falls back to a generated placeholder, so the game never breaks.
//
// Recommended export from Canva: 750x1050 (5:7), PNG or WebP.
// ---------------------------------------------------------------------------
export const ART_BASE = 'assets/cards/';

export const UNIT_ART = {
  1: 'unit-1.webp', 2: 'unit-2.webp', 3: 'unit-3.webp', 4: 'unit-4.webp', 5: 'unit-5.webp', 6: 'unit-6.webp',
  7: 'unit-7.webp', 8: 'unit-8.webp', 9: 'unit-9.webp', 10: 'unit-10.webp', 11: 'unit-11.webp',
};
export const UNIT_BACK = 'unit-back.webp';
export const RUNE_BACK = 'rune-back.webp';

// key = rune id from js/engine/runes.js
export const RUNE_ART = {
  elevate: 'rune-elevate.webp', shield: 'rune-shield.webp', hush: 'rune-hush.webp',
  rebuke: 'rune-rebuke.webp', return: 'rune-return.webp', twin_draw: 'rune-twin_draw.webp',
  elevate2: 'rune-elevate2.webp', shield2: 'rune-shield2.webp', gambit: 'rune-gambit.webp',
  retaliation: 'rune-retaliation.webp', barter: 'rune-barter.webp', remove: 'rune-remove.webp',
  curse: 'rune-curse.webp', pickpocket: 'rune-pickpocket.webp', wager: 'rune-wager.webp',
  restrain: 'rune-restrain.webp', dread: 'rune-dread.webp', disrupt: 'rune-disrupt.webp',
  mischief: 'rune-mischief.webp', stall: 'rune-stall.webp', reset: 'rune-reset.webp',
  unity: 'rune-unity.webp', target17: 'rune-target17.webp', target24: 'rune-target24.webp',
  target27: 'rune-target27.webp', trade: 'rune-trade.webp', helping_hand: 'rune-helping_hand.webp',
  double_draw: 'rune-double_draw.webp', prophecy: 'rune-prophecy.webp', duel: 'rune-duel.webp',
  bless: 'rune-bless.webp', exile: 'rune-exile.webp', jackpot: 'rune-jackpot.webp',
  vow: 'rune-vow.webp', wrap: 'rune-wrap.webp', underdog: 'rune-underdog.webp', reverse: 'rune-reverse.webp',
};
