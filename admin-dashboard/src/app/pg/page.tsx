"use client";
import { useState, useEffect } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

interface PGHostel {
  id: string;
  name: string;
  address: string;
  distanceFromCollege: number;
  genderType: string;
  baseRent: number;
  isActive: boolean;
  amenities: string[];
}

export default function PGMonitorPage() {
  const isAuthed = useAdminAuth();
  const [pgs, setPgs] = useState<PGHostel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthed) return;
    fetchPGs();
  }, [isAuthed]);

  const fetchPGs = async () => {
    try {
      const res = await fetch(`${API_URL}/api/pg`);
      if (res.ok) setPgs(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const togglePGStatus = async (id: string, currentStatus: boolean) => {
    // Basic admin toggle status or details placeholder
    alert("Toggle action requested for PG " + id);
  };

  if (!isAuthed) {
    return <div className="p-20 text-center font-black text-white uppercase tracking-widest animate-pulse">Authenticating Command Terminal...</div>;
  }

  return (
    <div className="space-y-12 animate-fade-in relative pb-20 text-slate-200">
      <header className="flex justify-between items-center mb-8">
        <div className="flex flex-col">
          <h1 className="text-3xl font-black text-white italic tracking-tighter">PG & HOSTEL <span className="text-blue-500">MONITOR</span></h1>
          <p className="text-[10px] font-black text-gray-500 uppercase tracking-[0.4em] mt-1">Super Admin Housing Control</p>
        </div>
      </header>

      {loading ? (
        <div className="text-center py-20 text-gray-500 font-mono text-xs uppercase tracking-widest animate-pulse">Syncing housing records...</div>
      ) : pgs.length === 0 ? (
        <div className="text-center py-20 text-gray-600 text-xs italic tracking-wide">No PG listings detected on the grid.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {pgs.map(pg => (
            <div key={pg.id} className="glass-card p-6 border-white/5 bg-slate-900/40 rounded-3xl flex flex-col justify-between group">
              <div>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-white group-hover:text-blue-400 transition-colors">{pg.name}</h3>
                    <p className="text-xs text-gray-500 font-mono mt-0.5">{pg.address}</p>
                  </div>
                  <span className={`text-[9px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider ${
                    pg.isActive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                  }`}>
                    {pg.isActive ? 'Active' : 'Suspended'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4 py-4 border-y border-white/5 mb-4 text-center">
                  <div>
                    <p className="text-[9px] text-gray-500 font-black uppercase tracking-wider">Distance</p>
                    <p className="text-sm font-bold text-white mt-1">{pg.distanceFromCollege} KM</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-500 font-black uppercase tracking-wider">Gender Policy</p>
                    <p className="text-sm font-bold text-indigo-400 mt-1">{pg.genderType}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-500 font-black uppercase tracking-wider">Base Rent</p>
                    <p className="text-sm font-bold text-emerald-400 mt-1">₹{pg.baseRent}/mo</p>
                  </div>
                </div>

                {pg.amenities && pg.amenities.length > 0 && (
                  <div className="mb-4">
                    <p className="text-[9px] text-gray-500 font-black uppercase tracking-wider mb-2">Amenities</p>
                    <div className="flex flex-wrap gap-1.5">
                      {pg.amenities.map((amenity, i) => (
                        <span key={i} className="text-[9px] font-bold bg-white/5 border border-white/5 px-2 py-0.5 rounded text-gray-400">
                          {amenity}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3 mt-4 pt-4 border-t border-white/5">
                <button 
                  onClick={() => togglePGStatus(pg.id, pg.isActive)}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all border border-white/5"
                >
                  Manage Listing
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
