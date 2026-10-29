"use client";

// Settings: GET / PUT /settings. Switches CAMPUS_EVENTS_ENABLED, CAMPUS_EVENTS_WALLET_ENABLED,
// CAMPUS_EVENTS_ONLINE_PAY_ENABLED (GlobalConfig, audited) + numeric settings with the server's ranges.
import { useEffect, useState } from 'react';
import { SETTING_RANGES, campusEventsApi, type SettingKey, type SettingsValues } from '@/lib/campusEventsApi';
import { Btn, ConfirmDialog, ErrorBox, Field, Loading, Msg, errText, inputCls, useLoader, type Notice } from './shared';

const FIELDS: { key: SettingKey; name: string; hint: string }[] = [
  { key: 'holdMinutes', name: 'Slot hold (minutes)', hint: 'How long a slot is held while the student confirms / pays' },
  { key: 'paymentMinutes', name: 'Online payment window (minutes)', hint: 'Unpaid online registrations expire after this' },
  { key: 'waitlistOfferMinutes', name: 'Waitlist offer (minutes)', hint: 'Time to accept a freed place on paid events' },
  { key: 'maxUnpaidVenueReservations', name: 'Max unpaid pay-at-venue', hint: 'Open pay-at-venue registrations per student' },
  { key: 'defaultUserCancelUntilHours', name: 'Default cancel window (hours)', hint: 'Students can cancel until this long before the start' },
  { key: 'defaultRefundPct', name: 'Default refund %', hint: 'Refund on a student cancellation inside the window' },
  { key: 'inviteExpiryHours', name: 'Team invite expiry (hours)', hint: 'Unanswered team invitations expire' },
  { key: 'joinLinkDays', name: 'Team join link (days)', hint: 'Validity of a captain\'s join link' },
  { key: 'announcementsPerDay', name: 'Updates per event per day', hint: 'Organizer announcements limit' },
  { key: 'retentionDays', name: 'Data retention (days)', hint: 'Answers / check-in logs kept after an event' },
  { key: 'maxPrice', name: 'Max price (₹)', hint: 'Highest fee an organizer can set' },
  { key: 'maxCapacity', name: 'Max capacity', hint: 'Largest event an organizer can create' },
  { key: 'entryOpensBeforeMin', name: 'Entry opens (min before start)', hint: 'Default gate opening for new events' },
];

type Switch = 'enabled' | 'walletEnabled' | 'onlinePayEnabled';

export default function SettingsTab({ tick, onChanged }: { tick: number; onChanged: () => void }) {
  const { data, loading, error, reload } = useLoader('settings', tick, () => campusEventsApi.settings());
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Notice>(null);
  const [switchTo, setSwitchTo] = useState<{ key: Switch; value: boolean } | null>(null);
  useEffect(() => {
    if (data && !dirty) setForm(Object.fromEntries(FIELDS.map((f) => [f.key, String(data.settings[f.key])])));
  }, [data, dirty]);
  if (error && !data) return <ErrorBox text={error} retry={reload} />;
  if (loading || !data) return <Loading text="Loading settings…" />;

  const problems: Record<string, string> = {};
  for (const f of FIELDS) {
    const [min, max] = SETTING_RANGES[f.key];
    const v = form[f.key];
    const n = Number(v);
    if (v === undefined || v.trim() === '' || !Number.isInteger(n) || n < min || n > max) problems[f.key] = `Whole number from ${min} to ${max}.`;
  }
  const save = async () => {
    if (Object.keys(problems).length) { setMsg({ ok: false, text: 'Fix the highlighted fields.' }); return; }
    const patch: Partial<SettingsValues> = {};
    for (const f of FIELDS) if (Number(form[f.key]) !== data.settings[f.key]) patch[f.key] = Number(form[f.key]);
    if (!Object.keys(patch).length) { setMsg({ ok: true, text: 'Nothing changed.' }); setDirty(false); return; }
    setBusy(true); setMsg(null);
    try {
      await campusEventsApi.putSettings({ settings: patch });
      setDirty(false);
      setMsg({ ok: true, text: `Saved ${Object.keys(patch).length} setting${Object.keys(patch).length === 1 ? '' : 's'}.` });
      onChanged(); reload();
    } catch (e) { setMsg({ ok: false, text: errText(e, 'Could not save the settings.') }); } finally { setBusy(false); }
  };

  const onlineReady = data.razorpayKeysPresent;
  return (
    <section className="space-y-6" aria-label="Settings">
      <Msg msg={msg} />
      <div className="rounded-lg border border-line bg-surface p-4 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-fg">Campus events for students</h3>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-px text-xs font-medium ${data.enabled ? 'border-success/20 bg-success-soft text-success-text' : 'border-line bg-surface-2 text-fg-muted'}`}>{data.enabled ? 'On' : 'Off'}</span>
              <span className="font-mono text-xs text-fg-subtle">CAMPUS_EVENTS_ENABLED</span>
            </div>
            <p className="mt-1 text-sm text-fg-muted">When on, students can browse events, register, book slots and form teams, and organisers can submit events. When off, all of that closes (drafts are kept); students’ own registrations and tickets, check-in and every admin tool keep working.</p>
            <p className={`mt-2 text-sm ${data.ticketsReady ? 'text-fg-muted' : 'font-medium text-danger-text'}`}>
              Set CAMPUS_EVENTS_TICKET_SECRET on Render (32 or more random characters) before turning this on. {data.ticketsReady ? 'The server reports tickets are configured.' : 'The server reports it is not set: tickets cannot be issued, so the switch is locked.'}
            </p>
          </div>
          <button type="button" role="switch" aria-checked={data.enabled} disabled={!data.enabled && !data.ticketsReady} onClick={() => setSwitchTo({ key: 'enabled', value: !data.enabled })}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${data.enabled ? 'bg-accent' : 'bg-line-strong'}`}>
            <span className={`h-5 w-5 rounded-full bg-white shadow-xs transition-transform ${data.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
            <span className="sr-only">{data.enabled ? 'Turn campus events off' : 'Turn campus events on'}</span>
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-4 shadow-xs">
          <h3 className="font-semibold">ZCS Wallet payments: {data.walletEnabled ? 'ON' : 'OFF'}</h3>
          <p className="mt-1 text-sm text-warning-text">Keep off until RBI / payment-aggregator and legal review is done. ZCS would collect event fees on behalf of clubs; the wallet is non-transferable refund credit. Pay at the venue is always available.</p>
          <div className="mt-3"><Btn tone={data.walletEnabled ? 'bad' : 'plain'} onClick={() => setSwitchTo({ key: 'walletEnabled', value: !data.walletEnabled })}>{data.walletEnabled ? 'Turn wallet off' : 'Turn wallet on'}</Btn></div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4 shadow-xs">
          <h3 className="font-semibold">Online payments (Razorpay): {data.onlinePayEnabled ? (onlineReady ? 'ON' : 'ON but keys missing') : 'OFF'}</h3>
          {onlineReady
            ? <p className="mt-1 text-sm text-fg-muted">Razorpay keys are configured on the server. Payments are confirmed only by the signed webhook, never by the app.</p>
            : <p className="mt-1 text-sm text-fg-muted">Not available yet: set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET on Render (and point the Razorpay webhook to /api/campus-events/webhooks/razorpay). Until then students cannot choose online payment.</p>}
          <div className="mt-3"><Btn tone={data.onlinePayEnabled ? 'bad' : 'plain'} disabled={!onlineReady && !data.onlinePayEnabled} onClick={() => setSwitchTo({ key: 'onlinePayEnabled', value: !data.onlinePayEnabled })}>{data.onlinePayEnabled ? 'Turn online payments off' : 'Turn online payments on'}</Btn></div>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface p-4 shadow-xs">
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
        <p className="mt-3 text-xs text-fg-muted">Organizer and admin cancellations always refund in full. Categories: {data.categories.join(', ')}.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Btn tone="primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save settings'}</Btn>
          {dirty && <Btn disabled={busy} onClick={() => { setDirty(false); setMsg(null); }}>Discard changes</Btn>}
        </div>
      </div>

      {switchTo && (
        <ConfirmDialog open tone={switchTo.value ? 'good' : 'bad'}
          title={{ enabled: switchTo.value ? 'Turn Campus Events ON for students?' : 'Turn Campus Events OFF?', walletEnabled: switchTo.value ? 'Turn on wallet payments?' : 'Turn off wallet payments?', onlinePayEnabled: switchTo.value ? 'Turn on online payments?' : 'Turn off online payments?' }[switchTo.key]}
          confirmLabel={switchTo.value ? 'Turn on' : 'Turn off'}
          body={{
            enabled: switchTo.value
              ? <><p className="font-semibold text-warning-text">Confirm CAMPUS_EVENTS_TICKET_SECRET is set on Render and the pilot organizers / venue staff are ready.</p><p>Students immediately see Campus Events in the app and can register for published events.</p></>
              : <p>Browsing, registration, slot booking, teams and organizer submissions stop immediately. Existing registrations and tickets stay valid; check-in keeps working.</p>,
            walletEnabled: switchTo.value ? <p className="font-semibold text-warning-text">Only after RBI / payment and legal review. Students will be able to pay event fees from their ZCS Wallet.</p> : <p>New registrations can no longer pay by wallet. Existing wallet payments and refunds are unaffected.</p>,
            onlinePayEnabled: switchTo.value ? <p>Students can pay by Razorpay where organizers allow it. Registrations confirm only after the verified webhook.</p> : <p>New registrations can no longer pay online. Payments already in progress still complete or expire normally.</p>,
          }[switchTo.key]}
          onCancel={() => setSwitchTo(null)}
          onConfirm={async () => {
            await campusEventsApi.putSettings({ [switchTo.key]: switchTo.value });
            setSwitchTo(null);
            setMsg({ ok: true, text: `${{ enabled: 'Campus Events', walletEnabled: 'Wallet payments', onlinePayEnabled: 'Online payments' }[switchTo.key]} turned ${switchTo.value ? 'on' : 'off'}.` });
            onChanged(); reload();
          }} />
      )}
    </section>
  );
}
