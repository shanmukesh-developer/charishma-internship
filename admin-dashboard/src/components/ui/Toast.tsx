"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn';
import { IconAlert, IconCheckCircle, IconInfo, IconX, IconXCircle } from './icons';

type ToastTone = 'success' | 'error' | 'info' | 'warning';
interface ToastItem { id: number; tone: ToastTone; message: ReactNode; title?: ReactNode }

export interface ToastApi {
  success: (message: ReactNode, title?: ReactNode) => void;
  error: (message: ReactNode, title?: ReactNode) => void;
  info: (message: ReactNode, title?: ReactNode) => void;
  warning: (message: ReactNode, title?: ReactNode) => void;
}

const noop = () => {};
const ToastContext = createContext<ToastApi>({ success: noop, error: noop, info: noop, warning: noop });

/** `const toast = useToast(); toast.success('Item saved.')` */
export const useToast = () => useContext(ToastContext);

const icons: Record<ToastTone, ReactNode> = {
  success: <IconCheckCircle size={16} className="text-success-text" />,
  error: <IconXCircle size={16} className="text-danger-text" />,
  info: <IconInfo size={16} className="text-info-text" />,
  warning: <IconAlert size={16} className="text-warning-text" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems(list => list.filter(t => t.id !== id)), []);
  const push = useCallback((tone: ToastTone, message: ReactNode, title?: ReactNode) => {
    const id = ++seq.current;
    setItems(list => [...list.slice(-3), { id, tone, message, title }]);
    // Errors stay longer so they can be read.
    window.setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 4500);
  }, [dismiss]);
  const api = useMemo<ToastApi>(() => ({
    success: (m, t) => push('success', m, t),
    error: (m, t) => push('error', m, t),
    info: (m, t) => push('info', m, t),
    warning: (m, t) => push('warning', m, t),
  }), [push]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite" role="status">
        {items.map(t => (
          <div key={t.id} className={cn('pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm shadow-pop animate-zv-pop-in')}>
            <span className="mt-0.5 shrink-0">{icons[t.tone]}</span>
            <div className="min-w-0 flex-1">
              {t.title && <p className="font-medium text-fg">{t.title}</p>}
              <div className={t.title ? 'text-fg-muted' : 'text-fg'}>{t.message}</div>
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="-mr-1 rounded p-0.5 text-fg-subtle hover:bg-surface-2 hover:text-fg">
              <IconX size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
