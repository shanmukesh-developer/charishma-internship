"use client";
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export type NotifType = 'order' | 'announcement' | 'info' | 'warning' | 'emergency' | 'sos' | 'issue' | 'promo';

export interface Notification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  ts: number; // timestamp ms
  read: boolean;
}

const TYPE_CONFIG: Record<NotifType, { icon: string; accent: string; bg: string }> = {
  order:        { icon: '📦', accent: 'text-blue-400',    bg: 'bg-blue-500/10 border-blue-500/20' },
  announcement: { icon: '📢', accent: 'text-slate-300',   bg: 'bg-white/5 border-white/10' },
  info:         { icon: 'ℹ️', accent: 'text-sky-400',     bg: 'bg-sky-500/10 border-sky-500/20' },
  warning:      { icon: '⚠️', accent: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/20' },
  emergency:    { icon: '🚨', accent: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20' },
  sos:          { icon: '🆘', accent: 'text-red-400',     bg: 'bg-red-500/15 border-red-500/30' },
  issue:        { icon: '⚠️', accent: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
  promo:        { icon: '🎉', accent: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
};

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

interface NotificationDrawerProps {
  open: boolean;
  notifications: Notification[];
  onClose: () => void;
  onClearAll: () => void;
  onMarkRead: (id: string) => void;
}

export default function NotificationDrawer({ open, notifications, onClose, onClearAll, onMarkRead }: NotificationDrawerProps) {
  const unread = notifications.filter(n => !n.read).length;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-[61] w-full max-w-sm bg-[#0D0D10] border-l border-white/8 flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-5 border-b border-white/5 shrink-0">
              <div>
                <h2 className="text-base font-black text-white tracking-tight">Notifications</h2>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mt-0.5">
                  {unread > 0 ? `${unread} unread` : 'All caught up'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {notifications.length > 0 && (
                  <button
                    onClick={onClearAll}
                    className="text-[9px] font-black uppercase tracking-widest text-slate-600 hover:text-red-400 transition-colors px-3 py-1.5 rounded-xl hover:bg-red-500/5"
                  >
                    Clear All
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Notification List */}
            <div className="flex-1 overflow-y-auto py-3 px-3 space-y-2">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-24">
                  <div className="text-5xl mb-4 opacity-20">🔔</div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">No Notifications Yet</p>
                  <p className="text-xs text-slate-700 mt-2">New orders and alerts will appear here</p>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {notifications.map(n => {
                    const cfg = TYPE_CONFIG[n.type];
                    return (
                      <motion.button
                        key={n.id}
                        layout
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                        onClick={() => onMarkRead(n.id)}
                        className={`w-full text-left p-4 rounded-2xl border transition-all ${cfg.bg} ${!n.read ? 'ring-1 ring-white/5' : 'opacity-60'}`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-xl shrink-0 mt-0.5">{cfg.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className={`text-[11px] font-black uppercase tracking-widest leading-tight ${cfg.accent}`}>
                                {n.title}
                              </p>
                              {!n.read && (
                                <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1" />
                              )}
                            </div>
                            <p className="text-xs text-slate-300 mt-1 leading-relaxed font-medium">{n.body}</p>
                            <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest mt-2">
                              {timeAgo(n.ts)}
                            </p>
                          </div>
                        </div>
                      </motion.button>
                    );
                  })}
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
