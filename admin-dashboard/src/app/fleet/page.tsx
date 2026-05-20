"use client";
import { useState, useEffect, memo } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

interface Rider {
  _id: string;
  name: string;
  phone: string;
  isApproved: boolean;
  isOnline: boolean;
  isSosActive: boolean;
  vehicleType?: string;
  completedOrders?: number;
}

const RiderRow = memo(({ rider, onEdit, onToggleApproval, onResetSos }: { 
  rider: Rider, 
  onEdit: (r: Rider) => void,
  onToggleApproval: (id: string, status: boolean) => void,
  onResetSos: (id: string) => void 
}) => (
  <tr className="hover:bg-white/[0.02] transition-colors group">
    <td className="px-8 py-6">
      <span className="text-xs font-black text-blue-500/50 group-hover:text-blue-400 transition-colors">#{rider._id.slice(-6)}</span>
    </td>
    <td className="px-8 py-6 text-sm font-bold text-white uppercase tracking-tight">
      {rider.name}
      {rider.vehicleType && <span className="ml-2 text-[8px] px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded-md">{rider.vehicleType}</span>}
    </td>
    <td className="px-8 py-6">
      <p className="text-xs text-gray-400 font-mono tracking-tighter">{rider.phone}</p>
      <div className="mt-1 flex items-center gap-2">
         <span className="text-[8px] font-black text-emerald-400 uppercase tracking-widest">{rider.completedOrders || 0} Cycles Completed</span>
      </div>
    </td>
    <td className="px-8 py-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${rider.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-gray-700'}`} />
          <span className={`text-[10px] font-black uppercase tracking-widest ${rider.isOnline ? 'text-emerald-500' : 'text-gray-500'}`}>
            {rider.isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
        {rider.isSosActive && (
          <button 
            onClick={() => onResetSos(rider._id)}
            className="flex flex-col items-start gap-1 group/sos"
          >
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 px-3 py-1 rounded-lg animate-bounce group-hover/sos:bg-red-500/20 transition-all">
              <span className="text-[9px] font-black text-red-500 uppercase tracking-widest">🚨 EMERGENCY SOS</span>
            </div>
            <span className="text-[7px] text-gray-600 uppercase font-black tracking-widest ml-1 opacity-0 group-hover/sos:opacity-100 transition-opacity">Click to Resolve</span>
          </button>
        )}
      </div>
    </td>
    <td className="px-8 py-6">
        <div className="flex items-center gap-3">
          <button onClick={() => onToggleApproval(rider._id, rider.isApproved)} className={`px-6 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${rider.isApproved ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
            {rider.isApproved ? 'Deactivate' : 'Hire'}
          </button>
          <button onClick={() => onEdit(rider)} className="text-blue-500/50 hover:text-blue-400 text-[10px] font-black uppercase tracking-widest transition-colors ml-2">Edit</button>
        </div>
    </td>
  </tr>
));
RiderRow.displayName = 'RiderRow';

export default function FleetManagement() {
  const isAuthed = useAdminAuth();
  const [riders, setRiders] = useState<Rider[]>([]);
  const [totalRiders, setTotalRiders] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingRider, setEditingRider] = useState<Rider | null>(null);
  const [newRider, setNewRider] = useState({ name: '', phone: '', password: 'password123', vehicleType: 'Bike' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRiders(1);
  }, []);

  const fetchRiders = async (page = 1) => {
    try {
      setLoading(true);
      const token = 'cookie-managed';
      const res = await fetch(`${API_URL}/api/admin/riders?page=${page}`, {
        });
      const data = await res.json();
      if (res.ok) {
        setRiders(data.riders || []);
        setTotalRiders(data.total || 0);
        setTotalPages(data.pages || 1);
        setCurrentPage(page);
      }
    } catch (err) {
      console.error('[FLEET_FETCH_ERROR]', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleApproval = async (id: string, currentStatus: boolean) => {
    try {
      const token = 'cookie-managed';
      const res = await fetch(`${API_URL}/api/admin/riders/${id}/approve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify({ isApproved: !currentStatus })
      });
      if (res.ok) fetchRiders();
    } catch (err) { console.error('[FLEET_APPROVE_ERROR]', err); }
  };

  const handleResetSos = async (id: string) => {
    if (!confirm('Mark emergency as resolved and reset SOS?')) return;
    try {
      const token = 'cookie-managed';
      await fetch(`${API_URL}/api/admin/riders/${id}/reset-sos`, {
        method: 'POST',
        });
      fetchRiders();
    } catch (err) { console.error('[SOS_RESET_ERROR]', err); }
  };

  const handleCreateRider = async () => {
    setError(null);
    if (!newRider.name.trim() || !newRider.phone.trim()) {
      setError("Name and Phone are mandatory");
      return;
    }
    if (newRider.phone.length !== 10) {
      setError("Phone must be exactly 10 digits");
      return;
    }

    try {
      const token = 'cookie-managed';
      const endpoint = editingRider ? `${API_URL}/api/admin/riders/${editingRider._id}` : `${API_URL}/api/delivery/register`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify(newRider)
      });
      if (res.ok) {
        setIsAdding(false);
        setEditingRider(null);
        fetchRiders();
      } else {
        const d = await res.json();
        setError(d.message || "Failed to save personnel");
      }
    } catch (err) { console.error('[CREATE_RIDER_ERROR]', err); setError("Nexus Connection Error"); }
  };

  if (!isAuthed) return <div className="p-20 text-center font-black text-white uppercase tracking-widest animate-pulse">Authenticating...</div>;

  return (
    <div className="space-y-10 animate-fade-in relative pb-20">
      <header className="flex justify-between items-center bg-white/5 p-8 rounded-[40px] border border-white/5 glass">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase">Nexus Fleet <span className="text-blue-500">Recruitment</span></h2>
          <p className="text-gray-400 text-sm font-bold uppercase tracking-widest mt-1">Personnel Onboarding & Approval Terminal</p>
        </div>
        <div className="flex gap-4">
           <button onClick={() => setIsAdding(true)} className="px-8 py-3 bg-blue-600 text-white text-[12px] font-black uppercase tracking-widest rounded-2xl hover:scale-105 transition-all shadow-[0_0_20px_rgba(37,99,235,0.3)]">
              Recruit New Node
           </button>
        </div>
      </header>

      {(isAdding || editingRider) && (
        <div className="glass-card p-10 border-blue-500/30 animate-slide-up">
           <h3 className="text-xl font-black text-white uppercase tracking-tight mb-8">{editingRider ? 'Modify Personnel Node' : 'Onboard New Personnel'}</h3>
           {error && <div className="mb-6 text-red-500 text-[10px] font-black uppercase tracking-widest text-center animate-shake">{error}</div>}
           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <input placeholder="Personnel Name" className="admin-input" value={newRider.name} onChange={(e) => setNewRider({...newRider, name: e.target.value})} />
              <input placeholder="Phone Number" className="admin-input" value={newRider.phone} onChange={(e) => setNewRider({...newRider, phone: e.target.value})} />
              <select className="admin-input" value={newRider.vehicleType} onChange={(e) => setNewRider({...newRider, vehicleType: e.target.value})}>
                 <option value="Bike">Bike (Standard)</option>
                 <option value="Electric">Electric (Eco)</option>
                 <option value="Cycle">Bicycle (Hostel Internal)</option>
                 <option value="Car">Car (Group Delivery)</option>
              </select>
              <input placeholder="Password" type="password" className="admin-input" value={newRider.password} onChange={(e) => setNewRider({...newRider, password: e.target.value})} />
           </div>
           <div className="flex gap-4 mt-10">
              <button 
                onClick={handleCreateRider}
                className="flex-1 py-5 bg-blue-600 text-white font-black uppercase tracking-[0.3em] rounded-3xl text-xs"
              >
                {editingRider ? 'Commit Modifications' : 'Confirm Onboarding'}
              </button>
              <button 
                onClick={() => { setIsAdding(false); setEditingRider(null); setError(null); }}
                className="px-10 py-5 bg-white/5 text-gray-500 font-black uppercase tracking-widest rounded-3xl text-xs hover:bg-white/10"
              >
                Cancel
              </button>
           </div>
        </div>
      )}

      <div className="glass-card overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-white/[0.03] border-b border-white/5">
              <th className="px-8 py-6 text-[12px] font-black text-gray-500 uppercase tracking-[0.2em]">Personnel ID</th>
              <th className="px-8 py-6 text-[12px] font-black text-gray-500 uppercase tracking-[0.2em]">Full Name</th>
              <th className="px-8 py-6 text-[12px] font-black text-gray-500 uppercase tracking-[0.2em]">Contact Node</th>
              <th className="px-8 py-6 text-[12px] font-black text-gray-500 uppercase tracking-[0.2em]">Status</th>
              <th className="px-8 py-6 text-[12px] font-black text-gray-500 uppercase tracking-[0.2em]">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.02] text-white">
            {loading ? (
              <tr><td colSpan={5} className="px-8 py-20 text-center text-gray-600 animate-pulse font-black uppercase tracking-widest">Scanning Grid for Personnel...</td></tr>
            ) : riders.map((rider) => (
              <RiderRow 
                key={rider._id} 
                rider={rider} 
                onEdit={(r) => { setEditingRider(r); setNewRider({ name: r.name, phone: r.phone, password: '', vehicleType: r.vehicleType || 'Bike' }); }}
                onToggleApproval={handleToggleApproval} 
                onResetSos={handleResetSos} 
              />
            ))}
          </tbody>
        </table>

        {/* Pagination Interface */}
        {totalPages > 1 && (
          <div className="p-6 bg-white/[0.02] border-t border-white/5 flex items-center justify-between">
            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
              Personnel Page {currentPage} / {totalPages} ({totalRiders} total)
            </span>
            <div className="flex gap-2">
               <button 
                 disabled={currentPage === 1}
                 onClick={() => fetchRiders(currentPage - 1)}
                 className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase text-gray-400 hover:text-white disabled:opacity-30"
               >
                 Prev
               </button>
               <button 
                 disabled={currentPage === totalPages}
                 onClick={() => fetchRiders(currentPage + 1)}
                 className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase text-gray-400 hover:text-white disabled:opacity-30"
               >
                 Next
               </button>
            </div>
          </div>
        )}
      </div>
      <style jsx>{`
        .admin-input { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 1.25rem; border-radius: 1.5rem; color: white; font-weight: 900; outline: none; }
        .admin-input:focus { border-color: rgba(37, 99, 235, 0.5); }
      `}</style>
    </div>
  );
}

