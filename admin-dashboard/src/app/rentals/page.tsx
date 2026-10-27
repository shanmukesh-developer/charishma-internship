"use client";

// Student vehicle rentals (peer to peer): listing review queue, driving licence verification,
// bookings, reports, C7 extra-charge disputes and safety settings. Backend: /api/admin/rentals/*
// (backend/modules/rentals). Live via admin:changed. Wording (C7): commercial plate = Rent (owner / renter),
// private plate = Borrow (lender / borrower).
import { Badge, Button, Notice as NoticeBox, PageHeader, Tabs, useConfirm, useToast } from '@/components/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminRequest } from '@/lib/api';
import { useAdminAuth } from '@/utils/useAdminAuth';
import { useLiveSync } from '@/lib/useLiveSync';

type Tab = 'listings' | 'licences' | 'bookings' | 'reports' | 'disputes' | 'settings';
type Mode = 'RENT' | 'BORROW';

interface Summary { pendingListings: number; liveListings: number; pendingLicences: number; openReports: number; openBookings: number; enabled: boolean; openDisputes?: number }
interface ConditionSide { photos: string[]; odometer: number | null; note: string | null; at: string | null }
interface ConditionRecord { owner: ConditionSide | null; renter: ConditionSide | null }
interface Charges {
  status: string; claimed: number; counted: number; note: string | null; photos: string[]; respondBy: string | null; respondedAt: string | null;
  disputeNote: string | null; disputePhotos: string[]; resolution: { outcome: string | null; amount: number | null; reason: string | null; at: string | null } | null;
}
interface SafetySettings { conditionPhotosRequired: boolean; otherChargesCap: number; chargesResponseHours: number; disclaimer: string }
interface AdminListing {
  id: string; title: string; rentalMode?: Mode; vehicleType: string; make: string | null; model: string | null; year: number | null; fuel: string | null;
  transmission: string | null; seats: number | null; registrationNumber: string | null; registrationDisplay: string | null; plateType: string | null;
  photos: string[]; documents: { rc: string | null; insurance: string | null; licence: string | null };
  pricePerHour: number | null; pricePerDay: number | null; securityDeposit: number; minHours: number; kmLimitPerDay: number | null; extraPerKm: number | null;
  fuelPolicy: string | null; pickupLocation: string | null; rules: string | null; helmetIncluded: boolean; status: string; rejectionReason: string | null;
  submittedAt: string | null; reviewedAt: string | null; createdAt: string | null; ratingAvg: number; ratingCount: number; tripCount: number;
  weeklyHours: Record<string, { start: string; end: string } | null>; blockedDates: { start: string; end: string }[];
  owner: { id: string; name: string; phone: string | null; email: string | null; isActive: boolean } | null;
}
interface AdminLicence {
  id: string; userId: string; status: string; licenceNumber: string | null; classes: string[]; verifiedClasses: string[] | null; expiresOn: string | null;
  frontImage: string | null; backImage: string | null; rejectionReason: string | null; submittedAt: string | null; reviewedAt: string | null;
  user: { id: string; name: string; phone: string | null; email: string | null } | null;
}
interface AdminBooking {
  id: string; status: string; rentalMode?: Mode; listingId: string; vehicleTitle: string; vehicleType: string; registration: string | null; startAt: string; endAt: string;
  billableHours: number; rentAmount: number; depositAmount: number; payAtHandover: number; extraCharges: number; finalAmount: number | null;
  renterNote: string | null; declineReason: string | null; cancelReason: string | null; cancelledBy: string | null; createdAt: string;
  owner: { id: string; name?: string; phone?: string | null }; renter: { id: string; name?: string; phone?: string | null };
  termsAcceptedAt?: string | null; termsVersion?: string | null; termsPending?: boolean;
  pickupCondition?: ConditionRecord | null; returnCondition?: ConditionRecord | null; charges?: Charges; completedAt?: string | null;
  extraBreakdown?: { extraKm?: number; perKm?: number | null; kmCharge?: number; otherCharges?: number; note?: string | null };
}
interface AdminReport {
  id: string; bookingId: string; category: string; description: string; photos: string[]; status: string; adminNote: string | null; reporterRole: string;
  reporter: { id: string; name?: string; phone?: string | null }; against: { id: string; name?: string; phone?: string | null } | null;
  booking: { id: string; status: string; vehicleTitle: string; startAt: string; endAt: string } | null; createdAt: string;
}

const LISTING_STATUSES = ['PENDING_REVIEW', 'APPROVED', 'PAUSED', 'REJECTED', 'DRAFT', 'DELETED', 'ALL'];
const LICENCE_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED', 'ALL'];
const BOOKING_STATUSES = ['', 'OPEN', 'REQUESTED', 'ACCEPTED', 'ACTIVE', 'RETURNED', 'COMPLETED', 'DECLINED', 'EXPIRED', 'CANCELLED'];
const REPORT_STATUSES = ['ACTIVE', 'OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED', 'ALL'];
const LICENCE_CLASSES = ['MCWOG', 'MCWG', 'LMV', 'LMV-NT', 'TRANS'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const label = (v: string) => v.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const inr = (n?: number | null) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const when = (v?: string | null) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '—';
};
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const statusTone: Record<string, string> = {
  PENDING_REVIEW: 'text-warning-text border-warning/30', PENDING: 'text-warning-text border-warning/30', REQUESTED: 'text-warning-text border-warning/30', OPEN: 'text-warning-text border-warning/30',
  APPROVED: 'text-success-text border-success/30', VERIFIED: 'text-success-text border-success/30', ACCEPTED: 'text-success-text border-success/30', COMPLETED: 'text-success-text border-success/30', RESOLVED: 'text-success-text border-success/30',
  ACTIVE: 'text-info-text border-info/30', RETURNED: 'text-accent-text border-accent/30', REVIEWING: 'text-info-text border-info/30', PAUSED: 'text-accent-text border-accent/30',
  REJECTED: 'text-danger-text border-danger/30', DECLINED: 'text-danger-text border-danger/30',
};
const Pill = ({ s }: { s: string }) => <span className={`border px-2 py-0.5 text-xs font-semibold ${statusTone[s] || 'text-fg-muted border-line'}`}>{label(s)}</span>;
// C7 wording: RENT (commercial plate) -> owner / renter; BORROW (private plate) -> lender / borrower.
const WORDS: Record<Mode, { giver: string; taker: string; verb: string }> = { RENT: { giver: 'Owner', taker: 'Renter', verb: 'Rent' }, BORROW: { giver: 'Lender', taker: 'Borrower', verb: 'Borrow' } };
const wordsOf = (m?: Mode | null) => WORDS[m === 'RENT' ? 'RENT' : 'BORROW'];
const ModePill = ({ m }: { m?: Mode | null }) => (
  <span className={`border px-2 py-0.5 text-xs font-semibold ${m === 'RENT' ? 'border-warning/30 text-warning-text' : 'border-success/30 text-success-text'}`}>{m === 'RENT' ? 'RENT' : 'BORROW'}</span>
);

export default function RentalsAdminPage() {
  const confirm = useConfirm();
  const toastApi = useToast();
  const { isAuthed } = useAdminAuth();
  const [tab, setTab] = useState<Tab>('listings');
  // ?tab=<id>: links from the overview's Needs attention list and the global search open the right tab.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && (['listings', 'licences', 'bookings', 'reports', 'disputes', 'settings'] as readonly string[]).includes(t)) setTab(t as Tab);
  }, []);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  // Live: any rentals queue change reloads quietly (coalesced).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bump = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => { timer.current = null; setTick((t) => t + 1); }, 600);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useLiveSync(['rental_listing', 'rental_licence', 'rental_booking', 'rental_report', 'rental_dispute'], (events) => {
    if (events.some((e) => e.action === 'created')) {
      setToast(events.some((e) => e.type === 'rental_dispute' && e.action === 'created') ? 'New extra-charges dispute'
        : events.some((e) => e.type === 'rental_report' && e.action === 'created') ? 'New rental report' : 'New item in the rentals queue');
    }
    bump();
  }, { enabled: isAuthed });
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  useEffect(() => {
    if (!isAuthed) return;
    let alive = true;
    adminRequest<Summary>('/api/admin/rentals/summary')
      .then((s) => { if (alive) { setSummary(s); setSummaryError(''); } })
      .catch((e) => { if (alive) setSummaryError(errText(e, 'Could not load the rentals summary.')); });
    return () => { alive = false; };
  }, [isAuthed, tick]);

  const toggle = async () => {
    if (!summary) return;
    const next = !summary.enabled;
    if (!next && !(await confirm({ title: 'Pause student vehicle rentals? Students will not be able to browse, list or request. Existing trips keep working.', confirmLabel: 'Pause rentals', tone: 'danger' }))) return;
    try {
      const r = await adminRequest<{ enabled: boolean }>('/api/admin/rentals/settings', { method: 'PUT', body: JSON.stringify({ enabled: next }) });
      setSummary({ ...summary, enabled: r.enabled });
    } catch (e) {
      toastApi.error(errText(e, 'Could not change the setting.'));
    }
  };

  if (!isAuthed) return null; // AppShell shows the session check

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'listings', label: 'Listings review', count: summary?.pendingListings },
    { key: 'licences', label: 'Driving licences', count: summary?.pendingLicences },
    { key: 'bookings', label: 'Bookings', count: summary?.openBookings },
    { key: 'reports', label: 'Reports', count: summary?.openReports },
    { key: 'disputes', label: 'Disputes', count: summary?.openDisputes },
    { key: 'settings', label: 'Safety settings' },
  ];

  return (
    <div className="text-fg">
      <PageHeader
        title="Rentals"
        description="Students rent (commercial plate) or borrow (private plate) bikes, scooters and cars from each other. Review listings and their RC and insurance, verify driving licences, and handle reports and extra-charge disputes. Students pay each other in cash; ZCS does not hold the money."
        meta={summary ? <Badge tone={summary.enabled ? 'success' : 'neutral'} dot>{summary.enabled ? `On · ${summary.liveListings} live vehicles` : 'Paused for students'}</Badge> : undefined}
        actions={summary ? (
          <Button variant={summary.enabled ? 'secondary' : 'primary'} onClick={toggle} title={summary.enabled ? 'Students can no longer browse, list or request; existing trips keep working.' : 'Students can browse, list and request vehicles again.'}>
            {summary.enabled ? 'Pause rentals' : 'Turn rentals on'}
          </Button>
        ) : undefined}
      >
        <Tabs ariaLabel="Rentals sections" value={tab} onChange={setTab} tabs={tabs.map(t => ({ id: t.key, label: t.label, count: t.count || null, attention: t.key !== 'bookings' }))} />
      </PageHeader>

      <div className="space-y-4">
        {summaryError && !summary && <NoticeBox tone="danger"><span className="text-fg">{summaryError} The on/off switch and counts are unavailable until it loads.</span></NoticeBox>}
        {toast && <NoticeBox tone="info"><span className="text-fg">{toast}</span></NoticeBox>}

      {tab === 'listings' && <ListingsTab tick={tick} onChanged={bump} />}
      {tab === 'licences' && <LicencesTab tick={tick} onChanged={bump} />}
      {tab === 'bookings' && <BookingsTab tick={tick} />}
      {tab === 'reports' && <ReportsTab tick={tick} onChanged={bump} />}
      {tab === 'disputes' && <DisputesTab tick={tick} onChanged={bump} />}
      {tab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}

function useLoader<T>(path: string, tick: number, pick: (d: any) => T[]) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [manual, setManual] = useState(0);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const first = useRef(true);
  // A new filter shows the spinner; live / manual reloads refresh quietly. (Declared before the loader.)
  useEffect(() => { first.current = true; }, [path]);
  useEffect(() => {
    let alive = true;
    if (first.current) setLoading(true);
    adminRequest<any>(path)
      .then((d) => { if (alive) { setRows(pickRef.current(d)); setError(''); } })
      .catch((e) => { if (alive) setError(errText(e, 'Could not load.')); })
      .finally(() => { if (alive) { setLoading(false); first.current = false; } });
    return () => { alive = false; };
  }, [path, tick, manual]);
  return { rows, loading, error, reload: () => setManual((m) => m + 1) };
}

function Empty({ text }: { text: string }) {
  return <div className="border border-line p-10 text-center text-sm text-fg-muted">{text}</div>;
}
function ErrorBox({ text, retry }: { text: string; retry: () => void }) {
  return <div role="alert" className="flex items-center justify-between gap-3 border border-danger/30 bg-danger-soft p-4 text-sm text-danger-text">{text}<button type="button" onClick={retry} className="font-semibold underline">Retry</button></div>;
}
function Select({ value, onChange, options, name }: { value: string; onChange: (v: string) => void; options: string[]; name: string }) {
  return (
    <label className="text-xs font-semibold text-fg-muted">{name}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="ml-2 border border-line bg-surface p-2 text-sm text-fg">
        {options.map((o) => <option key={o} value={o}>{o ? label(o) : 'All'}</option>)}
      </select>
    </label>
  );
}
/** Only http(s) or same-origin links are rendered as links/images (never javascript: or data: from user content). */
const safeUrl = (u: string | null | undefined) => {
  const v = String(u || '').trim();
  return /^https?:\/\//i.test(v) || (v.startsWith('/') && !v.startsWith('//')) ? v : null;
};
function Doc({ url: rawUrl, name }: { url: string | null; name: string }) {
  const url = safeUrl(rawUrl);
  if (!url) return <div className="flex h-32 items-center justify-center border border-dashed border-danger/30 text-xs text-danger-text">{name} missing</div>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block border border-line" title={`Open ${name}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={name} loading="lazy" className="h-32 w-full object-cover" />
      <span className="block bg-surface-2 px-2 py-1 text-xs font-semibold text-fg">{name} ↗</span>
    </a>
  );
}

// ── Listings ──────────────────────────────────────────────────────────────
function ListingsTab({ tick, onChanged }: { tick: number; onChanged: () => void }) {
  const [status, setStatus] = useState('PENDING_REVIEW');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 400); return () => clearTimeout(t); }, [q]);
  const { rows, loading, error, reload } = useLoader<AdminListing>(`/api/admin/rentals/listings?status=${status}${query ? `&q=${encodeURIComponent(query)}` : ''}`, tick, (d) => d.listings || []);
  return (
    <section className="space-y-4" aria-label="Listings">
      <div className="flex flex-wrap items-center gap-4 border border-line bg-surface-2/60 p-4">
        <Select name="Status" value={status} onChange={setStatus} options={LISTING_STATUSES} />
        <label className="text-xs font-semibold text-fg-muted">Plate
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="AP07…" className="ml-2 border border-line bg-surface p-2 text-sm font-normal text-fg" />
        </label>
        <span className="text-sm text-fg-muted">{rows.length} listing{rows.length === 1 ? '' : 's'}</span>
      </div>
      {error && <ErrorBox text={error} retry={reload} />}
      {loading ? <div role="status" className="border border-line p-8 text-sm text-fg-muted">Loading listings…</div>
        : rows.length === 0 ? <Empty text={status === 'PENDING_REVIEW' ? 'No vehicles waiting for review.' : 'No listings with this status.'} />
          : rows.map((l) => <ListingCard key={`${l.id}-${l.status}`} l={l} onChanged={onChanged} />)}
    </section>
  );
}

function ListingCard({ l, onChanged }: { l: AdminListing; onChanged: () => void }) {
  const confirm = useConfirm();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [state, setState] = useState(l.status);
  const act = async (kind: 'approve' | 'reject') => {
    if (kind === 'reject' && reason.trim().length < 5) return setMsg({ ok: false, text: 'Write a reason the student will see (at least 5 characters).' });
    if (kind === 'reject' && l.status === 'APPROVED' && !(await confirm({ title: 'Take this live vehicle down? Pending requests will be declined.', confirmLabel: 'Take it down', tone: 'danger' }))) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminRequest<{ listing: AdminListing }>(`/api/admin/rentals/listings/${l.id}/${kind}`, { method: 'POST', body: JSON.stringify(kind === 'reject' ? { reason: reason.trim() } : {}) });
      setState(r.listing.status);
      setMsg({ ok: true, text: kind === 'approve' ? 'Approved. The vehicle is live and the owner was notified.' : 'Rejected. The owner sees your reason.' });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errText(e, 'Could not update the listing.') });
    } finally {
      setBusy(false);
    }
  };
  const weekly = Object.entries(l.weeklyHours || {}).filter(([, v]) => !!v) as [string, { start: string; end: string }][];
  return (
    <article className="rounded-lg border border-line bg-surface p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{l.title}{l.year ? ` · ${l.year}` : ''}</h2>
            <span className="border border-info/30 px-2 py-0.5 text-xs font-semibold text-info-text">{label(l.vehicleType)}</span>
            <Pill s={state} />
            {l.plateType && <span className={`border px-2 py-0.5 text-xs font-semibold ${l.plateType === 'PRIVATE' ? 'border-warning/30 text-warning-text' : 'border-success/30 text-success-text'}`}>Plate: {l.plateType === 'PRIVATE' ? 'Private (white) · students BORROW it' : 'Commercial rental · students RENT it'}</span>}
          </div>
          <p className="mt-2 font-mono text-sm text-fg">{l.registrationDisplay || l.registrationNumber || 'No registration'}</p>
          <p className="mt-1 text-xs text-fg-muted">Submitted {when(l.submittedAt)} · #{l.id.slice(-8).toUpperCase()}</p>
        </div>
        <div className="text-right text-sm">
          <p className="text-xs text-fg-muted">{wordsOf(l.rentalMode).giver}</p>
          <p className="font-semibold">{l.owner?.name || 'Unknown'}{l.owner && !l.owner.isActive ? ' (suspended)' : ''}</p>
          <p className="text-fg-muted">{l.owner?.phone || ''}{l.owner?.email ? ` · ${l.owner.email}` : ''}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(l.photos || []).slice(0, 3).map((u, i) => <Doc key={u} url={u} name={`Photo ${i + 1}`} />)}
        <Doc url={l.documents?.rc ?? null} name="RC" />
        <Doc url={l.documents?.insurance ?? null} name="Insurance" />
        <Doc url={l.documents?.licence ?? null} name={`${wordsOf(l.rentalMode).giver} licence`} />
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-xs text-fg-muted">Price</dt><dd>{[l.pricePerHour ? `${inr(l.pricePerHour)}/hr` : null, l.pricePerDay ? `${inr(l.pricePerDay)}/day` : null].filter(Boolean).join(' · ') || '—'} · min {l.minHours} h</dd></div>
        <div><dt className="text-xs text-fg-muted">Deposit / km</dt><dd>{inr(l.securityDeposit)} · {l.kmLimitPerDay ? `${l.kmLimitPerDay} km/day${l.extraPerKm ? `, ₹${l.extraPerKm}/km` : ''}` : 'no km limit'}</dd></div>
        <div><dt className="text-xs text-fg-muted">Vehicle</dt><dd>{[l.fuel, l.transmission, l.seats ? `${l.seats} seats` : null, l.vehicleType !== 'CAR' ? (l.helmetIncluded ? 'helmet incl.' : 'no helmet') : null].filter(Boolean).map((x) => label(String(x))).join(' · ')}</dd></div>
        <div><dt className="text-xs text-fg-muted">Pickup</dt><dd>{l.pickupLocation || '—'}</dd></div>
        <div><dt className="text-xs text-fg-muted">Hours</dt><dd>{weekly.length ? weekly.map(([d, w]) => `${DAYS[Number(d)]} ${w.start}-${w.end}`).join(', ') : 'Any time'}</dd></div>
        <div><dt className="text-xs text-fg-muted">Blocked</dt><dd>{l.blockedDates?.length ? l.blockedDates.map((b) => (b.start === b.end ? b.start : `${b.start}→${b.end}`)).join(', ') : '—'}</dd></div>
        <div><dt className="text-xs text-fg-muted">Track record</dt><dd>{l.tripCount} trips · {l.ratingCount ? `★ ${l.ratingAvg.toFixed(1)} (${l.ratingCount})` : 'no ratings'}</dd></div>
        <div><dt className="text-xs text-fg-muted">Fuel policy</dt><dd>{l.fuelPolicy || '—'}</dd></div>
      </dl>
      {l.rules && <p className="mt-3 whitespace-pre-wrap border-l border-line pl-3 text-sm text-fg-muted">{l.rules}</p>}
      {l.rejectionReason && <p className="mt-3 text-sm text-danger-text">Last rejection: {l.rejectionReason}</p>}
      {['PENDING_REVIEW', 'APPROVED', 'PAUSED'].includes(state) && (
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          {state === 'PENDING_REVIEW' && <button type="button" disabled={busy} onClick={() => act('approve')} className="bg-success px-4 py-2 text-sm font-semibold hover:bg-success/90 disabled:opacity-50">Approve</button>}
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={state === 'PENDING_REVIEW' ? 'Reason to reject (sent to owner)' : 'Reason to take it down'} className="min-w-[260px] flex-1 border border-line bg-surface p-2 text-sm text-fg" />
          <button type="button" disabled={busy} onClick={() => act('reject')} className="border border-danger/30 px-4 py-2 text-sm font-semibold text-danger-text hover:bg-danger-soft disabled:opacity-50">{state === 'PENDING_REVIEW' ? 'Reject' : 'Take down'}</button>
        </div>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-3 text-sm ${msg.ok ? 'text-success-text' : 'text-danger-text'}`}>{msg.text}</p>}
    </article>
  );
}

// ── Licences ──────────────────────────────────────────────────────────────
function LicencesTab({ tick, onChanged }: { tick: number; onChanged: () => void }) {
  const [status, setStatus] = useState('PENDING');
  const { rows, loading, error, reload } = useLoader<AdminLicence>(`/api/admin/rentals/licences?status=${status}`, tick, (d) => d.licences || []);
  return (
    <section className="space-y-4" aria-label="Driving licences">
      <div className="flex flex-wrap items-center gap-4 border border-line bg-surface-2/60 p-4">
        <Select name="Status" value={status} onChange={setStatus} options={LICENCE_STATUSES} />
        <span className="text-sm text-fg-muted">Renters can request with a pending licence; owners can only accept once you verify it.</span>
      </div>
      {error && <ErrorBox text={error} retry={reload} />}
      {loading ? <div role="status" className="border border-line p-8 text-sm text-fg-muted">Loading licences…</div>
        : rows.length === 0 ? <Empty text="No licences here." /> : rows.map((l) => <LicenceCard key={`${l.id}-${l.status}-${l.submittedAt}`} l={l} onChanged={onChanged} />)}
    </section>
  );
}

function LicenceCard({ l, onChanged }: { l: AdminLicence; onChanged: () => void }) {
  const [classes, setClasses] = useState<string[]>(l.verifiedClasses || l.classes || []);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState(l.status);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (kind: 'verify' | 'reject') => {
    if (kind === 'verify' && !classes.length) return setMsg({ ok: false, text: 'Tick at least one class printed on the licence.' });
    if (kind === 'reject' && reason.trim().length < 5) return setMsg({ ok: false, text: 'Write a reason (at least 5 characters).' });
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminRequest<{ licence: AdminLicence }>(`/api/admin/rentals/licences/${l.id}/${kind}`, { method: 'POST', body: JSON.stringify(kind === 'verify' ? { classes } : { reason: reason.trim() }) });
      setState(r.licence.status);
      setMsg({ ok: true, text: kind === 'verify' ? `Verified for ${classes.join(', ')}.` : 'Rejected. The student was notified.' });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errText(e, 'Could not update the licence.') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="grid gap-5 border border-line p-5 lg:grid-cols-[1fr_1.4fr]">
      <div className="grid grid-cols-2 gap-3">
        <Doc url={l.frontImage} name="Front" />
        {l.backImage ? <Doc url={l.backImage} name="Back" /> : <div className="flex h-32 items-center justify-center border border-dashed border-line text-xs text-fg-muted">No back photo</div>}
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{l.user?.name || l.userId}</h2><Pill s={state} /></div>
        <p className="mt-1 text-sm text-fg-muted">{l.user?.phone || ''}{l.user?.email ? ` · ${l.user.email}` : ''}</p>
        <p className="mt-3 font-mono text-base">{l.licenceNumber}</p>
        <p className="mt-1 text-sm text-fg-muted">Declared: {(l.classes || []).join(', ') || '—'}{l.expiresOn ? ` · valid till ${l.expiresOn}` : ''} · submitted {when(l.submittedAt)}</p>
        {l.rejectionReason && <p className="mt-1 text-sm text-danger-text">Rejected: {l.rejectionReason}</p>}
        <fieldset className="mt-4">
          <legend className="text-xs font-semibold text-fg-muted">Classes printed on the card</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {LICENCE_CLASSES.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={classes.includes(c)} onChange={(e) => setClasses((cur) => (e.target.checked ? [...cur, c] : cur.filter((x) => x !== c)))} />{c}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {state !== 'VERIFIED' && <button type="button" disabled={busy} onClick={() => act('verify')} className="bg-success px-4 py-2 text-sm font-semibold hover:bg-success/90 disabled:opacity-50">Verify</button>}
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Reason to reject" className="min-w-[220px] flex-1 border border-line bg-surface p-2 text-sm text-fg" />
          <button type="button" disabled={busy} onClick={() => act('reject')} className="border border-danger/30 px-4 py-2 text-sm font-semibold text-danger-text hover:bg-danger-soft disabled:opacity-50">Reject</button>
        </div>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-3 text-sm ${msg.ok ? 'text-success-text' : 'text-danger-text'}`}>{msg.text}</p>}
      </div>
    </article>
  );
}

// ── Bookings ──────────────────────────────────────────────────────────────
function BookingsTab({ tick }: { tick: number }) {
  const [status, setStatus] = useState('OPEN');
  const [search, setSearch] = useState('');
  const { rows, loading, error, reload } = useLoader<AdminBooking>(`/api/admin/rentals/bookings${status ? `?status=${status}` : ''}`, tick, (d) => d.bookings || []);
  const q = search.trim().toLowerCase();
  const list = rows.filter((b) => !q || [b.id, b.vehicleTitle, b.registration, b.owner.name, b.owner.phone, b.renter.name, b.renter.phone].some((v) => String(v || '').toLowerCase().includes(q)));
  return (
    <section className="space-y-4" aria-label="Bookings">
      <div className="flex flex-wrap items-center gap-4 border border-line bg-surface-2/60 p-4">
        <Select name="Status" value={status} onChange={setStatus} options={BOOKING_STATUSES} />
        <label className="text-xs font-semibold text-fg-muted">Search
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone, plate, ID" className="ml-2 border border-line bg-surface p-2 text-sm font-normal text-fg" />
        </label>
        <span className="text-sm text-fg-muted">{list.length} of {rows.length}</span>
      </div>
      {error && <ErrorBox text={error} retry={reload} />}
      {loading ? <div role="status" className="border border-line p-8 text-sm text-fg-muted">Loading bookings…</div>
        : list.length === 0 ? <Empty text="No bookings match." /> : (
          <div className="zv-table-wrap">
            <table className="zv-table">
              <thead className="bg-surface-2/60 text-xs text-fg-muted">
                <tr><th className="p-3">Vehicle</th><th className="p-3">Owner / lender → renter / borrower</th><th className="p-3">When</th><th className="p-3">Cash</th><th className="p-3">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {list.map((b) => (
                  <tr key={b.id} className="align-top">
                    <td className="p-3"><p className="font-semibold">{b.vehicleTitle}</p><p className="mt-1"><ModePill m={b.rentalMode} /></p><p className="font-mono text-xs text-fg-muted">{b.registration || ''}</p><p className="text-xs text-fg-muted">#{b.id.slice(-8).toUpperCase()}</p></td>
                    <td className="p-3"><p><span className="text-xs text-fg-muted">{wordsOf(b.rentalMode).giver}:</span> {b.owner.name || b.owner.id} <span className="text-fg-muted">{b.owner.phone || ''}</span></p><p className="text-fg-muted"><span className="text-xs text-fg-muted">{wordsOf(b.rentalMode).taker}:</span> {b.renter.name || b.renter.id} <span className="text-fg-muted">{b.renter.phone || ''}</span></p>{b.renterNote && <p className="mt-1 text-xs text-fg-muted">“{b.renterNote}”</p>}<p className="mt-1 text-xs text-fg-muted">{b.termsPending ? <span className="text-warning-text">Terms not accepted yet (older app)</span> : b.termsAcceptedAt ? `Terms accepted ${when(b.termsAcceptedAt)}` : ''}</p>{(b.pickupCondition || b.returnCondition) && <ConditionLinks b={b} />}</td>
                    <td className="p-3 text-xs"><p>{when(b.startAt)}</p><p className="text-fg-muted">→ {when(b.endAt)}</p><p className="text-fg-muted">{b.billableHours} h billed</p></td>
                    <td className="p-3 text-xs"><p>{b.rentalMode === 'RENT' ? 'Rent' : 'Cost share'} {inr(b.rentAmount)}</p><p className="text-fg-muted">Deposit {inr(b.depositAmount)}</p>{b.charges && b.charges.status !== 'NONE' && <p className="text-warning-text">Extras claimed {inr(b.charges.claimed)} · {label(b.charges.status)}</p>}{b.extraCharges > 0 && <p className="text-warning-text">Extras counted {inr(b.extraCharges)}</p>}{b.finalAmount != null && <p className="font-semibold">Final {inr(b.finalAmount)}</p>}</td>
                    <td className="p-3"><Pill s={b.status} />{(b.cancelReason || b.declineReason) && <p className="mt-1 max-w-[220px] text-xs text-fg-muted">{b.cancelledBy ? `${label(b.cancelledBy)}: ` : ''}{b.cancelReason || b.declineReason}</p>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}

/** Small links to the private (signed) pickup / return photos of a booking. */
function ConditionLinks({ b }: { b: AdminBooking }) {
  const items: { name: string; url: string }[] = [];
  const add = (rec: ConditionRecord | null | undefined, stage: string) => {
    if (!rec) return;
    (rec.owner?.photos || []).forEach((u, i) => items.push({ name: `${stage} ${wordsOf(b.rentalMode).giver.toLowerCase()} ${i + 1}`, url: u }));
    (rec.renter?.photos || []).forEach((u, i) => items.push({ name: `${stage} ${wordsOf(b.rentalMode).taker.toLowerCase()} ${i + 1}`, url: u }));
  };
  add(b.pickupCondition, 'Pickup');
  add(b.returnCondition, 'Return');
  const odo = [b.pickupCondition?.owner?.odometer, b.returnCondition?.owner?.odometer];
  return (
    <p className="mt-1 text-xs text-fg-muted">
      {items.map((x) => { const u = safeUrl(x.url); return u ? <a key={x.url} href={u} target="_blank" rel="noreferrer" className="mr-2 underline">{x.name}</a> : null; })}
      {odo[0] != null && <span className="ml-1">Odometer {odo[0]}{odo[1] != null ? ` → ${odo[1]} km` : ' km'}</span>}
    </p>
  );
}

// ── Disputes (C7: extra charges the renter / borrower disputed) ────────────
function DisputesTab({ tick, onChanged }: { tick: number; onChanged: () => void }) {
  const [status, setStatus] = useState('OPEN');
  const { rows, loading, error, reload } = useLoader<AdminBooking>(`/api/admin/rentals/disputes?status=${status}`, tick, (d) => d.disputes || []);
  return (
    <section className="space-y-4" aria-label="Disputes">
      <div className="flex flex-wrap items-center gap-4 border border-line bg-surface-2/60 p-4">
        <Select name="Status" value={status} onChange={setStatus} options={['OPEN', 'RESOLVED', 'ALL']} />
        <span className="text-sm text-fg-muted">Extra charges the renter / borrower disputed. They do not count until you decide. Every decision is audited and both students are told the reason.</span>
      </div>
      {error && <ErrorBox text={error} retry={reload} />}
      {loading ? <div role="status" className="border border-line p-8 text-sm text-fg-muted">Loading disputes…</div>
        : rows.length === 0 ? <Empty text={status === 'OPEN' ? 'No open disputes.' : 'No disputes here.'} /> : rows.map((b) => <DisputeCard key={`${b.id}-${b.charges?.status}`} b={b} onChanged={onChanged} />)}
    </section>
  );
}

function ConditionBlock({ title, rec, mode }: { title: string; rec: ConditionRecord | null | undefined; mode?: Mode }) {
  if (!rec || (!rec.owner && !rec.renter)) return <div className="text-xs text-fg-muted">{title}: no photos recorded.</div>;
  const side = (who: string, s: ConditionSide | null) => (s ? (
    <div className="space-y-1">
      <p className="text-xs text-fg-muted">{who}{s.odometer != null ? ` · odometer ${s.odometer} km` : ''}{s.at ? ` · ${when(s.at)}` : ''}</p>
      <div className="grid grid-cols-3 gap-2">{s.photos.map((u, i) => <Doc key={u} url={u} name={`${who} ${i + 1}`} />)}</div>
      {s.note && <p className="text-xs text-fg-muted">“{s.note}”</p>}
    </div>
  ) : null);
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-fg-muted">{title}</p>
      {side(wordsOf(mode).giver, rec.owner)}
      {side(wordsOf(mode).taker, rec.renter)}
    </div>
  );
}

function DisputeCard({ b, onChanged }: { b: AdminBooking; onChanged: () => void }) {
  const confirm = useConfirm();
  const ch = b.charges;
  const w = wordsOf(b.rentalMode);
  const [outcome, setOutcome] = useState<'UPHOLD' | 'REDUCE' | 'VOID'>('REDUCE');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [state, setState] = useState(ch?.status || 'DISPUTED');
  if (!ch) return null;
  const resolve = async () => {
    if (reason.trim().length < 5) return setMsg({ ok: false, text: 'Write a reason both students will see (at least 5 characters).' });
    const amt = Number(amount);
    if (outcome === 'REDUCE' && (!amount || !Number.isFinite(amt) || amt < 0 || amt >= ch.claimed)) return setMsg({ ok: false, text: `Enter the reduced amount (less than ${inr(ch.claimed)}).` });
    if (!(await confirm({ title: outcome === 'UPHOLD' ? `Uphold ${inr(ch.claimed)}?` : outcome === 'VOID' ? 'Cancel all extra charges?' : `Reduce the charges to ${inr(amt)}?`, confirmLabel: 'Confirm', tone: 'default' }))) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminRequest<{ booking: AdminBooking; message: string }>(`/api/admin/rentals/disputes/${b.id}/resolve`, { method: 'POST', body: JSON.stringify({ outcome, reason: reason.trim(), ...(outcome === 'REDUCE' ? { amount: amt } : {}) }) });
      setState(r.booking.charges?.status || 'RESOLVED');
      setMsg({ ok: true, text: r.message || 'Resolved.' });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errText(e, 'Could not resolve the dispute.') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="rounded-lg border border-line bg-surface p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{b.vehicleTitle}</h2><ModePill m={b.rentalMode} /><Pill s={state} /></div>
          <p className="mt-1 text-sm text-fg-muted">{when(b.startAt)} → {when(b.endAt)} · #{b.id.slice(-8).toUpperCase()} · {b.registration || ''}</p>
          <p className="mt-1 text-sm">{w.verb === 'Rent' ? 'Rent' : 'Cost share'} {inr(b.rentAmount)} · deposit {inr(b.depositAmount)} · claimed <b className="text-warning-text">{inr(ch.claimed)}</b>{b.extraBreakdown?.extraKm ? ` (${b.extraBreakdown.extraKm} km × ₹${b.extraBreakdown.perKm || 0}${b.extraBreakdown.otherCharges ? ` + other ${inr(b.extraBreakdown.otherCharges)}` : ''})` : ''}</p>
        </div>
        <div className="text-right text-sm">
          <p>{w.giver}: <b>{b.owner.name || b.owner.id}</b> {b.owner.phone || ''}</p>
          <p className="text-fg-muted">{w.taker}: <b>{b.renter.name || b.renter.id}</b> {b.renter.phone || ''}</p>
          <p className="text-xs text-fg-muted">Disputed {when(ch.respondedAt)}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-2 border border-line p-3">
          <p className="text-xs font-semibold text-fg-muted">{w.giver}&apos;s claim</p>
          <p className="whitespace-pre-wrap text-sm text-fg">{ch.note || '—'}</p>
          {ch.photos.length > 0 && <div className="grid grid-cols-3 gap-2">{ch.photos.map((u, i) => <Doc key={u} url={u} name={`Evidence ${i + 1}`} />)}</div>}
        </div>
        <div className="space-y-2 border border-line p-3">
          <p className="text-xs font-semibold text-fg-muted">{w.taker}&apos;s dispute</p>
          <p className="whitespace-pre-wrap text-sm text-fg">{ch.disputeNote || '—'}</p>
          {ch.disputePhotos.length > 0 && <div className="grid grid-cols-3 gap-2">{ch.disputePhotos.map((u, i) => <Doc key={u} url={u} name={`Dispute ${i + 1}`} />)}</div>}
        </div>
        <div className="rounded-lg border border-line bg-surface p-4 shadow-xs"><ConditionBlock title="Pickup condition" rec={b.pickupCondition} mode={b.rentalMode} /></div>
        <div className="rounded-lg border border-line bg-surface p-4 shadow-xs"><ConditionBlock title="Return condition" rec={b.returnCondition} mode={b.rentalMode} /></div>
      </div>
      {ch.resolution && <p className="mt-3 text-sm text-success-text">Decision {when(ch.resolution.at)}: {label(ch.resolution.outcome || '')} · counted {inr(ch.counted)} · {ch.resolution.reason}</p>}
      {state === 'DISPUTED' && (
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as 'UPHOLD' | 'REDUCE' | 'VOID')} className="border border-line bg-surface p-2 text-sm text-fg" aria-label="Decision">
            <option value="UPHOLD">Uphold the full claim</option>
            <option value="REDUCE">Reduce the claim</option>
            <option value="VOID">Void (no extra charges)</option>
          </select>
          {outcome === 'REDUCE' && <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder={`New amount (< ${inr(ch.claimed)})`} className="w-48 border border-line bg-surface p-2 text-sm text-fg" aria-label="Reduced amount" />}
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Reason (sent to both students)" className="min-w-[260px] flex-1 border border-line bg-surface p-2 text-sm text-fg" />
          <button type="button" disabled={busy} onClick={resolve} className="bg-accent px-4 py-2 text-sm font-semibold hover:bg-accent-hover disabled:opacity-50">{busy ? 'Saving…' : 'Resolve'}</button>
        </div>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-3 text-sm ${msg.ok ? 'text-success-text' : 'text-danger-text'}`}>{msg.text}</p>}
    </article>
  );
}

// ── Safety settings (C7) ──────────────────────────────────────────────────
function SettingsTab() {
  const [s, setS] = useState<SafetySettings | null>(null);
  const [dflt, setDflt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    let alive = true;
    adminRequest<{ safety: SafetySettings; defaultDisclaimer: string }>('/api/admin/rentals/settings')
      .then((d) => { if (alive) { setS(d.safety); setDflt(d.defaultDisclaimer || ''); setError(''); } })
      .catch((e) => { if (alive) setError(errText(e, 'Could not load the settings.')); });
    return () => { alive = false; };
  }, []);
  if (error) return <ErrorBox text={error} retry={() => window.location.reload()} />;
  if (!s) return <div role="status" className="border border-line p-8 text-sm text-fg-muted">Loading settings…</div>;
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminRequest<{ safety: SafetySettings }>('/api/admin/rentals/settings', { method: 'PUT', body: JSON.stringify({ safety: { conditionPhotosRequired: s.conditionPhotosRequired, otherChargesCap: Number(s.otherChargesCap), chargesResponseHours: Number(s.chargesResponseHours), disclaimer: s.disclaimer } }) });
      setS(r.safety);
      setMsg({ ok: true, text: 'Saved. Apps and the /legal pages use the new values within a minute.' });
    } catch (e) {
      setMsg({ ok: false, text: errText(e, 'Could not save.') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="max-w-3xl space-y-5 border border-line p-5" aria-label="Safety settings">
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={s.conditionPhotosRequired} onChange={(e) => setS({ ...s, conditionPhotosRequired: e.target.checked })} className="mt-1" />
        <span><b>Require pickup and return photos + odometer</b><br /><span className="text-fg-muted">The owner / lender must record 2-6 photos and the odometer reading before the pickup and the return PIN step. Recommended ON.</span></span>
      </label>
      <label className="block text-sm"><b>Other charges cap (₹ per trip)</b>
        <input value={String(s.otherChargesCap)} onChange={(e) => setS({ ...s, otherChargesCap: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} inputMode="decimal" className="mt-1 block w-48 border border-line bg-surface p-2 text-fg" />
        <span className="text-xs text-fg-muted">Never more than 2 × the trip&apos;s deposit (when there is one). Bigger damage goes through a report.</span>
      </label>
      <label className="block text-sm"><b>Time to accept or dispute extra charges (hours)</b>
        <input value={String(s.chargesResponseHours)} onChange={(e) => setS({ ...s, chargesResponseHours: Number(e.target.value.replace(/\D/g, '')) || 0 })} inputMode="numeric" className="mt-1 block w-48 border border-line bg-surface p-2 text-fg" />
        <span className="text-xs text-fg-muted">After this, unanswered charges count as accepted (1-168).</span>
      </label>
      <label className="block text-sm"><b>Insurance / liability disclaimer</b>
        <textarea value={s.disclaimer} onChange={(e) => setS({ ...s, disclaimer: e.target.value.slice(0, 1000) })} rows={4} placeholder={dflt} className="mt-1 block w-full border border-line bg-surface p-2 text-fg" />
        <span className="text-xs text-fg-muted">Shown on every listing and booking review. Leave empty to use the default (built from Config → Legal).</span>
      </label>
      <button type="button" disabled={busy} onClick={save} className="bg-accent px-4 py-2 text-sm font-semibold hover:bg-accent-hover disabled:opacity-50">{busy ? 'Saving…' : 'Save settings'}</button>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-success-text' : 'text-danger-text'}`}>{msg.text}</p>}
    </section>
  );
}

// ── Reports ───────────────────────────────────────────────────────────────
function ReportsTab({ tick, onChanged }: { tick: number; onChanged: () => void }) {
  const [status, setStatus] = useState('ACTIVE');
  const { rows, loading, error, reload } = useLoader<AdminReport>(`/api/admin/rentals/reports?status=${status}`, tick, (d) => d.reports || []);
  return (
    <section className="space-y-4" aria-label="Reports">
      <div className="flex flex-wrap items-center gap-4 border border-line bg-surface-2/60 p-4">
        <Select name="Status" value={status} onChange={setStatus} options={REPORT_STATUSES} />
        <span className="text-sm text-fg-muted">Damage, no-shows, late returns and safety issues reported by owners and renters.</span>
      </div>
      {error && <ErrorBox text={error} retry={reload} />}
      {loading ? <div role="status" className="border border-line p-8 text-sm text-fg-muted">Loading reports…</div>
        : rows.length === 0 ? <Empty text="No reports here." /> : rows.map((r) => <ReportCard key={`${r.id}-${r.status}`} r={r} onChanged={onChanged} />)}
    </section>
  );
}

function ReportCard({ r, onChanged }: { r: AdminReport; onChanged: () => void }) {
  const [next, setNext] = useState(r.status === 'OPEN' ? 'REVIEWING' : r.status);
  const [note, setNote] = useState(r.adminNote || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await adminRequest(`/api/admin/rentals/reports/${r.id}/status`, { method: 'POST', body: JSON.stringify({ status: next, note: note.trim() || undefined }) });
      setMsg({ ok: true, text: ['RESOLVED', 'DISMISSED'].includes(next) ? 'Closed. The reporter was notified.' : 'Updated.' });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errText(e, 'Could not update the report.') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="rounded-lg border border-line bg-surface p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{label(r.category)}</h2><Pill s={r.status} /><span className="text-xs text-fg-muted">{when(r.createdAt)}</span></div>
          <p className="mt-1 text-sm text-fg-muted">{r.booking ? `${r.booking.vehicleTitle || 'Vehicle'} · ${when(r.booking.startAt)} → ${when(r.booking.endAt)} · booking ${label(r.booking.status)}` : `Booking ${r.bookingId}`}</p>
        </div>
        <div className="text-right text-sm">
          <p>By <b>{r.reporter.name || r.reporter.id}</b> ({label(r.reporterRole || '')}) {r.reporter.phone || ''}</p>
          {r.against && <p className="text-fg-muted">About {r.against.name || r.against.id} {r.against.phone || ''}</p>}
        </div>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm text-fg">{r.description}</p>
      {r.photos?.length > 0 && <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{r.photos.map((u, i) => <Doc key={u} url={u} name={`Photo ${i + 1}`} />)}</div>}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <select value={next} onChange={(e) => setNext(e.target.value)} className="border border-line bg-surface p-2 text-sm text-fg" aria-label="Report status">
          {['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Note (shown to the reporter when closed)" className="min-w-[260px] flex-1 border border-line bg-surface p-2 text-sm text-fg" />
        <button type="button" disabled={busy} onClick={save} className="bg-accent px-4 py-2 text-sm font-semibold hover:bg-accent-hover disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-3 text-sm ${msg.ok ? 'text-success-text' : 'text-danger-text'}`}>{msg.text}</p>}
    </article>
  );
}
