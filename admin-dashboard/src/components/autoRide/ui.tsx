"use client";

// Shared building blocks for the Auto-Ride admin page (same look as /rentals: square borders, dark panels).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LayoutCell, SeatLayout } from '@/lib/autoRideApi';

export const label = (v: string) => String(v || '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
export const inr = (n?: number | string | null) => (n === null || n === undefined || n === '' ? '—' : `₹${(Math.round(Number(n) * 100) / 100).toLocaleString('en-IN')}`);
export const when = (v?: string | null) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '—';
};
export const timeOnly = (v?: string | null) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—';
};
export const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
/** Phones in lists are masked (last 4 only); full numbers appear only in detail views. */
export const maskPhone = (p?: string | null) => {
  const s = String(p || '').replace(/\D/g, '');
  return s.length >= 4 ? `••••••${s.slice(-4)}` : s ? '••••' : '—';
};
export const short = (id?: string | null) => (id ? String(id).slice(-6).toUpperCase() : '—');
/** Today in IST as YYYY-MM-DD. */
export const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
/** Days from IST today to a YYYY-MM-DD date (negative = past). */
export const daysUntil = (ymd?: string | null) => {
  if (!ymd) return null;
  const a = Date.parse(`${istToday()}T00:00:00Z`);
  const b = Date.parse(`${String(ymd).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(b) ? null : Math.round((b - a) / 86400000);
};

const TONES: Record<string, string> = {
  PENDING_REVIEW: 'text-warning-text border-warning/30', PENDING_DOCS: 'text-warning-text border-warning/30', REQUESTED: 'text-warning-text border-warning/30',
  OPEN: 'text-warning-text border-warning/30', HELD: 'text-warning-text border-warning/30', REFUND_PENDING: 'text-warning-text border-warning/30', DELAYED: 'text-warning-text border-warning/30',
  VERIFIED: 'text-success-text border-success/30', APPROVED: 'text-success-text border-success/30', ACCEPTED: 'text-success-text border-success/30',
  CONFIRMED: 'text-success-text border-success/30', COMPLETED: 'text-success-text border-success/30', RESOLVED: 'text-success-text border-success/30', REFUNDED: 'text-success-text border-success/30',
  OPEN_FOR_BOOKING: 'text-info-text border-info/30', PUBLISHED: 'text-info-text border-info/30', DEPARTURE_THRESHOLD_REACHED: 'text-info-text border-info/30',
  FULL: 'text-accent-text border-accent/30', DRIVER_CONFIRMED: 'text-accent-text border-accent/30', BOARDING: 'text-accent-text border-accent/30',
  IN_PROGRESS: 'text-info-text border-info/30', BOARDED: 'text-info-text border-info/30', REVIEWING: 'text-info-text border-info/30',
  REJECTED: 'text-danger-text border-danger/30', SUSPENDED: 'text-danger-text border-danger/30', CANCELLED: 'text-danger-text border-danger/30', DECLINED: 'text-danger-text border-danger/30',
  NO_SHOW: 'text-danger-text border-danger/30', DRIVER_UNAVAILABLE: 'text-danger-text border-danger/30', VEHICLE_UNAVAILABLE: 'text-danger-text border-danger/30',
  CONFLICT: 'text-danger-text border-danger/30', EXPIRED: 'text-fg-muted border-line', DISMISSED: 'text-fg-muted border-line', DRAFT: 'text-fg-muted border-line',
};
export const Pill = ({ s }: { s: string }) => <span className={`inline-block whitespace-nowrap border px-2 py-0.5 text-xs font-semibold ${TONES[s] || 'text-fg-muted border-line'}`}>{label(s)}</span>;

export function Empty({ text }: { text: string }) {
  return <div className="border border-line p-10 text-center text-sm text-fg-muted">{text}</div>;
}
export function Loading({ text }: { text: string }) {
  return <div role="status" className="border border-line p-8 text-sm text-fg-muted">{text}</div>;
}
export function ErrorBox({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 border border-danger/30 bg-danger-soft p-4 text-sm text-danger-text">
      {text}{retry && <button type="button" onClick={retry} className="font-semibold underline">Retry</button>}
    </div>
  );
}
export function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-success-text' : 'text-danger-text'}`}>{msg.text}</p>;
}
export function Select({ value, onChange, options, name, allLabel = 'All' }: { value: string; onChange: (v: string) => void; options: readonly string[] | { value: string; label: string }[]; name: string; allLabel?: string }) {
  const opts = (options as (string | { value: string; label: string })[]).map((o) => (typeof o === 'string' ? { value: o, label: o ? label(o) : allLabel } : o));
  return (
    <label className="text-xs font-semibold text-fg-muted">{name}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="ml-2 max-w-[240px] border border-line bg-surface p-2 text-sm font-normal normal-case text-fg">
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-4 border border-line bg-surface-2/60 p-4">{children}</div>;
}
export const inputCls = 'w-full border border-line bg-surface p-2 text-sm text-fg disabled:opacity-50';
export function Field({ name, children, hint }: { name: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-xs font-semibold text-fg-muted">
      <span>{name}</span>
      <div className="mt-1 font-normal normal-case">{children}</div>
      {hint && <span className="mt-1 block text-xs font-normal normal-case text-fg-muted">{hint}</span>}
    </label>
  );
}
export function Btn({ children, onClick, tone = 'plain', disabled, type = 'button' }: { children: ReactNode; onClick?: () => void; tone?: 'plain' | 'good' | 'bad' | 'primary'; disabled?: boolean; type?: 'button' | 'submit' }) {
  const cls = {
    plain: 'border border-line text-fg hover:bg-surface-2/60',
    good: 'bg-success text-on-solid hover:bg-success/90',
    bad: 'border border-danger/30 text-danger-text hover:bg-danger-soft',
    primary: 'bg-accent text-on-solid hover:bg-accent-hover',
  }[tone];
  return <button type={type} disabled={disabled} onClick={onClick} className={`px-4 py-2 text-sm font-semibold disabled:opacity-50 ${cls}`}>{children}</button>;
}

/** Only http(s) or same-origin links are rendered (never javascript: / data: from user content). */
export const safeUrl = (u: string | null | undefined) => {
  const v = String(u || '').trim();
  return /^https?:\/\//i.test(v) || (v.startsWith('/') && !v.startsWith('//')) ? v : null;
};
/** Private document preview (short-lived signed link from the server). */
export function Doc({ url: rawUrl, name, required, expiry }: { url: string | null | undefined; name: string; required?: boolean; expiry?: string | null }) {
  const url = safeUrl(rawUrl);
  const days = daysUntil(expiry);
  return (
    <div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer noopener" className="block border border-line" title={`Open ${name}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={name} loading="lazy" referrerPolicy="no-referrer" className="h-32 w-full bg-surface-2 object-cover" />
          <span className="block bg-surface-2 px-2 py-1 text-xs font-semibold text-fg">{name} ↗</span>
        </a>
      ) : (
        <div className={`flex h-32 items-center justify-center border border-dashed text-xs ${required ? 'border-danger/30 text-danger-text' : 'border-line text-fg-muted'}`}>
          {name} {required ? 'missing (required)' : 'not uploaded'}
        </div>
      )}
      {expiry !== undefined && <Expiry date={expiry} days={days} />}
    </div>
  );
}
export function Expiry({ date, days, prefix = 'Expires' }: { date: string | null | undefined; days?: number | null; prefix?: string }) {
  const d = days === undefined ? daysUntil(date) : days;
  if (!date) return <p className="mt-1 text-xs text-fg-muted">{prefix}: not given</p>;
  const cls = d !== null && d < 0 ? 'text-danger-text font-semibold' : d !== null && d <= 30 ? 'text-warning-text font-semibold' : 'text-fg-muted';
  return <p className={`mt-1 text-xs ${cls}`}>{prefix} {String(date).slice(0, 10)}{d !== null && d < 0 ? ' · EXPIRED' : d !== null && d <= 30 ? ` · in ${d} day${d === 1 ? '' : 's'}` : ''}</p>;
}

export function StatCard({ name, value, tone = 'plain', hint }: { name: string; value: number | string | null | undefined; tone?: 'plain' | 'warn' | 'bad' | 'good'; hint?: string }) {
  const cls = { plain: 'text-fg', warn: 'text-warning-text', bad: 'text-danger-text', good: 'text-success-text' }[tone];
  return (
    <div className="border border-line bg-surface-2/60 p-4">
      <p className="text-xs font-semibold text-fg-muted">{name}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${cls}`}>{value === null || value === undefined ? '—' : value}</p>
      {hint && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}

/** Modal confirm, optionally with a reason box (min length enforced like the server's reasonOf). */
export function ConfirmDialog({ open, title, body, confirmLabel, tone = 'bad', reason, onCancel, onConfirm }: {
  open: boolean; title: string; body?: ReactNode; confirmLabel: string; tone?: 'bad' | 'good' | 'primary';
  reason?: { label: string; min: number; placeholder?: string }; onCancel: () => void; onConfirm: (reason: string) => Promise<void> | void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { setText(''); setError(''); setBusy(false); setTimeout(() => ref.current?.querySelector<HTMLElement>('textarea,button')?.focus(), 0); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);
  if (!open) return null;
  const go = async () => {
    if (reason && text.trim().length < reason.min) { setError(`Write at least ${reason.min} characters.`); return; }
    setBusy(true);
    setError('');
    try { await onConfirm(text.trim()); } catch (e) { setError(errText(e, 'Could not complete this.')); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-scrim/50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div ref={ref} className="w-full max-w-lg border border-line bg-surface p-6 text-fg shadow-pop">
        <h2 className="text-lg font-semibold">{title}</h2>
        {body && <div className="mt-3 space-y-2 text-sm text-fg-muted">{body}</div>}
        {reason && (
          <label className="mt-4 block text-xs font-semibold text-fg-muted">{reason.label}
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={3} placeholder={reason.placeholder} className={`${inputCls} mt-1 font-normal normal-case`} />
          </label>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-danger-text">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <Btn onClick={onCancel} disabled={busy}>Cancel</Btn>
          <Btn tone={tone} onClick={go} disabled={busy}>{busy ? 'Working…' : confirmLabel}</Btn>
        </div>
      </div>
    </div>
  );
}

/** Top-down seat grid (front row first). 'D' = driver, null = gap. Optional per-seat states. */
export function SeatGrid({ layout, seatState, onCellClick, editable }: {
  layout: SeatLayout | null | undefined; seatState?: Record<number, string>; onCellClick?: (r: number, c: number) => void; editable?: boolean;
}) {
  if (!layout || !Array.isArray(layout.rows) || !layout.rows.length) return <p className="text-xs text-fg-muted">No seat layout yet.</p>;
  const cellCls = (c: LayoutCell) => {
    if (c === 'D') return 'border-line-strong bg-surface-2 text-fg';
    if (c === null) return 'border-dashed border-line text-fg-subtle';
    const st = seatState?.[c];
    if (st === 'CONFIRMED' || st === 'BOARDED') return 'border-success/30 bg-success-soft text-success-text';
    if (st === 'HELD') return 'border-warning/30 bg-warning-soft text-warning-text';
    return 'border-info/30 bg-info-soft text-info-text';
  };
  return (
    <div className="inline-block rounded-t-[2rem] border border-line bg-surface-2 px-4 pb-4 pt-3" aria-label="Seat layout">
      <p className="mb-2 text-center text-xs font-semibold text-fg-muted">Front</p>
      <div className="space-y-2">
        {layout.rows.map((row, ri) => (
          <div key={ri} className="flex justify-center gap-2">
            {row.map((c, ci) => {
              const fixed = c === 'D';
              const content = c === 'D' ? '🛞' : c === null ? '·' : c;
              const title = c === 'D' ? 'Driver seat (fixed)' : c === null ? 'Gap' : `Seat ${c}${seatState?.[c] ? ` · ${label(seatState[c])}` : ''}`;
              return editable && !fixed && onCellClick ? (
                <button key={ci} type="button" title={`${title} · click to toggle`} onClick={() => onCellClick(ri, ci)} className={`flex h-10 w-10 items-center justify-center border text-sm font-semibold ${cellCls(c)} hover:ring-1 hover:ring-white/40`}>{content}</button>
              ) : (
                <span key={ci} title={title} className={`flex h-10 w-10 items-center justify-center border text-sm font-semibold ${cellCls(c)}`}>{content}</span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
