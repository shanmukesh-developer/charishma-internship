"use client";

// Shared building blocks for the Auto-ride and Campus events admin (re-exported by campusEvents/shared).
// Built on the admin UI kit (components/ui) so these sections look like the rest of the admin.
import { useEffect, useState, type ReactNode } from 'react';
import type { LayoutCell, SeatLayout } from '@/lib/autoRideApi';
import {
  Button, EmptyState, LoadingState, Modal, Notice, StatTile, StatusPill, Textarea, cn, type Tone,
  IconExternal, IconImage,
} from '@/components/ui';
import { formatDateTime, formatINR, formatTime, humanize } from '@/lib/format';

export const label = (v: string) => (v ? humanize(v) : '');
export const inr = (n?: number | string | null) => (n === null || n === undefined || n === '' ? '–' : formatINR(Math.round(Number(n) * 100) / 100));
export const when = (v?: string | null) => (v ? formatDateTime(v) : '–');
export const timeOnly = (v?: string | null) => (v ? formatTime(v) : '–');
export const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
/** Phones in lists are masked (last 4 only); full numbers appear only in detail views. */
export const maskPhone = (p?: string | null) => {
  const s = String(p || '').replace(/\D/g, '');
  return s.length >= 4 ? `••••••${s.slice(-4)}` : s ? '••••' : '–';
};
export const short = (id?: string | null) => (id ? String(id).slice(-6).toUpperCase() : '–');
/** Today in IST as YYYY-MM-DD. */
export const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
/** Days from IST today to a YYYY-MM-DD date (negative = past). */
export const daysUntil = (ymd?: string | null) => {
  if (!ymd) return null;
  const a = Date.parse(`${istToday()}T00:00:00Z`);
  const b = Date.parse(`${String(ymd).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(b) ? null : Math.round((b - a) / 86400000);
};

const TONES: Record<string, Tone> = {
  PENDING_REVIEW: 'warning', PENDING_DOCS: 'warning', REQUESTED: 'warning', OPEN: 'warning', HELD: 'warning', REFUND_PENDING: 'warning', DELAYED: 'warning',
  SUBMITTED: 'warning', CHANGES_REQUESTED: 'warning',
  VERIFIED: 'success', APPROVED: 'success', ACCEPTED: 'success', CONFIRMED: 'success', COMPLETED: 'success', RESOLVED: 'success', REFUNDED: 'success',
  PUBLISHED: 'success', ADMITTED: 'success', CHECKED_IN: 'success', PAID: 'success',
  OPEN_FOR_BOOKING: 'info', DEPARTURE_THRESHOLD_REACHED: 'info', FULL: 'accent', DRIVER_CONFIRMED: 'info', BOARDING: 'info',
  IN_PROGRESS: 'info', BOARDED: 'info', REVIEWING: 'info',
  REJECTED: 'danger', SUSPENDED: 'danger', CANCELLED: 'danger', DECLINED: 'danger', NO_SHOW: 'danger', DRIVER_UNAVAILABLE: 'danger',
  VEHICLE_UNAVAILABLE: 'danger', CONFLICT: 'danger', FAILED: 'danger',
  EXPIRED: 'neutral', DISMISSED: 'neutral', DRAFT: 'neutral', UNPUBLISHED: 'neutral',
};
export const Pill = ({ s }: { s: string }) => <StatusPill status={s} tone={TONES[s] || 'neutral'} label={label(s)} />;

export function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-line bg-surface shadow-xs"><EmptyState title={text} /></div>;
}
export function Loading({ text }: { text: string }) {
  return <div className="rounded-lg border border-line bg-surface shadow-xs"><LoadingState label={text} /></div>;
}
export function ErrorBox({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <Notice tone="danger" action={retry ? <Button size="sm" onClick={retry}>Try again</Button> : undefined}>
      <span className="text-fg">{text}</span>
    </Notice>
  );
}
export function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p role={msg.ok ? 'status' : 'alert'} className={cn('text-sm', msg.ok ? 'text-success-text' : 'text-danger-text')}>{msg.text}</p>;
}
export function Select({ value, onChange, options, name, allLabel = 'All' }: { value: string; onChange: (v: string) => void; options: readonly string[] | { value: string; label: string }[]; name: string; allLabel?: string }) {
  const opts = (options as (string | { value: string; label: string })[]).map((o) => (typeof o === 'string' ? { value: o, label: o ? label(o) : allLabel } : o));
  return (
    <label className="inline-flex items-center gap-2 text-sm text-fg-muted">
      <span className="whitespace-nowrap">{name}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="zv-control w-auto max-w-[240px]">
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2">{children}</div>;
}
export const inputCls = 'zv-control';
export function Field({ name, children, hint }: { name: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-fg">{name}</span>
      <div>{children}</div>
      {hint && <span className="mt-1 block text-xs text-fg-muted">{hint}</span>}
    </label>
  );
}
export function Btn({ children, onClick, tone = 'plain', disabled, type = 'button' }: { children: ReactNode; onClick?: () => void; tone?: 'plain' | 'good' | 'bad' | 'primary'; disabled?: boolean; type?: 'button' | 'submit' }) {
  const variant = tone === 'good' || tone === 'primary' ? 'primary' : tone === 'bad' ? 'destructive' : 'secondary';
  return <Button type={type} variant={variant} disabled={disabled} onClick={onClick}>{children}</Button>;
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
        <a href={url} target="_blank" rel="noreferrer noopener" className="block overflow-hidden rounded-lg border border-line hover:border-line-strong" title={`Open ${name}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={name} loading="lazy" referrerPolicy="no-referrer" className="h-32 w-full bg-surface-2 object-cover" />
          <span className="flex items-center justify-between gap-2 bg-surface-2 px-2 py-1 text-xs font-medium text-fg">{name}<IconExternal size={12} className="text-fg-subtle" /></span>
        </a>
      ) : (
        <div className={cn('flex h-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs', required ? 'border-danger/40 text-danger-text' : 'border-line text-fg-muted')}>
          <IconImage size={16} />
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
  const cls = d !== null && d < 0 ? 'font-medium text-danger-text' : d !== null && d <= 30 ? 'font-medium text-warning-text' : 'text-fg-muted';
  return <p className={cn('mt-1 text-xs', cls)}>{prefix} {String(date).slice(0, 10)}{d !== null && d < 0 ? ' · expired' : d !== null && d <= 30 ? ` · in ${d} ${d === 1 ? 'day' : 'days'}` : ''}</p>;
}

export function StatCard({ name, value, tone = 'plain', hint }: { name: string; value: number | string | null | undefined; tone?: 'plain' | 'warn' | 'bad' | 'good'; hint?: string }) {
  const t = tone === 'warn' ? 'warning' : tone === 'bad' ? 'danger' : tone === 'good' ? 'success' : 'neutral';
  return <StatTile label={name} value={value === null || value === undefined ? null : value} hint={hint} tone={t} />;
}

/** Modal confirm, optionally with a reason box (min length enforced like the server's reasonOf). */
export function ConfirmDialog({ open, title, body, confirmLabel, tone = 'bad', reason, onCancel, onConfirm }: {
  open: boolean; title: string; body?: ReactNode; confirmLabel: string; tone?: 'bad' | 'good' | 'primary';
  reason?: { label: string; min: number; placeholder?: string }; onCancel: () => void; onConfirm: (reason: string) => Promise<void> | void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setText(''); setError(''); setBusy(false); } }, [open]);
  const go = async () => {
    if (reason && text.trim().length < reason.min) { setError(`Write at least ${reason.min} characters.`); return; }
    setBusy(true);
    setError('');
    try { await onConfirm(text.trim()); } catch (e) { setError(errText(e, 'Could not complete this.')); setBusy(false); }
  };
  return (
    <Modal
      open={open}
      onClose={onCancel}
      dismissible={!busy}
      size="md"
      title={title}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant={tone === 'bad' ? 'destructive' : 'primary'} onClick={go} loading={busy} data-autofocus={reason ? undefined : true}>{busy ? 'Working…' : confirmLabel}</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-fg-muted">
        {body && <div className="space-y-2 [&_.font-bold]:font-medium [&_.font-bold]:text-fg">{body}</div>}
        {reason && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-fg">{reason.label}</span>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={3} placeholder={reason.placeholder} data-autofocus />
          </label>
        )}
        {error && <p role="alert" className="text-sm text-danger-text">{error}</p>}
      </div>
    </Modal>
  );
}

/** Steering wheel line icon for the driver cell. */
function SteeringIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2" /><path d="M3.8 10.5h6.3M13.9 10.5h6.3M12 14v6.4" />
    </svg>
  );
}

/**
 * Top-down seat grid (front row first). 'D' = driver (steering wheel), null = gap. Seats in layout.maleOnlySeats
 * (default: the seats beside the driver) carry a "Boys" tag. Optional per-seat states.
 */
export function SeatGrid({ layout, seatState, onCellClick, editable }: {
  layout: SeatLayout | null | undefined; seatState?: Record<number, string>; onCellClick?: (r: number, c: number) => void; editable?: boolean;
}) {
  if (!layout || !Array.isArray(layout.rows) || !layout.rows.length) return <p className="text-xs text-fg-muted">No seat layout yet.</p>;
  const driverRow = layout.rows.find((r) => r.includes('D'));
  const male = new Set(layout.maleOnlySeats ?? (driverRow ? driverRow.filter((c): c is number => typeof c === 'number') : []));
  const cellCls = (c: LayoutCell) => {
    if (c === 'D') return 'border-line-strong bg-surface-3 text-fg-muted';
    if (c === null) return 'border-dashed border-line text-fg-subtle';
    const st = seatState?.[c];
    if (st === 'CONFIRMED' || st === 'BOARDED') return 'border-success/40 bg-success-soft text-success-text';
    if (st === 'HELD') return 'border-warning/40 bg-warning-soft text-warning-text';
    return 'border-accent/30 bg-accent-soft text-accent-text';
  };
  return (
    <div className="inline-block rounded-t-[2rem] border border-line bg-surface-2 px-4 pb-4 pt-3" aria-label="Seat layout">
      <p className="mb-2 text-center text-xs text-fg-muted">Front</p>
      <div className="space-y-3">
        {layout.rows.map((row, ri) => (
          <div key={ri} className="flex justify-center gap-2">
            {row.map((c, ci) => {
              const fixed = c === 'D';
              const boys = typeof c === 'number' && male.has(c);
              const content = c === 'D' ? <span className="flex flex-col items-center leading-none"><SteeringIcon /><span className="mt-0.5 text-[9px]">Driver</span></span> : c === null ? '·' : c;
              const title = c === 'D' ? 'Driver seat (fixed)' : c === null ? 'Gap' : `Seat ${c}${boys ? ' · boys only' : ''}${seatState?.[c] ? ` · ${label(seatState[c])}` : ''}`;
              const tag = boys ? <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 border border-info/30 bg-surface px-1 text-[9px] font-semibold leading-3 text-info-text">Boys</span> : null;
              return editable && !fixed && onCellClick ? (
                <button key={ci} type="button" title={`${title} · click to toggle`} onClick={() => onCellClick(ri, ci)} className={cn('relative flex h-11 w-11 items-center justify-center rounded-md border text-sm font-medium hover:ring-2 hover:ring-accent/30', cellCls(c))}>{content}{tag}</button>
              ) : (
                <span key={ci} title={title} className={cn('relative flex h-11 w-11 items-center justify-center rounded-md border text-sm font-medium', cellCls(c))}>{content}{tag}</span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
