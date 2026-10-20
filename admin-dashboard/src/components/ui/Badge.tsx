import type { ReactNode } from 'react';
import { cn } from './cn';
import { humanize } from '@/lib/format';
import type { Tone } from './Feedback';

const tones: Record<Tone, { pill: string; dot: string }> = {
  neutral: { pill: 'bg-surface-2 text-fg-muted border-line', dot: 'bg-fg-subtle' },
  accent: { pill: 'bg-accent-soft text-accent-text border-accent/20', dot: 'bg-accent' },
  success: { pill: 'bg-success-soft text-success-text border-success/20', dot: 'bg-success' },
  warning: { pill: 'bg-warning-soft text-warning-text border-warning/25', dot: 'bg-warning' },
  danger: { pill: 'bg-danger-soft text-danger-text border-danger/20', dot: 'bg-danger' },
  info: { pill: 'bg-info-soft text-info-text border-info/20', dot: 'bg-info' },
};

export function Badge({
  tone = 'neutral',
  dot = false,
  children,
  className,
  title,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const t = tones[tone];
  return (
    <span
      title={title}
      className={cn('inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-px text-xs font-medium', t.pill, className)}
    >
      {dot && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', t.dot)} aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Small coloured dot (online / offline, live). */
export function StatusDot({ tone = 'neutral', className, label }: { tone?: Tone; className?: string; label?: string }) {
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', tones[tone].dot, className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

const SUCCESS = ['delivered', 'completed', 'complete', 'approved', 'active', 'verified', 'paid', 'online', 'success', 'succeeded', 'resolved', 'published', 'live', 'open now', 'available', 'in stock', 'enabled', 'settled', 'credited', 'confirmed', 'checked in', 'accepted by store'];
const WARNING = ['pending', 'requested', 'awaiting', 'under review', 'in review', 'review', 'in progress', 'processing', 'draft', 'scheduled', 'on hold', 'held', 'unverified', 'submitted', 'waitlisted', 'partially paid', 'due', 'expiring', 'awaiting payment', 'payment pending', 'new'];
const DANGER = ['cancelled', 'canceled', 'rejected', 'failed', 'suspended', 'blocked', 'banned', 'declined', 'expired', 'disabled', 'offline', 'closed', 'out of stock', 'refunded', 'reversed', 'disputed', 'overdue', 'no show', 'deleted', 'removed', 'debited', 'error'];
const INFO = ['accepted', 'preparing', 'ready', 'picked up', 'out for delivery', 'assigned', 'on the way', 'en route', 'started', 'ongoing', 'in transit', 'arrived', 'shopping', 'booked', 'ride started'];

/** Tone for a status word from the server ('OUT_FOR_DELIVERY', 'Pending', ...). */
export function statusTone(status: unknown): Tone {
  const s = humanize(status).toLowerCase();
  if (SUCCESS.includes(s)) return 'success';
  if (WARNING.includes(s)) return 'warning';
  if (DANGER.includes(s)) return 'danger';
  if (INFO.includes(s)) return 'info';
  return 'neutral';
}

/** Status pill with the label in sentence case and a tone picked from the status (override with `tone`). */
export function StatusPill({ status, tone, label, className }: { status: unknown; tone?: Tone; label?: ReactNode; className?: string }) {
  return (
    <Badge tone={tone ?? statusTone(status)} dot className={className}>
      {label ?? humanize(status)}
    </Badge>
  );
}
