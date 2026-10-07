// Multiplayer end-to-end: real server, real WebSockets, 2 humans + 1 computer.
// Checks lobby rules, hidden-information, action validation, reconnect, and that a full game finishes.
import assert from 'node:assert/strict';
import WebSocket from 'ws';

process.env.SOLACE_AI_DELAY = '5'; process.env.SOLACE_RUNE_PAUSE = '0'; process.env.SOLACE_DROP_MS = '100'; process.env.SOLACE_TURN_MS = '600000';
const { start } = await import('../server.js');
const server = await start(0);
const URL = `ws://localhost:${server.address().port}/ws`;

function client(name) {
  const c = { name, ws: new WebSocket(URL), lobby: null, view: null, errors: [], views: 0, auto: false };
  c.ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'lobby') c.lobby = m; else if (m.t === 'view') { c.view = m.view; c.views++; if (c.auto) play(c); } else if (m.t === 'error') c.errors.push(m.msg);
  });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.opened = new Promise((r) => c.ws.on('open', r));
  return c;
}
const until = async (fn, ms = 20000, what = 'condition') => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout: ' + what); await new Promise((r) => setTimeout(r, 10)); } };
function play(c) {                     // a simple human: draw under 15, otherwise stand; continue after each round
  const v = c.view;
  if (v.phase === 'turn' && v.legal.yourTurn) c.send({ t: 'act', action: { type: v.myTotal < 15 && v.legal.canDraw ? 'draw' : 'stand' } });
  else if (v.phase === 'roundEnd' && !v.ready.includes(v.you)) c.send({ t: 'act', action: { type: 'ready' } });
  else if (v.pending && v.pending.kind === 'vote' && v.pending.voters.includes(v.you) && !v.pending.voted.includes(v.you)) c.send({ t: 'act', action: { type: 'vote', target: v.pending.candidates[0] } });
  else if (v.pending && v.pending.kind === 'pick' && v.pending.cards) c.send({ t: 'act', action: { type: 'pick', cardUid: v.pending.cards[0].uid } });
}

const A = client('Alice'), B = client('Bob');
await Promise.all([A.opened, B.opened]);

// --- lobby
B.send({ t: 'join', name: 'Bob', code: 'ZZZZ' }); await until(() => B.errors.length, 2000, 'bad code error');
assert.match(B.errors[0], /No room/);
A.send({ t: 'create', name: 'Alice' }); await until(() => A.lobby, 2000, 'create');
const code = A.lobby.code; assert.match(code, /^[A-Z]{4}$/);
B.send({ t: 'join', name: 'Bob', code: code.toLowerCase() }); await until(() => B.lobby, 2000, 'join');
await until(() => A.lobby.players.length === 2, 2000, 'lobby broadcast');
B.send({ t: 'start' }); await until(() => B.errors.length > 1, 2000, 'non-host start'); assert.match(B.errors[1], /host/);
A.send({ t: 'addBot' }); A.send({ t: 'lives', value: 3 }); await until(() => A.lobby.players.length === 3 && A.lobby.lives === 3, 2000, 'bot + lives');
// --- table rules: host only, validated, shared with everyone, applied to the game
B.send({ t: 'rules', key: 'turnTimer', value: 5 }); await until(() => B.errors.length > 2, 2000, 'non-host rules'); assert.match(B.errors[2], /host/);
A.send({ t: 'rules', key: 'turnDirection', value: 'sideways' }); A.send({ t: 'rules', key: 'turnTimer', value: 'abc' });
await until(() => A.errors.length >= 2, 2000, 'invalid rules rejected');
A.send({ t: 'rules', key: 'turnDirection', value: 'ccw' }); A.send({ t: 'rules', key: 'turnTimer', value: 1 }); A.send({ t: 'rules', key: 'runeDrawChance', value: 0.5 });
await until(() => B.lobby.rules.turnDirection === 'ccw' && B.lobby.rules.turnTimer === 1 && B.lobby.rules.runeDrawChance === 0.5, 2000, 'rules broadcast');
A.send({ t: 'rules', key: 'lossFrac', value: 0.5 }); A.send({ t: 'rules', key: 'onDisconnect', value: 'bot' }); A.send({ t: 'rules', key: 'lossTies', value: 'nope' });
await until(() => B.lobby.rules.lossFrac === 0.5 && B.lobby.rules.onDisconnect === 'bot' && A.errors.length >= 3, 2000, 'new options validated and broadcast');   // this scenario tests the computer taking over; elimination is covered in engine tests
A.send({ t: 'start' }); await until(() => A.view && B.view, 3000, 'views');
assert.equal(A.view.config.lossFrac, 0.5);
assert.equal(A.view.dir, -1); assert.equal(A.view.config.turnDirection, 'ccw'); assert.ok(A.view.timer && A.view.timer.total === 1000, 'timer in view');
// idle humans are stood automatically when the timer runs out
const idle = [A, B].find((c) => c.view.turn === c.view.you);
if (idle) { const n = idle.view.log.length; await until(() => idle.view.turn !== idle.view.you || idle.view.log.length > n, 4000, 'auto-stand on timeout'); assert.ok(idle.view.log.some((l) => l.ev && l.ev.t === 'stand' && l.ev.pid === idle.view.you) || idle.view.turn !== idle.view.you); }


// --- hidden information: nobody sees another human's face-down card or rune hand
for (const [me, other] of [[A, B], [B, A]]) {
  assert.equal(me.view.you, me.lobby.you);
  const o = me.view.players.find((p) => p.id === other.view.you);
  assert.ok(o.cards.some((c) => c.faceDown && c.value === null), 'opponent face-down card hidden');
  assert.equal(o.runes, undefined, 'opponent rune hand hidden');
  assert.ok(me.view.players.find((p) => p.id === me.view.you).runes.length > 0, 'own runes visible');
}
// --- validation
const notMe = A.view.turn === A.view.you ? B : A;
notMe.send({ t: 'act', action: { type: 'draw' } }); await until(() => notMe.errors.length > (notMe === B ? 3 : 0), 2000, 'out-of-turn draw rejected');
A.send({ t: 'act', action: { type: 'debugGiveRune', runeId: 'bless' } }); await until(() => A.errors.some((e) => /Unknown action/.test(e)), 2000, 'debug action blocked');

// --- play on, reconnect Bob part-way, finish the game
A.auto = true; B.auto = true; play(A); play(B);
await until(() => B.views > 6, 15000, 'some play');
const token = B.lobby.token; B.auto = false; B.ws.terminate();
await new Promise((r) => setTimeout(r, 400));                       // longer than SOLACE_DROP_MS: the computer covers Bob
const B2 = client('Bob'); await B2.opened; B2.send({ t: 'rejoin', code, token }); B2.auto = true;
await until(() => B2.view, 3000, 'rejoin view'); assert.equal(B2.view.you, B.lobby.you, 'same seat after rejoin'); play(B2);
await until(() => A.view.phase === 'gameOver', 60000, 'game over');
assert.ok(A.view.winnerId, 'a winner'); assert.equal(B2.view.phase, 'gameOver');

// --- static files + safety
const get = (p) => fetch(`http://localhost:${server.address().port}${p}`);
assert.equal((await get('/')).status, 200); assert.equal((await get('/js/main.js')).status, 200);
for (const bad of ['/server.js', '/package.json', '/tests/net.test.mjs', '/../server.js', '/%2e%2e/server.js', '/node_modules/ws/package.json']) assert.equal((await get(bad)).status, 404, bad);
assert.equal((await get('/healthz')).status, 200);

console.log('net tests passed');
[A, B, B2].forEach((c) => c.ws.close()); server.close(); setTimeout(() => process.exit(0), 100);
