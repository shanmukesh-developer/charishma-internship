"use client";

import { useEffect, useState } from 'react';
import { autoRideApi, SETTING_RANGES, type NumericSettingKey, type Settings } from '@/lib/autoRideApi';
import { useLoader } from './hooks';
import { Btn, ConfirmDialog, ErrorBox, Field, Loading, Msg, errText, inputCls } from './ui';

const FIELDS: { key: NumericSettingKey; name: string; hint: string }[] = [
  { key: 'platformMaxCapacity', name: 'Platform max capacity', hint: 'Passengers per auto; approvals can never go above this or the RC seating' },
  { key: 'maxSeatsPerBooking', name: 'Max seats per booking', hint: 'Seats one passenger can book at once' },
  { key: 'holdMinutes', name: 'Seat hold (minutes)', hint: 'How long a seat is held before the passenger confirms' },
  { key: 'privateRespondMinutes', name: 'Full-auto respond (minutes)', hint: 'Time a driver has to accept a full-auto request' },
  { key: 'maxAdvanceDays', name: 'Max advance (days)', hint: 'How far ahead drivers can publish trips' },
  { key: 'reminderMinutes', name: 'Reminder (minutes)', hint: 'Passenger reminder before departure (0 = off)' },
  { key: 'noShowGraceMinutes', name: 'No-show grace (minutes)', hint: 'An auto still not boarding this long after departure time is closed as no-show' },
  { key: 'autoCompleteHours', name: 'Auto-complete (hours)', hint: 'Trips still in progress are completed after this' },
  { key: 'customerRefundBeforeConfirmPct', name: 'Refund % before driver confirms', hint: 'Wallet refund when a passenger cancels before departure is confirmed' },
  { key: 'customerRefundAfterConfirmPct', name: 'Refund % after driver confirms', hint: 'Wallet refund when a passenger cancels after confirmation' },
];

export default function SettingsTab({ tick, onChanged }: { tick: number; onChanged: () => void }) {
  const { data, loading, error, reload } = useLoader('settings', tick, () => autoRideApi.settings());
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [switchTo, setSwitchTo] = useState<{ key: 'enabled' | 'walletEnabled'; value: boolean } | null>(null);
  useEffect(() => {
    if (data && !dirty) setForm(Object.fromEntries(FIELDS.map((f) => [f.key, String(data[f.key])])));
  }, [data, dirty]);
  if (error && !data) return <ErrorBox text={error} retry={reload} />;
  if (loading || !data) return <Loading text="Loading settings…" />;
  const problems: Record<string, string> = {};
  for (const f of FIELDS) {
    const [min, max] = SETTING_RANGES[f.key];
    const n = Number(form[f.key]);
    if (form[f.key] === undefined || form[f.key].trim() === '' || !Number.isInteger(n) || n < min || n > max) problems[f.key] = `Whole number from ${min} to ${max}.`;
  }
  // Same rule as the server (services/flag.js writeSettings): seats per booking <= platform max capacity.
  if (!problems.maxSeatsPerBooking && !problems.platformMaxCapacity && Number(form.maxSeatsPerBooking) > Number(form.platformMaxCapacity)) {
    problems.maxSeatsPerBooking = `Cannot be more than the platform max capacity (${form.platformMaxCapacity}).`;
  }
  const save = async () => {
    if (Object.keys(problems).length) { setMsg({ ok: false, text: 'Fix the highlighted fields.' }); return; }
    const patch: Partial<Settings> = {};
    for (const f of FIELDS) if (Number(form[f.key]) !== data[f.key]) (patch as Record<string, number>)[f.key] = Number(form[f.key]);
    if (!Object.keys(patch).length) { setMsg({ ok: true, text: 'Nothing changed.' }); setDirty(false); return; }
    if (patch.platformMaxCapacity !== undefined && patch.platformMaxCapacity < data.platformMaxCapacity && !window.confirm(`Lower the platform max from ${data.platformMaxCapacity} to ${patch.platformMaxCapacity}? New trips are capped at ${patch.platformMaxCapacity} seats even for autos approved for more; new approvals are capped too. Trips already published keep their capacity.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      await autoRideApi.putSettings(patch);
      setDirty(false);
      setMsg({ ok: true, text: `Saved ${Object.keys(patch).length} setting${Object.keys(patch).length === 1 ? '' : 's'}.` });
      onChanged();
      reload();
    } catch (e) { setMsg({ ok: false, text: errText(e, 'Could not save the settings.') }); } finally { setBusy(false); }
  };
  return (
    <section className="space-y-6" aria-label="Settings">
      <div className={`border-2 p-6 ${data.enabled ? 'border-success/30 bg-success-soft' : 'border-danger/30 bg-danger-soft'}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-fg-muted">AUTO_RIDE_ENABLED</p>
            <h3 className="mt-1 text-2xl font-semibold">{data.enabled ? 'Auto-ride is on for passengers' : 'Auto-ride is off'}</h3>
            <p className="mt-2 max-w-2xl text-sm text-warning-text">Turn on only after legal checks: transport permits, permitted passenger capacity, commercial passenger rules, insurance and driver documents.</p>
            <p className="mt-1 max-w-2xl text-xs text-fg-muted">While off, passengers cannot browse, hold, book or request full autos (existing bookings stay readable and cancellable); drivers can onboard but trips stay drafts. Admin tools keep working.</p>
            {data.devOverride && <p className="mt-2 text-xs font-semibold text-warning-text">AUTO_RIDE_DEV_ENABLE is set on this server: the feature behaves as ON regardless of this switch.</p>}
          </div>
          <button type="button" role="switch" aria-checked={data.enabled} onClick={() => setSwitchTo({ key: 'enabled', value: !data.enabled })}
            className={`relative h-14 w-28 rounded-full border-2 transition ${data.enabled ? 'border-success/30 bg-success' : 'border-line bg-surface-2'}`}>
            <span className={`absolute top-1 h-11 w-11 rounded-full bg-white shadow transition-all ${data.enabled ? 'left-[3.75rem]' : 'left-1'}`} />
            <span className="sr-only">{data.enabled ? 'Turn Auto-Ride off' : 'Turn Auto-Ride on'}</span>
          </button>
        </div>
      </div>
      <div className="border border-line p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold">Zenvy Wallet payments for autos: {data.walletEnabled ? 'ON' : 'OFF'}</h3>
            <p className="mt-1 max-w-2xl text-sm text-warning-text">Keep off until RBI / payment-aggregator and legal review is done: collecting fares into the wallet on behalf of drivers may need a licence. Cash to the driver is always available.</p>
          </div>
          <Btn tone={data.walletEnabled ? 'bad' : 'plain'} onClick={() => setSwitchTo({ key: 'walletEnabled', value: !data.walletEnabled })}>{data.walletEnabled ? 'Turn wallet off' : 'Turn wallet on'}</Btn>
        </div>
      </div>
      <div className="border border-line p-5">
        <h3 className="mb-4 font-semibold">Limits and timings</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map((f) => {
            const [min, max] = SETTING_RANGES[f.key];
            return (
              <Field key={f.key} name={f.name} hint={problems[f.key] ? undefined : `${f.hint} (${min}–${max})`}>
                <input type="number" min={min} max={max} step={1} value={form[f.key] ?? ''} aria-invalid={!!problems[f.key]}
                  onChange={(e) => { setDirty(true); setForm((cur) => ({ ...cur, [f.key]: e.target.value })); }}
                  className={`${inputCls} ${problems[f.key] ? 'border-danger/30' : ''}`} />
                {problems[f.key] && <span role="alert" className="mt-1 block text-xs text-danger-text">{problems[f.key]}</span>}
              </Field>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-fg-muted">Driver, admin and system cancellations always refund wallet payments in full; the two refund % values apply only when a passenger cancels.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Btn tone="primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save settings'}</Btn>
          {dirty && <Btn disabled={busy} onClick={() => { setDirty(false); setMsg(null); }}>Discard changes</Btn>}
          <Msg msg={msg} />
        </div>
      </div>
      {switchTo && (
        <ConfirmDialog open tone={switchTo.value ? 'good' : 'bad'}
          title={switchTo.key === 'enabled' ? (switchTo.value ? 'Turn Auto-Ride ON for passengers?' : 'Turn Auto-Ride OFF?') : (switchTo.value ? 'Turn on wallet payments for autos?' : 'Turn off wallet payments for autos?')}
          confirmLabel={switchTo.value ? 'Turn on' : 'Turn off'}
          body={switchTo.key === 'enabled'
            ? (switchTo.value
              ? <><p className="font-semibold text-warning-text">Confirm the legal checks are done: transport permits, permitted capacity, commercial passenger rules, insurance and every live driver&apos;s documents.</p><p>Passengers will immediately be able to browse and book seats.</p></>
              : <p>New bookings, holds and full-auto requests stop immediately. Existing bookings are not cancelled; passengers can still view and cancel them.</p>)
            : (switchTo.value
              ? <p className="font-semibold text-warning-text">Only after RBI / payment and legal review. Passengers will be able to pay auto fares from their Zenvy Wallet.</p>
              : <p>Passengers can only pay cash to the driver. Existing wallet bookings keep their payment and refunds.</p>)}
          onCancel={() => setSwitchTo(null)}
          onConfirm={async () => {
            await autoRideApi.putSettings({ [switchTo.key]: switchTo.value });
            setSwitchTo(null);
            setMsg({ ok: true, text: `${switchTo.key === 'enabled' ? 'Auto-Ride' : 'Wallet payments'} turned ${switchTo.value ? 'on' : 'off'}.` });
            onChanged();
            reload();
          }} />
      )}
    </section>
  );
}
