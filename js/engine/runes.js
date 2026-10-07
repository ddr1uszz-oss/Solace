// ---------------------------------------------------------------------------
// RUNE REGISTRY
//
// Every rune is one entry made with def(). To add a new rune:
//   1. add a def() below,
//   2. drop its art in assets/cards/ and add one line to js/ui/assets.js.
// Nothing else needs to change.
//
// Fields
//   kind       'active'  stays on the table until the round ends (effects are
//                        derived from the table, so destroying the card undoes them)
//              'instant' resolves once, then is discarded
//   tier       1 white, 2 cyan, 3 violet, 4 special (matches the art colours)
//   copies     how many copies are shuffled into the rune deck
//   betMod     active: change to the round bet
//   target     active: replaces the win condition (latest one on the table wins)
//   destroy    true = "Destroy-type" (only Rebuke / Retaliation), still usable while Restrained
//   needs      choices the player must make, in order. Each is one of:
//                'player'     another player (narrowed by targetFilter)
//                'ownCard'    one of your unit cards
//                'active'     any active rune on the table
//                'ownActive'  an active rune you played
//                'ownRune'    another rune in your hand
//   targetFilter(g, me, t)  which players are valid for a 'player' step
//   canPlay(g, me)          return a reason string if it can't be played now
//   play(g, me, params, entry)  the effect. `g` is the Game (see game.js helpers).
// ---------------------------------------------------------------------------

export const RUNES = {};

function def(id, o) {
  RUNES[id] = { id, copies: 1, needs: [], tier: 1, kind: 'instant', ...o };
}

const otherAlive = (g, me) => g.alivePlayers().filter((p) => p.id !== me.id);
const deckLeft = (g) => g.unitCardsAvailable();
const stalledMsg = (g) => (g.isStalled() ? 'Stall: no one can draw unit cards right now.' : null);
const needDeck = (g, n = 1) => stalledMsg(g) || (deckLeft(g) < n ? 'Not enough unit cards left in the deck.' : null);

// ----- Tier 1 (white) ------------------------------------------------------
def('elevate', {
  name: 'Elevate', tier: 1, kind: 'active', copies: 3, betMod: +1,
  text: 'Increases the total round bet by 1.',
  play() {},
});
def('hush', {
  name: 'Hush', tier: 1, copies: 3,
  text: 'Draw one unit card face-down (only you can see).',
  canPlay: (g) => needDeck(g),
  play(g, me) { g.drawUnit(me, { faceDown: true }); g.log(`${me.name} drew a hidden card.`); },
});
def('shield', {
  name: 'Shield', tier: 1, kind: 'active', copies: 3, betMod: -1,
  text: 'Decreases the total round bet by 1.',
  play() {},
});
def('rebuke', {
  name: 'Rebuke', tier: 1, copies: 3, destroy: true,
  text: 'Destroy the latest active rune card.',
  canPlay: (g) => (g.state.active.length ? null : 'No active rune on the table.'),
  play(g, me) {
    const last = g.state.active[g.state.active.length - 1];
    g.destroyActive(last.uid, `${me.name} rebuked ${RUNES[last.runeId].name}.`);
  },
});
def('return', {
  name: 'Return', tier: 1, copies: 3, needs: ['ownCard'],
  text: 'Return 1 of your unit cards to the deck.',
  canPlay: (g, me) => (me.cards.length ? null : 'You have no unit cards.'),
  play(g, me, params) {
    const i = me.cards.findIndex((c) => c.uid === params.ownCard);
    const [card] = me.cards.splice(i, 1);
    g.returnToDeck(card);
    g.log(`${me.name} returned a card to the deck.`);
  },
});
def('twin_draw', {
  name: 'Twin Draw', tier: 1, copies: 3,
  text: 'Draw 2 unit cards.',
  canPlay: (g) => needDeck(g),
  play(g, me) {
    const a = g.drawUnit(me, {}), b = g.drawUnit(me, {});
    g.log(`${me.name} drew ${[a, b].filter(Boolean).length} cards.`);
  },
});

// ----- Tier 2 (cyan) -------------------------------------------------------
def('elevate2', {
  name: 'Elevate II', tier: 2, kind: 'active', copies: 2, betMod: +2,
  text: 'Increases the total round bet by 2.',
  play() {},
});
def('shield2', {
  name: 'Shield+', tier: 2, kind: 'active', copies: 2, betMod: -2,
  text: 'Decreases the total round bet by 2.',
  play() {},
});
def('gambit', {
  name: 'Gambit', tier: 2, kind: 'active', copies: 2, betMod: +1,
  text: 'Increases the total round bet by 1. Then, caster draws 1 rune card.',
  play(g, me) { g.drawRune(me, 1); },
});
def('retaliation', {
  name: 'Retaliation', tier: 2, copies: 2, destroy: true, needs: ['active'],
  text: 'Destroy 1 active rune card. Then draw 1 rune card.',
  canPlay: (g) => (g.state.active.length ? null : 'No active rune on the table.'),
  play(g, me, params) {
    g.destroyActive(params.active, `${me.name} destroyed an active rune.`);
    g.drawRune(me, 1);
  },
});
def('barter', {
  name: 'Barter', tier: 2, copies: 2, needs: ['player'],
  text: 'Swap your latest unit card with another player\u2019s latest card.',
  targetFilter: (g, me, t) => t.id !== me.id && t.cards.length > 0,
  canPlay: (g, me) => (me.cards.length ? null : 'You have no unit cards.'),
  play(g, me, params) {
    const t = g.player(params.player);
    const mine = me.cards.pop(), theirs = t.cards.pop();
    me.cards.push(theirs); t.cards.push(mine);
    g.log(`${me.name} swapped latest cards with ${t.name}.`);
  },
});
def('remove', {
  name: 'Remove', tier: 2, copies: 2, needs: ['player'],
  text: 'Remove the latest unit card of any 1 player.',
  targetFilter: (g, me, t) => t.cards.length > 0,
  play(g, me, params) {
    const t = g.player(params.player);
    const card = t.cards.pop();
    g.state.unitDiscard.push(card);
    g.log(`${me.name} removed ${t.name}\u2019s latest card${card.faceDown && !card.revealed ? '' : ` (${card.value})`}.`);
  },
});
def('curse', {
  name: 'Curse', tier: 2, kind: 'active', copies: 2, needs: ['player'],
  text: 'Chosen player loses an additional life this round.',
  targetFilter: (g, me, t) => t.id !== me.id,
  play(g, me, params, entry) { entry.data.targetId = params.player; g.log(`${me.name} cursed ${g.player(params.player).name}.`); },
});
def('pickpocket', {
  name: 'Pickpocket', tier: 2, copies: 2, needs: ['player'],
  text: 'Steal a random rune card from any player.',
  targetFilter: (g, me, t) => t.id !== me.id && t.runes.length > 0,
  play(g, me, params) {
    const t = g.player(params.player);
    const i = g.rng.int(t.runes.length);
    const [stolen] = t.runes.splice(i, 1);
    me.runes.push(stolen);
    g.log(`${me.name} stole a rune from ${t.name}.`);
  },
});
def('wager', {
  name: 'Wager', tier: 2, kind: 'active', copies: 2,
  text: 'If the caster wins this round, the caster draws 2 rune cards. If they lose, lose 1 extra life.',
  play(g, me, p, entry) { entry.data.ownerId = me.id; },
});
def('restrain', {
  name: 'Restrain', tier: 4, kind: 'active', copies: 1, needs: ['player'],
  text: 'Caster chooses a player. They can\u2019t draw and use rune cards this round (except Destroy-type).',
  targetFilter: (g, me, t) => t.id !== me.id,
  play(g, me, params, entry) { entry.data.targetId = params.player; g.log(`${me.name} restrained ${g.player(params.player).name}.`); },
});
def('dread', {
  name: 'Dread', tier: 2, copies: 2, needs: ['player'],
  text: 'Forces a chosen player to draw a unit card.',
  targetFilter: (g, me, t) => t.id !== me.id,
  canPlay: (g) => needDeck(g),
  play(g, me, params) {
    const t = g.player(params.player);
    const c = g.drawUnit(t, {});
    g.log(`${me.name} forced ${t.name} to draw${c ? ` a ${c.value}` : ''}.`);
  },
});
def('disrupt', {
  name: 'Disrupt', tier: 2, copies: 2,
  text: 'All players discard one rune card at random.',
  play(g) {
    for (const p of g.alivePlayers()) g.discardRandomRune(p);
    g.log('Every player discarded a random rune.');
  },
});

// ----- Tier 3 (violet) -----------------------------------------------------
def('mischief', {
  name: 'Mischief', tier: 3, copies: 2, needs: ['ownActive'],
  text: 'Return one of your active rune cards to your hand.',
  canPlay: (g, me) => (g.state.active.some((a) => a.owner === me.id) ? null : 'You have no active runes.'),
  play(g, me, params) {
    const i = g.state.active.findIndex((a) => a.uid === params.ownActive);
    const [a] = g.state.active.splice(i, 1);
    me.runes.push({ uid: a.uid, runeId: a.runeId });
    g.log(`${me.name} took ${RUNES[a.runeId].name} back into their hand.`);
  },
});
def('stall', {
  name: 'Stall', tier: 3, kind: 'active', copies: 2,
  text: 'For the next 2 turns, no one can draw unit cards.',
  canPlay: (g) => (g.isStalled() ? 'Stall is already in effect.' : null),
  // turnsLeft counts down as each new turn begins; the rest of this turn plus the next 2 are covered.
  play(g, me, p, entry) { entry.data.ownerId = me.id; entry.data.expired = false; entry.data.turnsLeft = 3; },
});
def('vow', {
  name: 'Vow', tier: 3, kind: 'active', copies: 2,
  text: 'Caster automatically stands for 3 turns. Rune cards can\u2019t target caster.',
  play(g, me, p, entry) { entry.data.ownerId = me.id; entry.data.left = 3; g.announce(`${me.name} swore a Vow: they stand for their next 3 turns and can\u2019t be targeted.`); },
});
def('reset', {
  name: 'Reset', tier: 3, copies: 2,
  text: 'Discard your unit cards. Draw a new face-up and face-down card.',
  canPlay: (g) => needDeck(g, 2),
  play(g, me) {
    g.state.unitDiscard.push(...me.cards);
    me.cards = [];
    g.drawUnit(me, { faceDown: true });
    g.drawUnit(me, {});
    g.log(`${me.name} reset their hand.`);
  },
});
def('unity', {
  name: 'Unity', tier: 3, copies: 2,
  text: 'You draw 2 rune cards. Everyone else draws 1.',
  play(g, me) { for (const p of g.alivePlayers()) g.drawRune(p, p.id === me.id ? 2 : 1); g.log(`${me.name} drew 2 runes, everyone else drew 1.`); },
});
for (const n of [17, 24, 27]) {
  def(`target${n}`, {
    name: `New Target: ${n}`, tier: 3, kind: 'active', copies: 2, target: n,
    text: `Sets the win condition to exactly ${n} this round.`,
    play(g, me) { g.log(`${me.name} set the target to ${n}.`); },
  });
}
def('trade', {
  name: 'Trade', tier: 3, copies: 2, needs: ['player', 'ownRune'],
  text: 'Swap 1 rune card with a player of choice.',
  targetFilter: (g, me, t) => t.id !== me.id && t.runes.length > 0,
  canPlay: (g, me) => (me.runes.length > 1 ? null : 'You need another rune to trade.'),
  play(g, me, params) {
    const t = g.player(params.player);
    const mi = me.runes.findIndex((r) => r.uid === params.ownRune);
    const ti = g.rng.int(t.runes.length);
    [me.runes[mi], t.runes[ti]] = [t.runes[ti], me.runes[mi]];
    g.log(`${me.name} traded a rune with ${t.name}.`);
  },
});
def('helping_hand', {
  name: 'Helping Hand', tier: 3, kind: 'active', copies: 2, needs: ['player'],
  text: 'Caster chooses 1 player. If the chosen busts this round, caster takes half the penalty and they take the rest.',
  targetFilter: (g, me, t) => t.id !== me.id,
  play(g, me, params, entry) { entry.data.ownerId = me.id; entry.data.targetId = params.player; g.log(`${me.name} offered ${g.player(params.player).name} a helping hand.`); },
});
def('double_draw', {
  name: 'Double Draw', tier: 3, copies: 2,
  text: 'Your next draw gives you 2 unit cards. Choose 1 to keep.',
  canPlay: (g, me) => (me.doubleDraw ? 'Already active.' : null),
  play(g, me) { me.doubleDraw = true; g.log(`${me.name} will draw two on their next draw.`); },
});
def('prophecy', {
  name: 'Prophecy', tier: 3, copies: 2, needs: ['player'],
  text: 'Choose a player. They must reveal their face-down card.',
  targetFilter: (g, me, t) => t.id !== me.id && t.cards.some((c) => c.faceDown && !c.revealed),
  play(g, me, params) {
    const t = g.player(params.player);
    for (const c of t.cards) if (c.faceDown) c.revealed = true;
    const shown = t.cards.filter((c) => c.faceDown).map((c) => c.value).join(', ');
    g.log(`${me.name} forced ${t.name} to reveal: ${shown}.`);
  },
});

def('underdog', {
  name: 'Underdog', tier: 3, copies: 2,
  text: 'Player with the fewest lives, draw 2 rune cards.',
  play(g) {
    const alive = g.alivePlayers(), lives = alive.map((p) => p.lives), min = Math.min(...lives);
    if (Math.max(...lives) === min) { g.log('Underdog: everyone has the same lives, so nobody has the fewest.'); return; }
    const low = alive.filter((p) => p.lives === min);     // ties for fewest all count
    for (const p of low) g.drawRune(p, 2);
    g.announce(`${low.map((p) => p.name).join(' & ')} ${low.length > 1 ? 'have' : 'has'} the fewest lives: +2 runes.`);
  },
});
def('reverse', {
  name: 'Reverse', tier: 3, copies: 2,
  text: 'Reverse the turn direction. Once per round.',
  canPlay: (g) => (g.state.reversed ? 'Already reversed this round.' : g.alivePlayers().length < 3 ? 'Needs at least 3 players.' : null),
  play(g, me) { g.state.dir *= -1; g.state.reversed = true; g.announce(`${me.name} reversed the turn order.`); },
});

// ----- Tier 4 (special) ----------------------------------------------------
def('duel', {
  name: 'Duel', tier: 4, copies: 1, needs: ['player'],
  text: 'Challenge 1 player. Both reveal top deck card. Lower loses: discards a rune & skips next draw. Tie: nothing.',
  targetFilter: (g, me, t) => t.id !== me.id,
  canPlay: (g) => (deckLeft(g) < 2 ? 'Not enough unit cards left in the deck.' : null),
  play(g, me, params) {
    const t = g.player(params.player);
    g.ensureDeck(2);
    const deck = g.state.unitDeck;
    const mine = deck[deck.length - 1], theirs = deck[deck.length - 2];   // peeked, stay on the deck
    let msg = `Duel! ${me.name} reveals ${mine.value}, ${t.name} reveals ${theirs.value}.`;
    if (mine.value === theirs.value) msg += ' Tie \u2014 nothing happens.';
    else {
      const loser = mine.value < theirs.value ? me : t;
      loser.skipDraw = true;
      g.discardRandomRune(loser);
      msg += ` ${loser.name} loses: discards a rune and skips their next draw.`;
    }
    g.announce(msg);
  },
});
def('wrap', {
  name: 'Wrap', tier: 4, copies: 1,
  text: 'Everyone else takes one last turn, then the round ends. No rune cards can be played in that lap.',
  canPlay: (g, me) => (g.state.lastCall ? 'Wrap is already in effect.' : otherAlive(g, me).length ? null : 'No one left to wrap up.'),
  play(g, me) { g.state.lastCall = { callerId: me.id, started: false, left: 0 }; g.announce(`${me.name} played Wrap: everyone else gets one last turn, no runes.`); },
});
def('bless', {
  name: 'Bless', tier: 4, kind: 'active', copies: 1,
  text: 'No one drops below 1 life this round. Can be destroyed.',
  play(g, me) { g.announce(`${me.name} blessed the table: no one can drop below 1 life this round unless this is destroyed.`); },
});
def('exile', {
  name: 'Exile', tier: 4, kind: 'active', copies: 1,
  text: 'Players vote. Chosen skips next draw and discards a rune card. Caster is immune.',
  canPlay: (g, me) => (otherAlive(g, me).some((p) => !g.isVowed(p)) ? null : 'No one to exile.'),
  play(g, me, p, entry) { g.startVote(me, entry); },
});
def('jackpot', {
  name: 'Jackpot', tier: 4, copies: 1,
  text: 'Draw 3 rune cards. But lose 1 extra life.',
  play(g, me) {
    g.drawRune(me, 3);
    me.jackpotTax += 1;
    g.announce(`${me.name} hit the Jackpot: +3 runes, but loses 1 extra life at round end.`);
  },
});

// Build the shuffled rune deck contents.
const RARITY_KEY = { 1: 'rarityWhite', 2: 'rarityCyan', 3: 'rarityViolet', 4: 'raritySpecial' };
/** Rune ids for a fresh deck. `mult` scales every rune; `cfg.rarity*` scales each colour (0 = that colour is left out). */
export function buildRuneDeckList(mult = 1, cfg = {}) {
  const list = [];
  for (const r of Object.values(RUNES)) {
    const w = cfg[RARITY_KEY[r.tier]] ?? 1;
    if (!(w > 0)) continue;
    for (let i = 0, n = Math.max(1, Math.round(r.copies * mult * w)); i < n; i++) list.push(r.id);
  }
  return list;
}
