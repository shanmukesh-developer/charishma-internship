"use client";

// Campus Events admin building blocks. The look (square borders, dark panels, pills, dialogs) is shared
// with Auto-Ride / Rentals through components/autoRide/ui.
import { useState, type ReactNode } from 'react';
import {
  campusEventsApi, CATEGORY_LABELS, currentFieldValue, sameValue, sensitiveQuestion,
  type AdminEvent, type Club, type Question, type Slot, type UserHit,
} from '@/lib/campusEventsApi';
import { Btn, Pill, errText, inputCls, inr, label, maskPhone, safeUrl, short, when } from '@/components/autoRide/ui';

export { useLoader } from '@/components/autoRide/hooks';
export * from '@/components/autoRide/ui';

export type Notice = { ok: boolean; text: string } | null;

/** ISO -> value for <input type="datetime-local"> (browser local time). */
export const toLocalInput = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
/** datetime-local value -> ISO (null when empty / invalid). */
export const fromLocalInput = (v: string) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
export const range = (a?: string | null, b?: string | null) => `${when(a)} → ${when(b)}`;
export const catLabel = (c: string) => CATEGORY_LABELS[c] || label(c);

/** Formats any pending-change / audit value for display. */
export function showValue(v: unknown): string {
  if (v === undefined) return '(not shown by the API)';
  if (v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) return when(v);
  if (Array.isArray(v) && v.every((x) => x && typeof x === 'object' && 'label' in (x as object))) {
    return (v as { label: string; amount?: number; type?: string }[]).map((x) => `${x.label}${x.amount !== undefined ? ` ${inr(x.amount)}` : ''}${x.type ? ` (${label(x.type)})` : ''}`).join('; ');
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="border border-white/10 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}
export function KV({ k, v }: { k: string; v: ReactNode }) {
  return <div className="flex gap-3 text-sm"><span className="w-40 shrink-0 text-gray-500">{k}</span><span className="min-w-0 break-words text-gray-200">{v}</span></div>;
}

/** Questions list; ones asking for phone / ID / bank details are flagged for the reviewer. */
export function QuestionList({ questions }: { questions: Question[] }) {
  if (!questions.length) return <p className="text-sm text-gray-500">No organizer questions.</p>;
  const flagged = questions.filter((q) => sensitiveQuestion(q.label)).length;
  return (
    <div className="space-y-2">
      {flagged > 0 && <p role="alert" className="border border-red-400/40 bg-red-500/10 p-2 text-sm font-bold text-red-300">⚠ {flagged} question{flagged === 1 ? '' : 's'} may ask for a phone, ID / Aadhaar / roll number or bank details. Zenvy already verifies students: ask the organizer to remove {flagged === 1 ? 'it' : 'them'}.</p>}
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        {questions.map((q) => {
          const bad = sensitiveQuestion(q.label);
          return (
            <li key={q.id} className={bad ? 'text-red-300' : 'text-gray-200'}>
              {bad && <span className="mr-1 font-bold">⚠ PII</span>}{q.label} <span className="text-xs text-gray-500">· {label(q.type)}{q.required ? ' · required' : ''}{q.options ? ` · ${q.options.join(' / ')}` : ''}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** What a student will see (spec §2), built only from the admin payload. */
export function EventPreview({ ev, slots }: { ev: AdminEvent; slots?: Slot[] | null }) {
  const poster = safeUrl(ev.posterUrl);
  const el = ev.eligibility || {};
  const pol = ev.cancellationPolicy || {};
  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <div className="space-y-2">
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt={`Poster for ${ev.title}`} loading="lazy" referrerPolicy="no-referrer" className="aspect-[3/4] w-full border border-white/10 bg-black/30 object-cover" />
        ) : <div className="flex aspect-[3/4] w-full items-center justify-center border border-dashed border-white/15 text-xs text-gray-500">No poster</div>}
        {ev.gallery?.length > 0 && (
          <div className="grid grid-cols-3 gap-1">
            {ev.gallery.map((g, i) => {
              const u = safeUrl(g);
              return u ? (
                <a key={i} href={u} target="_blank" rel="noreferrer noopener">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt={`Gallery ${i + 1}`} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full border border-white/10 object-cover" />
                </a>
              ) : null;
            })}
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill s={ev.status} />
            <span className="border border-white/10 px-2 py-0.5 text-xs text-gray-300">{catLabel(ev.category)}</span>
            <span className="border border-white/10 px-2 py-0.5 text-xs text-gray-300">{label(ev.format)}</span>
            <span className={`border px-2 py-0.5 text-xs font-bold ${ev.price.isFree ? 'border-emerald-400/30 text-emerald-300' : 'border-amber-400/30 text-amber-300'}`}>{ev.price.isFree ? 'FREE' : ev.price.label}</span>
            {ev.featured && <span className="border border-violet-400/30 px-2 py-0.5 text-xs font-bold text-violet-300">★ Featured</span>}
          </div>
          <h3 className="mt-2 text-xl font-black">{ev.title}</h3>
          <p className="text-sm text-gray-400">by {ev.organizer?.name || ev.organizerName || 'Organizer'}{ev.organizer?.club ? ` · ${ev.organizer.club.name}${ev.organizer.club.verified ? ' ✓' : ' (unverified club)'}` : ''}</p>
        </div>
        <div className="space-y-1">
          <KV k="When" v={range(ev.startAt, ev.endAt)} />
          <KV k="Venue" v={<>{ev.venue || '—'}{ev.venueDirections ? <span className="block text-xs text-gray-500">{ev.venueDirections}</span> : null}</>} />
          <KV k="Registration" v={`${ev.regOpensAt ? when(ev.regOpensAt) : 'open now'} → ${ev.regClosesAt ? when(ev.regClosesAt) : 'until start'}`} />
          <KV k="Capacity" v={ev.format === 'SLOT' ? `${slots ? slots.length : '—'} slot(s), max ${ev.maxBookingsPerStudent} booking(s) per student` : ev.format === 'TEAM' ? `${ev.team?.maxTeams ?? '—'} teams of ${ev.team?.min ?? '?'}–${ev.team?.max ?? '?'} players` : `${ev.capacityRaw ?? '—'} places`} />
          {ev.team && <KV k="Team rules" v={[ev.team.captainRequired && 'captain required', ev.team.allowSubstitutions && 'substitutions allowed', ev.team.multiTeamAllowed && 'multi-team allowed', ev.team.attendancePerMember && 'per-member tickets'].filter(Boolean).join(', ') || 'none'} />}
          <KV k="Pricing" v={ev.price.isFree ? 'Free' : <>{inr(ev.price.amount)}{ev.price.extraCharges.length ? ` + ${ev.price.extraCharges.map((c) => `${c.label} ${inr(c.amount)}`).join(', ')}` : ''} = <b>{inr(ev.price.total)}</b> · pay by {ev.paymentModesConfigured.map(label).join(', ') || '—'}</>} />
          <KV k="Eligibility" v={[el.years?.length ? `years ${el.years.join(', ')}` : null, el.branches?.length ? `branches ${el.branches.join(', ')}` : null, el.adultOnly ? '18+ only' : null].filter(Boolean).join(' · ') || 'All verified students'} />
          <KV k="Approval" v={ev.approvalRequired ? 'Organizer approves each registration' : 'Automatic'} />
          <KV k="Waitlist" v={ev.waitlistEnabled ? `On · offers stay open ${ev.waitlistOfferMinutes ?? 'the default'}${ev.waitlistOfferMinutes ? ' min' : ''}` : 'Off'} />
          <KV k="Minimum participants" v={ev.minParticipants ? String(ev.minParticipants) : 'None'} />
          <KV k="Cancellation" v={`${pol.userCancelUntilHours ?? 'default'} h before start · refund ${pol.refundPct ?? 'default'}%${pol.text ? ` · ${pol.text}` : ''}`} />
          <KV k="Entry opens" v={`${ev.entryOpensBeforeMin} min before start`} />
          {ev.contactText && <KV k="Contact" v={ev.contactText} />}
          {ev.equipment && <KV k="Equipment" v={ev.equipment} />}
          {ev.tags?.length > 0 && <KV k="Tags" v={ev.tags.join(', ')} />}
        </div>
        {ev.description && <div><p className="text-xs font-bold uppercase tracking-wider text-gray-500">Description</p><p className="mt-1 whitespace-pre-wrap text-sm text-gray-200">{ev.description}</p></div>}
        {ev.instructions && <div><p className="text-xs font-bold uppercase tracking-wider text-gray-500">Instructions</p><p className="mt-1 whitespace-pre-wrap text-sm text-gray-200">{ev.instructions}</p></div>}
        <div><p className="text-xs font-bold uppercase tracking-wider text-gray-500">Rules (v{ev.rulesVersion})</p><p className="mt-1 whitespace-pre-wrap text-sm text-gray-200">{ev.rules || '—'}</p></div>
        <div><p className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-500">Registration questions</p><QuestionList questions={ev.questions || []} /></div>
        {slots && slots.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-500">Slots</p>
            <div className="overflow-x-auto border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/[0.03] uppercase text-gray-400"><tr><th className="p-2">Slot</th><th className="p-2">Time</th><th className="p-2">Capacity</th><th className="p-2">Confirmed</th><th className="p-2">Left</th><th className="p-2">Price</th><th className="p-2">State</th></tr></thead>
                <tbody className="divide-y divide-white/10">
                  {slots.map((s) => <tr key={s.id}><td className="p-2">{s.label || '—'}</td><td className="p-2">{range(s.startAt, s.endAt)}</td><td className="p-2">{s.capacity}</td><td className="p-2">{s.confirmed}</td><td className="p-2">{s.remaining}</td><td className="p-2">{s.price.label}</td><td className="p-2"><Pill s={s.state} /></td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Pending material changes after approval: field, current value, requested value. */
export function ChangesDiff({ ev }: { ev: AdminEvent }) {
  const fields = ev.pendingChanges?.fields || {};
  const keys = Object.keys(fields);
  if (!keys.length) return <p className="text-sm text-gray-500">No changes waiting.</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">Requested {when(ev.pendingChanges?.requestedAt)} by the organizer. Approving applies them at once (registrants are notified of venue / time changes; capacity can never drop below places taken).</p>
      <div className="overflow-x-auto border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/[0.03] text-xs uppercase tracking-wider text-gray-400"><tr><th className="p-2">Field</th><th className="p-2">Now</th><th className="p-2">Requested</th></tr></thead>
          <tbody className="divide-y divide-white/10">
            {keys.map((k) => {
              const cur = currentFieldValue(ev, k);
              const next = fields[k];
              const changed = cur === undefined || !sameValue(cur, next);
              const piiQs = k === 'questions' && Array.isArray(next) && (next as Question[]).some((q) => sensitiveQuestion(q && q.label));
              return (
                <tr key={k} className="align-top">
                  <td className="p-2 text-xs font-bold">{label(k)}{piiQs && <span className="ml-1 text-red-300">⚠ PII</span>}</td>
                  <td className="max-w-md p-2 text-xs text-gray-400"><span className="line-through decoration-red-400/60">{showValue(cur)}</span></td>
                  <td className={`max-w-md p-2 text-xs ${changed ? 'bg-emerald-500/10 text-emerald-200' : 'text-gray-400'}`}>{showValue(next)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Finds a user (GET /api/admin/campus-events/users?q=). Shows name, masked phone / e-mail, campus and verified only. */
export function UserPicker({ onPick, placeholder, picked, clear }: { onPick: (u: UserHit) => void; placeholder?: string; picked?: UserHit | null; clear?: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<UserHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (picked) {
    return (
      <div className="flex items-center gap-3 border border-sky-400/30 bg-sky-400/5 p-2 text-sm">
        <span className="font-bold">{picked.name || 'Unnamed'}</span><span className="text-xs text-gray-400">{picked.phoneMasked || maskPhone(picked.phone)}</span>
        {picked.campus && <span className="text-xs text-gray-400">{picked.campus.name}</span>}
        {picked.verified !== undefined && <span className={`text-xs ${picked.verified ? 'text-emerald-300' : 'text-amber-300'}`}>{picked.verified ? 'verified' : 'not verified'}</span>}<span className="font-mono text-xs text-gray-500">#{short(picked.id)}</span>
        {clear && <button type="button" onClick={clear} className="ml-auto text-xs font-bold underline">Change</button>}
      </div>
    );
  }
  const run = async () => {
    const term = q.trim();
    if (term.length < 2) { setErr('Type at least 2 characters.'); return; }
    setBusy(true); setErr('');
    try {
      const d = await campusEventsApi.searchUsers(term);
      const list = (d.users || []).filter((u) => u && u.id);
      setHits(list);
      if (!list.length) setErr('No users match.');
    } catch (e) { setErr(errText(e, 'Search failed.')); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } }} placeholder={placeholder || 'Student name, phone or email'} maxLength={64} aria-label="Search users" />
        <Btn onClick={run} disabled={busy}>{busy ? '…' : 'Find'}</Btn>
      </div>
      {err && <p className="text-xs text-amber-300">{err}</p>}
      {hits.length > 0 && (
        <ul className="divide-y divide-white/10 border border-white/10">
          {hits.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => { onPick(u); setHits([]); setQ(''); }} className="w-full px-3 py-2 text-left hover:bg-white/5">
                <span className="text-sm font-bold">{u.name || 'Unnamed'}</span>
                <span className="ml-2 text-xs text-gray-500">{u.phoneMasked || maskPhone(u.phone)}</span>
                {u.emailMasked && <span className="ml-2 text-xs text-gray-500">{u.emailMasked}</span>}
                {u.campus && <span className="ml-2 text-xs text-gray-400">{u.campus.name}</span>}
                {u.verified !== undefined && <span className={`ml-2 text-xs ${u.verified ? 'text-emerald-300' : 'text-amber-300'}`}>{u.verified ? '✓ verified' : 'not verified'}</span>}
                {u.organizerStatus && <span className="ml-2 text-xs text-sky-300">organizer: {u.organizerStatus.toLowerCase()}</span>}
                {u.role && u.role !== 'student' && u.role !== 'customer' && <span className="ml-2 text-xs text-amber-300">{u.role}</span>}
                <span className="ml-2 font-mono text-xs text-gray-600">#{short(u.id)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Club (FriendsEntity) picker from /api/campus/mod/entities. */
export function ClubPicker({ value, onChange, verifiedOnly }: { value: Club | null; onChange: (c: Club | null) => void; verifiedOnly?: boolean }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Club[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (value) {
    return (
      <div className="flex items-center gap-3 border border-sky-400/30 bg-sky-400/5 p-2 text-sm">
        <span className="font-bold">{value.name}</span><span className="text-xs text-gray-400">{label(value.type)} · {value.verified ? 'verified ✓' : 'not verified'} · {value.managerIds.length} manager(s)</span>
        <button type="button" onClick={() => onChange(null)} className="ml-auto text-xs font-bold underline">Change</button>
      </div>
    );
  }
  const run = async () => {
    setBusy(true); setErr('');
    try {
      const d = await campusEventsApi.clubs(q.trim() || undefined);
      const list = (d.items || []).filter((c) => (verifiedOnly ? c.verified : true));
      setHits(list);
      if (!list.length) setErr(verifiedOnly ? 'No verified clubs match.' : 'No clubs match.');
    } catch (e) { setErr(errText(e, 'Could not load clubs.')); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } }} placeholder="Club name or handle (empty = all)" maxLength={60} aria-label="Search clubs" />
        <Btn onClick={run} disabled={busy}>{busy ? '…' : 'Find'}</Btn>
      </div>
      {err && <p className="text-xs text-amber-300">{err}</p>}
      {hits && hits.length > 0 && (
        <ul className="max-h-64 divide-y divide-white/10 overflow-y-auto border border-white/10">
          {hits.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { onChange(c); setHits(null); }} className="w-full px-3 py-2 text-left hover:bg-white/5">
                <span className="text-sm font-bold">{c.name}</span>
                <span className="ml-2 text-xs text-gray-500">{label(c.type)} · {c.verified ? 'verified ✓' : 'not verified'} · {c.managerIds.length} manager(s){c.status === 'suspended' ? ' · suspended' : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Server pagination footer (page / hasMore). */
export function PageNav({ page, hasMore, onPage, count, noun }: { page: number; hasMore: boolean; onPage: (p: number) => void; count: number; noun: string }) {
  if (page <= 1 && !hasMore) return <p className="text-xs text-gray-500">{count} {noun}</p>;
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-gray-400">
      <span>Page {page} · {count} {noun} on this page</span>
      <div className="flex gap-2">
        <Btn disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</Btn>
        <Btn disabled={!hasMore} onClick={() => onPage(page + 1)}>Next</Btn>
      </div>
    </div>
  );
}
