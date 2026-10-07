// Renders a card as an HTML string. Real art when available, placeholder otherwise.
import { RUNES } from '../engine/runes.js';
import { ART_BASE, UNIT_ART, UNIT_BACK, RUNE_BACK, RUNE_ART } from './assets.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ROMAN = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function roman(n) {
  let out = '';
  for (const [v, s] of [[30, 'XXX'], [20, 'XX'], ...ROMAN]) while (n >= v) { out += s; n -= v; }
  return out;
}

const SPECIAL = { duel: '#d9443f', wrap: '#f29a3c', restrain: '#9fc3cf', bless: '#f2d24a', exile: '#b98467', jackpot: '#3ddc84' };
const TIER = { 1: '#d9d2c3', 2: '#19c2c9', 3: '#8a6cf5', 4: '#d9b45a' };
export const runeAccent = (id) => SPECIAL[id] || TIER[RUNES[id].tier];

function src(spec) {
  if (spec.kind === 'unit') return UNIT_ART[spec.value];
  if (spec.kind === 'unit-back') return UNIT_BACK;
  if (spec.kind === 'rune-back') return RUNE_BACK;
  return RUNE_ART[spec.runeId];
}
function label(spec) {
  if (spec.kind === 'unit') return `Unit card ${spec.value}`;
  if (spec.kind === 'unit-back') return 'Face-down unit card';
  if (spec.kind === 'rune-back') return 'Rune card';
  return `Rune: ${RUNES[spec.runeId].name}`;
}

/** Placeholder face, used when art is missing. Pure CSS/HTML. */
export function placeholderHTML(spec) {
  if (spec.kind === 'unit') {
    return `<div class="ph ph-unit"><i class="c tl">${spec.value}</i><b>${roman(spec.value)}</b><i class="c br">${spec.value}</i></div>`;
  }
  if (spec.kind === 'unit-back') return '<div class="ph ph-back ph-unitback"><b>UNIT</b></div>';
  if (spec.kind === 'rune-back') return '<div class="ph ph-back ph-runeback"><b>RUNE</b></div>';
  const r = RUNES[spec.runeId];
  return `<div class="ph ph-rune" style="--accent:${runeAccent(spec.runeId)}"><em>${r.kind}</em><b>${esc(r.name)}</b><p>${esc(r.text)}</p></div>`;
}

// Called by <img onerror>. Swaps the broken image for the placeholder.
if (typeof window !== 'undefined') {
  window.__solaceArt = (img) => {
    const card = img.closest('.card');
    card.classList.add('noart');
    card.insertAdjacentHTML('afterbegin', placeholderHTML(JSON.parse(card.dataset.spec)));
    img.remove();
  };
}

/**
 * spec: { kind:'unit', value } | { kind:'unit-back' } | { kind:'rune', runeId } | { kind:'rune-back' }
 * opts: { cls, style, enter }
 */
export function cardHTML(spec, { cls = '', style = '', uid = null } = {}) {
  const file = src(spec);
  const specAttr = esc(JSON.stringify(spec));
  const img = file
    ? `<img src="${ART_BASE}${file}" alt="" draggable="false" onerror="window.__solaceArt&&window.__solaceArt(this)">`
    : placeholderHTML(spec);
  const face = spec.kind === 'unit' || spec.kind === 'rune' ? 'up' : 'down';
  const uidAttr = uid != null ? ` data-uid="${uid}"` : '';
  // Unit cards carry a plain number (the art uses roman numerals); hovering shows it larger.
  const num = spec.kind === 'unit' ? `<span class="unum" aria-hidden="true">${spec.value}</span>` : '';
  const tip = spec.kind === 'unit' ? ` title="${spec.value}"` : '';
  return `<div class="card ${cls}" role="img" aria-label="${esc(label(spec))}" data-spec="${specAttr}" data-face="${face}"${uidAttr}${tip} style="${style}">${img}${num}</div>`;
}
