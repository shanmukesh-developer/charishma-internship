"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { cn } from './cn';
import { Button } from './Button';
import { IconAlert, IconX } from './icons';

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Esc closes, Tab stays inside the panel, focus returns to the opener on close. */
function useDialogBehaviour(open: boolean, onClose: () => void, panel: React.RefObject<HTMLDivElement | null>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const node = panel.current;
    // Focus the first field (or the panel) once it is painted.
    const t = window.setTimeout(() => {
      if (!node) return;
      const preferred = node.querySelector<HTMLElement>('[data-autofocus],[autofocus]');
      const first = preferred || node.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]),textarea:not([disabled]),select:not([disabled])') || node.querySelector<HTMLElement>(FOCUSABLE);
      (first || node).focus();
    }, 10);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null);
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open, panel]);
}

function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}

const modalSizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof modalSizes;
  /** false while saving: Esc and backdrop clicks are ignored. */
  dismissible?: boolean;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useCallback(() => { if (dismissible) onClose(); }, [dismissible, onClose]);
  useDialogBehaviour(open, close, panel);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:items-center">
        <div className="fixed inset-0 bg-scrim/50 animate-zv-fade-in" onClick={close} aria-hidden />
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={cn('relative my-8 w-full rounded-xl border border-line bg-surface shadow-pop outline-none animate-zv-pop-in', modalSizes[size], className)}
        >
          <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-fg">{title}</h2>
              {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
            </div>
            <button type="button" onClick={close} aria-label="Close" className="-mr-1 rounded-md p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg">
              <IconX size={16} />
            </button>
          </div>
          {children && <div className="px-5 pb-5">{children}</div>}
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t border-line bg-surface-2/50 px-5 py-3">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

const drawerSizes = { md: 'max-w-md', lg: 'max-w-xl', xl: 'max-w-3xl' };

/** Panel sliding in from the right, for record details and long edit forms. */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'lg',
  dismissible = true,
  headerActions,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof drawerSizes;
  dismissible?: boolean;
  headerActions?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useCallback(() => { if (dismissible) onClose(); }, [dismissible, onClose]);
  useDialogBehaviour(open, close, panel);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-[90]">
        <div className="absolute inset-0 bg-scrim/40 animate-zv-fade-in" onClick={close} aria-hidden />
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={cn('absolute inset-y-0 right-0 flex w-full flex-col border-l border-line bg-surface shadow-pop outline-none animate-zv-slide-in', drawerSizes[size])}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-base font-semibold text-fg">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {headerActions}
              <button type="button" onClick={close} aria-label="Close" className="rounded-md p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg">
                <IconX size={16} />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2/50 px-5 py-3">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

/* ------------------------------------------------------------------ Confirm dialog */

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' for deletes, refunds, bans and anything that cannot be undone. */
  tone?: 'danger' | 'default';
  /** Admin must type this text (e.g. the store name) before confirming. */
  requireText?: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * `const confirm = useConfirm(); if (!(await confirm({ title: 'Delete item?', tone: 'danger' }))) return;`
 * Falls back to window.confirm when rendered outside the provider.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  return ctx || (async (o: ConfirmOptions) => window.confirm(typeof o.description === 'string' ? `${o.title}\n\n${o.description}` : o.title));
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState('');
  const confirm = useCallback<ConfirmFn>(opts => new Promise<boolean>(resolve => { setTyped(''); setReq({ ...opts, resolve }); }), []);
  const done = (v: boolean) => { req?.resolve(v); setReq(null); };
  const blocked = !!req?.requireText && typed.trim() !== req.requireText.trim();
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!req}
        onClose={() => done(false)}
        size="sm"
        title={
          <span className="flex items-center gap-2">
            {req?.tone === 'danger' && <span className="flex h-6 w-6 items-center justify-center rounded-full bg-danger-soft text-danger-text"><IconAlert size={14} /></span>}
            {req?.title}
          </span>
        }
        description={req?.description}
        footer={
          <>
            <Button onClick={() => done(false)}>{req?.cancelLabel || 'Cancel'}</Button>
            <Button variant={req?.tone === 'danger' ? 'destructive' : 'primary'} disabled={blocked} onClick={() => done(true)} data-autofocus={req?.requireText ? undefined : true}>
              {req?.confirmLabel || (req?.tone === 'danger' ? 'Delete' : 'Confirm')}
            </Button>
          </>
        }
      >
        {req?.requireText ? (
          <div>
            <label htmlFor="zv-confirm-text" className="mb-1 block text-sm text-fg-muted">
              Type <span className="font-medium text-fg">{req.requireText}</span> to confirm.
            </label>
            <input id="zv-confirm-text" className="zv-control" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" data-autofocus />
          </div>
        ) : null}
      </Modal>
    </ConfirmContext.Provider>
  );
}

/* ------------------------------------------------------------------ Dropdown menu */

export function Menu({
  trigger,
  items,
  align = 'end',
  label,
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu'; id: string }) => ReactNode;
  items: Array<{ label: ReactNode; onSelect?: () => void; href?: string; icon?: ReactNode; danger?: boolean; disabled?: boolean } | 'separator' | { heading: string }>;
  align?: 'start' | 'end';
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); (root.current?.querySelector('button') as HTMLElement | null)?.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const els = Array.from(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') || []);
        const i = els.indexOf(document.activeElement as HTMLElement);
        const next = e.key === 'ArrowDown' ? (i + 1) % els.length : (i - 1 + els.length) % els.length;
        els[next]?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.setTimeout(() => list.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(), 0);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={root} className="relative inline-flex">
      {trigger({ onClick: () => setOpen(o => !o), 'aria-expanded': open, 'aria-haspopup': 'menu', id })}
      {open && (
        <div
          ref={list}
          role="menu"
          aria-label={label}
          aria-labelledby={label ? undefined : id}
          className={cn('absolute top-full z-[80] mt-1 min-w-[200px] rounded-lg border border-line bg-surface p-1 shadow-pop animate-zv-pop-in', align === 'end' ? 'right-0' : 'left-0')}
        >
          {items.map((it, i) => {
            if (it === 'separator') return <div key={i} className="my-1 h-px bg-line" role="separator" />;
            if ('heading' in it) return <p key={i} className="px-2 pb-1 pt-1.5 text-xs font-medium text-fg-subtle">{it.heading}</p>;
            const cls = cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none',
              it.disabled ? 'cursor-not-allowed opacity-50' : it.danger ? 'text-danger-text hover:bg-danger-soft focus:bg-danger-soft' : 'text-fg hover:bg-surface-2 focus:bg-surface-2',
            );
            const content = (<>{it.icon && <span className="text-fg-subtle">{it.icon}</span>}<span className="min-w-0 flex-1 truncate">{it.label}</span></>);
            if (it.href && !it.disabled) {
              return <Link key={i} role="menuitem" tabIndex={-1} href={it.href} className={cls} onClick={() => setOpen(false)}>{content}</Link>;
            }
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={it.disabled || undefined}
                className={cls}
                onClick={() => { if (it.disabled) return; setOpen(false); it.onSelect?.(); }}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
