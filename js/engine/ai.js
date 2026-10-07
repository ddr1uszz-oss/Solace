// ---------------------------------------------------------------------------
// Simple AI for local testing. It only ever asks the Game for legal actions and
// sends them back through game.dispatch(), exactly like a remote player would.
// (It reads the full state, so it must run next to the Game, never in a client.)
// ---------------------------------------------------------------------------
import { RUNES } from './runes.js';
import { currentTarget, currentBet, cardTotal } from './rules.js';

const rk = (total, target) => (total > target ? 1000 + (total - target) : target - total);   // lower is better
const visTotal = (p) => p.cards.reduce((t, c) => t + (c.faceDown && !c.revealed ? 0 : c.value), 0);

/** The next action this AI wants to take, or null if it has nothing to do. */
export function nextAIAction(game, pid, rnd = Math.random) {
  const s = game.state, me = game.player(pid);
  if (!me || !me.alive || s.phase !== 'turn') return null;

  if (s.pending) {
    const pd = s.pending;
    if (pd.kind === 'vote' && pd.voters.includes(pid) && pd.votes[pid] == null) {
      const opts = pd.candidates.filter((id) => id !== pid);
      const pool = opts.length ? opts : pd.candidates;
      const strongest = pool.map((id) => game.player(id)).sort((a, b) => b.lives - a.lives)[0];
      return { type: 'vote', target: rnd() < 0.5 ? strongest.id : pool[Math.floor(rnd() * pool.length)] };
    }
    if (pd.kind === 'pick' && pd.playerId === pid) {
      const target = currentTarget(s), total = cardTotal(me);
      const best = [...pd.cards].sort((a, b) => rk(total + a.value, target) - rk(total + b.value, target))[0];
      return { type: 'pick', cardUid: best.uid };
    }
    return null;
  }
  if (s.turn !== pid) return null;

  const ctx = makeCtx(game, me);
  if (me.runesThisTurn < game.maxRunes()) {
    const choice = chooseRune(ctx, rnd);
    if (choice) return choice;
  }
  return { type: shouldDraw(ctx, rnd) ? 'draw' : 'stand' };
}

function makeCtx(game, me) {
  const s = game.state, target = currentTarget(s), total = cardTotal(me);
  return {
    game, s, me, target, total, room: target - total, bust: total > target, bet: currentBet(s),
    others: game.alivePlayers().filter((p) => p.id !== me.id),
  };
}

function shouldDraw(c, rnd) {
  const { game, s, me, room } = c;
  if (game.drawBlockReason(me)) return false;
  if (room <= 0) return false;
  if (room >= 11) return true;
  // Count what we can't see yet (own cards + others' face-up cards are known).
  const copies = game.deckCopies();
  const unseen = {};
  for (const v of s.config.unitValues) unseen[v] = copies;
  for (const p of game.alivePlayers()) {
    for (const k of p.cards) if (p.id === me.id || !k.faceDown || k.revealed) unseen[k.value]--;
  }
  let n = 0, bad = 0;
  for (const [v, cnt] of Object.entries(unseen)) { const q = Math.max(0, cnt); n += q; if (+v > room) bad += q; }
  if (!n) return false;
  const threshold = 0.38 + (rnd() - 0.5) * 0.12;
  return bad / n < threshold;
}

// Harm to me of an active rune sitting on the table (0..1), used by Rebuke/Retaliation.
function harm(c, a) {
  const { me, bust, room, target, total } = c;
  const r = a.runeId, d = a.data;
  if ((r === 'restrain' || r === 'curse') && d.targetId === me.id) return 0.9;
  if (RUNES[r].target) {
    // Would removing this target card help me? (Compare against the target without it.)
    const without = [...c.s.active].filter((x) => x.uid !== a.uid).reverse().find((x) => RUNES[x.runeId].target);
    const t2 = without ? RUNES[without.runeId].target : c.s.config.defaultTarget;
    return rk(total, t2) < rk(total, target) ? 0.75 : 0;
  }
  if (r === 'elevate' || r === 'elevate2' || r === 'gambit') return a.owner !== me.id && (bust || room >= 9) ? 0.55 : 0.05;
  if (r === 'stall') return a.owner !== me.id && room > 3 && !c.game.drawBlockReason(me) ? 0.4 : 0;
  if (r === 'wager' || r === 'helping_hand') return 0.05;
  if (r === 'bless') return a.owner !== me.id && !bust && room <= 3 ? 0.5 : 0;
  return 0;
}

function chooseRune(c, rnd) {
  const { game, me, others } = c;
  const options = [];
  for (const card of me.runes) {
    if (game.playableReason(me, card)) continue;
    const got = scoreRune(c, card);
    if (got && got.score > 0) options.push({ card, ...got });
  }
  options.sort((a, b) => b.score - a.score);
  for (const o of options) {
    if (rnd() >= o.score) continue;
    const steps = game._steps(me, o.card);
    const params = {};
    for (const st of steps) {
      const want = o.params && o.params[st.kind];
      params[st.kind] = st.options.some((x) => x.id === want) ? want : st.options[Math.floor(rnd() * st.options.length)].id;
    }
    return { type: 'playRune', runeUid: o.card.uid, params };
  }
  return null;
}

function leaderId(c, ids) {
  // The opponent who currently looks best (highest visible total that isn't over).
  const ps = ids.map((id) => c.game.player(id));
  ps.sort((a, b) => rk(visTotal(a), c.target) - rk(visTotal(b), c.target));
  return ps[0] && ps[0].id;
}

function scoreRune(c, card) {
  const { game, s, me, others, total, target, room, bust } = c;
  const id = card.runeId;
  const optIds = (kind) => game._steps(me, card).find((st) => st.kind === kind)?.options.map((o) => o.id) || [];
  const hot = !bust && room <= 3, cold = bust || room >= 9;

  switch (id) {
    case 'elevate': case 'elevate2': return { score: hot ? 0.75 : (!bust && room <= 6 ? 0.3 : 0.04) };
    case 'gambit': return { score: hot ? 0.8 : (!bust && room <= 6 ? 0.4 : 0.15) };
    case 'shield': case 'shield2': return { score: cold ? 0.6 : 0.08 };
    case 'bless': return { score: bust ? 0.75 : 0.12 };
    case 'wager': return { score: hot ? 0.6 : 0.03 };
    case 'target17': case 'target24': case 'target27': {
      const n = RUNES[id].target;
      if (n === target) return null;
      if (rk(total, n) < rk(total, target)) return { score: total === n ? 0.95 : 0.65 };
      return null;
    }
    case 'hush': return { score: !bust && room >= 6 ? 0.5 : 0 };
    case 'twin_draw': return { score: room >= 12 ? 0.6 : room >= 8 ? 0.25 : 0 };
    case 'double_draw': return { score: room >= 9 ? 0.5 : 0 };
    case 'rebuke': {
      const last = s.active[s.active.length - 1];
      return { score: last.owner === me.id ? 0 : harm(c, last) };
    }
    case 'retaliation': {
      let best = null;
      for (const a of s.active) { const h = a.owner === me.id ? 0 : harm(c, a); if (!best || h > best.h) best = { h, a }; }
      return best && best.h > 0.2 ? { score: best.h + 0.1, params: { active: best.a.uid } } : { score: 0.05 };
    }
    case 'return': {
      if (!bust) return null;
      const sorted = [...me.cards].sort((a, b) => rk(total - a.value, target) - rk(total - b.value, target));
      return rk(total - sorted[0].value, target) < rk(total, target) ? { score: 0.85, params: { ownCard: sorted[0].uid } } : null;
    }
    case 'remove': {
      if (bust && me.cards.length) {
        const last = me.cards[me.cards.length - 1];
        if (rk(total - last.value, target) < rk(total, target)) return { score: 0.85, params: { player: me.id } };
      }
      const ids = optIds('player').filter((x) => x !== me.id);
      return ids.length ? { score: 0.4, params: { player: leaderId(c, ids) } } : null;
    }
    case 'barter': {
      let best = null;
      const mine = me.cards[me.cards.length - 1];
      for (const o of others) {
        const theirs = o.cards[o.cards.length - 1];
        if (!theirs || (theirs.faceDown && !theirs.revealed)) continue;
        const gain = rk(total, target) - rk(total - mine.value + theirs.value, target);
        if (gain > 0 && (!best || gain > best.gain)) best = { gain, id: o.id };
      }
      return best ? { score: 0.8, params: { player: best.id } } : null;
    }
    case 'curse': return { score: bust ? 0.1 : 0.4, params: { player: leaderId(c, optIds('player')) } };
    case 'restrain': {
      const ids = optIds('player');
      const richest = ids.map((x) => game.player(x)).sort((a, b) => b.runes.length - a.runes.length)[0];
      return { score: 0.4, params: { player: richest && richest.id } };
    }
    case 'pickpocket': {
      const ids = optIds('player').map((x) => game.player(x)).sort((a, b) => b.runes.length - a.runes.length);
      return ids.length ? { score: 0.5, params: { player: ids[0].id } } : null;
    }
    case 'dread': {
      const risky = optIds('player').map((x) => game.player(x)).filter((p) => visTotal(p) >= target - 7 && visTotal(p) <= target);
      return risky.length ? { score: 0.55, params: { player: risky[0].id } } : null;
    }
    case 'disrupt': {
      const avg = others.reduce((t, p) => t + p.runes.length, 0) / Math.max(1, others.length);
      return { score: avg > me.runes.length ? 0.45 : 0.08 };
    }
    case 'mischief': {
      const mine = s.active.filter((a) => a.owner === me.id && (a.runeId === 'wager' || (a.runeId === 'vow' && bust)));
      return mine.length && bust ? { score: 0.7, params: { ownActive: mine[0].uid } } : null;
    }
    case 'stall': return { score: hot && room <= 2 ? 0.7 : 0.04 };
    case 'reset': return { score: bust ? 0.7 : room >= 12 ? 0.3 : 0 };
    case 'unity': return { score: 0.4 };
    case 'vow': return { score: hot ? 0.7 : 0.05 };
    case 'wrap': return { score: hot ? 0.45 : 0 };
    case 'underdog': { const l = game.alivePlayers().map((p) => p.lives); return { score: me.lives === Math.min(...l) && Math.max(...l) !== me.lives ? 0.9 : 0 }; }
    case 'reverse': return { score: 0.12 };
    case 'trade': return { score: 0.2 };
    case 'helping_hand': return { score: 0.2 };
    case 'prophecy': return { score: 0.35 };
    case 'duel': return { score: 0.3 };
    case 'exile': return { score: others.length >= 2 ? 0.3 : 0.1 };
    case 'jackpot': return { score: me.lives >= 5 ? 0.35 : 0 };
    default: return { score: 0.1 };
  }
}
