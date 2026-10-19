"use client";
import { useState } from 'react';
import { FIELD, HouseRuleGroup, MAX_RULES_PER_GROUP, PGHostel, RULE_CATEGORIES, RULE_CATEGORY_LABEL, RuleCategory } from './pgApi';
import { AppPreview, LineListEditor, SaveBar, cleanLines, fieldIndex, firstLineError, oneLine, useSectionEditor } from './contentShared';

type Draft = { category: RuleCategory; rules: string[] }[];
const order = (c: RuleCategory) => RULE_CATEGORIES.indexOf(c);
const sortGroups = <T extends { category: RuleCategory }>(g: T[]) => [...g].sort((a, b) => order(a.category) - order(b.category));

const toDraft = (v?: HouseRuleGroup[] | null): Draft => sortGroups((Array.isArray(v) ? v : [])
  .filter(g => g && RULE_CATEGORIES.includes(g.category) && Array.isArray(g.rules))
  .map(g => ({ category: g.category, rules: g.rules.filter(r => typeof r === 'string') })));
const toValue = (d: Draft): HouseRuleGroup[] | null => {
  const out = sortGroups(d).map(g => ({ category: g.category, rules: cleanLines(g.rules) })).filter(g => g.rules.length);
  return out.length ? out : null;
};
const validate = (d: Draft) => {
  for (const g of sortGroups(d)) {
    const e = firstLineError(g.rules, `${RULE_CATEGORY_LABEL[g.category]} rules`, { max: MAX_RULES_PER_GROUP, len: 160 });
    if (e) return e;
  }
  return null;
};
// The save response falls back to the legacy flat list when the groups are cleared; keep what was saved.
/** House rules grouped by category (shown under House rules on the PG page). */
export function RulesPanel({ pg, onSaved }: { pg: PGHostel; onSaved: (pg: Partial<PGHostel>) => void }) {
  const ed = useSectionEditor<Draft, HouseRuleGroup[]>({ pgId: pg.id, path: 'house-rules', field: 'houseRules', source: pg.houseRules, toDraft, toValue, validate, noun: 'House rules', onSaved });
  const used = new Set(ed.draft.map(g => g.category));
  const free = RULE_CATEGORIES.filter(c => !used.has(c));
  const [adding, setAdding] = useState<RuleCategory | ''>('');
  const pick = adding && !used.has(adding) ? adding : free[0] || '';
  const legacy = (pg.rules || []).map(oneLine).filter(Boolean);
  const showLegacy = legacy.length > 0 && !(pg.houseRules && pg.houseRules.length) && !ed.draft.some(g => g.category === 'other' && cleanLines(g.rules).length);
  const value = toValue(ed.draft) || [];
  const badIndex = fieldIndex(ed.badField, 'houseRules');
  const badCategory = badIndex !== null ? value[badIndex]?.category : null;

  const setRules = (category: RuleCategory, rules: string[]) => ed.update(d => d.map(g => (g.category === category ? { ...g, rules } : g)));
  const addGroup = (category: RuleCategory, rules: string[] = ['']) => ed.update(d => (d.some(g => g.category === category) ? d : sortGroups([...d, { category, rules }])));
  const moveLegacy = () => ed.update(d => {
    const other = d.find(g => g.category === 'other');
    if (!other) return sortGroups([...d, { category: 'other', rules: legacy }]);
    return d.map(g => (g.category === 'other' ? { ...g, rules: [...g.rules.filter(r => oneLine(r)), ...legacy] } : g));
  });

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">Shown under House rules on the PG page, grouped by category. Leave blank to hide.</p>

      {showLegacy && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4 text-sm">
          <p className="text-amber-200">This PG has {legacy.length} rule{legacy.length === 1 ? '' : 's'} from the older single list. Students see them under General until you save groups here.</p>
          <button type="button" onClick={moveLegacy} className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/10">Move the existing {legacy.length} rule{legacy.length === 1 ? '' : 's'} into Other</button>
        </div>
      )}

      {ed.draft.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-gray-400">No rule groups yet. Add a category below.</div>
      ) : (
        <div className="space-y-4">
          {ed.draft.map(g => (
            <fieldset key={g.category} className={`space-y-3 rounded-xl border p-4 ${badCategory === g.category ? 'border-red-500/50' : 'border-white/10'}`}>
              <legend className="px-1 text-sm font-bold text-blue-300">{RULE_CATEGORY_LABEL[g.category]}</legend>
              <LineListEditor
                id={`rules-${g.category}`} label={`${RULE_CATEGORY_LABEL[g.category]} rules`} items={g.rules} onChange={rules => setRules(g.category, rules)}
                max={MAX_RULES_PER_GROUP} len={160} field={`${RULE_CATEGORY_LABEL[g.category]} rules`} numbered addLabel="Add rule"
                placeholder="e.g. Visitors are allowed in the common area until 8:00 PM"
              />
              <div className="flex justify-end">
                <button type="button" onClick={() => ed.update(d => d.filter(x => x.category !== g.category))} className="text-xs text-red-300/80 hover:text-red-300">Remove {RULE_CATEGORY_LABEL[g.category]}</button>
              </div>
            </fieldset>
          ))}
        </div>
      )}

      {free.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="pg-rule-category" className="text-xs text-gray-400">Add category</label>
          <select id="pg-rule-category" className={`${FIELD} w-60`} value={pick} onChange={e => setAdding(e.target.value as RuleCategory)}>
            {free.map(c => <option key={c} value={c}>{RULE_CATEGORY_LABEL[c]}</option>)}
          </select>
          <button type="button" disabled={!pick} onClick={() => { if (pick) addGroup(pick); setAdding(''); }} className="rounded-lg bg-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-40">Add</button>
        </div>
      )}

      <AppPreview empty={!value.length}>
        {value.map(g => (
          <div key={g.category}>
            <p className="font-semibold text-white">{RULE_CATEGORY_LABEL[g.category]}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-gray-300">
              {g.rules.map(r => <li key={r}>{r}</li>)}
            </ul>
          </div>
        ))}
      </AppPreview>
      <SaveBar dirty={ed.dirty} saving={ed.saving} message={ed.message} onSave={ed.save} onDiscard={ed.discard} />
    </div>
  );
}
