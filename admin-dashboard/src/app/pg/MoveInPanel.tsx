"use client";
import { PGHostel, PgMoveIn } from './pgApi';
import { AppPreview, LineListEditor, SaveBar, cleanLines, compactObj, firstLineError, oneLine, useSectionEditor } from './contentShared';

const PRESET_DOCS = [
  'College ID card',
  'Government ID copy (Aadhaar or similar)',
  'Two passport-size photos',
  'Parent or guardian details',
  'Admission letter or fee receipt',
];
const LIMITS = {
  documents: { max: 12, len: 80 },
  bring: { max: 15, len: 60 },
  provided: { max: 15, len: 60 },
  steps: { max: 8, len: 200 },
};

type Draft = { presets: string[]; otherDocs: string[]; bring: string[]; provided: string[]; steps: string[] };
const isPreset = (s: string) => PRESET_DOCS.find(p => p.toLowerCase() === oneLine(s).toLowerCase());

const toDraft = (v?: PgMoveIn | null): Draft => {
  const docs = (v?.documents || []).filter(s => typeof s === 'string');
  return {
    presets: PRESET_DOCS.filter(p => docs.some(x => isPreset(x) === p)),
    otherDocs: docs.filter(x => !isPreset(x)),
    bring: v?.bring || [], provided: v?.provided || [], steps: v?.steps || [],
  };
};
const documentsOf = (d: Draft) => [...PRESET_DOCS.filter(p => d.presets.includes(p)), ...d.otherDocs];
const toValue = (d: Draft): PgMoveIn | null => compactObj<PgMoveIn>({
  documents: cleanLines(documentsOf(d)), bring: cleanLines(d.bring), provided: cleanLines(d.provided), steps: cleanLines(d.steps),
}) || null;
// Field names as in backend validateMoveIn.
const validate = (d: Draft) => firstLineError(documentsOf(d), 'Documents', LIMITS.documents)
  || firstLineError(d.bring, 'What to bring', LIMITS.bring)
  || firstLineError(d.provided, 'Provided', LIMITS.provided)
  || firstLineError(d.steps, 'Move-in steps', LIMITS.steps);

/** Documents, what to bring, what the PG provides, and move-in day steps. */
export function MoveInPanel({ pg, onSaved }: { pg: PGHostel; onSaved: (pg: Partial<PGHostel>) => void }) {
  const ed = useSectionEditor<Draft, PgMoveIn>({ pgId: pg.id, path: 'move-in', field: 'moveIn', source: pg.moveIn, toDraft, toValue, validate, noun: 'Move-in details', onSaved });
  const d = ed.draft;
  const v = toValue(d);
  const docCount = cleanLines(documentsOf(d)).length;
  // A typed document that repeats a ticked one is only caught on the combined list.
  const docErr = firstLineError(d.otherDocs, 'Documents', { max: Math.max(0, LIMITS.documents.max - d.presets.length), len: LIMITS.documents.len })
    ? null : firstLineError(documentsOf(d), 'Documents', LIMITS.documents);

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">Shown under Moving in, inside Policies on the PG page. Leave blank to hide.</p>

      <fieldset className="space-y-3 rounded-xl border border-white/10 p-4">
        <legend className="px-1 text-sm font-bold text-blue-300">Documents needed</legend>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs text-gray-500">Tick the common ones and add any others.</p>
          <span className={`text-xs ${docCount > LIMITS.documents.max ? 'text-red-300' : 'text-gray-500'}`}>{docCount} of {LIMITS.documents.max}</span>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {PRESET_DOCS.map(p => (
            <label key={p} className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" className="h-4 w-4 accent-blue-500" checked={d.presets.includes(p)} onChange={e => ed.update(prev => ({ ...prev, presets: e.target.checked ? [...prev.presets, p] : prev.presets.filter(x => x !== p) }))} />
              {p}
            </label>
          ))}
        </div>
        <LineListEditor
          id="movein-docs" label="Other documents" hideHeader items={d.otherDocs} onChange={otherDocs => ed.update(prev => ({ ...prev, otherDocs }))}
          max={Math.max(0, LIMITS.documents.max - d.presets.length)} len={LIMITS.documents.len} field="Documents" addLabel="Add another" placeholder="e.g. Medical certificate"
        />
        {docErr && <p className="text-xs text-red-300">{docErr}</p>}
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        <fieldset className="space-y-3 rounded-xl border border-white/10 p-4">
          <legend className="px-1 text-sm font-bold text-blue-300">Bring with you</legend>
          <LineListEditor id="movein-bring" label="Bring with you" items={d.bring} onChange={bring => ed.update(prev => ({ ...prev, bring }))} {...LIMITS.bring} field="What to bring" addLabel="Add item" placeholder="e.g. Bedsheet and pillow cover" />
        </fieldset>
        <fieldset className="space-y-3 rounded-xl border border-white/10 p-4">
          <legend className="px-1 text-sm font-bold text-blue-300">Provided by the PG</legend>
          <LineListEditor id="movein-provided" label="Provided by the PG" items={d.provided} onChange={provided => ed.update(prev => ({ ...prev, provided }))} {...LIMITS.provided} field="Provided" addLabel="Add item" placeholder="e.g. Bed, mattress and study table" />
        </fieldset>
      </div>

      <fieldset className="space-y-3 rounded-xl border border-white/10 p-4">
        <legend className="px-1 text-sm font-bold text-blue-300">Steps on move-in day</legend>
        <LineListEditor id="movein-steps" label="Move-in steps" items={d.steps} onChange={steps => ed.update(prev => ({ ...prev, steps }))} {...LIMITS.steps} field="Move-in steps" numbered addLabel="Add step" placeholder="e.g. Show your booking in the app at the office" />
      </fieldset>

      <AppPreview empty={!v}>
        {v?.documents && <div><p className="font-semibold text-white">Documents</p><ul className="mt-1 list-disc pl-5 text-gray-300">{v.documents.map(x => <li key={x}>{x}</li>)}</ul></div>}
        {v?.bring && <div><p className="font-semibold text-white">Bring with you</p><ul className="mt-1 list-disc pl-5 text-gray-300">{v.bring.map(x => <li key={x}>{x}</li>)}</ul></div>}
        {v?.provided && <div><p className="font-semibold text-white">Provided by the PG</p><ul className="mt-1 list-disc pl-5 text-gray-300">{v.provided.map(x => <li key={x}>{x}</li>)}</ul></div>}
        {v?.steps && <div><p className="font-semibold text-white">Steps on move-in day</p><ol className="mt-1 list-decimal pl-5 text-gray-300">{v.steps.map(x => <li key={x}>{x}</li>)}</ol></div>}
      </AppPreview>
      <SaveBar dirty={ed.dirty} saving={ed.saving} message={ed.message} onSave={ed.save} onDiscard={ed.discard} />
    </div>
  );
}
