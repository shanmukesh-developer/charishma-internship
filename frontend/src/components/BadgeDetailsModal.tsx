"use client";
import { motion, AnimatePresence } from 'framer-motion';

interface BadgeCriteria {
  category: string;
  silver: number;
  gold: number;
  platinum: number;
}

const CRITERIA_MAP: Record<string, BadgeCriteria> = {
  // Orders
  'Scaler': { category: 'Total Orders', silver: 10, gold: 30, platinum: 100 },
  'Grafter': { category: 'Total Orders', silver: 10, gold: 30, platinum: 100 },
  'Pro': { category: 'Total Orders', silver: 10, gold: 30, platinum: 100 },
  // Late Night
  'Shadow': { category: 'Late Night Orders (9PM+)', silver: 5, gold: 15, platinum: 50 },
  'Ghost': { category: 'Late Night Orders (9PM+)', silver: 5, gold: 15, platinum: 50 },
  'Phantom': { category: 'Late Night Orders (9PM+)', silver: 5, gold: 15, platinum: 50 },
  // Streak
  'Streaker': { category: 'Active Streak (Days)', silver: 5, gold: 15, platinum: 30 },
  'Guardian': { category: 'Active Streak (Days)', silver: 5, gold: 15, platinum: 30 },
  'Persistence': { category: 'Active Streak (Days)', silver: 5, gold: 15, platinum: 30 }
};

interface BadgeDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  badgeName: string;
  userStats: {
    completedOrders: number;
    lateNightOrders: number;
    streakCount: number;
  };
}

export default function BadgeDetailsModal({ isOpen, onClose, badgeName, userStats }: BadgeDetailsModalProps) {
  // Extract the specific badge keyword (e.g. "Scaler" from "Silver Scaler")
  const keyword = badgeName.split(' ').pop() || '';
  const criteria = CRITERIA_MAP[keyword];
  
  const isSilver = badgeName.includes('Silver');
  const isGold = badgeName.includes('Gold');
  const isPlatinum = badgeName.includes('Platinum');
  
  const currentLevel = isPlatinum ? 'Platinum' : isGold ? 'Gold' : isSilver ? 'Silver' : 'Locked';
  const nextLevel = (isPlatinum ? null : isGold ? 'platinum' : isSilver ? 'gold' : 'silver') as keyof BadgeCriteria | null;
  
  const currentStat = badgeName.includes('Shadow') || badgeName.includes('Ghost') || badgeName.includes('Phantom') ? userStats.lateNightOrders : 
                     badgeName.includes('Streaker') || badgeName.includes('Guardian') || badgeName.includes('Persistence') ? userStats.streakCount : 
                     userStats.completedOrders;

  // Guard against undefined criteria
  if (!criteria) return null;

  const target = nextLevel ? (criteria[nextLevel] as number) : criteria.platinum;
  const progress = Math.min(100, (currentStat / (target as number)) * 100);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-md" 
            onClick={onClose} 
          />
          
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="w-full max-w-md glass-card border-[#C9A84C]/20 p-8 relative overflow-hidden h-auto"
          >
            {/* Holographic Background */}
            <div className="absolute inset-0 hologram-badge opacity-10 pointer-events-none" />
            
            <div className="relative z-10 flex flex-col items-center text-center">
              <div className={`w-24 h-24 rounded-full flex items-center justify-center text-5xl mb-6 shadow-2xl border-2 ${
                isPlatinum ? 'border-purple-500/50 bg-purple-500/10' : 
                isGold ? 'border-amber-500/50 bg-amber-500/10' : 
                'border-gray-500/50 bg-gray-500/10'
              }`}>
                {badgeName.includes('Order') ? '📦' : badgeName.includes('Late') ? '🌙' : '🔥'}
              </div>
              
              <h2 className="text-2xl font-black text-white light:text-gray-900 italic uppercase tracking-tighter mb-2">{badgeName}</h2>
              <p className="text-[10px] font-black text-[#C9A84C] uppercase tracking-[0.3em] mb-6">{currentLevel} Rank Unlocked</p>
              
              <div className="w-full space-y-4 mb-8">
                <div className="flex justify-between items-end">
                   <div className="text-left">
                     <p className="text-[8px] font-black text-secondary-text uppercase tracking-widest mb-1">Current Progress</p>
                     <p className="text-lg font-black text-white light:text-gray-900">{currentStat} / {target}</p>
                   </div>
                   {nextLevel && (
                     <div className="text-right">
                        <p className="text-[8px] font-black text-[#C9A84C] uppercase tracking-widest mb-1">Next: {nextLevel}</p>
                     </div>
                   )}
                </div>
                
                <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    className={`h-full ${isPlatinum ? 'bg-purple-500' : isGold ? 'bg-amber-500' : 'bg-gray-400'}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 w-full">
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 text-left">
                   <p className="text-[8px] font-black text-secondary-text uppercase tracking-widest mb-2">Active Perk</p>
                   <div className="flex items-center gap-3">
                      <span className="text-lg">💎</span>
                      <p className="text-[11px] font-bold text-white light:text-gray-900 leading-tight">
                        {isPlatinum ? '100% Free Delivery on all orders across the campus.' : 
                         isGold ? '50% Discount on Delivery Fees applied automatically.' : 
                         '₹10 Flat Discount on every full order.'}
                      </p>
                   </div>
                </div>
              </div>

              <button 
                onClick={onClose}
                className="mt-8 w-full py-4 bg-white/5 hover:bg-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white light:text-gray-900/40 transition-all border border-white/5"
              >
                Dismiss Intel
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
