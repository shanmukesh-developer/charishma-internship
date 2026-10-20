"use client";
import type { ReactNode } from 'react';
import { cn } from './cn';
import { IconAlert, IconCheckCircle, IconInfo, IconX, IconXCircle } from './icons';

export function Spinner({ size = 16, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn('animate-spin shrink-0', className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** Grey placeholder block while content loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-surface-3', className)} aria-hidden />;
}

/** Centered loading message for a whole panel. */
export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-12 text-sm text-fg-muted', className)} role="status" aria-live="polite">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-fg-subtle">{icon}</div>}
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'Could not load this',
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)} role="alert">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-danger-soft text-danger-text">
        <IconAlert size={18} />
      </div>
      <p className="text-sm font-medium text-fg">{title}</p>
      {message && <p className="mt-1 max-w-md text-sm text-fg-muted">{message}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex h-8 items-center rounded-md border border-line-strong/80 bg-surface px-3 text-sm font-medium text-fg shadow-xs hover:bg-surface-2"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const noticeTone: Record<Exclude<Tone, 'neutral' | 'accent'> | 'neutral', { box: string; icon: ReactNode }> = {
  neutral: { box: 'border-line bg-surface-2 text-fg', icon: <IconInfo size={16} className="text-fg-muted" /> },
  info: { box: 'border-info/25 bg-info-soft text-fg', icon: <IconInfo size={16} className="text-info-text" /> },
  success: { box: 'border-success/25 bg-success-soft text-fg', icon: <IconCheckCircle size={16} className="text-success-text" /> },
  warning: { box: 'border-warning/30 bg-warning-soft text-fg', icon: <IconAlert size={16} className="text-warning-text" /> },
  danger: { box: 'border-danger/25 bg-danger-soft text-fg', icon: <IconXCircle size={16} className="text-danger-text" /> },
};

/** Inline message banner (form errors, page notices, warnings about risky settings). */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
  onClose,
  className,
}: {
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  const t = noticeTone[tone];
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm', t.box, className)}
    >
      <span className="mt-0.5 shrink-0">{t.icon}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn('text-fg-muted', title ? 'mt-0.5' : '')}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="-mr-1 -mt-0.5 rounded p-1 text-fg-subtle hover:bg-surface-3 hover:text-fg">
          <IconX size={14} />
        </button>
      )}
    </div>
  );
}
