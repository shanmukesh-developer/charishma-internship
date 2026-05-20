"use client";
import { useState, useEffect } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

interface Config {
  _id: string;
  key: string;
  value: string | number | boolean | string[];
  description: string;
}

export default function ConfigTerminal() {
  const isAuthed = useAdminAuth();
  const [configs, setConfigs] = useState<Config[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchConfigs();
  }, []);

  const fetchConfigs = async () => {
    try {
      const token = 'cookie-managed';
      const res = await fetch(`${API_URL}/api/admin/config`, {
        });
      const data = await res.json();
      if (res.ok) setConfigs(data);
    } catch {
      console.error('[CONFIG_FETCH_ERROR]');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateConfig = async (key: string, value: string | number | boolean | string[]) => {
    try {
      const token = 'cookie-managed';
      const res = await fetch(`${API_URL}/api/admin/config`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          },
        body: JSON.stringify({ key, value })
      });
      if (res.ok) fetchConfigs();
    } catch {
      console.error('[CONFIG_UPDATE_ERROR]');
    }
  };

  const rawShifts = configs.find(c => c.key === 'delivery_shifts')?.value;
  const shifts = Array.isArray(rawShifts) ? rawShifts : ['13:00', '19:30'];

  if (!isAuthed || loading) return <div className="p-20 text-center font-black text-white uppercase tracking-widest animate-pulse">Synchronizing Config...</div>;

  return (
    <div className="space-y-10 animate-fade-in relative pb-20">
      <header className="bg-white/5 p-8 rounded-[40px] border border-white/5 glass">
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase">Nexus <span className="text-blue-500">Config</span> Overrides</h2>
          <p className="text-gray-400 text-sm font-bold uppercase tracking-widest mt-1">Global System Parameters & Operational Windows</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Delivery Shifts Configuration */}
        <div className="glass-card p-10 space-y-8">
           <div className="flex items-center gap-4 mb-2">
              <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center text-xl">🕒</div>
              <div>
                 <h4 className="text-lg font-black text-white uppercase tracking-tight">Delivery Shift Timings</h4>
                 <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Sets the active delivery slots for campus</p>
              </div>
           </div>

           <div className="space-y-4">
              {shifts.map((time: string, i: number) => (
                <div key={i} className="flex gap-4">
                   <input 
                     type="time" 
                     className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-4 text-white font-black"
                     defaultValue={time}
                     onBlur={(e) => {
                        const newShifts = [...shifts];
                        newShifts[i] = e.target.value;
                        handleUpdateConfig('delivery_shifts', newShifts);
                     }}
                   />
                </div>
              ))}
              <button 
                onClick={() => handleUpdateConfig('delivery_shifts', [...shifts, '12:00'])}
                className="w-full py-4 border border-dashed border-white/10 rounded-2xl text-[10px] font-black uppercase text-gray-600 hover:bg-white/5"
              >
                Assemble New Shift Slot
              </button>
           </div>
        </div>

        {/* Elite Program Configuration */}
        <div className="glass-card p-10 space-y-8">
           <div className="flex items-center gap-4 mb-2">
              <div className="w-10 h-10 bg-[#C9A84C]/20 rounded-xl flex items-center justify-center text-xl">💎</div>
              <div>
                 <h4 className="text-lg font-black text-white uppercase tracking-tight">Elite Thresholds</h4>
                 <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Criteria for automated elite status</p>
              </div>
           </div>

           <div className="space-y-6">
              <div className="pt-4 border-t border-white/5">
                 <div className="flex items-center justify-between mb-6">
                    <div>
                       <h5 className="text-[11px] font-black text-white uppercase tracking-wider">Pulse Social Ripples</h5>
                       <p className="text-[9px] text-gray-500">Enable/Disable campus-wide order triggers</p>
                    </div>
                    <button 
                      onClick={() => handleUpdateConfig('pulse_enabled', !(configs.find(c => c.key === 'pulse_enabled')?.value ?? true))}
                      className={`w-14 h-8 rounded-full relative transition-colors ${configs.find(c => c.key === 'pulse_enabled')?.value !== false ? 'bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.4)]' : 'bg-white/10'}`}
                    >
                       <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${configs.find(c => c.key === 'pulse_enabled')?.value !== false ? 'left-7' : 'left-1'}`} />
                    </button>
                 </div>

                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                       <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest ml-1">Global Delivery Fee (₹)</label>
                       <input 
                         type="number" 
                         className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white font-black text-xs"
                         defaultValue={(configs.find(c => c.key === 'delivery_fee')?.value as number) ?? 30}
                         onBlur={(e) => handleUpdateConfig('delivery_fee', Number(e.target.value))}
                       />
                    </div>
                    <div className="space-y-2">
                       <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest ml-1">Surge Multiplier (x)</label>
                       <input 
                         type="number" 
                         step="0.1"
                         className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white font-black text-xs"
                         defaultValue={(configs.find(c => c.key === 'surge_multiplier')?.value as number) ?? 1.0}
                         onBlur={(e) => handleUpdateConfig('surge_multiplier', Number(e.target.value))}
                       />
                    </div>
                 </div>
              </div>
           </div>
        </div>

        {/* 🛠️ System Resilience & Global Toggles */}
        <div className="glass-card p-10 space-y-8 border-amber-500/20 bg-amber-500/[0.02]">
           <div className="flex items-center gap-4 mb-2">
              <div className="w-10 h-10 bg-amber-600/20 rounded-xl flex items-center justify-center text-xl">🛠️</div>
              <div>
                 <h4 className="text-lg font-black text-white uppercase tracking-tight">System Resilience</h4>
                 <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Master overrides for emergency protocols</p>
              </div>
           </div>

           <div className="space-y-6">
              <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                 <div>
                    <h5 className="text-xs font-black text-white uppercase tracking-wider">Maintenance Mode</h5>
                    <p className="text-[9px] text-gray-500 font-bold uppercase tracking-widest mt-1">Freezes all orders across student apps</p>
                 </div>
                 <button 
                   onClick={() => handleUpdateConfig('maintenance_mode', !(configs.find(c => c.key === 'maintenance_mode')?.value === true))}
                   className={`w-14 h-8 rounded-full relative transition-colors ${configs.find(c => c.key === 'maintenance_mode')?.value === true ? 'bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.4)]' : 'bg-white/10'}`}
                 >
                    <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${configs.find(c => c.key === 'maintenance_mode')?.value === true ? 'left-7' : 'left-1'}`} />
                 </button>
              </div>

              <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                 <div>
                    <h5 className="text-xs font-black text-white uppercase tracking-wider">Campus Operational Status</h5>
                    <p className="text-[9px] text-gray-500 font-bold uppercase tracking-widest mt-1">Master switch for campus delivery</p>
                 </div>
                 <button 
                   onClick={() => handleUpdateConfig('campus_open', !(configs.find(c => c.key === 'campus_open')?.value !== false))}
                   className={`w-14 h-8 rounded-full relative transition-colors ${configs.find(c => c.key === 'campus_open')?.value !== false ? 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)]'}`}
                 >
                    <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all ${configs.find(c => c.key === 'campus_open')?.value !== false ? 'left-7' : 'left-1'}`} />
                 </button>
              </div>

              <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-4">
                 <div className="flex justify-between items-center">
                    <h5 className="text-xs font-black text-white uppercase tracking-wider">Minimum Order Value</h5>
                    <span className="text-[10px] font-black text-[#C9A84C]">₹{configs.find(c => c.key === 'min_order_value')?.value || 0}</span>
                 </div>
                 <input 
                   type="range" 
                   min="0" 
                   max="500" 
                   step="10"
                   className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#C9A84C]"
                   defaultValue={Number(configs.find(c => c.key === 'min_order_value')?.value || 0)}
                   onMouseUp={(e) => handleUpdateConfig('min_order_value', Number((e.target as HTMLInputElement).value))}
                 />
                 <p className="text-[8px] text-gray-600 font-bold uppercase tracking-widest text-center">Prevents sub-threshold low-margin orders</p>
              </div>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Nexus Seeding Engine */}
        <div className="glass-card p-10 space-y-8 border-emerald-500/20 bg-emerald-500/[0.02]">
           <div className="flex items-center gap-4 mb-2">
              <div className="w-10 h-10 bg-emerald-600/20 rounded-xl flex items-center justify-center text-xl">🚀</div>
              <div>
                 <h4 className="text-lg font-black text-white uppercase tracking-tight">Nexus Seeding Engine</h4>
                 <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Migrate legacy assets to database</p>
              </div>
           </div>
           
           <p className="text-[11px] text-gray-400 leading-relaxed uppercase tracking-widest font-bold">
             Sync all current restaurants and menu items into the database to enable absolute administrative control. Warning: This will overwrite existing database records.
           </p>

           <button 
             onClick={async () => {
                if(!confirm('Migrate all legacy campus data to Database? This cannot be undone.')) return;
                try {
                  const token = 'cookie-managed';
                  const res = await fetch(`${API_URL}/api/admin/seed`, {
                    method: 'POST',
                    headers: {  'Content-Type': 'application/json' },
                    body: JSON.stringify({ restaurants: [] }) 
                  });
                  if(res.ok) alert('Nexus Synchronized Successfully!');
                } catch(_err) { console.error(_err); }
             }}
             className="w-full py-6 bg-emerald-600/20 text-emerald-500 border border-emerald-600/30 rounded-3xl text-[10px] font-black uppercase tracking-[0.3em] hover:bg-emerald-600 hover:text-white transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)]"
           >
             Initialize System Assets
           </button>
        </div>

        <div className="glass-card p-10 border-blue-500/20 bg-blue-500/[0.02]">
           <div className="flex items-center gap-6">
              <div className="w-4 h-4 rounded-full bg-blue-500 animate-pulse shadow-[0_0_15px_rgba(37,99,235,0.8)]" />
              <div>
                 <h4 className="text-sm font-black text-white uppercase tracking-wider">Absolute Sync Active</h4>
                 <p className="text-xs text-gray-500 leading-relaxed">Every modification in this terminal broadcasts an Omni-Sync byte to all student and rider nodes. System state is final upon commitment.</p>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}

