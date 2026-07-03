import { useState, useEffect } from 'react';
import SafeImage from './SafeImage';
import { API_URL } from '@/utils/api';

interface Legend {
  id: string;
  name: string;
  badgeCount: number;
  tier: 'Platinum' | 'Gold' | 'Silver';
  profileImage?: string;
  zenPoints: number;
}

export default function NexusLeaderboard() {
  const [legends, setLegends] = useState<Legend[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const res = await fetch(`${API_URL}/api/rewards/leaderboard`);
        const data = await res.json();
        if (Array.isArray(data)) {
          setLegends(data);
        }
      } catch (error) {
        console.error('Failed to fetch Nexus Leaderboard:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 60000); // Pulse every minute
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div className="h-64 w-full glass-card animate-pulse border-white/5" />;

  return (
    <div className="glass-card p-6 border-[#C9A84C]/20 relative overflow-hidden group midnight-border-transition">
      {/* Background Glow */}
      <div className="absolute -top-10 -right-10 w-32 h-32 bg-[#C9A84C]/10 blur-[50px] rounded-full pointer-events-none group-hover:bg-[#C9A84C]/20 transition-all duration-1000 midnight-glow-bg" />
      
      <div className="flex items-center justify-between mb-8">
        <div>
          <h3 className="text-[12px] font-black uppercase tracking-[0.4em] text-[#C9A84C] mb-1">Nexus Legends</h3>
          <p className="text-[9px] font-bold text-white/50 uppercase tracking-widest">Global Campus Rankings</p>
        </div>
        <div className="w-8 h-8 rounded-lg bg-[#C9A84C]/10 flex items-center justify-center text-sm border border-[#C9A84C]/20">🏆</div>
      </div>

      <div className="space-y-5">
        {legends.length > 0 ? legends.map((legend, idx) => {
          const isPlatinum = legend.tier === 'Platinum';
          const isGold = legend.tier === 'Gold';
          
          return (
            <div key={legend.id} className="relative flex items-center justify-between hover:translate-x-1 transition-transform cursor-pointer group/row">
               <div className="flex items-center gap-4 relative z-10">
                  <div className="relative">
                    <span className={`text-[10px] font-black w-4 inline-block ${idx === 0 ? 'text-[#C9A84C]' : 'text-secondary-text'}`}>
                      0{idx + 1}
                    </span>
                    <div className="w-10 h-10 rounded-xl overflow-hidden border border-white/10 relative shadow-2xl">
                        {legend.profileImage ? (
                          <SafeImage src={legend.profileImage} alt={legend.name} fill className="object-cover" />
                        ) : (
                         <div className={`w-full h-full flex items-center justify-center text-sm font-black ${isPlatinum ? 'bg-purple-500/20 text-purple-300' : isGold ? 'bg-amber-500/20 text-amber-300' : 'bg-gray-500/20 text-gray-300'}`}>
                           {legend.name[0].toUpperCase()}
                         </div>
                       )}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-[11px] font-black text-white uppercase tracking-tight group-hover/row:text-[#C9A84C] transition-colors">{legend.name}</h4>
                    <div className="flex items-center gap-2 mt-1">
                       <span className={`text-[7px] font-black px-1.5 py-0.5 rounded border ${
                         isPlatinum ? 'border-purple-500/40 text-purple-400 bg-purple-500/5' : 
                         isGold ? 'border-amber-500/40 text-amber-400 bg-amber-500/5' : 
                         'border-gray-500/40 text-gray-400 bg-gray-500/5'
                       }`}>
                         {legend.tier.toUpperCase()}
                       </span>
                       <span className="text-[7px] font-bold text-secondary-text uppercase tracking-widest">• {legend.badgeCount} Badges</span>
                    </div>
                  </div>
               </div>
               <div className="text-right">
                  <span className="text-[11px] font-black text-white italic">{legend.zenPoints}</span>
                  <p className="text-[6px] font-black text-[#C9A84C] uppercase tracking-tighter">ZEN POINTS</p>
               </div>
            </div>
          );
        }) : (
          <div className="py-10 text-center">
            <p className="text-[9px] font-black text-secondary-text uppercase tracking-[0.2em] animate-pulse">Scanning Nexus Nodes...</p>
          </div>
        )}
      </div>

      <div className="mt-8 pt-6 border-t border-white/5">
        <div className="flex items-center justify-between p-3 rounded-2xl bg-white/[0.02] border border-white/5">
           <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-md bg-emerald-500/20 flex items-center justify-center text-[12px]">✨</div>
              <p className="text-[10px] font-black text-white uppercase tracking-tight">Active Streak Multiplier</p>
           </div>
           <span className="text-[11px] font-black text-emerald-400">1.2x</span>
        </div>
      </div>
    </div>
  );
}
