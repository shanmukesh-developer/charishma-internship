/**
 * Spelling-tolerant food search helpers for the search overlay (components/SearchOverlay).
 *
 * The server search (GET /api/users/search) is a plain "contains" match, so "biriyani" found nothing while menus say
 * "Biryani". The overlay therefore:
 *  1. normalises the query and asks the server for every common spelling of each word (alias table below),
 *  2. when that finds nothing, corrects each word to the closest real word on today's menus (small edit distance)
 *     and asks again,
 *  3. ranks what comes back: name starts with > name word > name contains > category / store > description only,
 *  4. on no results, offers "Did you mean …?" and popular searches, both taken from the loaded menus only.
 *
 * The menus come from the Home store list (GET /api/users/restaurants?fields=summary), read from the Home cache when
 * it is there; no extra data is invented.
 */
import { ENDPOINTS } from '../constants/api';
import { apiFetch } from './auth';
import { peekCache, readCache, RESTAURANTS_CACHE_KEY } from './swrCache';

/** Lower case, accents and punctuation dropped, single spaces. */
export const normalizeText = (s: any): string =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** No spaces at all: "pav bhaji" and "pavbhaji" compare equal. */
const compact = (s: string) => s.replace(/\s+/g, '');

/**
 * Common Indian food spellings. `search` = the spellings that really appear on menus (each is sent to the server;
 * one that contains another is dropped, since "contains" already covers it); `also` = other spellings people type.
 * The first `search` entry is the canonical word.
 */
const ALIAS_GROUPS: { search: string[]; also?: string[] }[] = [
  { search: ['biryani', 'biriyani', 'briyani'], also: ['biriani', 'biryani', 'biryanni', 'biriyani', 'beryani', 'bryani'] },
  { search: ['chicken'], also: ['chiken', 'chikken', 'chikan', 'chickan'] },
  { search: ['paneer', 'panner'], also: ['panir', 'paner', 'panneer'] },
  { search: ['gobi', 'cauliflower'], also: ['gobhi', 'gobi'] },
  { search: ['mutton', 'lamb'], also: ['muttan', 'matan'] },
  { search: ['prawn', 'shrimp'], also: ['prawns', 'shrimps', 'royyala', 'royya'] },
  { search: ['dosa'], also: ['dosai', 'dose', 'dhosa'] },
  { search: ['idli', 'idly'], also: ['idlli', 'iddly'] },
  { search: ['noodle'], also: ['noodles', 'nodles', 'noodels'] },
  { search: ['manchuria'], also: ['manchurian', 'manchurian'] },
  { search: ['chilli', 'chili', 'chilly'], also: ['chillie', 'chille'] },
  { search: ['maggi'], also: ['maggie', 'magi'] },
  { search: ['lassi'], also: ['lassie', 'lasi'] },
  { search: ['kheer'], also: ['keer', 'khir'] },
  // Groceries (QA 5 Nov): common student spellings.
  { search: ['biscuit'], also: ['biscuits', 'biscut', 'biscuts', 'biskut', 'buiscuit', 'bisket'] },
  { search: ['chocolate'], also: ['chocolates', 'choclate', 'chocolete', 'choco'] },
  { search: ['chips'], also: ['chip', 'chipps'] },
  { search: ['shampoo'], also: ['shampu', 'shampo', 'shampooo'] },
  { search: ['soap'], also: ['sope', 'soaps'] },
  { search: ['toothpaste'], also: ['tooth paste', 'toothpast', 'tothpaste'] },
  { search: ['curd', 'dahi', 'yogurt'], also: ['yoghurt', 'yogourt', 'perugu'] },
  { search: ['atta'], also: ['ata', 'aata', 'wheat flour'] },
  { search: ['detergent'], also: ['detergant', 'detergents', 'surf'] },
  { search: ['sanitary', 'pads'], also: ['sanitory', 'sanitery'] },
  { search: ['juice'], also: ['juices', 'jucie', 'jues', 'jus'] },
  { search: ['cold drink', 'soft drink', 'coke', 'pepsi'], also: ['colddrink', 'softdrink', 'cooldrink', 'cool drink'] },
  { search: ['pickle', 'achar', 'pachadi'], also: ['pikle', 'pickel', 'pickles', 'pikkle', 'achaar', 'aachar', 'oorugaya', 'avakaya'] },
  { search: ['tomato'], also: ['tomatos', 'tomatoes', 'tamato', 'tomoto', 'tamatar'] },
  { search: ['potato', 'aloo'], also: ['potatos', 'potatoes', 'alu', 'patato'] },
  { search: ['onion'], also: ['onions', 'onian', 'onoin', 'pyaz', 'ullipaya'] },
  { search: ['mango'], also: ['mangoes', 'mangos', 'mamidi'] },
  { search: ['banana'], also: ['bananas', 'banan', 'arati'] },
  { search: ['vegetable', 'veggies'], also: ['vegetables', 'vegitable', 'vegtable', 'vegitables', 'veggie'] },
  { search: ['fruit'], also: ['fruits', 'fruts', 'friut'] },
];

/** word -> the spellings to search for it */
const ALIAS: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const g of ALIAS_GROUPS) {
    // Drop a spelling that contains another one ("noodles" is covered by "noodle").
    const search = g.search.filter((w, i) => !g.search.some((o, j) => j !== i && o.length < w.length && w.includes(o)));
    for (const w of [...g.search, ...(g.also || [])]) m.set(w, search);
  }
  return m;
})();

/** Every way to spell one query word (canonical first). */
const spellingsOf = (word: string): string[] => ALIAS.get(word) || [word];

export interface QueryPlan {
  /** normalised query ("" when nothing searchable was typed) */
  norm: string;
  /** spellings per word */
  tokens: string[][];
  /** phrases to send to the server (canonical first, at most 4) */
  phrases: string[];
}

const MAX_PHRASES = 4;

export function buildQueryPlan(raw: string): QueryPlan {
  const norm = normalizeText(raw);
  const words = norm ? norm.split(' ') : [];
  const tokens = words.map(spellingsOf);
  // Canonical phrase first, then one word at a time swapped for its other spellings.
  const phrases: string[] = [];
  const push = (p: string) => { if (p && !phrases.includes(p) && phrases.length < MAX_PHRASES) phrases.push(p); };
  push(tokens.map((t) => t[0]).join(' '));
  tokens.forEach((opts, i) => {
    opts.slice(1).forEach((alt) => push(tokens.map((t, j) => (j === i ? alt : t[0])).join(' ')));
  });
  // (What was typed needs no request of its own: a word without aliases is sent as typed, and a misspelling with an
  // alias is covered by its real spellings.)
  return { norm, tokens, phrases };
}

/** Bounded Levenshtein distance: returns max + 1 as soon as it is clearly larger than max. */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

// ─── Menu corpus (the Home store list) ────────────────────────────────────────────────

export interface SearchCorpus {
  /** normalised word -> how many dishes / stores use it */
  vocab: Map<string, number>;
  /** normalised word -> the spelling shown to people (most common original casing) */
  display: Map<string, string>;
  /** 4-6 popular searches from the menus (dish words and categories), display spelling */
  popular: string[];
}

// Words that describe a portion or style, not a dish: never offered as a popular search.
const GENERIC = new Set([
  'with', 'and', 'the', 'for', 'special', 'spl', 'full', 'half', 'plate', 'plates', 'combo', 'meal', 'extra', 'large',
  'small', 'regular', 'medium', 'piece', 'pieces', 'pcs', 'boneless', 'family', 'pack', 'mini', 'single', 'double',
  'jumbo', 'veg', 'nonveg', 'non', 'style', 'house', 'item', 'items', 'other', 'others', 'new', 'add', 'ons', 'addon',
  'addons', 'quarter', 'portion', 'bowl', 'cup', 'glass', 'bottle', 'litre', 'liter', 'gram', 'grams', 'kg', 'ml',
  'main', 'course', 'menu', 'today', 'fresh', 'hot', 'cold', 'kitchen', 'restaurant', 'dhaba', 'cafe', 'store',
]);

const isWord = (w: string) => w.length >= 3 && /^[a-z]+$/.test(w);

function buildCorpus(stores: any[]): SearchCorpus {
  const vocab = new Map<string, number>();
  const casing = new Map<string, Map<string, number>>();
  const popularCount = new Map<string, number>();
  const note = (rawText: any, weight: number, forPopular: boolean) => {
    const original = String(rawText ?? '').replace(/\([^)]*\)/g, ' ');
    const seen = new Set<string>();
    for (const piece of original.split(/[^A-Za-z]+/)) {
      const w = normalizeText(piece);
      if (!isWord(w) || seen.has(w)) continue;
      seen.add(w);
      vocab.set(w, (vocab.get(w) || 0) + weight);
      const c = casing.get(w) || new Map<string, number>();
      c.set(piece, (c.get(piece) || 0) + 1);
      casing.set(w, c);
      if (forPopular && w.length >= 4 && !GENERIC.has(w)) popularCount.set(w, (popularCount.get(w) || 0) + weight);
    }
  };
  for (const r of stores) {
    if (!r || r.isActive === false || r.campusBookingEnabled === true) continue;
    note(r.name, 1, false);
    for (const m of Array.isArray(r.menu) ? r.menu : []) {
      if (!m || m.isAvailable === false) continue;
      note(m.name, 1, true);
      note(m.category, 1, true);
    }
  }
  const display = new Map<string, string>();
  casing.forEach((c, w) => {
    let best = w;
    let n = -1;
    c.forEach((count, spelling) => { if (count > n) { n = count; best = spelling; } });
    // Shown as a word, not shouted: "BIRYANI" -> "Biryani".
    display.set(w, best === best.toUpperCase() ? best.charAt(0) + best.slice(1).toLowerCase() : best.charAt(0).toUpperCase() + best.slice(1));
  });
  // Popular: used by at least two dishes, most used first, one per alias group (no "Biryani" and "Biriyani" both).
  const popular: string[] = [];
  const groups = new Set<string>();
  [...popularCount.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .some(([w]) => {
      // Singular and plural are one search (no "Dosa" and "Dosas" both).
      const group = spellingsOf(w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)[0];
      if (!groups.has(group)) {
        groups.add(group);
        popular.push(display.get(w) || w);
      }
      return popular.length >= 6;
    });
  return { vocab, display, popular };
}

let corpusCache: { at: number; source: any; corpus: SearchCorpus } | null = null;
let corpusLoad: Promise<SearchCorpus | null> | null = null;
const CORPUS_FRESH_MS = 5 * 60 * 1000;

/** The menus Home already loaded (memory / storage), else the same light list from the server. Null when unavailable. */
export function loadSearchCorpus(): Promise<SearchCorpus | null> {
  const mem = peekCache<any[]>(RESTAURANTS_CACHE_KEY);
  if (Array.isArray(mem) && mem.length) {
    if (!corpusCache || corpusCache.source !== mem) corpusCache = { at: Date.now(), source: mem, corpus: buildCorpus(mem) };
    return Promise.resolve(corpusCache.corpus);
  }
  if (corpusCache && Date.now() - corpusCache.at < CORPUS_FRESH_MS) return Promise.resolve(corpusCache.corpus);
  if (!corpusLoad) {
    corpusLoad = (async () => {
      try {
        const cached = await readCache<any[]>(RESTAURANTS_CACHE_KEY);
        let list: any[] | null = cached && Array.isArray(cached.data) && cached.data.length ? cached.data : null;
        if (!list) {
          const res = await apiFetch(`${ENDPOINTS.restaurants}?fields=summary`);
          const data = res.ok ? await res.json().catch(() => null) : null;
          list = Array.isArray(data) ? data : null;
        }
        if (!list) return null;
        corpusCache = { at: Date.now(), source: list, corpus: buildCorpus(list) };
        return corpusCache.corpus;
      } catch {
        return null;
      } finally {
        corpusLoad = null;
      }
    })();
  }
  return corpusLoad;
}

/**
 * The closest real menu word to `word`. strict (automatic correction): distance <= 1 for 5+ letters, <= 2 for 8+.
 * loose ("Did you mean"): <= 1 for 4+, <= 2 for 6+, <= 3 for 9+. Ties go to the more used word.
 */
function closestWord(word: string, corpus: SearchCorpus, mode: 'strict' | 'loose'): string | null {
  if (corpus.vocab.has(word) || ALIAS.has(word)) return null; // already a real word
  const len = word.length;
  const max = mode === 'strict'
    ? (len >= 8 ? 2 : len >= 5 ? 1 : 0)
    : (len >= 9 ? 3 : len >= 6 ? 2 : len >= 4 ? 1 : 0);
  if (!max) return null;
  let best: string | null = null;
  let bestD = max + 1;
  let bestN = -1;
  for (const [w, n] of corpus.vocab) {
    if (Math.abs(w.length - len) > max) continue;
    const d = editDistance(word, w, Math.min(max, bestD));
    if (d < bestD || (d === bestD && d <= max && n > bestN)) {
      best = w;
      bestD = d;
      bestN = n;
    }
  }
  return bestD <= max ? best : null;
}

/** The query with every unknown word replaced by its closest menu word; null when nothing changes. */
export function correctQuery(plan: QueryPlan, corpus: SearchCorpus, mode: 'strict' | 'loose'): { query: string; display: string } | null {
  if (!plan.norm) return null;
  let changed = false;
  const words = plan.norm.split(' ').map((w) => {
    const fix = closestWord(w, corpus, mode);
    if (fix && fix !== w) { changed = true; return fix; }
    return w;
  });
  if (!changed) return null;
  const query = words.join(' ');
  const display = words.map((w) => corpus.display.get(w) || w).join(' ');
  return { query, display };
}

// ─── Ranking ──────────────────────────────────────────────────────────────────────────

/** 0 starts with, 1 a word starts with it / every word matches, 2 contains, 9 no match. */
function textTier(text: any, plan: QueryPlan): number {
  const t = normalizeText(text);
  if (!t) return 9;
  const tc = compact(t);
  let tier = 9;
  for (const p of plan.phrases) {
    if (t.startsWith(p) || tc.startsWith(compact(p))) return 0;
    if (` ${t}`.includes(` ${p}`)) tier = Math.min(tier, 1);
    else if (t.includes(p) || tc.includes(compact(p))) tier = Math.min(tier, 2);
  }
  if (tier > 1 && plan.tokens.length > 1) {
    const words = t.split(' ');
    const all = plan.tokens.every((opts) => opts.some((o) => words.some((w) => w.startsWith(o))));
    if (all) tier = 1;
    else if (tier > 2 && plan.tokens.every((opts) => opts.some((o) => t.includes(o)))) tier = 2;
  }
  return tier;
}

/** Dishes: name (starts with > word > contains) above category / store name above description-only. */
export function rankItems<T = any>(items: T[], plan: QueryPlan): T[] {
  const score = (it: any) => {
    const nameTier = textTier(it?.name, plan);
    if (nameTier < 9) return nameTier;
    if (textTier(it?.category, plan) < 9) return 3;
    if (textTier(it?.restaurantId?.name, plan) < 9) return 4;
    if (textTier(it?.description, plan) < 9) return 5;
    return 6;
  };
  return items.map((it, i) => ({ it, i, s: score(it) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.it);
}

export function rankStores<T = any>(stores: T[], plan: QueryPlan): T[] {
  return stores
    .map((r: any, i) => ({ r, i, s: textTier(r?.name, plan) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.r as T);
}

/** Does this dish mention every query word (any spelling) in its name, category, store or description? */
export function matchesEveryWord(it: any, plan: QueryPlan): boolean {
  const hay = normalizeText([it?.name, it?.category, it?.restaurantId?.name, it?.description].filter(Boolean).join(' '));
  return plan.tokens.every((opts) => opts.some((o) => hay.includes(o)));
}

// ─── Store address -> locality ────────────────────────────────────────────────────────

const ADDRESS_TAIL = /^(india|andhra pradesh|ap|a p|telangana|ts|tamil nadu|karnataka|kerala|odisha)$/i;

/** "Shop 4, Near Gate, Neerukonda, Mangalagiri, Andhra Pradesh 522502" -> "Neerukonda, Mangalagiri". */
export function localityOf(location: any): string {
  const parts = String(location ?? '')
    .split(/[,\n]/)
    .map((p) => p.replace(/[-\s]*\b\d{3}\s?\d{3}\b\.?$/, '').replace(/\.$/, '').trim()) // pincode off the end
    .filter(Boolean);
  while (parts.length > 1 && ADDRESS_TAIL.test(parts[parts.length - 1])) parts.pop();
  return parts.slice(-2).join(', ');
}
