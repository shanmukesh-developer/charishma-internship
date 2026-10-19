"use client";
import {
  CHARGE_UNITS, CHARGE_UNIT_LABEL, ChargeUnit, FIELD, INCLUDED_KEYS, INCLUDED_LABEL, IncludedKey, LABEL, LateFeeUnit,
  MAX_EXTRA_CHARGES, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, PGHostel, PaymentMethod, PgPolicies,
} from './pgApi';
import {
  AppPreview, SaveBar, amountError, compactObj, fieldIndex, inr, intError, isBlank, moveItem, multiLine, nextRowKey,
  numOrUndefined, numText, oneLine, ordinal, textError, useSectionEditor,
} from './contentShared';

type Charge = { key: string; item: string; amount: string; unit: ChargeUnit | '' };
type Draft = {
  booking: { steps: string; tokenAmount: string; confirmation: string };
  rent: { dueDay: string; lateFee: string; lateFeeUnit: LateFeeUnit | ''; methods: PaymentMethod[]; notes: string };
  deposit: { amount: string; refundDays: string; deductions: string };
  stay: { noticeMonths: string; lockInMonths: string; notes: string };
  cancellation: { freeCancelDays: string; refundPercent: string; text: string };
  included: IncludedKey[];
  extraCharges: Charge[];
  maintenance: { responseHours: string; notes: string };
};

const toDraft = (v?: PgPolicies | null): Draft => {
  const p = v || {};
  return {
    booking: { steps: p.booking?.steps || '', tokenAmount: numText(p.booking?.tokenAmount), confirmation: p.booking?.confirmation || '' },
    rent: { dueDay: numText(p.rent?.dueDay), lateFee: numText(p.rent?.lateFee), lateFeeUnit: p.rent?.lateFeeUnit || '', methods: p.rent?.methods || [], notes: p.rent?.notes || '' },
    deposit: { amount: numText(p.deposit?.amount), refundDays: numText(p.deposit?.refundDays), deductions: p.deposit?.deductions || '' },
    stay: { noticeMonths: numText(p.stay?.noticeMonths), lockInMonths: numText(p.stay?.lockInMonths), notes: p.stay?.notes || '' },
    cancellation: { freeCancelDays: numText(p.cancellation?.freeCancelDays), refundPercent: numText(p.cancellation?.refundPercent), text: p.cancellation?.text || '' },
    included: p.included || [],
    extraCharges: (p.extraCharges || []).map(c => ({ key: nextRowKey('c'), item: c.item, amount: numText(c.amount), unit: c.unit })),
    maintenance: { responseHours: numText(p.maintenance?.responseHours), notes: p.maintenance?.notes || '' },
  };
};

const chargeRows = (d: Draft) => d.extraCharges.filter(c => oneLine(c.item) || !isBlank(c.amount));

const toValue = (d: Draft): PgPolicies | null => {
  const lateFee = numOrUndefined(d.rent.lateFee, true);
  const out = compactObj<PgPolicies>({
    booking: compactObj({ steps: multiLine(d.booking.steps), tokenAmount: numOrUndefined(d.booking.tokenAmount, true), confirmation: multiLine(d.booking.confirmation) }),
    rent: compactObj({
      dueDay: numOrUndefined(d.rent.dueDay), lateFee,
      lateFeeUnit: lateFee ? d.rent.lateFeeUnit || undefined : undefined,
      methods: PAYMENT_METHODS.filter(m => d.rent.methods.includes(m)), notes: multiLine(d.rent.notes),
    }),
    deposit: compactObj({ amount: numOrUndefined(d.deposit.amount, true), refundDays: numOrUndefined(d.deposit.refundDays), deductions: multiLine(d.deposit.deductions) }),
    stay: compactObj({ noticeMonths: numOrUndefined(d.stay.noticeMonths), lockInMonths: numOrUndefined(d.stay.lockInMonths), notes: multiLine(d.stay.notes) }),
    cancellation: compactObj({ freeCancelDays: numOrUndefined(d.cancellation.freeCancelDays), refundPercent: numOrUndefined(d.cancellation.refundPercent), text: multiLine(d.cancellation.text) }),
    included: INCLUDED_KEYS.filter(k => d.included.includes(k)),
    extraCharges: chargeRows(d).map(c => ({ item: oneLine(c.item), amount: numOrUndefined(c.amount, true) as number, unit: c.unit as ChargeUnit })),
    maintenance: compactObj({ responseHours: numOrUndefined(d.maintenance.responseHours), notes: multiLine(d.maintenance.notes) }),
  });
  return out || null;
};

// Same order and messages as backend validatePolicies.
const chargeError = (c: Charge, i: number): string | null => {
  const item = oneLine(c.item);
  const n = `Extra charge ${i + 1}`;
  return textError(item, 40, `${n} item`) || amountError(c.amount, 100000, `${n} amount`)
    || (!item ? `${n}: name the charge (e.g. Electricity).` : null)
    || (isBlank(c.amount) ? `${item}: enter the amount.` : null)
    || (!c.unit ? `${item}: choose what the amount is per.` : null);
};
const validate = (d: Draft): string | null => {
  const rows = chargeRows(d);
  if (rows.length > MAX_EXTRA_CHARGES) return `extraCharges: at most ${MAX_EXTRA_CHARGES} items.`;
  for (const [i, c] of rows.entries()) { const e = chargeError(c, i); if (e) return e; }
  const lateFeeErr = amountError(d.rent.lateFee, 10000, 'Late fee');
  if (lateFeeErr) return lateFeeErr;
  if (Number(d.rent.lateFee) > 0 && !d.rent.lateFeeUnit) return 'Late fee: choose once or per day.';
  return textError(multiLine(d.booking.steps), 600, 'How to book')
    || amountError(d.booking.tokenAmount, 100000, 'Token amount')
    || textError(multiLine(d.booking.confirmation), 300, 'Confirmation')
    || intError(d.rent.dueDay, 1, 28, 'Rent due day')
    || textError(multiLine(d.rent.notes), 300, 'Rent notes')
    || amountError(d.deposit.amount, 500000, 'Deposit amount')
    || intError(d.deposit.refundDays, 0, 180, 'Deposit refund days')
    || textError(multiLine(d.deposit.deductions), 400, 'Deposit deductions')
    || intError(d.stay.noticeMonths, 0, 6, 'Notice period (months)')
    || intError(d.stay.lockInMonths, 0, 24, 'Lock-in (months)')
    || textError(multiLine(d.stay.notes), 300, 'Notice notes')
    || intError(d.cancellation.freeCancelDays, 0, 90, 'Free cancellation days')
    || intError(d.cancellation.refundPercent, 0, 100, 'Refund percent')
    || textError(multiLine(d.cancellation.text), 600, 'Cancellation policy')
    || intError(d.maintenance.responseHours, 1, 168, 'Repair response (hours)')
    || textError(multiLine(d.maintenance.notes), 300, 'Maintenance notes');
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const months = (n: number) => (n === 0 ? 'None' : plural(n, 'month'));
const joinOr = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
const chargeUnitShort: Record<ChargeUnit, string> = { month: '/month', unit: '/unit', use: '/use', day: '/day', kg: '/kg', once: ' one time' };
const TEXTAREA = `${FIELD} resize-y normal-case tracking-normal`;
const GROUP = 'space-y-3 rounded-xl border border-white/10 p-4';
const LEGEND = 'px-1 text-sm font-bold text-blue-300';

function Row({ label, value }: { label: string; value: string }) {
  return <p><span className="text-gray-500">{label}: </span><span className="whitespace-pre-line">{value}</span></p>;
}

/** Booking, rent, deposit, notice, cancellation, what rent includes, extra charges and repairs. */
export function PoliciesPanel({ pg, onSaved }: { pg: PGHostel; onSaved: (pg: Partial<PGHostel>) => void }) {
  const ed = useSectionEditor<Draft, PgPolicies>({ pgId: pg.id, path: 'policies', field: 'policies', source: pg.policies, toDraft, toValue, validate, noun: 'Policies', onSaved });
  const d = ed.draft;
  const set = <K extends keyof Draft>(group: K, patch: Partial<Draft[K]>) => ed.update(prev => ({ ...prev, [group]: { ...(prev[group] as object), ...patch } }));
  const setCharge = (key: string, patch: Partial<Charge>) => ed.update(prev => ({ ...prev, extraCharges: prev.extraCharges.map(c => (c.key === key ? { ...c, ...patch } : c)) }));
  const toggle = <T extends string>(list: T[], k: T) => (list.includes(k) ? list.filter(x => x !== k) : [...list, k]);
  const v = toValue(d);
  const badCharge = fieldIndex(ed.badField, 'policies.extraCharges');
  const badGroup = ed.badField ? ed.badField.split('.')[0] : null;
  const g = (key: string) => `${GROUP} ${badGroup === key ? 'border-red-500/50' : ''}`;
  const pgDeposit = Number(pg.securityDeposit) || 0;
  const depositAmount = v?.deposit?.amount ?? (pgDeposit > 0 ? pgDeposit : undefined);
  const lateOn = Number(d.rent.lateFee) > 0;

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">Shown under Policies on the PG page. Leave blank to hide. Amounts are in rupees; blank fields are not shown.</p>

      <fieldset className={g('booking')}>
        <legend className={LEGEND}>Booking</legend>
        <label className={LABEL}>How to book
          <textarea rows={3} maxLength={700} className={TEXTAREA} placeholder="e.g. Request a bed in the app. The housing desk confirms within a day." value={d.booking.steps} onChange={e => set('booking', { steps: e.target.value })} />
        </label>
        <div className="grid gap-3 md:grid-cols-[200px_1fr]">
          <label className={LABEL}>Token amount (₹)<input inputMode="numeric" className={FIELD} placeholder="0 = no token" value={d.booking.tokenAmount} onChange={e => set('booking', { tokenAmount: e.target.value })} /></label>
          <label className={LABEL}>Confirmation<input className={FIELD} maxLength={320} placeholder="e.g. You get a confirmation in the app once the bed is held." value={d.booking.confirmation} onChange={e => set('booking', { confirmation: e.target.value })} /></label>
        </div>
      </fieldset>

      <fieldset className={g('rent')}>
        <legend className={LEGEND}>Rent payment</legend>
        <p className="text-xs text-gray-400">Zenvy does not collect rent. This is shown to students for information.</p>
        <div className="grid gap-3 md:grid-cols-3">
          <label className={LABEL}>Due on day (1–28)<input inputMode="numeric" className={FIELD} placeholder="e.g. 5" value={d.rent.dueDay} onChange={e => set('rent', { dueDay: e.target.value })} /></label>
          <label className={LABEL}>Late fee (₹)<input inputMode="numeric" className={FIELD} placeholder="Blank = none" value={d.rent.lateFee} onChange={e => set('rent', { lateFee: e.target.value })} /></label>
          <label className={LABEL}>Late fee is charged
            <select className={FIELD} disabled={!lateOn} value={lateOn ? d.rent.lateFeeUnit : ''} onChange={e => set('rent', { lateFeeUnit: e.target.value as LateFeeUnit | '' })} aria-invalid={lateOn && !d.rent.lateFeeUnit}>
              <option value="">Choose</option><option value="once">Once</option><option value="day">Per day late</option>
            </select>
          </label>
        </div>
        <div role="group" aria-labelledby="pg-pay-methods" className="space-y-1.5">
          <span id="pg-pay-methods" className="text-xs font-semibold uppercase tracking-wider text-gray-400">Paid by</span>
          <div className="flex flex-wrap gap-4">
            {PAYMENT_METHODS.map(m => (
              <label key={m} className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" className="h-4 w-4 accent-blue-500" checked={d.rent.methods.includes(m)} onChange={() => set('rent', { methods: toggle(d.rent.methods, m) })} />{PAYMENT_METHOD_LABEL[m]}
              </label>
            ))}
          </div>
        </div>
        <label className={LABEL}>Notes<textarea rows={2} maxLength={360} className={TEXTAREA} placeholder="e.g. Rent for the first month is paid on move-in day." value={d.rent.notes} onChange={e => set('rent', { notes: e.target.value })} /></label>
      </fieldset>

      <fieldset className={g('deposit')}>
        <legend className={LEGEND}>Security deposit</legend>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={LABEL}>Amount (₹)<input inputMode="numeric" className={FIELD} placeholder={pgDeposit > 0 ? `Blank = ${inr(pgDeposit)} from Details` : 'Blank = the deposit from Details'} value={d.deposit.amount} onChange={e => set('deposit', { amount: e.target.value })} /></label>
          <label className={LABEL}>Refunded within (days)<input inputMode="numeric" className={FIELD} placeholder="0 = on the day you move out" value={d.deposit.refundDays} onChange={e => set('deposit', { refundDays: e.target.value })} /></label>
        </div>
        <label className={LABEL}>Deductions<textarea rows={2} maxLength={460} className={TEXTAREA} placeholder="e.g. Damage beyond normal wear and unpaid dues are deducted." value={d.deposit.deductions} onChange={e => set('deposit', { deductions: e.target.value })} /></label>
      </fieldset>

      <fieldset className={g('stay')}>
        <legend className={LEGEND}>Notice period &amp; lock-in</legend>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={LABEL}>Notice before moving out (months, 0–6)<input inputMode="numeric" className={FIELD} value={d.stay.noticeMonths} onChange={e => set('stay', { noticeMonths: e.target.value })} /></label>
          <label className={LABEL}>Lock-in (months, 0–24)<input inputMode="numeric" className={FIELD} value={d.stay.lockInMonths} onChange={e => set('stay', { lockInMonths: e.target.value })} /></label>
        </div>
        <label className={LABEL}>Notes<textarea rows={2} maxLength={360} className={TEXTAREA} value={d.stay.notes} onChange={e => set('stay', { notes: e.target.value })} /></label>
      </fieldset>

      <fieldset className={g('cancellation')}>
        <legend className={LEGEND}>Cancellation &amp; refund</legend>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={LABEL}>Full refund if cancelled this many days before check-in (0–90)<input inputMode="numeric" className={FIELD} value={d.cancellation.freeCancelDays} onChange={e => set('cancellation', { freeCancelDays: e.target.value })} /></label>
          <label className={LABEL}>After that, token refunded (%)<input inputMode="numeric" className={FIELD} placeholder="0 = no refund" value={d.cancellation.refundPercent} onChange={e => set('cancellation', { refundPercent: e.target.value })} /></label>
        </div>
        <label className={LABEL}>Details<textarea rows={3} maxLength={700} className={TEXTAREA} value={d.cancellation.text} onChange={e => set('cancellation', { text: e.target.value })} /></label>
      </fieldset>

      <fieldset className={g('included')}>
        <legend className={LEGEND}>Included in rent</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {INCLUDED_KEYS.map(k => (
            <label key={k} className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" className="h-4 w-4 accent-blue-500" checked={d.included.includes(k)} onChange={() => ed.update(prev => ({ ...prev, included: toggle(prev.included, k) }))} />{INCLUDED_LABEL[k]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={g('extraCharges')}>
        <legend className={LEGEND}>Extra charges</legend>
        <p className="text-xs text-gray-500">Anything billed on top of rent, e.g. Electricity, ₹10 per unit. {chargeRows(d).length} of {MAX_EXTRA_CHARGES}.</p>
        {d.extraCharges.length > 0 && (
          <ol className="space-y-2">
            {d.extraCharges.map((c, i) => {
              const rowIndex = chargeRows(d).indexOf(c);
              const err = rowIndex >= 0 ? chargeError(c, rowIndex) : null;
              const bad = !!err || (badCharge !== null && badCharge === rowIndex);
              return (
                <li key={c.key} className="space-y-1">
                  <div className="grid grid-cols-[1fr_120px_130px_auto] items-center gap-2">
                    <input aria-label={`Extra charge ${i + 1} item`} aria-invalid={bad} className={`${FIELD} ${bad ? 'border-red-500/60' : ''}`} maxLength={60} placeholder="Item, e.g. Electricity" value={c.item} onChange={e => setCharge(c.key, { item: e.target.value })} />
                    <input aria-label={`Extra charge ${i + 1} amount in rupees`} inputMode="numeric" className={FIELD} placeholder="₹" value={c.amount} onChange={e => setCharge(c.key, { amount: e.target.value })} />
                    <select aria-label={`Extra charge ${i + 1} is per`} className={FIELD} value={c.unit} onChange={e => setCharge(c.key, { unit: e.target.value as ChargeUnit | '' })}>
                      <option value="">Per…</option>
                      {CHARGE_UNITS.map(u => <option key={u} value={u}>{CHARGE_UNIT_LABEL[u]}</option>)}
                    </select>
                    <div className="flex items-center gap-1.5">
                      <button type="button" disabled={i === 0} onClick={() => ed.update(prev => ({ ...prev, extraCharges: moveItem(prev.extraCharges, i, -1) }))} aria-label={`Move extra charge ${i + 1} up`} className="rounded border border-white/10 px-2 py-1 text-xs text-gray-300 hover:text-white disabled:opacity-30">Up</button>
                      <button type="button" disabled={i === d.extraCharges.length - 1} onClick={() => ed.update(prev => ({ ...prev, extraCharges: moveItem(prev.extraCharges, i, 1) }))} aria-label={`Move extra charge ${i + 1} down`} className="rounded border border-white/10 px-2 py-1 text-xs text-gray-300 hover:text-white disabled:opacity-30">Down</button>
                      <button type="button" onClick={() => ed.update(prev => ({ ...prev, extraCharges: prev.extraCharges.filter(x => x.key !== c.key) }))} aria-label={`Remove extra charge ${i + 1}`} className="px-1 text-xs text-red-300/80 hover:text-red-300">Remove</button>
                    </div>
                  </div>
                  {err && <p className="text-xs text-red-300">{err}</p>}
                </li>
              );
            })}
          </ol>
        )}
        <button type="button" disabled={d.extraCharges.length >= MAX_EXTRA_CHARGES} onClick={() => ed.update(prev => ({ ...prev, extraCharges: [...prev.extraCharges, { key: nextRowKey('c'), item: '', amount: '', unit: '' }] }))} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-white/5 disabled:opacity-40">Add charge</button>
      </fieldset>

      <fieldset className={g('maintenance')}>
        <legend className={LEGEND}>Maintenance &amp; repairs</legend>
        <div className="grid gap-3 md:grid-cols-[240px_1fr]">
          <label className={LABEL}>Response time (hours, 1–168)<input inputMode="numeric" className={FIELD} placeholder="e.g. 24" value={d.maintenance.responseHours} onChange={e => set('maintenance', { responseHours: e.target.value })} /></label>
          <label className={LABEL}>How to report<input className={FIELD} maxLength={320} placeholder="e.g. Tell the warden or raise it through the housing desk." value={d.maintenance.notes} onChange={e => set('maintenance', { notes: e.target.value })} /></label>
        </div>
      </fieldset>

      <AppPreview empty={!v}>
        {v?.booking && <div><p className="font-semibold text-white">Booking</p>
          {v.booking.steps && <Row label="How to book" value={v.booking.steps} />}
          {v.booking.tokenAmount !== undefined && <Row label="Token amount" value={v.booking.tokenAmount ? inr(v.booking.tokenAmount) : 'No token needed'} />}
          {v.booking.confirmation && <Row label="Confirmation" value={v.booking.confirmation} />}
        </div>}
        {v?.rent && <div><p className="font-semibold text-white">Rent payment</p>
          {v.rent.dueDay && <p>Rent due on the {ordinal(v.rent.dueDay)} of each month</p>}
          {v.rent.lateFee ? <Row label="Late fee" value={`${inr(v.rent.lateFee)} ${v.rent.lateFeeUnit === 'day' ? 'per day late' : 'once'}`} /> : null}
          {v.rent.methods?.length ? <Row label="Paid by" value={joinOr(v.rent.methods.map(m => PAYMENT_METHOD_LABEL[m]))} /> : null}
          {v.rent.notes && <Row label="Notes" value={v.rent.notes} />}
          <p className="text-xs text-gray-500">Rent is paid to the PG. Zenvy does not collect rent.</p>
        </div>}
        {v?.deposit && <div><p className="font-semibold text-white">Security deposit</p>
          {depositAmount !== undefined && <Row label="Amount" value={depositAmount ? inr(depositAmount) : 'None'} />}
          {v.deposit.refundDays !== undefined && <Row label="Refund" value={v.deposit.refundDays === 0 ? 'On the day you move out' : `Within ${plural(v.deposit.refundDays, 'day')} of moving out`} />}
          {v.deposit.deductions && <Row label="Deductions" value={v.deposit.deductions} />}
        </div>}
        {v?.stay && <div><p className="font-semibold text-white">Notice period and lock-in</p>
          {v.stay.noticeMonths !== undefined && <Row label="Notice before moving out" value={months(v.stay.noticeMonths)} />}
          {v.stay.lockInMonths !== undefined && <Row label="Lock-in" value={v.stay.lockInMonths ? `${months(v.stay.lockInMonths)} minimum stay` : 'None'} />}
          {v.stay.notes && <Row label="Notes" value={v.stay.notes} />}
        </div>}
        {v?.cancellation && <div><p className="font-semibold text-white">Cancellation and refund</p>
          {v.cancellation.freeCancelDays !== undefined && <Row label="Full refund" value={v.cancellation.freeCancelDays === 0 ? 'Until the check-in day' : `If you cancel ${plural(v.cancellation.freeCancelDays, 'day')} or more before check-in`} />}
          {v.cancellation.refundPercent !== undefined && <Row label={v.cancellation.freeCancelDays !== undefined ? 'After that' : 'Refund'} value={v.cancellation.refundPercent === 0 ? 'No refund' : `${v.cancellation.refundPercent}% of the token refunded`} />}
          {v.cancellation.text && <Row label="Details" value={v.cancellation.text} />}
        </div>}
        {(v?.included?.length || v?.extraCharges?.length) ? <div><p className="font-semibold text-white">What rent includes</p>
          {v.included?.length ? <p>{v.included.map(k => INCLUDED_LABEL[k]).join(' · ')}</p> : null}
          {v.extraCharges?.map(c => <p key={c.item}>{c.item} · {inr(c.amount)}{chargeUnitShort[c.unit]}</p>)}
        </div> : null}
        {v?.maintenance && <div><p className="font-semibold text-white">Maintenance and repairs</p>
          {v.maintenance.responseHours ? <Row label="Response time" value={v.maintenance.responseHours < 24 ? `Within ${plural(v.maintenance.responseHours, 'hour')}` : v.maintenance.responseHours % 24 === 0 ? `Within ${plural(v.maintenance.responseHours / 24, 'day')}` : `Within ${v.maintenance.responseHours} hours`} /> : null}
          {v.maintenance.notes && <Row label="How to report" value={v.maintenance.notes} />}
        </div>}
      </AppPreview>
      <SaveBar dirty={ed.dirty} saving={ed.saving} message={ed.message} onSave={ed.save} onDiscard={ed.discard} />
    </div>
  );
}
