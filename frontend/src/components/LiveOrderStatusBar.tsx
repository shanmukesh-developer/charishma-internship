"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';

import { socket } from '@/utils/socket';
import ChatDrawer from './ChatDrawer';

interface Props {
  orderId: string;
  initialStatus?: string;
  cancelSecondsLeft?: number;
  onCancel?: () => void;
  onDelivered?: () => void;
}

const STEPS = [
  { key: 'Pending',   label: 'Order Placed',   icon: '📋' },
  { key: 'Accepted',  label: 'Rider Assigned',  icon: '🛵' },
  { key: 'PickedUp',  label: 'Out for Delivery', icon: '🔥' },
  { key: 'Delivered', label: 'Delivered!',       icon: '✅' },
];

export default function LiveOrderStatusBar({ orderId, initialStatus = 'Pending', cancelSecondsLeft: initialSeconds = 0, onCancel, onDelivered }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [cancelSecondsLeft, setCancelSecondsLeft] = useState(initialSeconds);
  const [riderName, setRiderName] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(false);

  const currentStepIdx = STEPS.findIndex(s => s.key === status);

  useEffect(() => {
    if (!orderId) return;
    socket.emit('joinOrder', orderId);
    socket.on('statusUpdated', (data: any) => {
      const s = typeof data === 'string' ? data : data.status;
      const targetId = typeof data === 'object' && data !== null ? data.id || data.orderId : null;
      if (targetId && String(targetId) !== String(orderId)) {
        return;
      }
      setStatus(s);
      if (s === 'Delivered' && onDelivered) {
        onDelivered();
      }
    });
    socket.on('locationUpdated', (data: { riderName?: string }) => {
      if (data.riderName) setRiderName(data.riderName);
    });

    return () => { 
      socket.off('statusUpdated');
      socket.off('locationUpdated');
    };
  }, [orderId, onDelivered]);

  // Tick down cancellation countdown isolated here
  useEffect(() => {
    if (cancelSecondsLeft <= 0 || status !== 'Pending') return;
    const tick = setInterval(() => setCancelSecondsLeft(p => Math.max(0, p - 1)), 1000);
    return () => clearInterval(tick);
  }, [cancelSecondsLeft, status]);

  if (status === 'Delivered') return (
    <div className="fixed bottom-20 left-4 right-4 z-50 animate-slide-up">
      <div className="bg-emerald-500 text-black p-4 rounded-3xl flex items-center justify-between shadow-xl">
        <div>
          <p className="font-black text-sm uppercase tracking-wide">Delivered! 🎉</p>
          <p className="text-xs opacity-70 mt-0.5">Your food has arrived. Enjoy!</p>
        </div>
        <button onClick={() => setStatus('closed')} className="text-black/50 hover:text-black text-xl font-bold">✕</button>
      </div>
    </div>
  );

  if (status === 'closed') return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 animate-slide-up">
      <div className="bg-[#1A1A1C] border border-emerald-500/30 rounded-3xl shadow-[0_0_40px_rgba(16,185,129,0.15)] overflow-hidden">
        {/* Header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-5 py-4 flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="relative w-8 h-8 flex items-center justify-center">
              <div className="absolute w-8 h-8 bg-emerald-500/20 rounded-full animate-ping" />
              <span className="text-lg relative z-10">{STEPS[currentStepIdx]?.icon || '📋'}</span>
            </div>
            <div className="text-left">
              <p className="text-[9px] text-emerald-500 uppercase font-black tracking-widest">Live Order</p>
              <p className="text-sm font-black text-white">{STEPS[currentStepIdx]?.label}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/tracking?id=${orderId}`}
              className="text-[9px] text-blue-400 font-black uppercase tracking-widest bg-blue-400/10 px-2 py-1 rounded-lg"
              onClick={e => e.stopPropagation()}
            >
              Map
            </Link>
            <button
               onClick={(e) => { e.stopPropagation(); setIsChatOpen(true); }}
               className="text-[9px] text-emerald-400 font-black uppercase tracking-widest bg-emerald-400/10 px-2 py-1 rounded-lg"
            >
              Chat
            </button>
            <a
               href={`https://wa.me/91XXXXXXXXXX?text=Help%20with%20Order%20${orderId}`}
               target="_blank"
               rel="noopener noreferrer"
               className="text-[9px] text-[#25D366] font-black uppercase tracking-widest bg-[#25D366]/10 px-2 py-1 rounded-lg flex items-center gap-1"
               onClick={e => e.stopPropagation()}
            >
              WhatsApp
            </a>
            <span className="text-gray-500">{isExpanded ? '▼' : '▲'}</span>
          </div>
        </button>

        {/* Steps */}
        {isExpanded && (
          <div className="px-5 pb-5">
            {riderName && (
              <p className="text-[10px] text-gray-400 font-medium mb-4">
                🛵 Your rider: <span className="text-white font-black">{riderName}</span>
              </p>
            )}
            <div className="flex items-center gap-0">
              {STEPS.map((step, idx) => {
                const done = idx <= currentStepIdx;
                const current = idx === currentStepIdx;
                return (
                  <div key={step.key} className="flex items-center flex-1 last:flex-none">
                    <div className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm border-2 transition-all ${
                        done ? 'bg-emerald-500 border-emerald-500 text-black' : 'border-white/10 text-gray-600'
                      } ${current ? 'shadow-[0_0_16px_rgba(16,185,129,0.5)]' : ''}`}>
                        {done ? (current ? step.icon : '✓') : step.icon}
                      </div>
                      <p className={`text-[8px] mt-1 font-black uppercase tracking-wide text-center max-w-[48px] leading-tight ${
                        done ? 'text-emerald-400' : 'text-gray-600'
                      }`}>{step.label}</p>
                    </div>
                    {idx < STEPS.length - 1 && (
                      <div className={`flex-1 h-0.5 mx-1 mb-5 transition-all ${done && idx < currentStepIdx ? 'bg-emerald-500' : 'bg-white/5'}`} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Cancel Order Section */}
            {status === 'Pending' && cancelSecondsLeft > 0 && onCancel && (
              <div className="mt-5 pt-4 border-t border-white/5 flex items-center justify-between">
                <div>
                   <p className="text-[9px] text-gray-500 font-bold uppercase tracking-widest">Changed your mind?</p>
                   <p className="text-[10px] text-red-400 font-bold">Cancel window closes in {cancelSecondsLeft}s</p>
                </div>
                <button
                  onClick={onCancel}
                  className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 text-[10px] font-black uppercase tracking-wider rounded-xl border border-red-500/20 transition-all"
                >
                  Cancel Order
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <ChatDrawer
        orderId={orderId}
        userName="Student" // Should come from auth context ideally
        userRole="customer"
        socket={socket}
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
      />
    </div>
  );
}
