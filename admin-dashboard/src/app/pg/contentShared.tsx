"use client";
import { useEffect, useState } from 'react';
import { FIELD, PGHostel, PGRoom, pgRequest, roomTypeOptions } from './pgApi';

/** Room types of a PG (for linking photos and videos to a kind of room). */
export function useRoomTypes(pgId: string) {
  const [options, setOptions] = useState<{ key: string; label: string }[]>([]);
  useEffect(() => {
    let alive = true;
    pgRequest<PGRoom[]>(`/api/pg/${pgId}/rooms-all`)
      .then(rooms => { if (alive) setOptions(roomTypeOptions(Array.isArray(rooms) ? rooms : [])); })
      .catch(() => { if (alive) setOptions([]); });
    return () => { alive = false; };
  }, [pgId]);
  return options;
}

/** Save / discard row shared by the content panels. */
export function SaveBar({ dirty, saving, onSave, onDiscard, message, extra }: {
  dirty: boolean; saving: boolean; onSave: () => void; onDiscard: () => void;
  message: { kind: 'ok' | 'error'; text: string } | null; extra?: React.ReactNode;
}) {
  return (
    <div className="sticky bottom-0 -mx-6 mt-6 flex flex-wrap items-center gap-3 border-t border-line bg-surface px-6 py-4">
      {message && <span role={message.kind === 'error' ? 'alert' : 'status'} className={`mr-auto text-sm ${message.kind === 'error' ? 'text-danger-text' : 'text-success-text'}`}>{message.text}</span>}
      {!message && <span className="mr-auto text-xs text-fg-muted">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>}
      {extra}
      {dirty && <button type="button" disabled={saving} onClick={onDiscard} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg-muted hover:text-fg disabled:opacity-50">Discard</button>}
      <button type="button" disabled={!dirty || saving} onClick={onSave} className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-on-solid hover:bg-accent-hover disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
    </div>
  );
}

export const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// v2 section helpers (highlights, house rules, policies, safety, move-in, location, FAQ).
// The text rules mirror backend/utils/pgContent.js txt(): emoji dropped, whitespace collapsed,
// length capped, and no phone numbers (students reach staff through the Zenvy housing desk).
// ════════════════════════════════════════════════════════════════════════════════════════════════
export type PanelMessage = { kind: 'ok' | 'error'; text: string } | null;

/** Same pattern as backend PHONE_RE (any 8+ digit run, spaces and dashes allowed). */
export const PHONE_RE = /(?:\+?\d[\s().-]{0,2}){8,}/;
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2B00}-\u{2BFF}]/gu;
const CTRL_RE = /[\u0000-\u001F\u007F]/g;
const CTRL_KEEP_NL_RE = /[\u0000-\u0009\u000B-\u001F\u007F]/g;

/** One-line text as the backend stores it. */
export const oneLine = (s: string) => String(s ?? '').replace(EMOJI_RE, '').replace(CTRL_RE, ' ').replace(/\s+/g, ' ').trim();
/** Multi-line text as the backend stores it (at most one blank line in a row). */
export const multiLine = (s: string) => String(s ?? '').replace(EMOJI_RE, '').replace(/\r\n?/g, '\n')
  .replace(CTRL_KEEP_NL_RE, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

/** Length and phone-number check for already cleaned text. Same messages as the backend. */
export const textError = (s: string, max: number, field: string): string | null => {
  if (s.length > max) return `${field} must be at most ${max} characters.`;
  if (s && PHONE_RE.test(s)) return `${field}: phone numbers are not shown on listings. Students contact staff through the ZenWe housing desk.`;
  return null;
};
export const isBlank = (raw: string) => String(raw ?? '').trim() === '';
/** Whole number in range, or blank. */
export const intError = (raw: string, min: number, max: number, field: string): string | null => {
  if (isBlank(raw)) return null;
  const n = Number(raw);
  return !Number.isInteger(n) || n < min || n > max ? `${field} must be a whole number from ${min} to ${max}.` : null;
};
/** Rupee amount from 0 to max, or blank. */
export const amountError = (raw: string, max: number, field: string): string | null => {
  if (isBlank(raw)) return null;
  const n = Number(raw);
  return !Number.isFinite(n) || n < 0 || n > max ? `${field} must be an amount from ₹0 to ₹${max.toLocaleString('en-IN')}.` : null;
};
/** Number for the payload (blank or unreadable → undefined, so the key is left out). */
export const numOrUndefined = (raw: string, round = false): number | undefined => {
  if (isBlank(raw)) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return round ? Math.round(n) : n;
};
export const numText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** Drops empty values (same as backend compact()); undefined when nothing is left. */
export function compactObj<T extends object>(o: T): T | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length)) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? (out as T) : undefined;
}

export const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`;
export const ordinal = (n: number) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th'}`;
};
/** '20:00' → '8:00 PM'. */
export const time12 = (hhmm?: string | null) => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};
export function moveItem<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const j = index + dir;
  if (index < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}
let rowSeq = 0;
export const nextRowKey = (prefix = 'r') => `${prefix}${Date.now().toString(36)}${(rowSeq++).toString(36)}`;

/** `field` from a refused save (400 { code: 'INVALID_PG_CONTENT', field, message }). */
export const errorField = (e: unknown): string | null => {
  const f = e && typeof e === 'object' ? (e as { field?: unknown }).field : null;
  return typeof f === 'string' && f ? f : null;
};
/** Row index from a server field path like 'faq[2].q' or 'locationGuide.nearby[0].distanceM' (null when there is none). */
export const fieldIndex = (field: string | null, prefix: string): number | null => {
  if (!field || !field.startsWith(`${prefix}[`)) return null;
  const n = parseInt(field.slice(prefix.length + 1), 10);
  return Number.isInteger(n) ? n : null;
};

/**
 * Problems in a list of short lines (blank lines are dropped on save). Mirrors backend lines():
 * at most `max` items, each at most `len` characters, no repeats (ignoring case), no phone numbers.
 */
export function lineErrors(items: string[], field: string, { max, len, min = 0 }: { max: number; len: number; min?: number }) {
  const seen = new Set<string>();
  const rows = items.map(raw => {
    const s = oneLine(raw);
    if (!s) return null;
    const t = textError(s, len, field);
    if (t) return t;
    if (min && s.length < min) return `Use at least ${min} characters.`;
    const k = s.toLowerCase();
    if (seen.has(k)) return `${field}: "${s.slice(0, 40)}" is listed twice.`;
    seen.add(k);
    return null;
  });
  const count = items.filter(x => oneLine(x)).length;
  return { rows, list: count > max ? `${field}: at most ${max} items.` : null, count };
}
/** First problem in a line list, for the save check. */
export const firstLineError = (items: string[], field: string, opts: { max: number; len: number; min?: number }) => {
  const r = lineErrors(items, field, opts);
  return r.list || r.rows.find(Boolean) || null;
};
export const cleanLines = (items: string[]) => items.map(oneLine).filter(Boolean);

/** Editable list of short lines with reorder and remove. */
export function LineListEditor({ id, label, items, onChange, max, len, min, placeholder, field, numbered, addLabel = 'Add', highlightIndex, hideHeader }: {
  id: string; label: string; items: string[]; onChange: (items: string[]) => void; max: number; len: number; min?: number;
  placeholder?: string; field: string; numbered?: boolean; addLabel?: string; highlightIndex?: number | null; hideHeader?: boolean;
}) {
  const { rows, list, count } = lineErrors(items, field, { max, len, min });
  const noun = label.toLowerCase();
  return (
    <div className="space-y-2" role="group" aria-label={label}>
      {!hideHeader && (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-semibold text-fg-muted">{label}</span>
          <span className={`text-xs ${count > max ? 'text-danger-text' : 'text-fg-muted'}`}>{count} of {max}</span>
        </div>
      )}
      {items.length > 0 && (
        <ol className="space-y-1.5">
          {items.map((item, i) => {
            const bad = !!rows[i] || highlightIndex === i;
            return (
              <li key={`${id}-${i}`} className="space-y-1">
                <div className="flex items-center gap-2">
                  {numbered && <span className="w-5 shrink-0 text-right text-xs text-fg-muted" aria-hidden="true">{i + 1}.</span>}
                  <input
                    id={`${id}-${i}`} aria-label={`${label}, item ${i + 1}`} aria-invalid={bad} aria-describedby={rows[i] ? `${id}-${i}-err` : undefined}
                    className={`${FIELD} flex-1 ${bad ? 'border-danger/30' : ''}`} maxLength={len + 20} placeholder={placeholder} value={item}
                    onChange={e => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  <button type="button" disabled={i === 0} onClick={() => onChange(moveItem(items, i, -1))} aria-label={`Move ${noun} item ${i + 1} up`} className="rounded border border-line px-2 py-1 text-xs text-fg-muted hover:text-fg disabled:opacity-30">Up</button>
                  <button type="button" disabled={i === items.length - 1} onClick={() => onChange(moveItem(items, i, 1))} aria-label={`Move ${noun} item ${i + 1} down`} className="rounded border border-line px-2 py-1 text-xs text-fg-muted hover:text-fg disabled:opacity-30">Down</button>
                  <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${noun} item ${i + 1}`} className="px-1 text-xs text-danger-text hover:text-danger-text">Remove</button>
                </div>
                {rows[i] && <p id={`${id}-${i}-err`} className={`text-xs text-danger-text ${numbered ? 'pl-7' : ''}`}>{rows[i]}</p>}
              </li>
            );
          })}
        </ol>
      )}
      {list && <p className="text-xs text-danger-text">{list}</p>}
      <button type="button" disabled={items.length >= max} onClick={() => onChange([...items, ''])} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-2/60 disabled:opacity-40">{addLabel}</button>
    </div>
  );
}

/** Read-only summary of what students will see. */
export function AppPreview({ children, empty }: { children?: React.ReactNode; empty: boolean }) {
  return (
    <section aria-label="Preview in the app" className="rounded-xl border border-line bg-surface-2/60 p-4">
      <p className="mb-2 text-xs font-semibold text-fg-muted">Preview in the app</p>
      {empty ? <p className="text-sm text-fg-muted">Nothing to show. The app hides this section.</p> : <div className="space-y-2 text-sm text-fg">{children}</div>}
    </section>
  );
}

/**
 * Draft / save state for one v2 section (PUT /api/pg/:id/<path> { <field>: value }). Drafts are compared
 * through toValue, so whitespace-only edits do not count as changes. An empty value is sent as null and
 * the app hides the section. A refused save shows the server message and keeps its `field` in badField.
 */
export function useSectionEditor<D, V>({ pgId, path, field, source, toDraft, toValue, validate, readSaved, noun, onSaved }: {
  pgId: string; path: string; field: keyof PGHostel; source: V | null | undefined;
  toDraft: (v: V | null | undefined) => D; toValue: (d: D) => V | null; validate: (d: D) => string | null;
  /** The stored value from the save response (default: response[field], the section exactly as saved). */
  readSaved?: (saved: PGHostel, sent: V | null) => V | null | undefined;
  noun: string; onSaved: (patch: Partial<PGHostel>) => void;
}) {
  const [initial, setInitial] = useState<D>(() => toDraft(source));
  const [draft, setDraft] = useState<D>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<PanelMessage>(null);
  const [badField, setBadField] = useState<string | null>(null);
  const dirty = JSON.stringify(toValue(draft)) !== JSON.stringify(toValue(initial));

  const update = (fn: (d: D) => D) => { setMessage(null); setBadField(null); setDraft(prev => fn(prev)); };
  const discard = () => { setDraft(initial); setMessage(null); setBadField(null); };
  const save = async () => {
    if (saving) return;
    const invalid = validate(draft);
    if (invalid) { setMessage({ kind: 'error', text: invalid }); return; }
    const value = toValue(draft);
    setSaving(true);
    setMessage(null);
    setBadField(null);
    try {
      const saved = await pgRequest<PGHostel>(`/api/pg/${pgId}/${path}`, { method: 'PUT', body: JSON.stringify({ [field]: value }) });
      const raw = readSaved ? readSaved(saved, value) : (saved?.[field] as V | null | undefined);
      const stored = raw === null || raw === undefined || (Array.isArray(raw) && !raw.length) ? null : raw;
      const next = toDraft(stored);
      setInitial(next);
      setDraft(next);
      onSaved({ [field]: stored } as Partial<PGHostel>);
      setMessage({ kind: 'ok', text: stored === null ? `${noun} cleared. The app hides this section.` : `${noun} saved.` });
    } catch (e) {
      setBadField(errorField(e));
      setMessage({ kind: 'error', text: errorText(e, `Could not save the ${noun.toLowerCase()}.`) });
    } finally {
      setSaving(false);
    }
  };
  return { draft, update, dirty, saving, message, save, discard, badField };
}
