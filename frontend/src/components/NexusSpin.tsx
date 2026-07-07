"use client";
import React, { useState } from 'react';
import { motion, useAnimation } from 'framer-motion';
import { showToast } from './ToastProvider';

const PRIZES = [
  { text: '50 ZEN', icon: '💎', color: '#C9A84C' },
  { text: 'FREE DEL', icon: '🚚', color: '#38BDF8' },
  { text: '10 ZEN', icon: '🪙', color: '#94A3B8' },
  { text: 'TRY AGAIN', icon: '❌', color: '#1E293B' },
  { text: '100 ZEN', icon: '🔥', color: '#F59E0B' },
  { text: 'SURPRISE', icon: '🎁', color: '#8B5CF6' },
  { text: '5 ZEN', icon: '🪙', color: '#475569' },
  { text: 'JACKPOT', icon: '🎰', color: '#EC4899' },
];

export default function NexusSpin() {
  const [isSpinning, setIsSpinning] = useState(false);
  const [hasSpun, setHasSpun] = useState(false);
  const controls = useAnimation();

  const handleSpin = async () => {
    if (isSpinning || hasSpun) return;

    setIsSpinning(true);
    
    // Calculate random rotation (at least 5 full spins + random prize)
    const prizeIndex = Math.floor(Math.random() * PRIZES.length);
    const rotationPerPrize = 360 / PRIZES.length;
    const extraRotation = (PRIZES.length - prizeIndex) * rotationPerPrize;
    const totalRotation = 1800 + extraRotation; // 1800 = 5 full rotations

    await controls.start({
      rotate: totalRotation,
      transition: { duration: 4, ease: [0.15, 0, 0.15, 1] }
    });

    setIsSpinning(false);
    setHasSpun(true);

    const prize = PRIZES[prizeIndex];
    if (prize.text === 'TRY AGAIN') {
      showToast('No luck this time, Operative.', 'info', '📡');
    } else {
      showToast(`Unit Unlocked: ${prize.text}!`, 'success', prize.icon);
    }
  };

  return (
    <div className="flex flex-col items-center py-12 px-4 bg-white/[0.02] border border-white/5 rounded-[48px] relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(201,168,76,0.05),transparent_70%)] pointer-events-none" />
      
      <div className="text-center mb-10 relative z-10">
        <h3 className="text-2xl font-black uppercase tracking-tighter italic text-white light:text-gray-900 mb-2">Nexus Synchronizer</h3>
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary-yellow/60">Daily Probability Matrix Injection</p>
      </div>

      <div className="relative w-72 h-72 md:w-80 md:h-80 mb-12">
        {/* Needle Indicator */}
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-10 z-20 pointer-events-none">
          <div className="w-full h-full bg-[#C9A84C] clip-path-polygon-[0%_0%,100%_0%,50%_100%] shadow-[0_5px_15px_rgba(201,168,76,0.5)]" 
               style={{ clipPath: 'polygon(0% 0%, 100% 0%, 50% 100%)' }} />
        </div>

        {/* Wheel */}
        <motion.div
          animate={controls}
          className="w-full h-full rounded-full border-8 border-white/5 relative overflow-hidden shadow-[0_0_80px_rgba(0,0,0,0.5)] bg-[#0A0A0B]"
          style={{ transformOrigin: 'center' }}
        >
          {PRIZES.map((prize, i) => {
            const angle = (360 / PRIZES.length) * i;
            return (
              <div
                key={i}
                className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-full flex flex-col items-center pt-8 origin-bottom"
                style={{ 
                  transform: `translateX(-50%) rotate(${angle}deg)`,
                  borderRight: '1px solid rgba(255,255,255,0.05)'
                }}
              >
                <span className="text-lg mb-2">{prize.icon}</span>
                <span className="text-[7px] font-black uppercase tracking-widest text-white light:text-gray-900/40 rotate-90 origin-center translate-y-12 whitespace-nowrap">
                  {prize.text}
                </span>
              </div>
            );
          })}
          
          {/* Center Hub */}
          <div className="absolute inset-0 m-auto w-12 h-12 bg-[#0A0A0B] rounded-full border-4 border-white/10 z-10 flex items-center justify-center shadow-2xl">
             <div className="w-2 h-2 bg-primary-yellow rounded-full animate-ping" />
          </div>
        </motion.div>
      </div>

      <button
        onClick={handleSpin}
        disabled={isSpinning || hasSpun}
        className={`relative z-10 px-12 py-4 rounded-full font-black uppercase tracking-[0.4em] text-[10px] transition-all active:scale-95 ${
          hasSpun 
          ? 'bg-white/5 text-white light:text-gray-900/20 border border-white/5 cursor-not-allowed' 
          : 'bg-primary-yellow text-black shadow-[0_10px_30px_rgba(201,168,76,0.3)] hover:shadow-[0_15px_40px_rgba(201,168,76,0.5)]'
        }`}
      >
        {isSpinning ? 'Synchronizing...' : hasSpun ? 'Matrix Depleted' : 'Initiate Spin'}
      </button>
      
      {hasSpun && (
        <p className="mt-6 text-[8px] font-black uppercase tracking-widest text-white light:text-gray-900/20 animate-pulse">
          Return in 24h for next injection
        </p>
      )}
    </div>
  );
}
