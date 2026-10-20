"use client";
import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
  ButtonHTMLAttributes, KeyboardEvent as ReactKeyboardEvent, ReactNode,
} from 'react';

// ─── Classes shared by every form in the Stores area ─────────────────────────
export const INPUT = 'w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50 aria-[invalid=true]:border-red-500/60';
export const SELECT = `${INPUT} pr-8`;
export const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0f14]';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

// ─── Button ───────────────────────────────────────────────────────────────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'amber';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-success text-on-solid hover:bg-success/90 font-semibold',
  secondary: 'border border-line bg-surface-2/60 text-fg hover:bg-surface-2 hover:text-fg font-semibold',
  ghost: 'text-fg-muted hover:bg-surface-2/60 hover:text-fg font-semibold',
  danger: 'border border-danger/30 text-danger-text hover:bg-danger-soft font-semibold',
  amber: 'bg-accent text-accent-fg hover:bg-accent-hover font-semibold',
};

export function Button({ variant = 'secondary', size = 'md', className, loading, children, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm',
        VARIANTS[variant], FOCUS_RING, className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cx('inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent', className)} />;
}

// ─── Field: label + control + help / error ───────────────────────────────────
/**
 * Wraps one control. The control should use `id` and `aria-describedby={msgId}` from the render prop
 * so screen readers announce the help or error text.
 */
export function Field({ label, help, error, required, optional, className, children, aside }: {
  label: ReactNode;
  help?: ReactNode;
  error?: string | null;
  required?: boolean;
  optional?: boolean;
  className?: string;
  aside?: ReactNode;
  children: (ids: { id: string; msgId: string; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className={cx('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-semibold text-fg-muted">
          {label}
          {required && <span className="ml-0.5 text-danger-text" aria-hidden>*</span>}
          {optional && <span className="ml-1.5 normal-case text-fg-subtle">optional</span>}
        </label>
        {aside}
      </div>
      {children({ id, msgId, invalid: !!error })}
      {error ? (
        <p id={msgId} role="alert" className="text-xs text-danger-text">{error}</p>
      ) : help ? (
        <p id={msgId} className="text-xs leading-relaxed text-fg-muted">{help}</p>
      ) : null}
    </div>
  );
}

// ─── Toggle switch ───────────────────────────────────────────────────────────
export function Toggle({ checked, onChange, label, description, disabled, size = 'md', tone = 'emerald', srOnlyLabel }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  size?: 'sm' | 'md';
  tone?: 'emerald' | 'amber';
  srOnlyLabel?: boolean;
}) {
  const id = useId();
  const track = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11';
  const knob = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  const shift = size === 'sm' ? 'translate-x-4' : 'translate-x-5';
  const on = tone === 'amber' ? 'bg-accent' : 'bg-success';
  return (
    <div className={cx('flex items-start gap-3', disabled && 'opacity-50')}>
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        aria-label={srOnlyLabel && typeof label === 'string' ? label : undefined}
        aria-describedby={description ? `${id}-d` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed', track, checked ? on : 'bg-surface-3', FOCUS_RING)}
      >
        <span aria-hidden className={cx('rounded-full bg-white shadow transition-transform', knob, checked ? shift : 'translate-x-0')} />
      </button>
      {!srOnlyLabel && (
        <div className="min-w-0">
          <label htmlFor={id} className="cursor-pointer text-sm font-semibold text-fg">{label}</label>
          {description && <p id={`${id}-d`} className="mt-0.5 text-xs leading-relaxed text-fg-muted">{description}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Chips ───────────────────────────────────────────────────────────────────
export type Tone = 'green' | 'amber' | 'slate' | 'red' | 'sky' | 'violet';
const TONES: Record<Tone, string> = {
  green: 'border-success/30 bg-success-soft text-success-text',
  amber: 'border-warning/30 bg-warning-soft text-warning-text',
  slate: 'border-line bg-surface-2/60 text-fg-muted',
  red: 'border-danger/30 bg-danger-soft text-danger-text',
  sky: 'border-info/30 bg-info-soft text-info-text',
  violet: 'border-accent/30 bg-accent-soft text-accent-text',
};
export function Chip({ tone = 'slate', children, title, dot }: { tone?: Tone; children: ReactNode; title?: string; dot?: boolean }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-semibold', TONES[tone])}>
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

// ─── Skeleton / empty state / inline alert ───────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  // A <span> (display: block) so it is valid inside <p> / inline parents too (a <div> in a <p> is a
  // hydration error and React logs it on every drawer open).
  return <span aria-hidden className={cx('animate-pulse rounded-md bg-surface-2/60', /\bhidden\b/.test(className || '') ? '' : 'block', className)} />;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
      {icon && <div aria-hidden className="mb-3 text-3xl">{icon}</div>}
      <h3 className="font-semibold text-fg">{title}</h3>
      {body && <p className="mt-1.5 max-w-md text-sm text-fg-muted">{body}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Callout({ tone = 'sky', title, children }: { tone?: 'sky' | 'amber' | 'red' | 'green'; title?: ReactNode; children: ReactNode }) {
  const cls = {
    sky: 'border-info/30 bg-info-soft text-info-text',
    amber: 'border-warning/30 bg-warning-soft text-warning-text',
    red: 'border-danger/30 bg-danger-soft text-danger-text',
    green: 'border-success/30 bg-success-soft text-success-text',
  }[tone];
  return (
    <div className={cx('rounded-lg border p-3 text-sm leading-relaxed', cls)} role={tone === 'red' ? 'alert' : undefined}>
      {title && <p className="mb-0.5 font-semibold">{title}</p>}
      <div className="opacity-90">{children}</div>
    </div>
  );
}

// ─── Copy button ─────────────────────────────────────────────────────────────
export function CopyButton({ text, label = 'Copy', copiedLabel = 'Copied', size = 'sm', variant = 'secondary', className }: {
  text: string; label?: string; copiedLabel?: string; size?: 'sm' | 'md'; variant?: Variant; className?: string;
}) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('ok');
    } catch {
      setState('fail');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1800);
  };
  return (
    <Button size={size} variant={variant} onClick={copy} className={className} aria-live="polite">
      {state === 'ok' ? `✓ ${copiedLabel}` : state === 'fail' ? 'Select & copy manually' : label}
    </Button>
  );
}

// ─── Focus helpers for dialogs ───────────────────────────────────────────────
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function useDialogFocus(open: boolean, onEscape: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const escRef = useRef(onEscape);
  escRef.current = onEscape;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') || node?.querySelector<HTMLElement>(FOCUSABLE);
    (first || node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (!node) return;
      // Only the top-most dialog reacts.
      const dialogs = document.querySelectorAll('[data-zenvy-dialog]');
      if (dialogs[dialogs.length - 1] !== node) return;
      if (e.key === 'Escape') { e.stopPropagation(); escRef.current(); return; }
      if (e.key !== 'Tab') return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);
  return ref;
}

export function Modal({ open = true, onClose, title, description, children, footer, size = 'md' }: {
  open?: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const ref = useDialogFocus(open, onClose);
  const titleId = useId();
  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-scrim/50 sm:items-center sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={ref}
        data-zenvy-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx('flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-line bg-surface text-fg shadow-pop outline-none sm:rounded-lg', width)}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
            {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={cx('rounded-lg p-1.5 text-fg-muted hover:bg-surface-2/60 hover:text-fg', FOCUS_RING)}><span aria-hidden="true" className="text-base leading-none">×</span></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Right-side panel; full screen on phones. */
export function Drawer({ onClose, labelledBy, children, width = 'max-w-5xl' }: {
  onClose: () => void; labelledBy: string; children: ReactNode; width?: string;
}) {
  const ref = useDialogFocus(true, onClose);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-scrim/50" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={ref}
        data-zenvy-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cx('flex h-full w-full flex-col border-l border-line bg-surface text-fg shadow-pop outline-none', width)}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Tabs (roving focus, arrow keys) ─────────────────────────────────────────
export function Tabs<T extends string>({ tabs, value, onChange, label }: {
  tabs: { value: T; label: ReactNode; badge?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: ReactKeyboardEvent, index: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].value);
    refs.current[tabs[next].value]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto">
      {tabs.map((t, i) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            ref={el => { refs.current[t.value] = el; }}
            role="tab"
            type="button"
            id={`tab-${t.value}`}
            aria-selected={selected}
            aria-controls={`panel-${t.value}`}
            tabIndex={selected ? 0 : -1}
            onKeyDown={e => onKey(e, i)}
            onClick={() => onChange(t.value)}
            className={cx(
              'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-lg px-3.5 py-2.5 text-sm font-semibold transition-colors',
              selected ? 'text-fg after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-success' : 'text-fg-muted hover:text-fg',
              FOCUS_RING,
            )}
          >
            {t.label}
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}

// ─── Segmented control ───────────────────────────────────────────────────────
export function Segmented<T extends string>({ options, value, onChange, label, size = 'md' }: {
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap overflow-hidden rounded-lg border border-line bg-surface-2/60">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
            'font-semibold transition-colors',
            value === o.value ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg',
            FOCUS_RING,
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Popover menu ────────────────────────────────────────────────────────────
export function MenuButton({ label, items, align = 'right', buttonClassName, ariaLabel }: {
  label: ReactNode;
  ariaLabel?: string;
  align?: 'left' | 'right';
  buttonClassName?: string;
  items: Array<{ label: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean } | 'divider'>;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const onMenuKey = (e: ReactKeyboardEvent) => {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') || []);
    const i = nodes.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); (wrap.current?.querySelector('button') as HTMLElement | null)?.focus(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); nodes[(i + 1) % nodes.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); nodes[(i - 1 + nodes.length) % nodes.length]?.focus(); }
    if (e.key === 'Tab') setOpen(false);
  };
  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className={cx('rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-fg-muted hover:bg-surface-2/60 hover:text-fg', FOCUS_RING, buttonClassName)}
      >
        {label}
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          onKeyDown={onMenuKey}
          onClick={e => e.stopPropagation()}
          className={cx('absolute z-30 mt-1 min-w-[190px] overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-pop', align === 'right' ? 'right-0' : 'left-0')}
        >
          {items.map((item, i) => item === 'divider' ? (
            <div key={`d${i}`} className="my-1 border-t border-line" role="separator" />
          ) : (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onSelect(); }}
              className={cx('block w-full px-3.5 py-2 text-left text-sm outline-none disabled:opacity-40', item.danger ? 'text-danger-text hover:bg-danger-soft focus:bg-danger-soft' : 'text-fg hover:bg-surface-2/60 focus:bg-surface-2/60')}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Toasts ──────────────────────────────────────────────────────────────────
type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; kind: ToastKind; text: string; action?: { label: string; onClick: () => void } }
interface ToastApi {
  success: (text: string, action?: ToastItem['action']) => void;
  error: (text: string, action?: ToastItem['action']) => void;
  info: (text: string, action?: ToastItem['action']) => void;
}
const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const map = timers.current;
    return () => { map.forEach(clearTimeout); map.clear(); };
  }, []);
  const dismiss = useCallback((id: number) => {
    setItems(prev => prev.filter(t => t.id !== id));
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);
  const push = useCallback((kind: ToastKind, text: string, action?: ToastItem['action']) => {
    const id = ++seq.current;
    setItems(prev => [...prev.slice(-3), { id, kind, text, action }]);
    timers.current.set(id, setTimeout(() => dismiss(id), kind === 'error' ? 9000 : action ? 7000 : 4000));
  }, [dismiss]);
  const api = useMemo<ToastApi>(() => ({
    success: (t, a) => push('success', t, a),
    error: (t, a) => push('error', t, a),
    info: (t, a) => push('info', t, a),
  }), [push]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite" aria-relevant="additions">
        {items.map(t => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={cx(
              'pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-pop',
              t.kind === 'success' && 'border-success/30 bg-surface text-success-text',
              t.kind === 'error' && 'border-danger/30 bg-surface text-danger-text',
              t.kind === 'info' && 'border-info/30 bg-surface text-info-text',
            )}
          >
            <span aria-hidden className="mt-0.5">{t.kind === 'success' ? '✓' : t.kind === 'error' ? '!' : 'i'}</span>
            <span className="flex-1 leading-relaxed">{t.text}</span>
            {t.action && (
              <button type="button" onClick={() => { t.action!.onClick(); dismiss(t.id); }} className="shrink-0 font-semibold underline underline-offset-2">{t.action.label}</button>
            )}
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100"><span aria-hidden="true" className="text-base leading-none">×</span></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

// ─── Typed confirmation ──────────────────────────────────────────────────────
export function TypedConfirmModal({ title, body, confirmText, actionLabel, onConfirm, onClose }: {
  title: string;
  body: ReactNode;
  confirmText: string;
  actionLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const matches = typed.trim() === confirmText.trim();
  const run = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setBusy(false);
    }
  };
  return (
    <Modal
      onClose={busy ? () => undefined : onClose}
      title={title}
      size="sm"
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="danger" className="!bg-danger !text-on-solid hover:!bg-danger/90" disabled={!matches} loading={busy} onClick={run}>{actionLabel}</Button>
      </>}
    >
      <div className="space-y-4 text-sm text-fg-muted">
        {body}
        <Field label={<>Type <span className="normal-case text-fg">{confirmText}</span> to confirm</>} error={error || null}>
          {({ id, msgId }) => (
            <input
              id={id}
              data-autofocus
              aria-describedby={msgId}
              className={INPUT}
              value={typed}
              autoComplete="off"
              onChange={e => setTyped(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') run(); }}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}

/** Simple yes/no confirmation. */
export function ConfirmModal({ title, body, actionLabel, tone = 'primary', onConfirm, onClose }: {
  title: string; body: ReactNode; actionLabel: string; tone?: 'primary' | 'danger'; onConfirm: () => Promise<void> | void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true);
    setError('');
    try { await onConfirm(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); setBusy(false); }
  };
  return (
    <Modal onClose={busy ? () => undefined : onClose} title={title} size="sm" footer={<>
      <Button onClick={onClose} disabled={busy}>Cancel</Button>
      <Button data-autofocus variant={tone === 'danger' ? 'danger' : 'primary'} className={tone === 'danger' ? '!bg-danger !text-on-solid hover:!bg-danger/90' : ''} loading={busy} onClick={run}>{actionLabel}</Button>
    </>}>
      <div className="space-y-3 text-sm text-fg-muted">
        {body}
        {error && <Callout tone="red">{error}</Callout>}
      </div>
    </Modal>
  );
}

/** Store / product thumbnail with a letter fallback. */
export function Thumb({ src, alt, size = 'md', rounded = 'rounded-lg' }: { src?: string | null; alt: string; size?: 'sm' | 'md' | 'lg'; rounded?: string }) {
  const dim = { sm: 'h-9 w-9 text-xs', md: 'h-12 w-12 text-sm', lg: 'h-16 w-16 text-lg' }[size];
  const [broken, setBroken] = useState(false);
  return src && !broken ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setBroken(true)} className={cx(dim, rounded, 'shrink-0 border border-line bg-surface-2 object-cover')} />
  ) : (
    <div aria-hidden className={cx(dim, rounded, 'flex shrink-0 items-center justify-center border border-line bg-surface-2 font-semibold text-fg-muted')}>
      {(alt || '?').trim().slice(0, 1).toUpperCase()}
    </div>
  );
}

/** Small "is this key pressed" helper: "/" focuses search unless typing in a field. */
export function useSlashFocus(ref: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (document.querySelector('[data-zenvy-dialog]')) return;
      e.preventDefault();
      ref.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ref]);
}
