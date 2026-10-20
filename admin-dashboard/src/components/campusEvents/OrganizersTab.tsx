"use client";

// Organizers: applications + grants (CeOrganizer). Grant a user picked by search (optionally linked to a club),
// approve / reject applications, suspend / reinstate / revoke, bulk-grant the managers of verified clubs
// (FriendsEntity). Every decision is audited server-side and notifies the student.
import { useState } from 'react';
import { ORGANIZER_STATUSES, campusEventsApi, type Club, type Organizer, type UserHit } from '@/lib/campusEventsApi';
import {
  Btn, ClubPicker, ConfirmDialog, Empty, ErrorBox, Field, Loading, Msg, Pill, Section, Select, Toolbar, UserPicker, errText, inputCls, short, useLoader, when, type Notice,
} from './shared';

type Act = 'approve' | 'reject' | 'suspend' | 'reinstate' | 'revoke';
const ACTIONS: Record<Act, { from: string[]; label: string; tone: 'good' | 'bad' | 'primary'; reason: boolean }> = {
  approve: { from: ['PENDING', 'REJECTED'], label: 'Approve', tone: 'good', reason: false },
  reject: { from: ['PENDING'], label: 'Reject', tone: 'bad', reason: true },
  suspend: { from: ['ACTIVE'], label: 'Suspend', tone: 'bad', reason: true },
  reinstate: { from: ['SUSPENDED', 'REVOKED'], label: 'Reinstate', tone: 'good', reason: false },
  revoke: { from: ['ACTIVE', 'SUSPENDED', 'PENDING'], label: 'Revoke', tone: 'bad', reason: true },
};

export default function OrganizersTab({ tick, onChanged }: { tick: number; onChanged: () => void }) {
  const [status, setStatus] = useState('PENDING');
  const { data, loading, error, reload } = useLoader(`orgs:${status}`, tick, () => campusEventsApi.organizers(status || undefined));
  const [act, setAct] = useState<{ act: Act; org: Organizer } | null>(null);
  const [msg, setMsg] = useState<Notice>(null);
  const rows = data?.organizers || [];
  const done = (text: string) => { setMsg({ ok: true, text }); onChanged(); reload(); };

  const run = async (reason: string) => {
    if (!act) return;
    const { org } = act;
    const call = {
      approve: () => campusEventsApi.approveOrganizer(org.id),
      reject: () => campusEventsApi.rejectOrganizer(org.id, reason),
      suspend: () => campusEventsApi.suspendOrganizer(org.id, reason),
      reinstate: () => campusEventsApi.reinstateOrganizer(org.id),
      revoke: () => campusEventsApi.revokeOrganizer(org.id, reason),
    }[act.act];
    await call();
    setAct(null);
    const past = { approve: 'approved', reject: 'rejected', suspend: 'suspended', reinstate: 'reinstated', revoke: 'revoked' }[act.act];
    done(`${org.name || org.displayName || 'Organizer'}: ${past}.`);
  };

  return (
    <section className="space-y-5" aria-label="Organizers">
      <div className="grid gap-4 lg:grid-cols-2">
        <GrantPanel done={done} />
        <BulkPanel done={done} />
      </div>
      <Toolbar>
        <Select name="Status" value={status} onChange={setStatus} options={['', ...ORGANIZER_STATUSES]} allLabel="All" />
        <span className="text-sm text-fg-muted">{rows.length} organizer{rows.length === 1 ? '' : 's'}</span>
      </Toolbar>
      <Msg msg={msg} />
      {error && <ErrorBox text={error} retry={reload} />}
      {loading && !data ? <Loading text="Loading organizers…" /> : rows.length === 0 ? <Empty text={status === 'PENDING' ? 'No organizer applications waiting.' : 'No organizers in this view.'} /> : (
        <div className="zv-table-wrap">
          <table className="zv-table">
            <thead className="bg-surface-2/60 text-xs text-fg-muted"><tr><th className="p-3">Student</th><th className="p-3">Shown as</th><th className="p-3">Club</th><th className="p-3">Application</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead>
            <tbody className="divide-y divide-white/10">
              {rows.map((o) => (
                <tr key={o.id} className="align-top">
                  <td className="p-3 text-xs"><span className="font-semibold">{o.name || 'Student'}</span><span className="block font-mono text-fg-subtle">user #{short(o.userId)}</span><span className="block text-fg-muted">since {when(o.createdAt)}</span></td>
                  <td className="p-3 text-xs">{o.displayName || '—'}</td>
                  <td className="p-3 text-xs">{o.entity ? <>{o.entity.name}<span className="block text-fg-muted">{o.entity.verified ? 'verified ✓' : 'not verified'}</span></> : '—'}</td>
                  <td className="max-w-xs p-3 text-xs text-fg-muted">{o.applicationNote || '—'}{o.proofText && <span className="mt-1 block text-fg-muted">Proof: {o.proofText}</span>}{o.reviewNote && <span className="mt-1 block text-warning-text">Note: {o.reviewNote}</span>}</td>
                  <td className="p-3"><Pill s={o.status} />{o.reviewedAt && <span className="block text-xs text-fg-muted">{when(o.reviewedAt)}</span>}</td>
                  <td className="p-3"><div className="flex flex-wrap gap-2">{(Object.keys(ACTIONS) as Act[]).filter((a) => ACTIONS[a].from.includes(o.status)).map((a) => <Btn key={a} tone={ACTIONS[a].tone === 'primary' ? 'plain' : ACTIONS[a].tone} onClick={() => setAct({ act: a, org: o })}>{ACTIONS[a].label}</Btn>)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {act && (
        <ConfirmDialog open tone={ACTIONS[act.act].tone} title={`${ACTIONS[act.act].label} ${act.org.name || 'this organizer'}?`} confirmLabel={ACTIONS[act.act].label}
          reason={ACTIONS[act.act].reason ? { label: 'Reason (the student sees it)', min: 3 } : undefined}
          body={act.act === 'suspend' || act.act === 'revoke' ? <p>They can no longer create or edit events. Published events stay live; cancel them separately if needed.</p> : act.act === 'approve' || act.act === 'reinstate' ? <p>They can create events and submit them for review. Events still need admin approval before students see them.</p> : undefined}
          onCancel={() => setAct(null)} onConfirm={run} />
      )}
    </section>
  );
}

function GrantPanel({ done }: { done: (t: string) => void }) {
  const [user, setUser] = useState<UserHit | null>(null);
  const [club, setClub] = useState<Club | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Notice>(null);
  const grant = async () => {
    if (!user) { setMsg({ ok: false, text: 'Pick a student first.' }); return; }
    setBusy(true); setMsg(null);
    try {
      await campusEventsApi.grantOrganizer({ userId: user.id, entityId: club?.id || null, ...(name.trim() ? { displayName: name.trim() } : {}) });
      done(`${user.name || 'Student'} can now publish campus events.`);
      setUser(null); setClub(null); setName('');
    } catch (e) { setMsg({ ok: false, text: errText(e, 'Could not grant access.') }); } finally { setBusy(false); }
  };
  return (
    <Section title="Grant organizer access">
      <div className="space-y-3">
        <Field name="Student"><UserPicker onPick={setUser} picked={user} clear={() => setUser(null)} /></Field>
        <Field name="Club (optional)" hint="Links the organizer to a club; its name shows on their events."><ClubPicker value={club} onChange={setClub} /></Field>
        <Field name="Shown as (optional)"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Defaults to the student's name" /></Field>
        <div className="flex items-center gap-3"><Btn tone="primary" disabled={busy || !user} onClick={grant}>{busy ? 'Granting…' : 'Grant access'}</Btn><Msg msg={msg} /></div>
      </div>
    </Section>
  );
}

function BulkPanel({ done }: { done: (t: string) => void }) {
  const [club, setClub] = useState<Club | null>(null);
  const [scope, setScope] = useState<'club' | 'campus'>('club');
  const [confirm, setConfirm] = useState(false);
  return (
    <Section title="Bulk grant: managers of verified clubs">
      <div className="space-y-3">
        <p className="text-xs text-fg-muted">Grants organizer access to every manager of a verified, active club. Suspended or revoked organizers and inactive accounts are skipped.</p>
        <Field name="Verified club"><ClubPicker value={club} onChange={setClub} verifiedOnly /></Field>
        {club && (
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="inline-flex items-center gap-2"><input type="radio" checked={scope === 'club'} onChange={() => setScope('club')} /> Only {club.name} ({club.managerIds.length} manager{club.managerIds.length === 1 ? '' : 's'})</label>
            {club.campusId && <label className="inline-flex items-center gap-2"><input type="radio" checked={scope === 'campus'} onChange={() => setScope('campus')} /> Every verified club on this club&apos;s campus</label>}
          </div>
        )}
        <Btn tone="primary" disabled={!club} onClick={() => setConfirm(true)}>Grant managers</Btn>
      </div>
      {confirm && club && (
        <ConfirmDialog open tone="good" title="Grant organizer access in bulk?" confirmLabel="Grant"
          body={<p>{scope === 'club' ? `All managers of ${club.name}` : 'All managers of every verified club on this campus'} become organizers and are notified.</p>}
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            const r = await campusEventsApi.bulkGrant(scope === 'campus' && club.campusId ? { campusId: club.campusId } : { entityId: club.id });
            setConfirm(false);
            done(`Bulk grant: ${r.granted} granted, ${r.skipped} skipped across ${r.entities} club(s).`);
            setClub(null);
          }} />
      )}
    </Section>
  );
}
