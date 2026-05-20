"use client";
import React, { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5005';

interface SOSData {
  riderId: string;
  riderName: string;
  timestamp: string;
}

export default function SOSAlertModal() {
  const [sosEvent, setSosEvent] = useState<SOSData | null>(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'], withCredentials: true
    });
    socket.on('sos_received', (data: SOSData) => {
      setSosEvent(data);
      // Attempt to play a siren
      try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/996/996-preview.mp3');
        audio.play().catch(() => {}); // catch browser autoplay blocks
      } catch {}
    });
    return () => { socket.disconnect(); };
  }, []);

  if (!sosEvent) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div className="bg-red-600 p-10 rounded-3xl border-4 border-red-400 shadow-[0_0_100px_rgba(220,38,38,0.8)] max-w-xl w-full text-center animate-pulse">
        <div className="text-6xl mb-6">🆘</div>
        <h2 className="text-4xl font-black text-white uppercase tracking-widest mb-4">CRITICAL SOS ALERT</h2>
        <p className="text-xl text-white font-bold mb-2">Rider: {sosEvent.riderName}</p>
        <p className="text-md text-red-200 mb-8 font-mono">ID: {sosEvent.riderId}<br/>{new Date(sosEvent.timestamp).toLocaleString()}</p>
        
        <button 
          onClick={() => setSosEvent(null)}
          className="w-full py-5 bg-white text-red-600 font-black text-xl uppercase tracking-widest rounded-2xl hover:bg-red-100 transition-all"
        >
          Acknowledge & Dispatch Security
        </button>
      </div>
    </div>
  );
}
