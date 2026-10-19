"use client";
import { MAX_HIGHLIGHTS, PGHostel } from './pgApi';
import { AppPreview, LineListEditor, SaveBar, cleanLines, fieldIndex, firstLineError, useSectionEditor } from './contentShared';

const LIMITS = { max: MAX_HIGHLIGHTS, len: 40, min: 3 };
const toDraft = (v?: string[] | null) => (Array.isArray(v) ? v.filter(s => typeof s === 'string') : []);
const toValue = (d: string[]) => { const out = cleanLines(d); return out.length ? out : null; };
const validate = (d: string[]) => firstLineError(d, 'Highlights', LIMITS);

/** Short highlight chips at the top of the PG page (about text and the Verified mark live on Details). */
export function OverviewPanel({ pg, onSaved }: { pg: PGHostel; onSaved: (pg: Partial<PGHostel>) => void }) {
  const ed = useSectionEditor<string[], string[]>({ pgId: pg.id, path: 'highlights', field: 'highlights', source: pg.highlights, toDraft, toValue, validate, noun: 'Highlights', onSaved });
  const shown = cleanLines(ed.draft);

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">Shown as highlights under Overview on the PG page. Leave blank to hide.</p>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-bold text-blue-300">Highlights</h3>
        <span className={`text-xs ${shown.length > MAX_HIGHLIGHTS ? 'text-red-300' : 'text-gray-400'}`} aria-live="polite">{shown.length} of {MAX_HIGHLIGHTS}</span>
      </div>
      <p className="text-xs text-gray-500">Short facts, 3 to 40 characters each, e.g. &quot;5 min walk to SRM gate&quot; or &quot;Home-style food&quot;.</p>
      <LineListEditor
        id="pg-highlights" label="Highlights" hideHeader items={ed.draft} onChange={items => ed.update(() => items)}
        max={LIMITS.max} len={LIMITS.len} min={LIMITS.min} field="Highlights" placeholder="e.g. 5 min walk to SRM gate" addLabel="Add highlight"
        highlightIndex={fieldIndex(ed.badField, 'highlights')}
      />
      <AppPreview empty={!shown.length}>
        <div className="flex flex-wrap gap-2">
          {shown.map(h => <span key={h} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-gray-200">{h}</span>)}
        </div>
      </AppPreview>
      <SaveBar dirty={ed.dirty} saving={ed.saving} message={ed.message} onSave={ed.save} onDiscard={ed.discard} />
    </div>
  );
}
