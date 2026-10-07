// ---------------------------------------------------------------------------
// TABLE OPTIONS: the data-driven settings that the lobby / start screen render and the
// server validates. One entry per option; add an entry (and a default in config.js) and it
// appears everywhere. (The older options, such as turn direction and twists, are wired in main.js.)
//
//   kind 'choice'  a few named values          values: [[value, label], ...]
//   kind 'steps'   a stepper over fixed values  values: [value, ...]  + fmt(value) -> label
//   online: true   only offered for online rooms (no meaning in single player)
// ---------------------------------------------------------------------------
const pct = (v) => (v == null ? 'Classic' : v === 0 ? 'Nobody' : Math.round(v * 100) + '%');

const rar = (v) => (v === 0 ? 'None' : '\u00d7' + v);

export const OPTIONS = [
  { key: 'lossFrac', label: 'Who loses lives', kind: 'steps', values: [null, 0, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1], fmt: pct,
    help: 'Classic: everyone but the closest loses the bet. A percentage: that share of the table (the worst ranked) loses it. Ties at the cutoff all lose; if everyone ties nobody loses.' },
  { key: 'lossRounding', label: 'Losers head count rounds', kind: 'choice', values: [['ceil', 'Up'], ['round', 'Nearest'], ['floor', 'Down']] },
  { key: 'lossTies', label: 'Tied at the cutoff', kind: 'choice', values: [['lose', 'All lose'], ['safe', 'All safe']] },
  { key: 'unitDeckScaling', label: 'Unit card deck size', kind: 'choice', values: [['scaled', 'Grows with table'], ['fixed', 'Fixed']] },
  { key: 'playersPerDeck', label: 'Players per extra unit set', kind: 'steps', values: [1, 2, 3, 4, 5], fmt: String },
  { key: 'unitCopies', label: 'Unit sets when fixed', kind: 'steps', values: [1, 2, 3, 4, 5, 6], fmt: String },
  { key: 'runeDeckMultiplier', label: 'Rune deck size', kind: 'steps', values: ['auto', 0.5, 1, 1.5, 2, 3], fmt: (v) => (v === 'auto' ? 'Auto' : '\u00d7' + v),
    help: 'Auto doubles the rune deck at 8 to 10 players.' },
  { key: 'rarityWhite', label: 'White rune rarity', kind: 'steps', values: [0, 0.5, 1, 1.5, 2, 3, 4], fmt: rar,
    help: 'How common each rune colour is in the deck. \u00d71 is the default; \u00d72 doubles the copies (drawn more often), \u00d70.5 halves them, None removes them.' },
  { key: 'rarityCyan', label: 'Cyan rune rarity', kind: 'steps', values: [0, 0.5, 1, 1.5, 2, 3, 4], fmt: rar },
  { key: 'rarityViolet', label: 'Violet rune rarity', kind: 'steps', values: [0, 0.5, 1, 1.5, 2, 3, 4], fmt: rar },
  { key: 'raritySpecial', label: 'Special rune rarity', kind: 'steps', values: [0, 0.5, 1, 1.5, 2, 3, 4], fmt: rar },
  { key: 'timeoutAction', label: 'If the turn timer runs out', kind: 'choice', values: [['stand', 'Stand'], ['lose', 'Lose the round']],
    help: 'Lose the round: that player gets no more turns this round and loses the bet. Only matters when a turn timer is set.' },
  { key: 'onDisconnect', label: 'If a player disconnects', kind: 'choice', online: true, values: [['eliminate', 'Eliminate'], ['bot', 'Computer takes over']] },
  { key: 'disconnectGraceSecs', label: 'Reconnect grace', kind: 'steps', online: true, values: [0, 5, 10, 20, 30, 60, 120], fmt: (v) => (v ? v + 's' : 'None') },
];
export const OPTION_KEYS = new Set(OPTIONS.map((o) => o.key));

/** Validate a value for an option (server side). Returns { ok, value }. Numbers are snapped to what the option allows. */
export function cleanOption(key, v) {
  const o = OPTIONS.find((x) => x.key === key);
  if (!o) return { ok: false };
  if (o.kind === 'choice') return o.values.some(([x]) => x === v) ? { ok: true, value: v } : { ok: false };
  if (v === null || v === 'auto') return o.values.includes(v) ? { ok: true, value: v } : { ok: false };
  if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false };
  const nums = o.values.filter((x) => typeof x === 'number');
  if (key === 'lossFrac') return { ok: true, value: Math.max(0, Math.min(1, Math.round(v * 100) / 100)) };   // any share, not only the listed steps
  const best = nums.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  return { ok: true, value: best };
}
