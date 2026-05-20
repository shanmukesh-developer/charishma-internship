"use client";
import { useState, useEffect } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

interface BlockStats {
  name: string;
  count: number;
}

export default function BlockWarsHUD() {
  const isAuthed = useAdminAuth();
  const [stats, setStats] = useState<BlockStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let fallbackTimer: NodeJS.Timeout;

    const fetchStats = async () => {
      try {
        const token = typeof window !== 'undefined' ? 'cookie-managed' : null;
        console.log('[BLOCKS_FETCH_TOKEN]', token);
        if (!token) {
           // If layout haven't set token yet, retry sets 
           if (mounted) fallbackTimer = setTimeout(fetchStats, 1000);
           return;
        }
        const res = await fetch(`${API_URL}/api/blocks/activity`, {
          });
        const data = await res.json();
        if (res.ok && mounted) setStats(data);
      } catch (err) {
        console.error('[BLOCKS_FETCH_ERROR]', err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchStats();
    // Refresh every 30s
    const timer = setInterval(fetchStats, 30000);
    return () => {
      mounted = false;
      clearInterval(timer);
      clearTimeout(fallbackTimer);
    };
  }, []);

  const maxCount = Math.max(...stats.map(s => s.count), 1);

  if (!isAuthed) return <div className="p-20 text-center font-black text-white uppercase tracking-widest animate-pulse">Authenticating...</div>;

  return (
    <div className="space-y-10 animate-fade-in relative pb-20">
      <header className="flex justify-between items-center bg-white/5 p-8 rounded-[40px] border border-white/5 glass">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase">Nexus <span className="text-blue-500">Block Wars</span> HUD</h2>
          <p className="text-gray-400 text-sm font-bold uppercase tracking-widest mt-1">Live Campus Competition & Viral Oversight</p>
        </div>
        <div className="flex gap-4">
           <div className="glass px-10 py-4 rounded-3xl border border-white/10 flex flex-col items-center">
             <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-1">Total Campus Orders</span>
             <span className="text-3xl font-black text-white tracking-tighter">{stats.reduce((acc, curr) => acc + curr.count, 0)}</span>
           </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6">
        {loading ? (
            <div className="py-20 text-center font-black text-gray-500 animate-pulse tracking-widest uppercase">Scanning Campus Nodes for Activity...</div>
        ) : stats.map((block, i) => (
          <div key={block.name} className="glass-card p-10 group relative overflow-hidden">
             {/* Background glow for rank 1 */}
             {i === 0 && <div className="absolute inset-0 bg-blue-600/[0.03] animate-pulse-soft pointer-events-none" />}
             
             <div className="flex items-center justify-between relative z-10">
                <div className="flex items-center gap-8">
                   <div className={`w-12 h-12 rounded-[1.5rem] flex items-center justify-center text-xl font-black ${
                     i === 0 ? 'bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.4)]' : 
                     i === 1 ? 'bg-slate-700 text-slate-300' : 
                     i === 2 ? 'bg-amber-900/40 text-amber-600' : 'bg-white/5 text-gray-500'
                   }`}>
                     {i + 1}
                   </div>
                   <div>
                      <h4 className="text-xl font-black text-white uppercase tracking-tight">{block.name}</h4>
                      <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">SRM AP Hostel Block</p>
                   </div>
                </div>
                
                <div className="text-right">
                   <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1">Orders Delivered</span>
                   <span className="text-3xl font-black text-white">{block.count}</span>
                </div>
             </div>

             {/* Bar visualization */}
             <div className="mt-8 w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div 
                   className={`h-full transition-all duration-1000 ${i === 0 ? 'bg-blue-500 shadow-[0_0_15px_rgba(37,99,235,0.5)]' : 'bg-white/20'}`} 
                   style={{ width: `${(block.count / maxCount) * 100}%` }} 
                />
             </div>
          </div>
        ))}
      </div>

      <div className="glass-card p-10 border-blue-500/20 bg-blue-500/[0.02]">
         <div className="flex items-center gap-6">
            <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center text-xl">🏆</div>
            <div>
               <h4 className="text-sm font-black text-white uppercase tracking-wider">Incentivizing Block Loyalty</h4>
               <p className="text-xs text-gray-500 leading-relaxed max-w-2xl">Block Wars is the primary viral engine for Zenvy. Currently, **{stats[0]?.name || '...'}** is dominating the campus. Use the Nexus Config to announce block-specific multipliers or prize drops.</p>
            </div>
         </div>
      </div>
    </div>
  );
}

