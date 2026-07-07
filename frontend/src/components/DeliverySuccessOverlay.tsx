"use client";
import { useEffect } from 'react';

interface Props {
  isOpen: boolean;
  onComplete: () => void;
  newBadges?: string[];
}

export default function DeliverySuccessOverlay({ isOpen, onComplete, newBadges = [] }: Props) {
  useEffect(() => {
    if (isOpen) {
      // Extend timer if badges are shown to allow user to see them
      const duration = newBadges.length > 0 ? 5500 : 3500;
      const timer = setTimeout(() => onComplete(), duration);
      return () => clearTimeout(timer);
    }
  }, [isOpen, onComplete, newBadges]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[300] flex flex-col items-center justify-center p-6 bg-[#0a0a0b] animate-in fade-in duration-700 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(201,168,76,0.2)_0%,transparent_70%)] animate-pulse" />
      <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-30 mix-blend-overlay" />
      
      <div className="relative z-10 flex flex-col items-center text-center animate-in slide-in-from-bottom-10 duration-1000">
        <div className="w-32 h-32 bg-[#C9A84C] rounded-full flex items-center justify-center text-6xl mb-8 shadow-[0_0_80px_rgba(201,168,76,0.6)] animate-bounce border-4 border-black">
          🎉
        </div>
        <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#C9A84C] via-[#F7D331] to-[#8B7332] uppercase tracking-[0.2em] mb-4">
          Delivered!
        </h1>
        <p className="text-white light:text-gray-900/60 text-sm font-bold uppercase tracking-widest max-w-[250px] leading-relaxed mb-10">
          Your Zenvy captain has completed the mission. Enjoy your meal!
        </p>

        {newBadges.length > 0 && (
          <div className="flex flex-col items-center gap-6 animate-in zoom-in slide-in-from-top-20 duration-1000 delay-500">
            <div className="text-[10px] font-black text-[#C9A84C] uppercase tracking-[0.3em]">Achievement Unlocked</div>
            <div className="flex flex-wrap justify-center gap-4">
              {newBadges.map((badge, idx) => {
                const isPlatinum = badge.includes('Platinum') || badge.includes('Pro') || badge.includes('Phantom');
                const isGold = badge.includes('Gold') || badge.includes('Grafter') || badge.includes('Ghost');
                return (
                  <div key={idx} className={`p-6 rounded-3xl border-2 flex flex-col items-center gap-3 glass shadow-2xl transition-all hover:scale-110 ${
                    isPlatinum ? 'border-purple-500/40 bg-purple-500/10' : 
                    isGold ? 'border-amber-500/40 bg-amber-500/10' : 
                    'border-gray-400/40 bg-gray-400/10'
                  }`}>
                    <div className="text-4xl">
                      {isPlatinum ? '💎' : isGold ? '🥇' : '🥈'}
                    </div>
                    <div className={`text-xs font-black uppercase tracking-widest ${
                      isPlatinum ? 'text-purple-300' : isGold ? 'text-amber-300' : 'text-gray-200'
                    }`}>
                      {badge}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
