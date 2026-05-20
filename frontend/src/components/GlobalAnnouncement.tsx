"use client";
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || API_URL;

interface Announcement {
  message: string;
  type: 'info' | 'warning' | 'promo' | 'emergency';
}

const TYPE_STYLES = {
  info:      'bg-blue-600/90 border-blue-400/50 text-white',
  warning:   'bg-amber-500/90 border-amber-400/50 text-black',
  promo:     'bg-emerald-600/90 border-emerald-400/50 text-white',
  emergency: 'bg-red-600/90 border-red-400/50 text-white animate-pulse',
};

const TYPE_ICONS = {
  info: '📢',
  warning: '⚠️',
  promo: '🎉',
  emergency: '🚨',
};

export default function GlobalAnnouncement() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'], withCredentials: true });
    socket.on('global_announcement', (data: Announcement) => {
      setAnnouncement(data);
      // Auto-dismiss after 8 seconds unless emergency
      if (data.type !== 'emergency') {
        setTimeout(() => setAnnouncement(null), 8000);
      }
    });
    return () => { socket.disconnect(); };
  }, []);

  if (!announcement) return null;

  return (
    <div className={`fixed top-0 left-0 right-0 z-[9998] flex items-center justify-between gap-4 px-6 py-3 border-b backdrop-blur-md shadow-lg ${TYPE_STYLES[announcement.type]}`}>
      <div className="flex items-center gap-3 flex-1">
        <span className="text-xl">{TYPE_ICONS[announcement.type]}</span>
        <p className="text-sm font-bold leading-snug">{announcement.message}</p>
      </div>
      <button
        onClick={() => setAnnouncement(null)}
        className="text-lg opacity-70 hover:opacity-100 transition-opacity shrink-0 font-black"
      >
        ✕
      </button>
    </div>
  );
}
