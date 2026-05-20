"use client";
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const PRIZES = [
  { label: 'FREE DEL', color: '#C9A84C', value: 'FREEDEL', type: 'coupon' }, // Index 0
  { label: '10 ZEN', color: '#1a1a1c', value: 10, type: 'points' },
  { label: '20 ZEN', color: '#1a1a1c', value: 20, type: 'points' },
  { label: '5 ZEN', color: '#1a1a1c', value: 5, type: 'points' },
  { label: '50 ZEN', color: '#1a1a1c', value: 50, type: 'points' },
  { label: '100 ZEN', color: '#1a1a1c', value: 100, type: 'points' },
  { label: '5 ZEN', color: '#1a1a1c', value: 5, type: 'points' },
  { label: '2 ZEN', color: '#1a1a1c', value: 2, type: 'points' },
];

export default function SpinWheel({ onWin }: { onWin: (prize: typeof PRIZES[0]) => void }) {
  const [eligibility, setEligibility] = useState<{ spinsAvailable: number, nextMilestoneIn: number, spinsUsed: number } | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    fetchEligibility();
  }, []);

  const fetchEligibility = async () => {
    try {
      const token = 'cookie-managed';
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
      const res = await fetch(`${API_URL}/api/rewards/spin-eligibility`, {
        });
      const data = await res.json();
      setEligibility(data);
    } catch (err) {
      console.error('Failed to fetch spin eligibility:', err);
    }
  };

  const handleSpinClick = async () => {
    if (isSpinning || !eligibility || eligibility.spinsAvailable <= 0) return;

    // Developer Bias Implementation: Win Free Delivery only every 15th spin
    const spinsCount = (eligibility.spinsUsed || 0) + 1;
    let newPrizeNumber;
    
    if (spinsCount % 15 === 0) {
      newPrizeNumber = 0; // Force landed on FREE DEL
    } else {
      // Pick any prize EXCEPT index 0
      newPrizeNumber = Math.floor(Math.random() * (PRIZES.length - 1)) + 1;
    }

    const extraRotations = 5 * 360; 
    const prizeRotation = (360 / PRIZES.length) * newPrizeNumber;
    const finalRotation = rotation + extraRotations + (360 - (rotation % 360)) + (360 - prizeRotation);

    setRotation(finalRotation);
    setIsSpinning(true);

    setTimeout(async () => {
      setIsSpinning(false);
      const wonPrize = PRIZES[newPrizeNumber];
      
      // Record spin in backend
      try {
        const token = 'cookie-managed';
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
        await fetch(`${API_URL}/api/rewards/use-spin`, {
          method: 'POST',
          headers: { 
            
            'Type-Content': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ 
            prizeType: wonPrize.type, 
            prizeValue: wonPrize.value 
          })
        });
        fetchEligibility(); // Refresh count
        onWin(wonPrize);
      } catch (err) {
        console.error('Failed to record spin:', err);
      }
    }, 5000);
  };

  return (
    <div className="flex flex-col items-center gap-6 p-6 glass-card border-[#C9A84C]/20 rounded-[40px] relative overflow-hidden">
      {/* Background Glow */}
      <div className="absolute inset-0 bg-[#C9A84C]/5 pointer-events-none" />
      
      <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-primary-yellow">Nexus Luck</h3>
      <h2 className="text-xl font-black text-white uppercase tracking-wider text-center">Gourmet Lucky Spin</h2>
      
      <div className="relative w-64 h-64 mt-4">
        {/* Pointer */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-2 z-20">
          <div className="w-4 h-6 bg-primary-yellow clip-path-triangle shadow-lg shadow-primary-yellow/40" />
        </div>

        {/* Wheel Container */}
        <motion.div 
          className="w-full h-full rounded-full border-4 border-[#C9A84C]/30 relative overflow-hidden shadow-2xl"
          animate={{ rotate: rotation }}
          transition={{ duration: 5, ease: [0.12, 0.8, 0.32, 1] }}
        >
          {PRIZES.map((prize, i) => (
            <div 
              key={i}
              className="absolute top-0 left-0 w-full h-full"
              style={{ 
                transform: `rotate(${(360 / PRIZES.length) * i}deg)`,
                clipPath: 'polygon(50% 50%, 50% 0%, 100% 0%, 100% 20%)', // Simplified sector
                background: prize.color,
                borderRight: '1px solid rgba(255,255,255,0.05)'
              }}
            >
              <span 
                className="absolute top-8 left-1/2 -translate-x-1/2 text-[8px] font-black text-white whitespace-nowrap origin-bottom"
                style={{ transform: `rotate(${(360 / PRIZES.length) / 2}deg)` }}
              >
                {prize.label}
              </span>
            </div>
          ))}
          {/* Enhanced Clip Path Sectors (Manual SVG approach is better for precision, but CSS works for demo) */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
             {PRIZES.map((prize, i) => {
               const angle = (360 / PRIZES.length);
               const startAngle = i * angle;
               const endAngle = (i + 1) * angle;
               const x1 = 50 + 50 * Math.cos((Math.PI * (startAngle - 90)) / 180);
               const y1 = 50 + 50 * Math.sin((Math.PI * (startAngle - 90)) / 180);
               const x2 = 50 + 50 * Math.cos((Math.PI * (endAngle - 90)) / 180);
               const y2 = 50 + 50 * Math.sin((Math.PI * (endAngle - 90)) / 180);
               
               return (
                 <path 
                   key={i}
                   d={`M 50 50 L ${x1} ${y1} A 50 50 0 0 1 ${x2} ${y2} Z`}
                   fill={prize.color}
                   stroke="rgba(255,255,255,0.05)"
                   strokeWidth="0.5"
                 />
               );
             })}
          </svg>
          {/* Prize Labels inside SVG for better rotation */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100">
             {PRIZES.map((prize, i) => {
               const angle = (360 / PRIZES.length) * i + (360 / PRIZES.length) / 2;
               return (
                 <text 
                   key={i}
                   x="50" y="20"
                   transform={`rotate(${angle}, 50, 50)`}
                   textAnchor="middle"
                   fill="white"
                   className="text-[4px] font-black uppercase tracking-tighter"
                 >
                   {prize.label}
                 </text>
               );
             })}
          </svg>
          <div className="absolute inset-4 rounded-full border border-white/5 pointer-events-none" />
        </motion.div>

        {/* Center Cap */}
        <button 
          onClick={handleSpinClick}
          disabled={isSpinning || !eligibility || eligibility.spinsAvailable <= 0}
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full glass-card border-2 shadow-xl z-30 flex items-center justify-center transition-all ${isSpinning || !eligibility || eligibility.spinsAvailable <= 0 ? 'border-white/10 opacity-50' : 'border-primary-yellow hover:scale-110 active:scale-95'}`}
        >
          <div className="text-center">
            <p className="text-[10px] font-black text-white uppercase leading-none">SPIN</p>
            {(!eligibility || eligibility.spinsAvailable <= 0) && !isSpinning && <p className="text-[6px] font-bold text-primary-yellow uppercase mt-1">Locked</p>}
          </div>
        </button>
      </div>

      <div className="text-center space-y-1">
        <p className="text-[8px] font-bold text-secondary-text uppercase tracking-widest">
          {isSpinning ? 'Good Luck!' : (eligibility && eligibility.spinsAvailable > 0) 
            ? `${eligibility.spinsAvailable} Spin${eligibility.spinsAvailable > 1 ? 's' : ''} Earned!` 
            : `${eligibility?.nextMilestoneIn || 2} orders left for next spin`}
        </p>
        <p className="text-[7px] text-white/20 uppercase tracking-widest italic">Nexus Reward System v1.1</p>
      </div>
    </div>
  );
}

// Add these to globals.css or component-specific styles
// .clip-path-triangle { clip-path: polygon(50% 100%, 0 0, 100% 0); }
