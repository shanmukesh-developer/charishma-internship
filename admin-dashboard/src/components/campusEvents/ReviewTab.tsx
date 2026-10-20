"use client";

// Review queue: submitted events (approve / reject / request changes) and live events whose organizer asked
// for material changes (diff → approve / reject changes). GET /review-queue, GET /events/:id for slots.
import { useEffect, useMemo, useState } from 'react';
import { campusEventsApi, sensitiveQuestion, type AdminEvent } from '@/lib/campusEventsApi';
import {
  Btn, ChangesDiff, ConfirmDialog, Empty, ErrorBox, EventPreview, Loading, Msg, Pill, Section, catLabel, fromLocalInput, inputCls, useLoader, when, type Notice,
} from './shared';

type Action = 'approve' | 'reject' | 'changes' | 'changes_approve' | 'changes_reject';

export default function ReviewTab({ tick, onChanged }: { tick: number; onChanged: () => void }) {
  const { data, loading, error, reload } = useLoader('review', tick, () => campusEventsApi.reviewQueue());
  const [selId, setSelId] = useState<string | null>(null);
  const rows = useMemo(() => data?.events || [], [data]);
  useEffect(() => { if (!selId && rows.length) setSelId(rows[0].id); }, [rows, selId]);
  const sel = rows.find((r) => r.id === selId) || null;
  const [msg, setMsg] = useState<Notice>(null);

  if (error && !data) return <ErrorBox text={error} retry={reload} />;
  if (loading && !data) return <Loading text="Loading the review queue…" />;
  if (!rows.length) return <div className="space-y-3"><Msg msg={msg} /><Empty text="Nothing to review. Submitted events and requested changes appear here." /></div>;

  return (
    <section className="grid gap-5 lg:grid-cols-[320px_1fr]" aria-label="Review queue">
      <ul className="max-h-[75vh] divide-y divide-line overflow-y-auto border border-line">
        {rows.map((ev) => {
          const kind = ev.status === 'SUBMITTED' ? 'New event' : 'Changes requested';
          const pii = (ev.questions || []).some((q) => sensitiveQuestion(q.label));
          return (
            <li key={ev.id}>
              <button type="button" onClick={() => { setSelId(ev.id); setMsg(null); }} aria-current={ev.id === selId}
                className={`w-full p-3 text-left hover:bg-surface-2/60 ${ev.id === selId ? 'bg-info-soft' : ''}`}>
                <p className="text-xs font-semibold text-info-text">{kind}{pii && <span className="ml-2 text-danger-text">PII question</span>}</p>
                <p className="mt-1 font-semibold">{ev.title}</p>
                <p className="text-xs text-fg-muted">{catLabel(ev.category)} · {ev.organizer?.name || ev.organizerName} · starts {when(ev.startAt)}</p>
                <p className="text-xs text-fg-muted">{ev.status === 'SUBMITTED' ? `Submitted ${when(ev.submittedAt)}` : `Asked ${when(ev.pendingChanges?.requestedAt)}`}</p>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="min-w-0 space-y-4">
        <Msg msg={msg} />
        {sel && <ReviewDetail key={sel.id} ev={sel} tick={tick} done={(text) => { setMsg({ ok: true, text }); setSelId(null); onChanged(); reload(); }} />}
      </div>
    </section>
  );
}

function ReviewDetail({ ev, tick, done }: { ev: AdminEvent; tick: number; done: (text: string) => void }) {
  const detail = useLoader(`rev:${ev.id}`, tick, () => campusEventsApi.event(ev.id));
  const [action, setAction] = useState<Action | null>(null);
  const [publishAt, setPublishAt] = useState('');
  const [note, setNote] = useState('');
  const submitted = ev.status === 'SUBMITTED';
  const hasChanges = !!ev.pendingChanges?.fields && Object.keys(ev.pendingChanges.fields).length > 0;

  const run = async (reason: string) => {
    switch (action) {
      case 'approve': {
        const at = fromLocalInput(publishAt);
        await campusEventsApi.approve(ev.id, { ...(at ? { publishAt: at } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
        done(at && Date.parse(at) > Date.now() ? `Approved "${ev.title}". It goes live ${when(at)}.` : `Approved and published "${ev.title}".`);
        break;
      }
      case 'reject': await campusEventsApi.reject(ev.id, reason); done(`Rejected "${ev.title}". The organizer sees your reason.`); break;
      case 'changes': await campusEventsApi.requestChanges(ev.id, reason); done(`Sent "${ev.title}" back to the organizer for changes.`); break;
      case 'changes_approve': await campusEventsApi.approveChanges(ev.id); done(`Changes to "${ev.title}" are live.`); break;
      case 'changes_reject': await campusEventsApi.rejectChanges(ev.id, reason); done(`Changes to "${ev.title}" were not approved.`); break;
      default: break;
    }
    setAction(null);
  };

  return (
    <div className="space-y-4">
      {submitted && (
        <div className="flex flex-wrap gap-2 border border-line bg-surface-2/60 p-4">
          <Btn tone="good" onClick={() => { setPublishAt(''); setNote(''); setAction('approve'); }}>Approve</Btn>
          <Btn onClick={() => setAction('changes')}>Request changes</Btn>
          <Btn tone="bad" onClick={() => setAction('reject')}>Reject</Btn>
        </div>
      )}
      {hasChanges && (
        <Section title="Changes requested after approval" right={<div className="flex gap-2"><Btn tone="good" onClick={() => setAction('changes_approve')}>Approve changes</Btn><Btn tone="bad" onClick={() => setAction('changes_reject')}>Reject changes</Btn></div>}>
          <ChangesDiff ev={ev} />
        </Section>
      )}
      <Section title="Student view preview" right={<Pill s={ev.status} />}>
        {detail.error && !detail.data && <ErrorBox text={detail.error} retry={detail.reload} />}
        <EventPreview ev={detail.data?.event || ev} slots={detail.data ? detail.data.slots : null} />
      </Section>

      {action && (
        <ConfirmDialog open
          tone={action === 'approve' || action === 'changes_approve' ? 'good' : action === 'changes' ? 'primary' : 'bad'}
          title={{ approve: 'Approve this event?', reject: 'Reject this event?', changes: 'Send back for changes?', changes_approve: 'Apply the requested changes?', changes_reject: 'Reject the requested changes?' }[action]}
          confirmLabel={{ approve: 'Approve', reject: 'Reject', changes: 'Send back', changes_approve: 'Apply changes', changes_reject: 'Reject changes' }[action]}
          reason={action === 'reject' ? { label: 'Reason (the organizer sees it)', min: 3 } : action === 'changes' ? { label: 'What needs to change (the organizer sees it)', min: 3 } : action === 'changes_reject' ? { label: 'Note to the organizer', min: 3 } : undefined}
          body={action === 'approve' ? (
            <>
              <p>Without a publish time the event goes live for students right away (if Campus Events is on).</p>
              <label className="block text-xs font-semibold text-fg-muted">Publish at (optional, your local time)
                <input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} className={`${inputCls} mt-1`} />
              </label>
              <label className="block text-xs font-semibold text-fg-muted">Note to the organizer (optional)
                <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className={`${inputCls} mt-1`} />
              </label>
              {(ev.questions || []).some((q) => sensitiveQuestion(q.label)) && <p className="font-semibold text-danger-text">This event has a question that may collect personal ID / phone data.</p>}
            </>
          ) : action === 'changes_approve' ? <p>The new values apply at once. Venue or time changes notify every registrant; extra capacity promotes the waitlist.</p> : undefined}
          onCancel={() => setAction(null)} onConfirm={run} />
      )}
    </div>
  );
}
