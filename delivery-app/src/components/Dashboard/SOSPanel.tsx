"use client";
import React, { useState, useRef } from 'react';
import { Socket } from 'socket.io-client';

interface SOSPanelProps {
  riderName: string;
  riderId: string;
  socket?: Socket | null;
}

export default function SOSPanel({ riderName, riderId, socket }: SOSPanelProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [sosActive, setSosActive] = useState(false);
  const [sosCountdown, setSosCountdown] = useState(0);

  const holdRef = useRef<NodeJS.Timeout | null>(null);
   const timerRef = useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    if (!socket) return;
    const handleReset = (data: { riderId: string }) => {
      if (data.riderId === riderId) {
        setSosActive(false);
        setIsConfirming(false);
      }
    };
    socket.on('RIDER_SOS_RESET', handleReset);
    return () => { socket.off('RIDER_SOS_RESET', handleReset); };
  }, [socket, riderId]);

  const handleSosStart = () => {
    let count = 3;
    setSosCountdown(count);
    holdRef.current = setTimeout(() => {
      setSosCountdown(0);
      setIsConfirming(true); // Show confirmation screen instead of instant trigger
    }, 3000);
    timerRef.current = setInterval(() => {
      count -= 1;
      setSosCountdown(count);
      if (count <= 0) clearInterval(timerRef.current!);
    }, 1000);
  };

  const handleSosCancel = () => {
    if (holdRef.current) clearTimeout(holdRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    setSosCountdown(0);
  };

  const triggerSOS = () => {
    setSosActive(true);
    setIsConfirming(false);
    setSosCountdown(0);

    const sendPayload = (lat: number, lng: number, coordsInaccurate = false) => {
      const payload = {
        riderName,
        riderId,
        lat,
        lng,
        coordsInaccurate,
        timestamp: new Date().toISOString(),
        message: coordsInaccurate 
          ? 'Emergency SOS triggered. Location unavailable (fallback coordinates used).'
          : 'Emergency SOS triggered by rider.'
      };
      if (socket?.connected) socket.emit('sos_alert', payload);
      console.warn('[SOS] Payload emitted:', payload);
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          sendPayload(pos.coords.latitude, pos.coords.longitude, false);
        },
        (err) => {
          console.warn('[SOS] Geolocation failed. Using fallback coordinates. Error:', err.message);
          sendPayload(16.4632, 80.5064, true);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    } else {
      console.warn('[SOS] Geolocation not supported. Using fallback.');
      sendPayload(16.4632, 80.5064, true);
    }

    // Auto-deactivate after 30s
    setTimeout(() => setSosActive(false), 30000);
  };

  if (sosActive) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-5 mb-6 text-center shadow-xl">
        <p className="text-red-500 font-bold text-xs uppercase tracking-widest mb-1.5 flex items-center justify-center gap-2">
           <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-ping" />
           Emergency Signal Sent
        </p>
        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-4">Support units notified with your location</p>
        <button 
          onClick={() => setSosActive(false)} 
          className="text-[9px] font-bold uppercase tracking-widest text-slate-400 hover:text-white transition-colors border border-white/5 px-4 py-2 rounded-lg"
        >
          Cancel Alert
        </button>
      </div>
    );
  }

  if (isConfirming) {
    return (
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 mb-6 text-center shadow-xl animate-in fade-in zoom-in duration-300">
        <p className="text-amber-500 font-bold text-xs uppercase tracking-widest mb-1 shadow-sm">Confirm Critical Signal?</p>
        <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-4">This will notify Nexus Command Center immediately.</p>
        <div className="flex gap-3">
          <button 
            onClick={() => setIsConfirming(false)} 
            className="flex-1 text-[9px] font-black uppercase tracking-widest text-slate-400 bg-white/5 px-4 py-3 rounded-xl border border-white/5 active:scale-95 transition-all"
          >
            Cancel
          </button>
          <button 
            onClick={triggerSOS} 
            className="flex-1 text-[9px] font-black uppercase tracking-widest text-black bg-amber-500 px-4 py-3 rounded-xl shadow-[0_0_20px_rgba(245,158,11,0.3)] active:scale-95 transition-all"
          >
            Confirm SOS
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6">
      {sosCountdown > 0 ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex items-center justify-between shadow-lg">
          <p className="text-red-500 font-bold text-xs uppercase tracking-widest">Hold for {sosCountdown}s...</p>
          <button
            onPointerUp={handleSosCancel}
            onPointerLeave={handleSosCancel}
            className="text-[10px] font-black uppercase tracking-widest text-slate-400 bg-white/5 px-4 py-2 rounded-xl border border-white/5"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onPointerDown={handleSosStart}
          onPointerUp={handleSosCancel}
          onPointerLeave={handleSosCancel}
          className="w-full py-3.5 rounded-2xl bg-white/[0.03] border border-red-500/10 text-red-500/60 text-[10px] font-black uppercase tracking-widest hover:border-red-500/40 hover:text-red-500 transition-all active:scale-[0.98] select-none shadow-sm"
        >
          Hold to trigger Emergency Signal
        </button>
      )}
    </div>
  );
}
