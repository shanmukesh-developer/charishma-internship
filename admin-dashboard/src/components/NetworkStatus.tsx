"use client";
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5005';

export default function NetworkStatus() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'], withCredentials: true
    });
    socket.on('connect', () => {
      console.log('[SOCKET_CONNECTED] Admin Terminal Link Established');
      setConnected(true);
    });
    socket.on('disconnect', () => setConnected(false));
    return () => { socket.disconnect(); };
  }, []);

  return (
    <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Network Status</span>
        <div className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${connected ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.6)] animate-pulse' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.6)]'}`} />
      </div>
      <p className="text-[11px] font-bold text-gray-400">{connected ? 'SRM_ALPHA_NODE_01' : 'OFFLINE'}</p>
      <div className="mt-3 w-full h-1 bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${connected ? 'w-[100%] bg-emerald-500' : 'w-[0%] bg-red-500'}`} />
      </div>
    </div>
  );
}

