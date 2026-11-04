/**
 * C2: server-side bad-word filter for user-generated text (whispers, community posts, chat, groups,
 * lost & found, campus spots, polls, Friends content). Word lists live in data/contentFilterWords.json.
 *
 *   analyse(text) -> { action: 'allow'|'mask'|'block', text, matches: [{ term, severity }] }
 *     block = a severe term (identity slur, threat, "kill yourself"): the caller refuses with
 *             422 { code: 'CONTENT_BLOCKED' } (see rejectBlocked / cleanFields).
 *     mask  = milder profanity: `text` comes back with each matched word replaced by '*' (same length).
 *
 * Matching (Scunthorpe-safe): the text is split into tokens (letters / digits / leet symbols) and a
 * term only ever matches WHOLE tokens, never a piece of a word, so "class", "assignment", "Essex",
 * "cocktail", "Scunthorpe" and "shitake" pass. Each token is normalised first:
 *   - lower case, accents removed (NFKD), zero-width characters dropped;
 *   - leetspeak undone when the token has a letter (sh1t, @ss, f4ck, a$$);
 *   - letters drawn out 3+ times are collapsed (fuuuuck, shiiit);
 *   - runs of 1-2 letter tokens are joined (f u c k, f.u.c.k, fu ck) - only short pieces, so normal
 *     words next to each other ("as shown", "is hit") never join into a match;
 *   - multi-word phrases match across tokens with or without spaces (killyourself, i'll kill you).
 *
 * CONTENT_FILTER=off disables the filter (allow everything) without a deploy of new code.
 */
const path = require('path');

const LIST_PATH = path.join(__dirname, '..', 'data', 'contentFilterWords.json');

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };
const TOKEN_RE = /[\p{L}\p{M}\p{N}@$!|]+/gu;
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;

const BLOCK_MESSAGE = "That has words that aren't allowed on ZENV (slurs, threats or telling someone to hurt themselves). Please rephrase it and try again.";

const enabled = () => !['off', 'false', '0'].includes(String(process.env.CONTENT_FILTER || '').trim().toLowerCase());

/** Letters drawn out 3+ times become one ("fuuuck" -> "fuck"). */
const collapseLong = (s) => s.replace(/(.)\1{2,}/g, '$1');
/** Every repeat collapsed ("bullshit" -> "bulshit"); compared only against the same form of a term. */
const collapseAll = (s) => s.replace(/(.)\1+/g, '$1');

/** One token -> its comparable form (letters only). */
const normToken = (raw) => {
  let t = String(raw).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
  // Edge punctuation (!, |) is punctuation, not leetspeak: "fuck!" is "fuck", "sh!t" is "shit".
  t = t.replace(/^[!|]+|[!|]+$/g, '');
  if (/\p{L}/u.test(t)) t = t.replace(/[0134578@$!|]/g, (c) => LEET[c] || c);
  return t.replace(/[^\p{L}\p{N}]/gu, '');
};

const squashPhrase = (p) => String(p).toLowerCase().replace(/[^a-z0-9]+/g, '');

let compiled = null;
const compile = () => {
  if (compiled) return compiled;
  // Read once per process (require caches it; JSON edits ship with a deploy).
  const data = require(LIST_PATH);
  const suffixes = (data.suffixes || []).map((s) => String(s).toLowerCase());
  const exact = new Map(); // form -> { term, severity }
  const stems = []; // { stem, stemAll, term, severity }
  const phrases = []; // { sq, term, severity }
  const add = (severity, list) => {
    for (const raw of (list && list.words) || []) {
      const w = String(raw).toLowerCase().trim();
      if (!w) continue;
      const suffixable = w.endsWith('*');
      const base = suffixable ? w.slice(0, -1) : w;
      const entry = { term: base, severity };
      if (!exact.has(base) || severity === 'severe') exact.set(base, entry);
      if (suffixable) stems.push({ stem: base, stemAll: collapseAll(base), ...entry });
    }
    for (const raw of (list && list.phrases) || []) {
      const sq = squashPhrase(raw);
      if (sq.length >= 4) phrases.push({ sq, term: String(raw).toLowerCase(), severity });
    }
  };
  add('severe', data.severe);
  add('mild', data.mild);
  // Collapsed forms (only used when the token itself was drawn out), short terms excluded: "ass" -> "as".
  const exactAll = new Map();
  for (const [form, entry] of exact) {
    const c = collapseAll(form);
    if (c.length >= 3 && (!exactAll.has(c) || entry.severity === 'severe')) exactAll.set(c, entry);
  }
  const maxPhrase = phrases.reduce((m, p) => Math.max(m, p.sq.length), 0);
  compiled = { suffixes, exact, exactAll, stems, phrases, maxPhrase };
  return compiled;
};

/** Does one normalised form hit a word (exactly, or a suffixable stem + a known ending)? */
const lookupForm = (form, C, drawnOut) => {
  if (!form) return null;
  const hit = C.exact.get(form);
  if (hit) return hit;
  for (const s of C.stems) {
    if (form.length > s.stem.length && form.startsWith(s.stem) && C.suffixes.includes(form.slice(s.stem.length))) return s;
  }
  if (drawnOut) {
    const all = collapseAll(form);
    const h2 = C.exactAll.get(all);
    if (h2) return h2;
    for (const s of C.stems) {
      if (s.stemAll.length >= 3 && all.length > s.stemAll.length && all.startsWith(s.stemAll)
        && C.suffixes.some((x) => collapseAll(x) === all.slice(s.stemAll.length))) return s;
    }
  }
  return null;
};

const lookupToken = (tok, C) => {
  const n = tok.n;
  const drawn = /(.)\1{2,}/.test(n);
  return lookupForm(n, C, false) || (drawn ? lookupForm(collapseLong(n), C, true) : null);
};

/**
 * @param {string} text
 * @returns {{ action: 'allow'|'mask'|'block', text: string, matches: { term: string, severity: string }[] }}
 */
const analyse = (text) => {
  const original = typeof text === 'string' ? text : String(text == null ? '' : text);
  if (!original.trim() || !enabled()) return { action: 'allow', text: original, matches: [] };
  const C = compile();
  const src = original.replace(ZERO_WIDTH_RE, ' ');
  const tokens = [];
  for (const m of src.matchAll(TOKEN_RE)) {
    const n = normToken(m[0]);
    if (n) tokens.push({ start: m.index, end: m.index + m[0].length, n });
  }
  const matches = [];
  const maskSpans = [];
  let severe = false;
  const hit = (entry, from, to) => {
    matches.push({ term: entry.term, severity: entry.severity });
    if (entry.severity === 'severe') severe = true;
    for (let k = from; k <= to; k++) maskSpans.push(tokens[k]);
  };

  const covered = new Set();
  // 1. Phrases (and any word spelled across tokens): concatenations that start and end on token edges.
  if (C.phrases.length) {
    for (let i = 0; i < tokens.length; i++) {
      let acc = '';
      for (let j = i; j < tokens.length && acc.length < C.maxPhrase; j++) {
        acc += tokens[j].n;
        const p = C.phrases.find((x) => x.sq === acc || x.sq === collapseLong(acc));
        if (p) { hit(p, i, j); for (let k = i; k <= j; k++) covered.add(k); break; }
      }
    }
  }
  // 2. Single tokens.
  for (let i = 0; i < tokens.length; i++) {
    if (covered.has(i)) continue;
    const e = lookupToken(tokens[i], C);
    if (e) { hit(e, i, i); covered.add(i); }
  }
  // 3. Spaced-out letters: runs of 1-2 character tokens joined ("f u c k", "fu ck", "k y s").
  for (let i = 0; i < tokens.length; i++) {
    if (covered.has(i) || tokens[i].n.length > 2) continue;
    let acc = tokens[i].n;
    let best = null;
    for (let j = i + 1; j < tokens.length && tokens[j].n.length <= 2 && !covered.has(j) && acc.length < 40; j++) {
      acc += tokens[j].n;
      const e = lookupToken({ n: acc }, C);
      if (e) best = { e, j };
    }
    if (best) { hit(best.e, i, best.j); for (let k = i; k <= best.j; k++) covered.add(k); i = best.j; }
  }

  if (!matches.length) return { action: 'allow', text: original, matches: [] };
  if (severe) return { action: 'block', text: original, matches };
  // Token offsets are UTF-16 indexes (zero-width removal kept the length), so mask code units;
  // emoji and text outside the matched words stay untouched.
  const units = original.split('');
  for (const t of maskSpans) for (let k = t.start; k < t.end; k++) units[k] = '*';
  return { action: 'mask', text: units.join(''), matches };
};

/** Short form: true when the text must not be posted. */
const isBlocked = (text) => analyse(text).action === 'block';

/** The friendly 422 body every surface returns. */
const blockedBody = (field) => ({ code: 'CONTENT_BLOCKED', message: BLOCK_MESSAGE, ...(field ? { field } : {}) });

const rejectBlocked = (res, field) => res.status(422).json(blockedBody(field));

/**
 * Checks several text fields at once. Returns { blocked: false, values } with masked copies
 * (non-strings passed through), or { blocked: true, field } for the first severe field.
 */
const cleanFields = (fields) => {
  const values = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (typeof v !== 'string' || !v) { values[k] = v; continue; }
    const r = analyse(v);
    if (r.action === 'block') return { blocked: true, field: k, values: null };
    values[k] = r.text;
  }
  return { blocked: false, values };
};

/** For tests: forget the compiled lists. */
const _reset = () => { compiled = null; delete require.cache[require.resolve(LIST_PATH)]; };

module.exports = { analyse, isBlocked, cleanFields, rejectBlocked, blockedBody, BLOCK_MESSAGE, normToken, _reset };
