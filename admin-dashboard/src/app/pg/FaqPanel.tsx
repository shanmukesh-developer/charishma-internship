"use client";
import { FIELD, MAX_FAQ, PGHostel, PgFaqItem } from './pgApi';
import { AppPreview, SaveBar, fieldIndex, moveItem, multiLine, nextRowKey, oneLine, textError, useSectionEditor } from './contentShared';

type Row = { key: string; id?: string; q: string; a: string };
const toDraft = (v?: PgFaqItem[] | null): Row[] => (Array.isArray(v) ? v : []).map(f => ({ key: f.id || nextRowKey('f'), id: f.id, q: f.q || '', a: f.a || '' }));
const filled = (d: Row[]) => d.filter(r => oneLine(r.q) || multiLine(r.a));
const toValue = (d: Row[]): PgFaqItem[] | null => {
  const out = filled(d).map(r => ({ ...(r.id ? { id: r.id } : {}), q: oneLine(r.q), a: multiLine(r.a) }));
  return out.length ? out : null;
};
// Same checks and messages as backend validateFaq (rows are numbered as admins see them).
const rowErrors = (d: Row[]) => {
  const seen = new Set<string>();
  return d.map((r, i) => {
    const q = oneLine(r.q);
    const a = multiLine(r.a);
    if (!q && !a) return null;
    const e = textError(q, 160, `Question ${i + 1}`) || textError(a, 800, `Answer ${i + 1}`);
    if (e) return e;
    if (!q) return `Question ${i + 1}: write the question.`;
    if (!a) return `"${q.slice(0, 40)}": write the answer.`;
    const k = q.toLowerCase();
    if (seen.has(k)) return `"${q.slice(0, 40)}" is asked twice.`;
    seen.add(k);
    return null;
  });
};
const validate = (d: Row[]) => (filled(d).length > MAX_FAQ ? `faq: at most ${MAX_FAQ} items.` : rowErrors(d).find(Boolean) || null);

/** Questions students ask before booking, in the order shown. */
export function FaqPanel({ pg, onSaved }: { pg: PGHostel; onSaved: (pg: Partial<PGHostel>) => void }) {
  const ed = useSectionEditor<Row[], PgFaqItem[]>({ pgId: pg.id, path: 'faq', field: 'faq', source: pg.faq, toDraft, toValue, validate, noun: 'FAQ', onSaved });
  const rows = ed.draft;
  const errors = rowErrors(rows);
  const v = toValue(rows);
  const badIndex = fieldIndex(ed.badField, 'faq');
  const badKey = badIndex !== null ? filled(rows)[badIndex]?.key : null;
  const setRow = (key: string, patch: Partial<Row>) => ed.update(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs text-fg-muted">Shown under FAQ on the PG page, in this order. Leave blank to hide.</p>
          <p className="mt-1 text-sm text-fg-muted">{filled(rows).length} of {MAX_FAQ} questions</p>
        </div>
        <button type="button" disabled={rows.length >= MAX_FAQ} onClick={() => ed.update(prev => [...prev, { key: nextRowKey('f'), q: '', a: '' }])} className="rounded-lg bg-surface-2 px-4 py-2.5 text-sm font-semibold text-fg hover:bg-surface-3 disabled:opacity-40">Add question</button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-fg-muted">No questions yet.</div>
      ) : (
        <ol className="space-y-3">
          {rows.map((r, i) => {
            const bad = !!errors[i] || badKey === r.key;
            return (
              <li key={r.key} className={`space-y-2 rounded-xl border p-4 ${bad ? 'border-danger/30' : 'border-line'}`}>
                <input aria-label={`Question ${i + 1}`} aria-invalid={bad} className={FIELD} maxLength={180} placeholder="Question, e.g. Is there a curfew for girls?" value={r.q} onChange={e => setRow(r.key, { q: e.target.value })} />
                <textarea aria-label={`Answer ${i + 1}`} rows={3} maxLength={900} className={`${FIELD} resize-y`} placeholder="Answer" value={r.a} onChange={e => setRow(r.key, { a: e.target.value })} />
                {errors[i] && <p className="text-xs text-danger-text">{errors[i]}</p>}
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="text-fg-subtle">#{i + 1}</span>
                  <button type="button" disabled={i === 0} onClick={() => ed.update(prev => moveItem(prev, i, -1))} aria-label={`Move question ${i + 1} up`} className="rounded border border-line px-2 py-1 text-fg-muted hover:text-fg disabled:opacity-30">Move up</button>
                  <button type="button" disabled={i === rows.length - 1} onClick={() => ed.update(prev => moveItem(prev, i, 1))} aria-label={`Move question ${i + 1} down`} className="rounded border border-line px-2 py-1 text-fg-muted hover:text-fg disabled:opacity-30">Move down</button>
                  <span className="text-fg-subtle">{oneLine(r.q).length}/160 · {multiLine(r.a).length}/800</span>
                  <button type="button" onClick={() => ed.update(prev => prev.filter(x => x.key !== r.key))} aria-label={`Remove question ${i + 1}`} className="ml-auto text-danger-text hover:text-danger-text">Remove</button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <AppPreview empty={!v}>
        {v?.map(f => (
          <div key={f.id || f.q}>
            <p className="font-semibold text-fg">{f.q}</p>
            <p className="whitespace-pre-line text-fg-muted">{f.a}</p>
          </div>
        ))}
      </AppPreview>
      <SaveBar dirty={ed.dirty} saving={ed.saving} message={ed.message} onSave={ed.save} onDiscard={ed.discard} />
    </div>
  );
}
