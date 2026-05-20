"use client";
import { useState, useEffect } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';

interface Metric {
  label: string;
  value: string;
  subtext: string;
  percent: number;
}

interface RewardStats {
  totalSpinsEarned: number;
  totalSpinsUsed: number;
  activeRewardUsers: number;
  badgeDistribution: Record<string, number>;
  tierDistribution: Record<string, number>;
  topPerformers: { name: string; completedOrders: number; badgesCount: number; tier: string }[];
  redemptionRate: string;
}

export default function AnalyticsIntel() {
  const isAuthed = useAdminAuth();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [rewards, setRewards] = useState<RewardStats | null>(null);
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

   const [volume, setVolume] = useState<{ hour: string; count: number }[]>([]);
   const [health, setHealth] = useState<any>(null);

  useEffect(() => {
      const fetchVolume = async () => {
        try {
          const token = 'cookie-managed';
          const res = await fetch(`${API_URL}/api/admin/stats/volume`, {
            });
          const data = await res.json();
          setVolume(data);
        } catch (err) { console.error('Volume fetch failed', err); }
      };

      const fetchHealth = async () => {
        try {
          const token = 'cookie-managed';
          const res = await fetch(`${API_URL}/api/admin/health`, {
            });
          const data = await res.json();
          setHealth(data);
        } catch (err) { console.error('Health fetch failed', err); }
      };

     const fetchStats = async () => {
       try {
         const token = 'cookie-managed';
         const res = await fetch(`${API_URL}/api/admin/stats`, {
           });
         const data = await res.json();
         
         setMetrics([
           { label: 'Market Revenue', value: data.revenue, subtext: 'Total Validated Revenue', percent: 100 },
           { label: 'Order Velocity', value: data.orderActivity, subtext: 'Total Orders Processed', percent: Math.min(100, parseInt(data.orderActivity) * 2) },
           { label: 'Fleet Saturation', value: data.activeFleet, subtext: 'Verified Delivery Partners', percent: Math.min(100, parseInt(data.activeFleet) * 10) },
           { label: 'Tactical Backlog', value: data.activeOrders, subtext: 'Ongoing Logistics Tasks', percent: Math.min(100, parseInt(data.activeOrders) * 5) },
         ]);
         fetchVolume();
         fetchHealth();
         setLoading(false);
       } catch (error) {
         console.error('Failed to fetch stats:', error);
         setLoading(false);
       }
     };

      const fetchRewards = async () => {
        try {
          const token = 'cookie-managed';
          const res = await fetch(`${API_URL}/api/admin/rewards-analytics`, {
            });
          const data = await res.json();
          setRewards(data);
        } catch (error) {
          console.error('Failed to fetch rewards:', error);
        }
      };

      fetchStats();
      fetchRewards();
      const interval = setInterval(() => {
        fetchStats();
        fetchRewards();
      }, 10000); // Polling every 10s
      return () => clearInterval(interval);
   }, [API_URL]);

  if (!isAuthed) return <div className="p-20 text-center font-black text-white uppercase tracking-widest animate-pulse">Authenticating...</div>;

  return (
    <div className="space-y-12 animate-fade-in relative pb-20">
      <header className="flex justify-between items-center bg-white/5 p-8 rounded-[40px] border border-white/5 glass">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase">Nexus <span className="text-blue-500">Performance Intel</span></h2>
          <p className="text-gray-400 text-sm font-bold uppercase tracking-widest mt-1">Deep Metrics & Node Bandwidth Tracking</p>
        </div>
        <div className="flex gap-4">
           <div className="glass px-10 py-4 rounded-3xl border border-white/10 flex flex-col items-center">
              <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-1">Audit Node</span>
              <span className="text-xl font-black text-white tracking-tighter">SRM_ALPHA_01</span>
           </div>
        </div>
      </header>

      {loading ? (
        <div className="py-20 text-center font-black text-gray-500 animate-pulse tracking-widest uppercase">Aggregating Global Node Telemetry...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {metrics.map((metric, i) => (
              <div key={i} className="glass-card p-8 group overflow-hidden relative">
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/[0.03] blur-[40px] group-hover:bg-blue-600/[0.08] transition-all" />
                <p className="stat-label tracking-[0.2em]">{metric.label}</p>
                <div className="space-y-4 mt-2">
                   <h4 className="text-3xl font-black text-white">{metric.value}</h4>
                   <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 shadow-[0_0_10px_rgba(37,99,235,0.4)] transition-all duration-1000" style={{ width: `${metric.percent}%` }} />
                   </div>
                   <span className="text-[9px] font-black text-gray-500 uppercase tracking-wider">{metric.subtext}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
             <div className="glass-card p-10 space-y-6">
                <h3 className="text-xl font-black tracking-tighter uppercase text-white">Node response <span className="text-blue-500">Frequency</span></h3>
                <p className="text-xs text-gray-500 leading-relaxed max-w-lg">Continuous telemetry ping analysis from local SRM-Alpha hubs to visual interface pipeline routing.</p>
                 <div className="h-48 flex items-end gap-2 pt-10">
                    {(volume.length > 0 ? volume : [{count:0},{count:0},{count:0},{count:0},{count:0},{count:0}]).map((v, i) => {
                       const max = Math.max(...volume.map(x => x.count), 1);
                       const h = (v.count / max) * 100;
                       return (
                        <div key={i} className="flex-1 bg-white/5 rounded-t-lg relative group overflow-hidden" style={{ height: `${Math.max(5, h)}%` }}>
                           <div className="absolute inset-x-0 bottom-0 bg-blue-500/30 group-hover:bg-blue-500/60 transition-all duration-500" style={{ height: '100%' }} />
                           <div className="absolute inset-0 bg-blue-500 shadow-[0_0_15px_rgba(37,99,235,0.4)] opacity-0 group-hover:opacity-100 transition-opacity" />
                           <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[8px] font-black text-white opacity-0 group-hover:opacity-100 transition-opacity z-20">
                             {v.count}
                           </div>
                        </div>
                       );
                    })}
                 </div>
                  <div className="flex justify-between text-[8px] font-black text-gray-600 uppercase tracking-widest px-2">
                     {volume.slice(0, 6).map((v, i) => <span key={i}>{v.hour}</span>)}
                  </div>
             </div>

             <div className="glass-card p-10 space-y-6 flex flex-col justify-center">
                <h3 className="text-xl font-black tracking-tighter uppercase text-white">Interlink <span className="text-emerald-500">Integrity</span></h3>
                 <div className="space-y-4">
                    {[
                      { name: 'SRM_ALPHA_01', type: 'Database Node', status: health?.database === 'POSTGRES' ? 'Operational' : 'Volatile', latency: health?.persistence === 'PERSISTENT' ? 'Ultra-Stable' : 'Unstable' },
                      { name: 'API_NODE_01', type: 'Core Server', status: health ? 'Connected' : 'Syncing...', latency: 'Live' },
                      { name: 'RIDER_HUB_01', type: 'Fleet Broadband', status: 'Operational', latency: '4ms' },
                    ].map((node, i) => (
                       <div key={i} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                          <div>
                             <p className="text-sm font-bold text-white tracking-wide">{node.name}</p>
                             <p className="text-[9px] text-gray-500 font-bold uppercase tracking-widest">{node.type}</p>
                          </div>
                          <div className="text-right">
                             <span className={`text-[9px] font-black px-2 py-0.5 rounded-md border ${
                                node.status === 'Operational' || node.status === 'Connected' ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' : 'text-amber-500 bg-amber-500/10 border-amber-500/20'
                             }`}>{node.status}</span>
                             <p className="text-[9px] text-gray-600 font-bold mt-1">{node.latency}</p>
                          </div>
                       </div>
                    ))}
                 </div>
             </div>
          </div>

          {rewards && (
             <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                <div className="glass-card p-10 space-y-6 md:col-span-2">
                   <h3 className="text-xl font-black tracking-tighter uppercase text-white">Gamification <span className="text-blue-500">Bandwidth</span></h3>
                   <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="bg-white/5 p-6 rounded-3xl border border-white/5">
                         <p className="text-[8px] font-black text-blue-400 uppercase tracking-widest mb-2">Total Spins</p>
                         <p className="text-2xl font-black text-white">{rewards.totalSpinsEarned}</p>
                      </div>
                      <div className="bg-white/5 p-6 rounded-3xl border border-white/5">
                         <p className="text-[8px] font-black text-emerald-400 uppercase tracking-widest mb-2">Spins Used</p>
                         <p className="text-2xl font-black text-white">{rewards.totalSpinsUsed}</p>
                      </div>
                      <div className="bg-white/5 p-6 rounded-3xl border border-white/5">
                         <p className="text-[8px] font-black text-purple-400 uppercase tracking-widest mb-2">Active Users</p>
                         <p className="text-2xl font-black text-white">{rewards.activeRewardUsers}</p>
                      </div>
                      <div className="bg-white/5 p-6 rounded-3xl border border-white/5">
                         <p className="text-[8px] font-black text-amber-400 uppercase tracking-widest mb-2">ROI Rate</p>
                         <p className="text-2xl font-black text-white">{rewards.redemptionRate}%</p>
                      </div>
                   </div>
                   
                   <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-4">
                       <div className="space-y-4">
                          <p className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Tier Membership Distribution</p>
                          <div className="space-y-3">
                             {Object.entries(rewards.tierDistribution || {}).map(([tier, count]) => {
                                const colors: Record<string, string> = { 
                                  Platinum: 'text-purple-400 border-purple-400/20 bg-purple-400/5', 
                                  Gold: 'text-amber-400 border-amber-400/20 bg-amber-400/5', 
                                  Silver: 'text-gray-300 border-gray-400/20 bg-gray-400/5',
                                  None: 'text-gray-600 border-gray-600/10 bg-white/5'
                                };
                                return (
                                   <div key={tier} className={`px-6 py-4 rounded-2xl border flex justify-between items-center ${colors[tier] || colors.None}`}>
                                      <span className="text-xs font-black uppercase tracking-widest">{tier} Hierarchy</span>
                                      <span className="text-lg font-black">{count}</span>
                                   </div>
                                );
                             })}
                          </div>
                       </div>
                       
                       <div className="space-y-4">
                          <p className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Badge Distribution Neural Map</p>
                          <div className="flex flex-wrap gap-2">
                             {Object.entries(rewards.badgeDistribution).map(([badge, count]) => (
                                <div key={badge} className="px-4 py-2 bg-white/5 rounded-full border border-white/10 flex items-center gap-2">
                                   <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                   <span className="text-[10px] font-bold text-white whitespace-nowrap">{badge}</span>
                                   <span className="text-[10px] font-black text-blue-500">{count}</span>
                                </div>
                             ))}
                          </div>
                       </div>
                    </div>
                </div>

                <div className="glass-card p-10 space-y-6">
                   <h3 className="text-xl font-black tracking-tighter uppercase text-white">Nexus <span className="text-blue-500">Legends</span></h3>
                   <div className="space-y-4">
                      {rewards.topPerformers.map((user, i) => {
                          const tierColor = user.tier === 'Platinum' ? 'border-l-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.1)]' : 
                                            user.tier === 'Gold' ? 'border-l-amber-500' : 
                                            user.tier === 'Silver' ? 'border-l-gray-400' : 'border-l-blue-500';
                          return (
                             <div key={i} className={`flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 border-l-4 ${tierColor}`}>
                                <div>
                                   <p className="text-sm font-bold text-white">{user.name}</p>
                                   <p className="text-[9px] text-gray-500 font-bold uppercase tracking-widest">{user.completedOrders} Orders • {user.tier}</p>
                                </div>
                                <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                   <span className="text-[10px] font-black text-blue-500">{user.badgesCount}</span>
                                </div>
                             </div>
                          );
                       })}
                   </div>
                </div>
             </div>
           )}
        </>
      )}
    </div>
  );
}

