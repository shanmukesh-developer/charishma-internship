"use client";

import { useEffect, useState, type FormEvent } from 'react';
import { autoRideApi, DRIVER_STATUSES, DRIVER_DOC_KEYS, REQUIRED_DRIVER_DOCS, type Driver } from '@/lib/autoRideApi';
import { useLoader } from './hooks';
import { Btn, ConfirmDialog, Doc, Empty, ErrorBox, Expiry, Field, Loading, Msg, Pill, Select, Toolbar, errText, inputCls, maskPhone, short, when } from './ui';

const DOC_NAMES: Record<string, string> = { photo: 'Profile photo', licenceFront: 'Licence (front)', licenceBack: 'Licence (back)', badge: 'Auto badge', policeVerification: 'Police verification' };
const MISSING_NAMES: Record<string, string> = {
  licenceNumber: 'Licence number', licenceExpiresOn: 'Licence expiry', emergencyContactPhone: 'Emergency contact phone', vehicle: 'A vehicle (not rejected)',
};
const missingName = (m: string) => (m.startsWith('document:') ? DOC_NAMES[m.slice(9)] || m.slice(9) : MISSING_NAMES[m] || m);

export default function DriversTab({ tick, onChanged, openVehicle }: { tick: number; onChanged: () => void; openVehicle: (id: string) => void }) {
  const [status, setStatus] = useState('PENDING_REVIEW');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 400); return () => clearTimeout(t); }, [q]);
  const key = `${status}|${query}`;
  const { data, loading, error, reload } = useLoader(key, tick, () => autoRideApi.drivers(status, query || undefined));
  const rows = data?.drivers || [];
  const [adding, setAdding] = useState(false);
  // ?q=<name or phone> (global search) searches every status; ?new=1 (New > Auto driver) opens the form.
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const fromUrl = (qs.get('q') || '').trim();
    if (fromUrl) { setStatus('ALL'); setQ(fromUrl); }
    if (qs.get('new') === '1') setAdding(true);
  }, []);
  return (
    <section className="space-y-4" aria-label="Drivers">
      <div className="flex justify-end">
        <Btn tone="primary" onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : 'Add driver'}</Btn>
      </div>
      {adding && <AddDriverForm onCreated={() => { setStatus('PENDING_DOCS'); onChanged(); reload(); }} />}
      <Toolbar>
        <Select name="Status" value={status} onChange={setStatus} options={[...DRIVER_STATUSES, 'ALL']} />
        <label className="text-xs font-semibold text-fg-muted">Search
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or phone" className="ml-2 border border-line bg-surface p-2 text-sm font-normal text-fg" />
        </label>
        <span className="text-sm text-fg-muted">{rows.length} driver{rows.length === 1 ? '' : 's'}{rows.length >= 200 ? ' (first 200)' : ''}</span>
      </Toolbar>
      {error && <ErrorBox text={error} retry={reload} />}
      {loading ? <Loading text="Loading drivers…" />
        : rows.length === 0 ? <Empty text={status === 'PENDING_REVIEW' ? 'No drivers waiting for verification.' : 'No drivers with this status.'} /> : (
          <div className="zv-table-wrap">
            <table className="zv-table">
              <thead className="bg-surface-2/60 text-xs text-fg-muted">
                <tr><th className="p-3">Driver</th><th className="p-3">Phone</th><th className="p-3">Status</th><th className="p-3">Online</th><th className="p-3">Submitted</th><th className="p-3" /></tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {rows.map((d) => (
                  <DriverRow key={d.id} d={d} open={openId === d.id} toggle={() => setOpenId(openId === d.id ? null : d.id)} tick={tick} onChanged={() => { onChanged(); reload(); }} openVehicle={openVehicle} />
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}

// Plan B sign-up (like Zenvy Rider): the admin creates the account; the driver signs in with this number and the
// temporary password, uploads documents in the app and submits for review. Same password rule as self sign-up.
function AddDriverForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const digits = phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  const phoneOk = /^[6-9]\d{9}$/.test(digits);
  const pwOk = password.length >= 8 && password.length <= 72 && /[A-Za-z]/.test(password) && /\d/.test(password);
  const ok = name.trim().length >= 2 && phoneOk && pwOk;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await autoRideApi.createDriver({ name: name.trim(), phone: digits, password });
      setMsg({ ok: true, text: `${r.driver.name} can now sign in to Zenvy Auto Driver with ${digits} and the temporary password. Ask them to change it in the app under More > Profile and password.` });
      setName(''); setPhone(''); setPassword(''); setShow(false);
      onCreated();
    } catch (err) {
      setMsg({ ok: false, text: errText(err, 'Could not create the driver account.') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4 border border-line bg-surface-2/60 p-4" aria-label="Add driver">
      <div>
        <h3 className="text-base font-semibold">Add driver</h3>
        <p className="mt-1 text-sm text-fg-muted">Creates the account with a temporary password. The driver signs in with this number and password, uploads documents in the app and submits for verification. No SMS is needed.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field name="Full name" hint="As on the driving licence">
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} className={inputCls} autoComplete="off" />
        </Field>
        <Field name="Mobile number" hint={phone && !phoneOk ? 'Enter a 10-digit Indian mobile number.' : '10 digits, without +91'}>
          <input value={phone} onChange={(e) => setPhone(e.target.value.slice(0, 14))} inputMode="numeric" className={inputCls} autoComplete="off" />
        </Field>
        <Field name="Temporary password" hint={password && !pwOk ? 'Use 8 to 72 characters with letters and numbers.' : '8 or more characters, with letters and numbers'}>
          <div className="flex gap-2">
            <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} autoComplete="new-password" />
            <Btn onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</Btn>
          </div>
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Btn type="submit" tone="good" disabled={!ok || busy}>{busy ? 'Creating…' : 'Create account'}</Btn>
        <Msg msg={msg} />
      </div>
    </form>
  );
}

function DriverRow({ d, open, toggle, tick, onChanged, openVehicle }: { d: Driver; open: boolean; toggle: () => void; tick: number; onChanged: () => void; openVehicle: (id: string) => void }) {
  return (
    <>
      <tr className={`align-top ${open ? 'bg-surface-2/60' : ''}`}>
        <td className="p-3"><p className="font-semibold">{d.name}</p><p className="text-xs text-fg-muted">#{short(d.id)}</p></td>
        <td className="p-3 font-mono text-xs">{maskPhone(d.phone)}</td>
        <td className="p-3"><Pill s={d.status} />{d.status === 'REJECTED' && d.rejectionReason && <p className="mt-1 max-w-[220px] text-xs text-danger-text">{d.rejectionReason}</p>}{d.status === 'SUSPENDED' && d.suspendedReason && <p className="mt-1 max-w-[220px] text-xs text-danger-text">{d.suspendedReason}</p>}</td>
        <td className="p-3 text-xs">{d.isOnline ? <span className="font-semibold text-success-text">● Online</span> : <span className="text-fg-muted">Offline</span>}<p className="text-fg-muted">{d.lastOnlineAt ? `last ${when(d.lastOnlineAt)}` : ''}</p></td>
        <td className="p-3 text-xs text-fg-muted">{when(d.submittedAt)}</td>
        <td className="p-3 text-right"><Btn onClick={toggle}>{open ? 'Close' : 'Review'}</Btn></td>
      </tr>
      {open && (
        <tr><td colSpan={6} className="border-t border-line bg-surface-2 p-0"><DriverDetail id={d.id} tick={tick} onChanged={onChanged} openVehicle={openVehicle} /></td></tr>
      )}
    </>
  );
}

type Action = 'verify' | 'reject' | 'suspend' | 'unsuspend';

function DriverDetail({ id, tick, onChanged, openVehicle }: { id: string; tick: number; onChanged: () => void; openVehicle: (id: string) => void }) {
  const { data, loading, error, reload } = useLoader(id, tick, () => autoRideApi.driver(id));
  const [action, setAction] = useState<Action | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (loading) return <div className="p-5"><Loading text="Loading driver…" /></div>;
  if (error || !data) return <div className="p-5"><ErrorBox text={error || 'Could not load the driver.'} retry={reload} /></div>;
  const d = data.driver;
  const missing = data.missing.filter((m) => m !== 'vehicle');
  const canVerify = ['PENDING_REVIEW', 'REJECTED', 'PENDING_DOCS'].includes(d.status);
  const canReject = ['PENDING_REVIEW', 'PENDING_DOCS', 'VERIFIED'].includes(d.status);
  const run = async (a: Action, reason: string) => {
    if (a === 'verify') await autoRideApi.verifyDriver(d.id);
    if (a === 'reject') await autoRideApi.rejectDriver(d.id, reason);
    if (a === 'unsuspend') await autoRideApi.unsuspendDriver(d.id);
    let extra = '';
    if (a === 'suspend') { const r = await autoRideApi.suspendDriver(d.id, reason); extra = r.tripsEnded ? ` ${r.tripsEnded} upcoming trip${r.tripsEnded === 1 ? '' : 's'} ended; passengers were notified.` : ''; }
    setAction(null);
    setMsg({ ok: true, text: { verify: 'Driver verified and notified.', reject: 'Rejected. The driver sees your reason.', suspend: `Suspended and signed out.${extra}`, unsuspend: 'Reactivated. The driver was notified.' }[a] });
    onChanged();
    reload();
  };
  const dialog: Record<Action, { title: string; confirm: string; tone: 'bad' | 'good'; body: string; reason?: boolean }> = {
    verify: { title: `Verify ${d.name}?`, confirm: 'Verify driver', tone: 'good', body: 'Only verify after checking the licence photos, licence number + expiry and the profile photo. Verified drivers can go online and publish trips once their auto is approved.' },
    reject: { title: `Reject ${d.name}?`, confirm: 'Reject', tone: 'bad', reason: true, body: d.status === 'VERIFIED' ? 'This driver is verified: rejecting takes them offline. Tell them what to fix.' : 'Tell the driver what to fix. They can resubmit.' },
    suspend: { title: `Suspend ${d.name}?`, confirm: 'Suspend driver', tone: 'bad', reason: true, body: 'The driver is signed out on every device and goes offline. Upcoming trips (not already in progress) are ended and their passengers are notified; wallet payments are refunded in full.' },
    unsuspend: { title: `Reactivate ${d.name}?`, confirm: 'Reactivate', tone: 'good', body: d.reviewedAt ? 'The driver returns to Verified and must sign in again.' : 'The driver was never reviewed, so they return to Pending review.' },
  };
  const cfg = action ? dialog[action] : null;
  return (
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">{d.name} <Pill s={d.status} /></h3>
          <p className="mt-1 text-sm text-fg-muted">Phone <span className="font-mono">{d.phone}</span> · Emergency {d.emergencyContactName || '—'} <span className="font-mono">{d.emergencyContactPhone || '—'}</span></p>
          <p className="mt-1 text-sm text-fg-muted">Licence <span className="font-mono">{d.licenceNumber || '—'}</span>{d.badgeNumber ? <> · Badge <span className="font-mono">{d.badgeNumber}</span></> : null}</p>
          <Expiry date={d.licenceExpiresOn} prefix="Licence expires" />
          <p className="mt-1 text-xs text-fg-muted">Joined {when(d.createdAt)} · submitted {when(d.submittedAt)} · reviewed {when(d.reviewedAt)} · last login {when(d.lastLoginAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canVerify && <Btn tone="good" disabled={missing.length > 0} onClick={() => { setMsg(null); setAction('verify'); }}>Verify</Btn>}
          {canReject && <Btn tone="bad" onClick={() => { setMsg(null); setAction('reject'); }}>Reject</Btn>}
          {d.status !== 'SUSPENDED' && <Btn tone="bad" onClick={() => { setMsg(null); setAction('suspend'); }}>Suspend</Btn>}
          {d.status === 'SUSPENDED' && <Btn tone="good" onClick={() => { setMsg(null); setAction('unsuspend'); }}>Unsuspend</Btn>}
        </div>
      </div>
      {missing.length > 0 && canVerify && <p role="alert" className="border border-warning/30 bg-warning-soft p-3 text-sm text-warning-text">Cannot verify yet. Missing: {missing.map(missingName).join(', ')}.</p>}
      {data.missing.includes('vehicle') && <p className="text-sm text-warning-text">This driver has no vehicle under review or approved yet.</p>}
      <Msg msg={msg} />
      <div>
        <h4 className="mb-2 text-xs font-semibold text-fg-muted">Documents (private, links expire)</h4>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {DRIVER_DOC_KEYS.map((k) => <Doc key={k} name={DOC_NAMES[k]} url={d.documentPreviews?.[k]} required={REQUIRED_DRIVER_DOCS.includes(k)} />)}
        </div>
      </div>
      <div>
        <h4 className="mb-2 text-xs font-semibold text-fg-muted">Vehicles</h4>
        {data.vehicles.length === 0 ? <p className="text-sm text-fg-muted">No vehicles.</p> : (
          <ul className="space-y-1 text-sm">
            {data.vehicles.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3">
                <span className="font-mono font-semibold">{v.registration || v.registrationNumber}</span><Pill s={v.status} />
                <span className="text-fg-muted">RC {v.rcSeatingCapacity} seats{v.approvedCapacity ? ` · approved ${v.approvedCapacity}` : ''}</span>
                <button type="button" onClick={() => openVehicle(v.id)} className="text-xs font-semibold text-info-text underline">Open in Vehicles</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className="mb-2 text-xs font-semibold text-fg-muted">Recent trips</h4>
        {data.trips.length === 0 ? <p className="text-sm text-fg-muted">No trips yet.</p> : (
          <ul className="space-y-1 text-sm">
            {data.trips.slice(0, 10).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 text-fg-muted"><span className="text-xs text-fg-muted">#{short(t.id)}</span><Pill s={t.status} /><span>{when(t.departureAt)}</span><span className="text-fg-muted">{t.confirmedSeats}/{t.capacity} seats</span></li>
            ))}
          </ul>
        )}
      </div>
      {cfg && (
        <ConfirmDialog open title={cfg.title} body={<p>{cfg.body}</p>} confirmLabel={cfg.confirm} tone={cfg.tone}
          reason={cfg.reason ? { label: 'Reason (the driver sees this)', min: 5 } : undefined}
          onCancel={() => setAction(null)} onConfirm={(r) => run(action as Action, r)} />
      )}
    </div>
  );
}

