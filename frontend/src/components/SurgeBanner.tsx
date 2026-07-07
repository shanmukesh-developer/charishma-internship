"use client";
import { useEffect, useState } from 'react';
import socket from '@/utils/socket';

// Uses shared singleton socket — no new connection per render
interface SurgeData {
  multiplier: number;
  orderCount: number;
}

export default function SurgeBanner() {
  const [surge, setSurge] = useState<SurgeData | null>(null);

  useEffect(() => {
    const onSurgeActive = (data: SurgeData) => setSurge(data);
    const onSurgeEnded = () => setSurge(null);

    socket.on('surge_active', onSurgeActive);
    socket.on('surge_ended', onSurgeEnded);

    return () => {
      socket.off('surge_active', onSurgeActive);
      socket.off('surge_ended', onSurgeEnded);
    };
  }, []);

  if (!surge) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9997] bg-gradient-to-r from-orange-600 to-red-600 text-white light:text-gray-900 flex items-center justify-between px-6 py-2.5 shadow-lg border-b border-red-400/30">
      <div className="flex items-center gap-3">
        <span className="text-xl animate-pulse">🔥</span>
        <div>
          <p className="text-[11px] font-black uppercase tracking-widest opacity-70">HIGH DEMAND ALERT</p>
          <p className="text-sm font-bold">
            Surge pricing active · Delivery fee ×{surge.multiplier.toFixed(2)}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-[10px] font-black text-orange-200 uppercase tracking-widest">{surge.orderCount} orders</p>
        <p className="text-[9px] text-orange-300">in last 2 mins</p>
      </div>
    </div>
  );
}
