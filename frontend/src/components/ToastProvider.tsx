"use client";
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  icon?: string;
}

let addToastGlobal: ((t: Omit<Toast, 'id'>) => void) | null = null;

// Global utility — call this from anywhere to show a toast
export function showToast(message: string, type: Toast['type'] = 'success', icon?: string) {
  addToastGlobal?.({ message, type, icon });
}

export default function ToastProvider() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    addToastGlobal = (t) => {
      const id = Date.now();
      setToasts(prev => [...prev, { ...t, id }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(x => x.id !== id));
      }, 3500);
    };
    return () => { addToastGlobal = null; };
  }, []);

  if (!mounted) return null;

  const colorMap = {
    success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
    error:   'border-red-500/40 bg-red-500/10 text-red-400',
    info:    'border-[#C9A84C]/40 bg-[#C9A84C]/10 text-[#C9A84C]',
    warning: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  };

  return createPortal(
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 items-center w-[90vw] max-w-sm pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`w-full px-5 py-3.5 rounded-2xl border backdrop-blur-xl bg-[#0A0A0B]/80 flex items-center gap-3 shadow-2xl animate-in slide-in-from-top-4 duration-300 ${colorMap[t.type]}`}
        >
          {t.icon && <span className="text-xl shrink-0">{t.icon}</span>}
          <p className="text-sm font-black tracking-wide">{t.message}</p>
        </div>
      ))}
    </div>,
    document.body
  );
}
