// ---------------------------------------------------------------------------
// SOLACE SERVER: serves the game files and runs multiplayer rooms over WebSocket.
//
//   node server.js            (PORT env var respected; Render sets it)
//
// Each room owns one authoritative Game (js/engine). Clients send actions, the
// server validates them through game.dispatch and sends every player ONLY their
// own getView(), so face-down cards and rune hands are never leaked.
// Empty seats can be computer players. A player who drops and doesn't come back within the grace period is
// eliminated (default) or played by the computer until they return; the host chooses (config.onDisconnect).
// ---------------------------------------------------------------------------
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { LocalSession } from './js/engine/session.js';
import { DEFAULT_CONFIG } from './js/engine/config.js';
import { OPTIONS, OPTION_KEYS, cleanOption } from './js/engine/options.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const num = (k, d) => (process.env[k] != null ? Number(process.env[k]) : d);
const CFG = {
  aiDelay: num('SOLACE_AI_DELAY', 1000),        // ms between computer moves
  runePause: num('SOLACE_RUNE_PAUSE', 1600),    // computers wait while everyone sees a rune land (casts no longer take over the screen)
  turnSecs: num('SOLACE_TURN_MS', 60000) / 1000, // default turn timer for new rooms (the host can change it); idle humans are acted for
  dropMs: num('SOLACE_DROP_MS', 20000),         // a disconnected human is played by the computer after this
  roomIdleMs: num('SOLACE_ROOM_IDLE_MS', 10 * 60000),
  maxRooms: 200,
};
const BOT_NAMES = ['Mara', 'Odo', 'Ilsa', 'Bram', 'Wren', 'Sable', 'Quill', 'Tamsin', 'Fenn'];
const ALLOWED = new Set(['draw', 'stand', 'playRune', 'vote', 'pick', 'ready']);   // no debug actions from the network

// ------------------------------------------------------------------ static files
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
const PUBLIC_DIRS = new Set(['js', 'css', 'assets']);
function serve(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  const top = path.relative(ROOT, file).split(path.sep)[0];
  if (!file.startsWith(ROOT + path.sep) || !(top === 'index.html' || PUBLIC_DIRS.has(top))) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': ext === '.webp' ? 'public, max-age=86400' : 'no-cache', 'x-content-type-options': 'nosniff' });
    res.end(data);
  });
}

// ---------------------------------------------------------------------- rooms
const rooms = new Map();
const newCode = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I / O
  for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)]; if (!rooms.has(c)) return c; }
};
const cleanName = (n) => String(n ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14) || 'Player';
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

function lobbyMsg(room, seat) {
  return {
    t: 'lobby', code: room.code, you: seat.id, token: seat.token, hostId: room.hostId, started: !!room.session, lives: room.lives, rules: room.rules,
    players: room.seats.map((s) => ({ id: s.id, name: s.name, isAI: s.bot, connected: s.bot || !!s.ws, host: s.id === room.hostId })),
  };
}
function sendLobby(room) { for (const s of room.seats) if (!s.bot) send(s.ws, lobbyMsg(room, s)); }
function sendView(room, s) { if (room.session && !s.bot) send(s.ws, { t: 'view', view: room.session.game.getView(s.id) }); }
function sendViews(room) { room.seats.forEach((s) => sendView(room, s)); }
const touch = (room) => { room.last = Date.now(); };

function addSeat(room, name, bot) {
  const humans = room.seats.filter((s) => !s.bot).length, bots = room.seats.length - humans;
  const id = bot ? `ai${++room.botN}` : `h${++room.humanN}`;
  const seat = { id, name: bot ? BOT_NAMES[bots % BOT_NAMES.length] : cleanName(name), bot, token: bot ? null : randomBytes(12).toString('hex'), ws: null, dropT: 0 };
  room.seats.push(seat);
  return seat;
}
function removeSeat(room, seat) {
  room.seats = room.seats.filter((s) => s !== seat);
  if (!room.seats.some((s) => !s.bot)) return closeRoom(room);
  if (room.hostId === seat.id) room.hostId = room.seats.find((s) => !s.bot).id;
}
function closeRoom(room) {
  clearTimeout(room.pauseT);
  if (room.session) room.session.destroy();
  rooms.delete(room.code);
}

// ---------------------------------------------------------------- game wiring
function startGame(room) {
  const players = room.seats.map((s) => ({ id: s.id, name: s.name, isAI: s.bot }));
  room.session = new LocalSession({ players, aiDelay: CFG.aiDelay, config: { startingLives: room.lives, devMode: false, ...room.rules } });
  room.session.game.onChange(() => onGameChange(room));
  sendLobby(room); sendViews(room);
}
function onGameChange(room) {
  touch(room);
  const g = room.session.game, last = g.state.log[g.state.log.length - 1];
  if (last && last.ev && last.ev.t === 'rune' && last.id !== room.lastRune && CFG.runePause > 0) {   // let every screen play the cast before the computer moves
    room.lastRune = last.id; room.session.setPaused(true);
    clearTimeout(room.pauseT); room.pauseT = setTimeout(() => room.session && room.session.setPaused(false), CFG.runePause);
  }
  sendViews(room);
}
/** The table rule for a player who is gone (config.onDisconnect): knocked out of the game, or played by the computer until they come back. */
function dropSeat(room, seat, why) {
  const g = room.session && room.session.game; if (!g) return;
  if (g.state.config.onDisconnect === 'bot') return setBot(room, seat, true);
  g.eliminate(seat.id, why);
  room.session._schedule();
}
/** A human who stays disconnected is played by the computer until they come back. */
function setBot(room, seat, on) {
  const p = room.session && room.session.game.player(seat.id); if (!p) return;
  p.isAI = on;
  if (on && room.session.game.state.phase === 'roundEnd') room.session.game.dispatch(seat.id, { type: 'ready' });
  room.session._schedule();
}

// -------------------------------------------------------------------- sockets
function onMessage(ws, raw) {
  let m; try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m.t !== 'string') return;
  const ctx = ws.ctx;
  const fail = (msg) => send(ws, { t: 'error', msg });

  if (m.t === 'create' || m.t === 'join' || m.t === 'rejoin') {
    if (ctx) return fail('Already in a room.');
    if (m.t === 'create') {
      if (rooms.size >= CFG.maxRooms) return fail('Server is full. Try again later.');
      const room = { code: newCode(), seats: [], hostId: null, session: null, lives: 10, rules: { turnDirection: DEFAULT_CONFIG.turnDirection, showDirection: DEFAULT_CONFIG.showDirection, showLives: DEFAULT_CONFIG.showLives, showRuneCount: DEFAULT_CONFIG.showRuneCount, twistPreset: 'mild', runeHandLimit: DEFAULT_CONFIG.runeHandLimit, turnTimer: CFG.turnSecs, runeDrawChance: DEFAULT_CONFIG.runeDrawChance, ...Object.fromEntries(OPTIONS.map((o) => [o.key, DEFAULT_CONFIG[o.key]])), disconnectGraceSecs: CFG.dropMs / 1000 }, humanN: 0, botN: 0, last: Date.now() };
      rooms.set(room.code, room);
      const seat = addSeat(room, m.name, false); room.hostId = seat.id; return attach(ws, room, seat);
    }
    const room = rooms.get(String(m.code || '').toUpperCase());
    if (!room) return fail('No room with that code.');
    if (m.t === 'rejoin') {
      const seat = room.seats.find((s) => !s.bot && s.token && s.token === m.token);
      if (!seat) return fail('Could not rejoin that room.');
      return attach(ws, room, seat);
    }
    if (room.session) return fail('That game has already started.');
    if (room.seats.length >= DEFAULT_CONFIG.maxPlayers) return fail('That room is full.');
    return attach(ws, room, addSeat(room, m.name, false));
  }
  if (!ctx) return fail('Join a room first.');
  const { room, seat } = ctx;
  touch(room);
  switch (m.t) {
    case 'addBot': case 'removeBot': case 'lives': case 'rules': case 'start': {
      if (seat.id !== room.hostId) return fail('Only the host can do that.');
      if (room.session) return fail('The game has already started.');
      if (m.t === 'addBot') { if (room.seats.length < DEFAULT_CONFIG.maxPlayers) addSeat(room, '', true); }
      else if (m.t === 'removeBot') { const b = [...room.seats].reverse().find((s) => s.bot); if (b) removeSeat(room, b); }
      else if (m.t === 'rules') {
        const v = m.value;
        if (m.key === 'turnDirection' && ['cw', 'ccw', 'alternate'].includes(v)) room.rules.turnDirection = v;
        else if ((m.key === 'showDirection' || m.key === 'showLives' || m.key === 'showRuneCount') && typeof v === 'boolean') room.rules[m.key] = v;
        else if (m.key === 'twistPreset' && ['off', 'mild', 'wild', 'chaos'].includes(v)) room.rules.twistPreset = v;
        else if (m.key === 'runeHandLimit' && Number.isFinite(v)) room.rules.runeHandLimit = Math.max(2, Math.min(10, Math.round(v)));
        else if (m.key === 'turnTimer' && Number.isFinite(v)) room.rules.turnTimer = Math.max(0, Math.min(300, Math.round(v)));
        else if (m.key === 'runeDrawChance' && Number.isFinite(v)) room.rules.runeDrawChance = Math.max(0, Math.min(1, Math.round(v * 20) / 20));
        else if (OPTION_KEYS.has(m.key)) { const c = cleanOption(m.key, v); if (!c.ok) return fail('Invalid value.'); room.rules[m.key] = c.value; }
        else return fail('Unknown setting.');
      }
      else if (m.t === 'lives') room.lives = Math.max(3, Math.min(30, Math.round(Number(m.value)) || 10));
      else { if (room.seats.length < 2) return fail('You need at least 2 players. Add a computer player.'); return startGame(room); }
      return sendLobby(room);
    }
    case 'act': {
      if (!room.session) return fail('The game has not started.');
      const a = m.action;
      if (!a || typeof a !== 'object' || !ALLOWED.has(a.type)) return fail('Unknown action.');
      const res = room.session.game.dispatch(seat.id, a);
      if (!res.ok) fail(res.error);
      return;
    }
    case 'leave': return leave(ws, true);
    default:
  }
}
function attach(ws, room, seat) {
  if (seat.ws && seat.ws !== ws) { seat.ws.ctx = null; seat.ws.close(); }
  clearTimeout(seat.dropT);
  seat.ws = ws; ws.ctx = { room, seat };
  touch(room);
  if (room.session) setBot(room, seat, false);
  sendLobby(room); sendView(room, seat);
}
function leave(ws, explicit) {
  const ctx = ws.ctx; if (!ctx) return;
  const { room, seat } = ctx;
  ws.ctx = null; if (seat.ws === ws) seat.ws = null;
  if (!room.session) { removeSeat(room, seat); if (rooms.has(room.code)) sendLobby(room); return; }
  if (explicit) { seat.token = null; dropSeat(room, seat, 'left the game'); }
  else {
    clearTimeout(seat.dropT);
    const act = () => room.session && !seat.ws && dropSeat(room, seat, 'disconnected');
    const grace = (room.session.game.state.config.disconnectGraceSecs ?? CFG.dropMs / 1000) * 1000;
    if (grace <= 0) act(); else seat.dropT = setTimeout(act, grace);
  }
  sendLobby(room);
}

// ---------------------------------------------------------------------- boot
export function start(port = process.env.PORT || 8080) {
  const server = http.createServer(serve);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
  wss.on('connection', (ws) => {
    ws.isAlive = true; ws.ctx = null;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (d) => { try { onMessage(ws, d.toString()); } catch (e) { console.error(e); } });
    ws.on('close', () => leave(ws, false));
    ws.on('error', () => {});
  });
  const beat = setInterval(() => {                                   // drop dead sockets; free idle rooms
    wss.clients.forEach((ws) => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); });
    for (const r of rooms.values()) if (Date.now() - r.last > CFG.roomIdleMs && !r.seats.some((s) => s.ws)) closeRoom(r);
  }, 15000);
  server.on('close', () => { clearInterval(beat); rooms.forEach(closeRoom); });
  return new Promise((res) => server.listen(port, () => { console.log(`Solace on :${server.address().port}`); res(server); }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start();
