"use client";
import { useEffect, useState } from 'react';

interface Props {
  isOpen: boolean;
  status: 'processing' | 'success' | 'error';
  errorMessage?: string;
}

export default function CheckoutProcessingModal({ isOpen, status, errorMessage }: Props) {
  const [step, setStep] = useState(0);
  const [sparkles, setSparkles] = useState<{ id: number; x: number; y: number }[]>([]);

  useEffect(() => {
    if (!isOpen || status !== 'processing') return;
    setStep(0);
    const t1 = setTimeout(() => setStep(1), 800);
    const t2 = setTimeout(() => setStep(2), 1600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [isOpen, status]);

  useEffect(() => {
    if (status === 'success') {
      // Explode 12 golden star particles in a radial burst
      const particles = Array.from({ length: 12 }).map((_, i) => {
        const angle = (i * 2 * Math.PI) / 12;
        const distance = 50 + Math.random() * 50;
        return {
          id: i,
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance
        };
      });
      setSparkles(particles);
    } else {
      setSparkles([]);
    }
  }, [status]);

  if (!isOpen) return null;

  const messages = [
    "Encrypting Payment...",
    "Notifying Elite Captain...",
    "Confirming Details..."
  ];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/90 backdrop-blur-xl animate-in fade-in duration-300">
      <div className="flex flex-col items-center justify-center text-center">
        {status === 'processing' && (
          <>
            <div className="relative w-24 h-24 mb-8">
              <div className="absolute inset-0 border-4 border-white/10 rounded-full" />
              <div className="absolute inset-0 border-4 border-[#C9A84C] rounded-full border-t-transparent animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center text-2xl animate-pulse">
                🔒
              </div>
            </div>
            <h2 className="text-xl font-black text-white light:text-gray-900 uppercase tracking-widest mb-2 animate-in fade-in">Processing</h2>
            <p className="text-[#C9A84C] text-sm font-bold uppercase tracking-widest transition-all duration-300 animate-in slide-in-from-bottom-2">
              {messages[step]}
            </p>
          </>
        )}
        
        {status === 'success' && (
          <div className="animate-in zoom-in duration-500">
            <div className="relative w-24 h-24 mx-auto mb-6">
              <div className="w-24 h-24 bg-emerald-500 rounded-full flex items-center justify-center text-5xl text-black shadow-[0_0_50px_rgba(16,185,129,0.5)] relative z-10">
                ✓
              </div>
              {sparkles.map(s => (
                <div
                  key={s.id}
                  className="sparkle-particle"
                  style={{
                    left: '50%',
                    top: '50%',
                    marginLeft: '-3px',
                    marginTop: '-3px',
                    '--tw-sparkle-x': `${s.x}px`,
                    '--tw-sparkle-y': `${s.y}px`
                  } as React.CSSProperties}
                />
              ))}
            </div>
            <h2 className="text-2xl font-black text-white light:text-gray-900 uppercase tracking-widest">Order Confirmed</h2>
            <p className="text-emerald-500 text-sm font-bold uppercase tracking-widest mt-2">Routing to Tracker...</p>
          </div>
        )}

        {status === 'error' && (
          <div className="animate-in zoom-in duration-500">
             <div className="w-24 h-24 bg-red-500 rounded-full flex items-center justify-center text-5xl mx-auto mb-6 text-black shadow-[0_0_50px_rgba(239,68,68,0.5)]">
              ✕
            </div>
            <h2 className="text-2xl font-black text-white light:text-gray-900 uppercase tracking-widest">Payment Failed</h2>
            <p className="text-red-400 text-xs font-bold uppercase tracking-widest mt-4 max-w-xs">{errorMessage || 'Request Rejected'}</p>
            <button 
              onClick={() => window.location.reload()}
              className="mt-8 px-6 py-2 bg-white/10 border border-white/20 rounded-xl text-[10px] font-black uppercase tracking-widest text-white light:text-gray-900 hover:bg-white/20 transition-all"
            >
              Back to Checkout
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
