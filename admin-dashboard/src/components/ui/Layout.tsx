"use client";
import Link from 'next/link';
import { useRef, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './cn';
import { Skeleton } from './Feedback';
import { IconChevronRight } from './icons';

/* ------------------------------------------------------------------ Page header */

/**
 * One per page: a plain title, one line saying what the page is for, and the primary action(s) on
 * the right. `children` renders under it (usually <Tabs>).
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  meta,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  /** Small inline status next to the title (e.g. a live indicator or a count badge). */
  meta?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-fg-muted">
          {breadcrumbs.map((b, i) => (
            <span key={`${b.label}-${i}`} className="flex items-center gap-1">
              {i > 0 && <IconChevronRight size={12} className="text-fg-subtle" />}
              {b.href ? <Link href={b.href} className="hover:text-fg">{b.label}</Link> : <span className="text-fg">{b.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-[-0.01em] text-fg">{title}</h1>
            {meta}
          </div>
          {description && <p className="mt-1 max-w-3xl text-sm text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </header>
  );
}

/* ------------------------------------------------------------------ Card */

export function Card({ className, children, padded = false, ...rest }: HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return (
    <div className={cn('rounded-lg border border-line bg-surface shadow-xs', padded && 'p-4', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3', className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3', className)} {...rest} />;
}

/** Section title inside a page (between cards). */
export function SectionTitle({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Label / value rows for detail panels. */
export function DescriptionList({ items, className, columns = 1 }: { items: { label: ReactNode; value: ReactNode }[]; className?: string; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-3', className)}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-fg-muted">{it.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-fg">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ Stat tile */

/**
 * One real number with its label. Never pass invented values: use `value={null}` for "not available"
 * (shows '–') and `loading` while it is fetched.
 */
export function StatTile({
  label,
  value,
  hint,
  href,
  tone = 'neutral',
  loading = false,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: 'neutral' | 'warning' | 'danger' | 'success';
  loading?: boolean;
  className?: string;
}) {
  const valueTone = tone === 'warning' ? 'text-warning-text' : tone === 'danger' ? 'text-danger-text' : tone === 'success' ? 'text-success-text' : 'text-fg';
  const body = (
    <>
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <p className={cn('mt-1 text-2xl font-semibold tabular-nums tracking-[-0.01em]', valueTone)}>{value ?? '–'}</p>
      )}
      {hint && <p className="mt-1 truncate text-xs text-fg-subtle">{hint}</p>}
    </>
  );
  const cls = cn('block rounded-lg border border-line bg-surface p-4 shadow-xs', href && 'transition-colors hover:border-line-strong hover:bg-surface-2/60', className);
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

/* ------------------------------------------------------------------ Tabs */

export interface TabItem<K extends string = string> {
  id: K;
  label: ReactNode;
  count?: number | null;
  /** Highlights the count (e.g. items waiting for review). */
  attention?: boolean;
  disabled?: boolean;
}

/** Underlined tabs. Arrow keys move between tabs (WAI-ARIA tabs pattern). */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  className,
  ariaLabel = 'Sections',
}: {
  tabs: TabItem<K>[];
  value: K;
  onChange: (id: K) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = tabs.filter(t => !t.disabled);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const pos = enabled.findIndex(t => t.id === tabs[idx].id);
    let next = pos;
    if (e.key === 'ArrowRight') next = (pos + 1) % enabled.length;
    if (e.key === 'ArrowLeft') next = (pos - 1 + enabled.length) % enabled.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = enabled.length - 1;
    const target = enabled[next];
    onChange(target.id);
    refs.current[tabs.findIndex(t => t.id === target.id)]?.focus();
  };
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('-mb-px flex gap-1 overflow-x-auto border-b border-line scrollbar-hide', className)}>
      {tabs.map((t, i) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            ref={el => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
            onKeyDown={e => onKey(e, i)}
            className={cn(
              'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 pb-2.5 pt-1.5 text-sm font-medium transition-colors disabled:opacity-40',
              active ? 'text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {t.label}
            {typeof t.count === 'number' && (
              <span className={cn('rounded-full px-1.5 text-2xs font-medium tabular-nums', t.attention && t.count > 0 ? 'bg-warning-soft text-warning-text' : 'bg-surface-2 text-fg-muted')}>
                {t.count}
              </span>
            )}
            {active && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-accent" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

/** Compact button group for filters ("All / Pending / Approved"). */
export function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
  className,
  ariaLabel,
  size = 'md',
}: {
  options: { value: K; label: ReactNode; count?: number | null }[];
  value: K;
  onChange: (v: K) => void;
  className?: string;
  ariaLabel?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-md border border-line bg-surface-2 p-0.5 scrollbar-hide', className)}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded font-medium transition-colors',
              size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-sm',
              active ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted hover:text-fg',
            )}
          >
            {o.label}
            {typeof o.count === 'number' && <span className="text-xs tabular-nums text-fg-subtle">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
