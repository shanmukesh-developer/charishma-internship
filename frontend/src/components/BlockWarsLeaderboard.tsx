"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { API_URL } from '@/utils/api';

interface BlockActivity {
  name: string;
  count: number;
}

export default function BlockWarsLeaderboard({ userBlock }: { userBlock: string | null }) {
  const [blocks, setBlocks] = useState<BlockActivity[]>([]);
  const [loading, setLoading] = useState(true);


  useEffect(() => {
    const MOCK_BLOCKS: BlockActivity[] = [
      { name: 'Vedavathi', count: 142 },
      { name: 'Krishna', count: 118 },
      { name: 'Ganga-A', count: 97 },
      { name: 'Yamuna', count: 74 },
    ];
    
    const fetchActivity = async () => {
      try {
        const token = 'cookie-managed';
        // Comfort Guard: Don't fetch if no token (prevents 401s if backend was protected)
        // Now that backend is public, we can fetch, but we might still want to skip for clean logs
        const res = await fetch(`${API_URL}/api/blocks/activity`, {
          headers: token ? { } : {}
        });
        
        if (res.status === 401) {
           setBlocks(MOCK_BLOCKS);
           return;
        }

        const data = await res.json();
        // Guard: only set if we received a real array
        if (Array.isArray(data) && data.length > 0) {
          setBlocks(data);
        } else {
          setBlocks(MOCK_BLOCKS);
        }
      } catch {
        console.error('Failed to fetch block activity');
        setBlocks(MOCK_BLOCKS);
      } finally {
        setLoading(false);
      }
    };

    fetchActivity();
    const interval = setInterval(fetchActivity, 30000);
    return () => clearInterval(interval);
  }, []); // MOCK_BLOCKS is now locally defined

  if (loading) return <div className="h-40 w-full glass-card animate-pulse" />;

  return (
    <div className="glass-card p-6 border-white/[0.05] relative overflow-hidden">
      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
         <span className="text-4xl font-black italic">WARS</span>
      </div>
      
      <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-[12px] font-black uppercase tracking-[0.3em] text-primary-gold mb-1">Block Leaderboard</h3>
            <p className="text-[9px] font-bold text-white/50 uppercase tracking-widest">Real-time Activity</p>
          </div>
         <div className="flex -space-x-2">
            {[1,2,3].map(i => (
              <div key={i} className="w-5 h-5 rounded-full border border-black bg-white/10 flex items-center justify-center text-[6px] font-black">
                {String.fromCharCode(64 + i)}
              </div>
            ))}
         </div>
      </div>

      <div className="space-y-4">
        {blocks.slice(0, 4).map((block, idx) => {
          const isUserBlock = block.name.toLowerCase() === userBlock?.toLowerCase();
          const percentage = (block.count / blocks[0].count) * 100;

          return (
            <div key={block.name} className={`relative flex items-center justify-between group`}>
               <div className="flex items-center gap-3 relative z-10">
                  <span className={`text-[9px] font-black ${idx === 0 ? 'text-primary-gold' : 'text-secondary-text'}`}>#0{idx + 1}</span>
                  <div>
                    <h4 className={`text-[11px] font-black uppercase tracking-wider ${isUserBlock ? 'text-primary-gold' : 'text-white'}`}>
                      {block.name} {isUserBlock && <span className="text-[7px] italic text-primary-gold opacity-60 ml-1">(My Block)</span>}
                    </h4>
                    <div className="w-32 h-1 bg-white/5 rounded-full mt-1.5 overflow-hidden">
                       <div 
                         className={`h-full transition-all duration-1000 ${idx === 0 ? 'bg-primary-gold' : 'bg-white/20'}`} 
                         style={{ width: `${percentage}%` }}
                       />
                    </div>
                  </div>
               </div>
               <div className="text-right relative z-10">
                  <span className="text-[11px] font-black text-white">{block.count}</span>
                  <p className="text-[6px] font-bold text-secondary-text uppercase">Orders</p>
               </div>
               {isUserBlock && <div className="absolute inset-x-[-12px] inset-y-[-8px] bg-primary-gold/[0.03] border-l-2 border-primary-gold rounded-lg -z-10" />}
            </div>
          );
        })}
      </div>

      <Link href="/rewards" className="block text-center w-full mt-6 py-3 border border-white/[0.05] rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] text-secondary-text hover:bg-white/5 transition-colors">
        View Full Rankings →
      </Link>
    </div>
  );
}

