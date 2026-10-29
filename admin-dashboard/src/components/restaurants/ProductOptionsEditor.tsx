"use client";
import { useMemo, useState } from 'react';
import { Button, INPUT, MenuButton, Toggle, cx, FOCUS_RING } from './ui';

/*
 * Editor for a product's customer choices (`specs.options`) and its ordered details (`specs.details`).
 * Contract: docs/PRODUCT_OPTIONS.md. Limits below mirror backend/utils/productOptions.js normalizeOptions.
 */

export type OptionType = 'variant' | 'single' | 'multi' | 'text';

export interface ChoiceDraft { key: string; label: string; price: string; mrp?: string; isDefault?: boolean }
export interface GroupDraft {
  key: string;
  name: string;
  type: OptionType;
  required: boolean;
  max: string;
  maxLength: string;
  choices: ChoiceDraft[];
}
export interface DetailDraft { key: string; label: string; value: string }

export const LIMITS = {
  groups: 8,
  choices: 20,
  groupName: 30,
  choiceLabel: 30,
  details: 20,
  detailLabel: 30,
  detailValue: 200,
  maxPrice: 100000,
  textMaxLength: 100,
  textDefault: 40,
} as const;

const TYPE_LABEL: Record<OptionType, string> = {
  variant: 'Weight / size (full prices)',
  single: 'Pick one (extra price)',
  multi: 'Pick many (extra price)',
  text: 'Text the customer types',
};

let seq = 0;
const newKey = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`;
const blankChoice = (): ChoiceDraft => ({ key: newKey(), label: '', price: '' });

// ─── Loading stored values ──────────────────────────────────────────────────
const asArray = (v: unknown): unknown[] => {
  if (typeof v === 'string') { try { return asArray(JSON.parse(v)); } catch { return []; } }
  return Array.isArray(v) ? v : [];
};
const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export function groupsFromSpecs(specs: Record<string, unknown>): GroupDraft[] {
  return asArray(specs.options).map(raw => {
    const g = asObj(raw);
    const type: OptionType = g.type === 'variant' || g.type === 'single' || g.type === 'multi' || g.type === 'text' ? g.type : 'single';
    return {
      key: newKey(),
      name: str(g.name),
      type,
      required: type === 'variant' ? true : !!g.required,
      max: g.max !== undefined && g.max !== null ? str(g.max) : '',
      maxLength: g.maxLength !== undefined && g.maxLength !== null ? str(g.maxLength) : String(LIMITS.textDefault),
      choices: asArray(g.choices).map(c => {
        const o = asObj(c);
        return {
          key: newKey(), label: str(o.label), price: o.price !== undefined && o.price !== null ? str(o.price) : '', mrp: o.mrp !== undefined && o.mrp !== null ? str(o.mrp) : '',
          ...(type === 'variant' && o.isDefault === true ? { isDefault: true } : {}),
        };
      }),
    };
  });
}

export function detailsFromSpecs(specs: Record<string, unknown>): DetailDraft[] {
  return asArray(specs.details).map(raw => {
    const d = asObj(raw);
    return { key: newKey(), label: str(d.label), value: str(d.value) };
  });
}

// ─── Validation ─────────────────────────────────────────────────────────────
/** Error keys: `g:<groupKey>:name|choices|max|maxLength`, `c:<choiceKey>:label|price`, `d:<detailKey>:label|value`, `options`, `details`. */
export type OptionErrors = Record<string, string>;

const PRICE_RE = /^\d+(\.\d{1,2})?$/;
const isBlankChoice = (g: GroupDraft, c: ChoiceDraft) => !c.label.trim() && (!c.price.trim() || (g.type !== 'variant' && Number(c.price) === 0));
const isBlankDetail = (d: DetailDraft) => !d.label.trim() && !d.value.trim();

function priceError(raw: string, variant: boolean): string | null {
  const s = raw.trim();
  if (!s) return variant ? 'Enter the full price.' : null; // an empty extra means ₹0
  if (!PRICE_RE.test(s)) return 'Use a number like 20 or 20.50.';
  const n = Number(s);
  if (variant && n <= 0) return 'Must be more than ₹0.';
  if (n > LIMITS.maxPrice) return 'At most ₹1,00,000.';
  return null;
}

export function validateOptions(groups: GroupDraft[], details: DetailDraft[]): OptionErrors {
  const e: OptionErrors = {};
  if (groups.length > LIMITS.groups) e.options = `At most ${LIMITS.groups} choice groups.`;
  if (groups.filter(g => g.type === 'variant').length > 1) e.options = 'Only one Weight / size group is allowed.';

  const names = new Set<string>();
  for (const g of groups) {
    const name = g.name.trim();
    if (!name) e[`g:${g.key}:name`] = 'Name this group.';
    else if (name.length > LIMITS.groupName) e[`g:${g.key}:name`] = `At most ${LIMITS.groupName} characters.`;
    else if (names.has(name.toLowerCase())) e[`g:${g.key}:name`] = 'Another group already has this name.';
    names.add(name.toLowerCase());

    if (g.type === 'text') {
      const s = g.maxLength.trim();
      const n = Number(s);
      if (s && (!Number.isInteger(n) || n < 1 || n > LIMITS.textMaxLength)) e[`g:${g.key}:maxLength`] = `A whole number from 1 to ${LIMITS.textMaxLength}.`;
      continue;
    }

    const choices = g.choices.filter(c => !isBlankChoice(g, c));
    if (!choices.length) e[`g:${g.key}:choices`] = 'Add at least one choice.';
    else if (choices.length > LIMITS.choices) e[`g:${g.key}:choices`] = `At most ${LIMITS.choices} choices.`;
    const labels = new Set<string>();
    for (const c of choices) {
      const label = c.label.trim();
      if (!label) e[`c:${c.key}:label`] = 'Enter a label.';
      else if (label.length > LIMITS.choiceLabel) e[`c:${c.key}:label`] = `At most ${LIMITS.choiceLabel} characters.`;
      else if (labels.has(label.toLowerCase())) e[`c:${c.key}:label`] = 'Already in this group.';
      labels.add(label.toLowerCase());
      const pe = priceError(c.price, g.type === 'variant');
      if (pe) e[`c:${c.key}:price`] = pe;
      // Weight / size: optional MRP for that weight, never below its price.
      if (g.type === 'variant' && (c.mrp || '').trim()) {
        const m = Number((c.mrp || '').trim());
        if (!PRICE_RE.test((c.mrp || '').trim()) || !(m > 0) || m > LIMITS.maxPrice) e[`c:${c.key}:mrp`] = 'Enter a valid MRP or leave it empty.';
        else if (!pe && m < Number(c.price)) e[`c:${c.key}:mrp`] = 'MRP cannot be lower than the price.';
      }
    }

    if (g.type === 'multi' && g.max.trim()) {
      const n = Number(g.max.trim());
      if (!Number.isInteger(n) || n < 1) e[`g:${g.key}:max`] = 'A whole number, 1 or more.';
    }
  }

  const rows = details.filter(d => !isBlankDetail(d));
  if (rows.length > LIMITS.details) e.details = `At most ${LIMITS.details} details.`;
  for (const d of rows) {
    const label = d.label.trim(); const value = d.value.trim();
    if (!label) e[`d:${d.key}:label`] = 'Enter a label.';
    else if (label.length > LIMITS.detailLabel) e[`d:${d.key}:label`] = `At most ${LIMITS.detailLabel} characters.`;
    if (!value) e[`d:${d.key}:value`] = 'Enter a value.';
    else if (value.length > LIMITS.detailValue) e[`d:${d.key}:value`] = `At most ${LIMITS.detailValue} characters.`;
  }
  return e;
}

// ─── Saving ─────────────────────────────────────────────────────────────────
const toRupees = (s: string) => Math.round((Number(s.trim()) || 0) * 100) / 100;

/** `specs.options` payload: the array in the admin's order, or null to remove options. Call only after validateOptions passes. */
export function serializeOptions(groups: GroupDraft[]): unknown[] | null {
  if (!groups.length) return null;
  return groups.map(g => {
    const name = g.name.trim();
    if (g.type === 'text') {
      const n = Number(g.maxLength.trim());
      return { name, type: 'text', required: g.required, maxLength: g.maxLength.trim() && Number.isInteger(n) ? n : LIMITS.textDefault };
    }
    const kept = g.choices.filter(c => !isBlankChoice(g, c));
    // Weight / size: the one the app pre-selects and lists show (at most one; none = the first listed).
    const defaultKey = g.type === 'variant' ? kept.find(c => c.isDefault)?.key : undefined;
    const choices = kept.map(c => ({
      label: c.label.trim(),
      price: toRupees(c.price),
      ...(g.type === 'variant' && (c.mrp || '').trim() ? { mrp: toRupees(c.mrp || '') } : {}),
      ...(c.key === defaultKey ? { isDefault: true } : {}),
    }));
    if (g.type === 'variant') return { name, type: 'variant', choices };
    if (g.type === 'single') return { name, type: 'single', required: g.required, choices };
    return { name, type: 'multi', ...(g.max.trim() ? { max: Number(g.max.trim()) } : {}), choices };
  });
}

/** `specs.details` payload in order, or null to remove details. */
export function serializeDetails(details: DetailDraft[]): unknown[] | null {
  const rows = details.filter(d => !isBlankDetail(d)).map(d => ({ label: d.label.trim(), value: d.value.trim() }));
  return rows.length ? rows : null;
}

/** Lowest valid weight / size price, or null when there is no variant group (or no valid price yet). */
export function variantMinPrice(groups: GroupDraft[]): number | null {
  const v = groups.find(g => g.type === 'variant');
  if (!v) return null;
  const prices = v.choices.map(c => c.price.trim()).filter(s => PRICE_RE.test(s)).map(Number).filter(n => n > 0 && n <= LIMITS.maxPrice);
  return prices.length ? Math.min(...prices) : null;
}

// ─── Small pieces ───────────────────────────────────────────────────────────
const move = <T,>(list: T[], i: number, dir: -1 | 1): T[] => {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

const ICON_BTN = cx('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm text-fg-muted hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-25', FOCUS_RING);

function MoveButtons({ index, count, what, onMove }: { index: number; count: number; what: string; onMove: (dir: -1 | 1) => void }) {
  return (
    <span className="flex shrink-0">
      <button type="button" className={ICON_BTN} disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${what} up`} title="Move up">↑</button>
      <button type="button" className={ICON_BTN} disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move ${what} down`} title="Move down">↓</button>
    </span>
  );
}

function RemoveButton({ what, onClick }: { what: string; onClick: () => void }) {
  return (
    <button type="button" className={cx(ICON_BTN, 'hover:bg-danger-soft hover:text-danger-text')} onClick={onClick} aria-label={`Remove ${what}`} title="Remove">×</button>
  );
}

const ErrorText = ({ id, children }: { id?: string; children?: string }) =>
  children ? <p id={id} role="alert" className="mt-1 text-xs text-danger-text">{children}</p> : null;

/** Shows an error once its field was left (blur) or after a save attempt. */
function useShownErrors(errors: OptionErrors, showAll: boolean) {
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const touch = (k: string) => setTouched(prev => (prev.has(k) ? prev : new Set(prev).add(k)));
  const err = (k: string) => (showAll || touched.has(k) ? errors[k] : undefined);
  return { touch, err };
}

function PriceInput({ value, onChange, onBlur, invalid, describedBy, label, placeholder }: {
  value: string; onChange: (v: string) => void; onBlur: () => void; invalid: boolean; describedBy?: string; label: string; placeholder?: string;
}) {
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-fg-subtle">₹</span>
      <input
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className={cx(INPUT, 'pl-6 tabular-nums')}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </div>
  );
}

// ─── Suggested weights (same rule as backend/utils/productOptions.autoWeightOptions) ─────────────
// A grocery / bakery product sold by weight (pack of 250 g or more) with no saved choices is sold with automatic
// 250 g / 500 g / 1 kg weights priced per gram. The editor shows those rows (useChoiceGroups below); they are saved
// as the admin's own only once the admin changes one.
const AUTO_TYPES = ['GROCERY', 'BAKERY'];
const packGrams = (text: unknown): number | null => {
  const t = String(text || '').toLowerCase().trim();
  const m = t.match(/(\d+(?:\.\d+)?)\s*(kgs?|kilograms?|kilos?|g|gms?|grams?)(?![a-z])/);
  if (m) {
    const n = Number(m[1]) * (m[2].startsWith('k') ? 1000 : 1);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  // A pack size typed as a bare number ("1000", as stores enter it) is grams.
  const bare = t.match(/^(\d{2,5})$/);
  if (bare) {
    const n = Number(bare[1]);
    return n >= 50 && n <= 10000 ? n : null;
  }
  return null;
};
export function suggestedWeightGroups(item: { name?: string; price?: number | string; originalPrice?: number | string | null; specs?: unknown } | null, vendorType?: string | null): GroupDraft[] {
  if (!item || !AUTO_TYPES.includes(String(vendorType || '').toUpperCase())) return [];
  const specs = (item.specs && typeof item.specs === 'object' ? item.specs : {}) as Record<string, unknown>;
  if (Array.isArray(specs.options) && specs.options.length) return [];
  if (specs.autoWeights === false) return [];
  const grams = packGrams(specs.weight) || packGrams(item.name);
  const price = Number(item.price);
  if (!grams || grams < 250 || !Number.isFinite(price) || price <= 0) return [];
  const mrpRaw = Number((item as { originalPrice?: unknown }).originalPrice) || Number(specs.originalPrice);
  const mrp = Number.isFinite(mrpRaw) && mrpRaw > price ? mrpRaw : null;
  const sizes = [...new Set([250, 500, 1000, grams])].filter(g => g >= grams / 4 && g <= grams * 2).sort((a, b) => a - b);
  if (sizes.length < 2) return [];
  const label = (g: number) => (g >= 1000 ? `${Number((g / 1000).toFixed(2))} kg` : `${g} g`);
  return [{
    key: newKey(), name: 'Weight', type: 'variant', required: true, max: '', maxLength: String(LIMITS.textDefault),
    choices: sizes.map(g => {
      const p = g === grams ? Math.round(price * 100) / 100 : Math.max(1, Math.round((price / grams) * g));
      const m = mrp ? (g === grams ? mrp : Math.max(p, Math.round((mrp / grams) * g))) : null;
      return { key: newKey(), label: label(g), price: String(p), mrp: m && m > p ? String(m) : '', ...(g === grams ? { isDefault: true } : {}) };
    }),
  }];
}

/**
 * The choice groups an item editor works on, with the automatic weights above (docs/PRODUCT_OPTIONS.md):
 *  - own === null: nothing saved. A weight-sold grocery / bakery product then sells in the automatic weights, which
 *    follow the form's current price, MRP and pack size and are never saved (saving them on any edit made them
 *    permanent and rewrote the product price to the 250 g price). Changing any of them makes them the admin's own.
 *  - own === [] while automatic weights would apply: the admin removed them, so the product sells only as its one
 *    pack (saved as specs.autoWeights false, e.g. a sealed 1 kg packet).
 */
export function useChoiceGroups(specs: Record<string, unknown>, form: { name: string; price: string; mrp: string; weight: unknown }, vendorType?: string | null) {
  const [own, setOwn] = useState<GroupDraft[] | null>(() => {
    const saved = groupsFromSpecs(specs);
    return saved.length ? saved : specs.autoWeights === false ? [] : null;
  });
  const autoGroups = useMemo(
    () => suggestedWeightGroups({ name: form.name, price: form.price, originalPrice: form.mrp.trim() || null, specs: { weight: form.weight } }, vendorType),
    [form.name, form.price, form.mrp, form.weight, vendorType],
  );
  const usingAuto = own === null && autoGroups.length > 0;
  const autoOff = own !== null && own.length === 0 && autoGroups.length > 0;
  return {
    groups: own ?? autoGroups,
    setGroups: (next: GroupDraft[]) => setOwn(next),
    usingAuto,
    autoOff,
    /** Back to the automatic weights (and, in a fresh form, to nothing). */
    useAutomatic: () => setOwn(null),
    /** specs keys to save: options (null removes the admin's own) and autoWeights (false = off, null = default). */
    specsPatch: () => ({ options: own === null ? null : serializeOptions(own), autoWeights: autoOff ? false : null }),
    /** Pack the automatic weights start from, for messages ("1 kg"). */
    packLabel: autoGroups[0]?.choices.find(c => c.isDefault)?.label || null,
  };
}

/** Explains the automatic weights state above the choices editor (both item editors). */
export function AutoWeightsNote({ usingAuto, autoOff, packLabel, onUseAutomatic }: { usingAuto: boolean; autoOff: boolean; packLabel: string | null; onUseAutomatic: () => void }) {
  if (usingAuto) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm leading-relaxed text-fg-muted">
        <p className="mb-0.5 font-medium text-warning-text">Automatic weights</p>
        Customers can buy this in the weights below, worked out from the selling price{packLabel ? ` of the ${packLabel} pack` : ''}. They follow the price until you change one; change any weight or price to set your own, or remove the Weight group to sell only the {packLabel || 'one'} pack.
      </div>
    );
  }
  if (autoOff) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-info/25 bg-info-soft px-3 py-2.5 text-sm leading-relaxed text-fg-muted">
        <span>No weight choices: customers buy only the {packLabel || 'one'} pack at the selling price.</span>
        <Button size="sm" onClick={onUseAutomatic}>Use automatic weights</Button>
      </div>
    );
  }
  return null;
}

// ─── Choices the customer picks ─────────────────────────────────────────────
const PRESETS: { id: string; label: string; make: () => GroupDraft }[] = [
  { id: 'variant', label: 'Weight / size', make: () => ({ key: newKey(), name: 'Weight', type: 'variant', required: true, max: '', maxLength: String(LIMITS.textDefault), choices: [blankChoice()] }) },
  // Half / full plates and piece counts are a weight / size group too: each choice carries its own full price.
  { id: 'portion', label: 'Half / Full', make: () => ({ key: newKey(), name: 'Portion', type: 'variant', required: true, max: '', maxLength: String(LIMITS.textDefault), choices: [{ ...blankChoice(), label: 'Half' }, { ...blankChoice(), label: 'Full' }] }) },
  { id: 'pieces', label: 'Pieces (e.g. 6 pcs / 12 pcs)', make: () => ({ key: newKey(), name: 'Pieces', type: 'variant', required: true, max: '', maxLength: String(LIMITS.textDefault), choices: [{ ...blankChoice(), label: '6 pcs' }, { ...blankChoice(), label: '12 pcs' }] }) },
  { id: 'flavour', label: 'Flavour', make: () => ({ key: newKey(), name: 'Flavour', type: 'single', required: true, max: '', maxLength: String(LIMITS.textDefault), choices: [blankChoice()] }) },
  { id: 'type', label: 'Type (e.g. Egg / Eggless)', make: () => ({ key: newKey(), name: 'Type', type: 'single', required: true, max: '', maxLength: String(LIMITS.textDefault), choices: [blankChoice()] }) },
  { id: 'addons', label: 'Add-ons', make: () => ({ key: newKey(), name: 'Add-ons', type: 'multi', required: false, max: '', maxLength: String(LIMITS.textDefault), choices: [blankChoice()] }) },
  { id: 'message', label: 'Message', make: () => ({ key: newKey(), name: 'Message', type: 'text', required: false, max: '', maxLength: String(LIMITS.textDefault), choices: [] }) },
];

/** Presets that add the product's one weight / size / portion / pieces group. */
const VARIANT_PRESETS = ['variant', 'portion', 'pieces'];

export function OptionGroupsEditor({ groups, onChange, errors, showAllErrors }: {
  groups: GroupDraft[];
  onChange: (next: GroupDraft[]) => void;
  errors: OptionErrors;
  showAllErrors: boolean;
}) {
  const { touch, err } = useShownErrors(errors, showAllErrors);
  const hasVariant = groups.some(g => g.type === 'variant');
  const full = groups.length >= LIMITS.groups;

  const setGroup = (key: string, patch: Partial<GroupDraft>) => onChange(groups.map(g => (g.key === key ? { ...g, ...patch } : g)));
  const setChoice = (g: GroupDraft, ckey: string, patch: Partial<ChoiceDraft>) =>
    setGroup(g.key, { choices: g.choices.map(c => (c.key === ckey ? { ...c, ...patch } : c)) });
  const changeType = (g: GroupDraft, type: OptionType) => {
    const patch: Partial<GroupDraft> = { type };
    if (type === 'variant') patch.required = true;
    if (type !== 'text' && !g.choices.length) patch.choices = [blankChoice()];
    setGroup(g.key, patch);
  };

  return (
    <section className="space-y-3 rounded-xl border border-line p-4" aria-labelledby="opt-groups-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="opt-groups-h" className="text-sm font-semibold text-fg">Choices the customer picks</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">Weights, flavours, types, add-ons or a message. Shown to the customer in this order.</p>
        </div>
        <MenuButton
          label="+ Add choice group"
          ariaLabel="Add choice group"
          items={PRESETS.map(p => ({
            label: VARIANT_PRESETS.includes(p.id) && hasVariant ? `${p.label} (already added)` : p.label,
            disabled: full || (VARIANT_PRESETS.includes(p.id) && hasVariant),
            onSelect: () => onChange([...groups, p.make()]),
          }))}
        />
      </div>
      {full && <p className="text-xs text-fg-muted">The limit is {LIMITS.groups} groups per product.</p>}
      {errors.options && <ErrorText>{errors.options}</ErrorText>}

      {groups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-fg-muted">
          No choices. Customers add this product as it is.
        </p>
      ) : (
        <ol className="space-y-3">
          {groups.map((g, gi) => {
            const what = g.name.trim() || `group ${gi + 1}`;
            const nameErr = err(`g:${g.key}:name`);
            const priceHead = g.type === 'variant' ? 'Full price' : 'Extra price';
            return (
              <li key={g.key} className="space-y-3 rounded-lg border border-line bg-surface-2/40 p-3">
                {/* Header: name, type, order, delete */}
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-[160px] flex-1">
                    <input
                      aria-label={`Group ${gi + 1} name`}
                      aria-invalid={!!nameErr}
                      aria-describedby={nameErr ? `${g.key}-name-err` : undefined}
                      className={INPUT}
                      maxLength={LIMITS.groupName}
                      placeholder="Group name, e.g. Flavour"
                      value={g.name}
                      onChange={e => setGroup(g.key, { name: e.target.value })}
                      onBlur={() => touch(`g:${g.key}:name`)}
                    />
                    <ErrorText id={`${g.key}-name-err`}>{nameErr}</ErrorText>
                  </div>
                  <select
                    aria-label={`Group ${gi + 1} type`}
                    className={cx(INPUT, 'w-auto pr-8')}
                    value={g.type}
                    onChange={e => changeType(g, e.target.value as OptionType)}
                  >
                    {(Object.keys(TYPE_LABEL) as OptionType[]).map(t => (
                      <option key={t} value={t} disabled={t === 'variant' && hasVariant && g.type !== 'variant'}>{TYPE_LABEL[t]}</option>
                    ))}
                  </select>
                  <span className="flex items-center">
                    <MoveButtons index={gi} count={groups.length} what={what} onMove={dir => onChange(move(groups, gi, dir))} />
                    <RemoveButton what={what} onClick={() => onChange(groups.filter(x => x.key !== g.key))} />
                  </span>
                </div>

                {/* Settings per type */}
                {g.type === 'variant' && (
                  <p className="text-xs leading-relaxed text-fg-muted">Each weight&apos;s full price. The product price becomes the lowest one.</p>
                )}
                {g.type === 'single' && (
                  <Toggle size="sm" checked={g.required} onChange={required => setGroup(g.key, { required })} label="Customer must pick one" />
                )}
                {g.type === 'multi' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={`${g.key}-max`} className="text-sm text-fg">Up to</label>
                    <input
                      id={`${g.key}-max`}
                      inputMode="numeric"
                      aria-invalid={!!err(`g:${g.key}:max`)}
                      className={cx(INPUT, 'w-20 tabular-nums')}
                      placeholder="Any"
                      value={g.max}
                      onChange={e => setGroup(g.key, { max: e.target.value })}
                      onBlur={() => touch(`g:${g.key}:max`)}
                    />
                    <span className="text-sm text-fg-muted">picks. Leave empty for no limit.</span>
                    <ErrorText>{err(`g:${g.key}:max`)}</ErrorText>
                  </div>
                )}
                {g.type === 'text' && (
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <Toggle size="sm" checked={g.required} onChange={required => setGroup(g.key, { required })} label="Customer must type it" />
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={`${g.key}-len`} className="text-sm text-fg">Max characters</label>
                      <input
                        id={`${g.key}-len`}
                        inputMode="numeric"
                        aria-invalid={!!err(`g:${g.key}:maxLength`)}
                        className={cx(INPUT, 'w-20 tabular-nums')}
                        placeholder={String(LIMITS.textDefault)}
                        value={g.maxLength}
                        onChange={e => setGroup(g.key, { maxLength: e.target.value })}
                        onBlur={() => touch(`g:${g.key}:maxLength`)}
                      />
                    </div>
                    <ErrorText>{err(`g:${g.key}:maxLength`)}</ErrorText>
                  </div>
                )}

                {/* Choices */}
                {g.type !== 'text' && (
                  <div className="space-y-2">
                    <div className={cx('grid gap-2 px-0.5 text-xs font-medium text-fg-muted', g.type === 'variant' ? 'grid-cols-[minmax(0,1fr)_110px_110px_112px]' : 'grid-cols-[minmax(0,1fr)_120px_84px]')} aria-hidden>
                      <span>{g.type === 'variant' ? 'Weight / size' : 'Choice'}</span>
                      <span>{g.type === 'variant' ? 'Selling price (₹)' : `${priceHead} (₹)`}</span>
                      {g.type === 'variant' && <span>MRP (₹, optional)</span>}
                      <span />
                    </div>
                    <ul className="space-y-2">
                      {g.choices.map((c, ci) => {
                        const cWhat = c.label.trim() || `choice ${ci + 1}`;
                        const labelErr = err(`c:${c.key}:label`);
                        const priceErr = err(`c:${c.key}:price`);
                        return (
                          <li key={c.key} className={cx('grid items-start gap-2', g.type === 'variant' ? 'grid-cols-[minmax(0,1fr)_110px_110px_112px]' : 'grid-cols-[minmax(0,1fr)_120px_84px]')}>
                            <div>
                              <input
                                aria-label={`${what}: choice ${ci + 1} label`}
                                aria-invalid={!!labelErr}
                                aria-describedby={labelErr ? `${c.key}-l-err` : undefined}
                                className={INPUT}
                                maxLength={LIMITS.choiceLabel}
                                placeholder={g.type === 'variant' ? 'e.g. 500 g' : 'e.g. Chocolate'}
                                value={c.label}
                                onChange={e => setChoice(g, c.key, { label: e.target.value })}
                                onBlur={() => touch(`c:${c.key}:label`)}
                              />
                              <ErrorText id={`${c.key}-l-err`}>{labelErr}</ErrorText>
                            </div>
                            <div>
                              <PriceInput
                                label={`${what}: ${cWhat} ${priceHead.toLowerCase()}`}
                                value={c.price}
                                placeholder={g.type === 'variant' ? '' : '0'}
                                invalid={!!priceErr}
                                describedBy={priceErr ? `${c.key}-p-err` : undefined}
                                onChange={price => setChoice(g, c.key, { price })}
                                onBlur={() => touch(`c:${c.key}:price`)}
                              />
                              <ErrorText id={`${c.key}-p-err`}>{priceErr}</ErrorText>
                            </div>
                            {g.type === 'variant' && (
                              <div>
                                <PriceInput
                                  label={`${what}: ${cWhat} MRP`}
                                  value={c.mrp || ''}
                                  placeholder="MRP"
                                  invalid={!!err(`c:${c.key}:mrp`)}
                                  describedBy={err(`c:${c.key}:mrp`) ? `${c.key}-m-err` : undefined}
                                  onChange={mrp => setChoice(g, c.key, { mrp })}
                                  onBlur={() => touch(`c:${c.key}:mrp`)}
                                />
                                <ErrorText id={`${c.key}-m-err`}>{err(`c:${c.key}:mrp`)}</ErrorText>
                              </div>
                            )}
                            <span className="flex">
                              {g.type === 'variant' && (
                                <button
                                  type="button"
                                  className={cx(ICON_BTN, c.isDefault && 'text-warning-text hover:text-warning-text')}
                                  aria-pressed={!!c.isDefault}
                                  aria-label={`Pre-select ${cWhat} in the app`}
                                  title={c.isDefault ? 'Pre-selected in the app and shown in lists (click to undo)' : 'Pre-select this one in the app'}
                                  onClick={() => setGroup(g.key, { choices: g.choices.map(x => ({ ...x, isDefault: x.key === c.key ? !c.isDefault : false })) })}
                                >{c.isDefault ? '★' : '☆'}</button>
                              )}
                              <MoveButtons index={ci} count={g.choices.length} what={cWhat} onMove={dir => setGroup(g.key, { choices: move(g.choices, ci, dir) })} />
                              <RemoveButton what={cWhat} onClick={() => setGroup(g.key, { choices: g.choices.filter(x => x.key !== c.key) })} />
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {(showAllErrors || g.choices.length === 0) && <ErrorText>{errors[`g:${g.key}:choices`]}</ErrorText>}
                    {g.type === 'variant' && <p className="text-xs text-fg-subtle">★ marks the weight / size the app pre-selects and lists show; without one, the first.</p>}
                    <Button size="sm" variant="ghost" disabled={g.choices.length >= LIMITS.choices} onClick={() => setGroup(g.key, { choices: [...g.choices, blankChoice()] })}>
                      + Add {g.type === 'variant' ? 'weight / size' : 'choice'}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ─── Product details ────────────────────────────────────────────────────────
export function ProductDetailsEditor({ details, onChange, errors, showAllErrors }: {
  details: DetailDraft[];
  onChange: (next: DetailDraft[]) => void;
  errors: OptionErrors;
  showAllErrors: boolean;
}) {
  const { touch, err } = useShownErrors(errors, showAllErrors);
  const full = details.length >= LIMITS.details;
  const setRow = (key: string, patch: Partial<DetailDraft>) => onChange(details.map(d => (d.key === key ? { ...d, ...patch } : d)));

  return (
    <section className="space-y-3 rounded-xl border border-line p-4" aria-labelledby="prod-details-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="prod-details-h" className="text-sm font-semibold text-fg">Product details (shown in this order)</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">e.g. Brand, Shelf life, Serves. Up to {LIMITS.details} rows.</p>
        </div>
        <Button size="sm" disabled={full} onClick={() => onChange([...details, { key: newKey(), label: '', value: '' }])}>+ Add detail</Button>
      </div>
      {errors.details && <ErrorText>{errors.details}</ErrorText>}

      {details.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-fg-muted">No details yet.</p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_84px] gap-2 px-0.5 text-xs font-medium text-fg-muted" aria-hidden>
            <span>Label</span><span>Value</span><span />
          </div>
          <ol className="space-y-2">
            {details.map((d, i) => {
              const what = d.label.trim() || `detail ${i + 1}`;
              const labelErr = err(`d:${d.key}:label`);
              const valueErr = err(`d:${d.key}:value`);
              return (
                <li key={d.key} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_84px] items-start gap-2">
                  <div>
                    <input
                      aria-label={`Detail ${i + 1} label`}
                      aria-invalid={!!labelErr}
                      aria-describedby={labelErr ? `${d.key}-l-err` : undefined}
                      className={INPUT}
                      maxLength={LIMITS.detailLabel}
                      placeholder="e.g. Brand"
                      value={d.label}
                      onChange={e => setRow(d.key, { label: e.target.value })}
                      onBlur={() => touch(`d:${d.key}:label`)}
                    />
                    <ErrorText id={`${d.key}-l-err`}>{labelErr}</ErrorText>
                  </div>
                  <div>
                    <input
                      aria-label={`Detail ${i + 1} value`}
                      aria-invalid={!!valueErr}
                      aria-describedby={valueErr ? `${d.key}-v-err` : undefined}
                      className={INPUT}
                      maxLength={LIMITS.detailValue}
                      placeholder="e.g. Amul"
                      value={d.value}
                      onChange={e => setRow(d.key, { value: e.target.value })}
                      onBlur={() => touch(`d:${d.key}:value`)}
                    />
                    <ErrorText id={`${d.key}-v-err`}>{valueErr}</ErrorText>
                  </div>
                  <span className="flex">
                    <MoveButtons index={i} count={details.length} what={what} onMove={dir => onChange(move(details, i, dir))} />
                    <RemoveButton what={what} onClick={() => onChange(details.filter(x => x.key !== d.key))} />
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
