"use client";
import { useState, useEffect, memo } from 'react';
import Image from 'next/image';
import { useAdminAuth } from '@/utils/useAdminAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

interface VaultItem {
  _id: string;
  name: string;
  price: number;
  originalPrice: number;
  remainingCount: number;
  imageUrl: string;
  isActive: boolean;
}

export default function VaultTerminal() {
  const isAuthed = useAdminAuth();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [newItem, setNewItem] = useState({ 
    name: '', 
    price: 0, 
    originalPrice: 0, 
    remainingCount: 1, 
    imageUrl: '' 
  });

  useEffect(() => {
    fetchVault();
  }, []);

  const fetchVault = async () => {
    try {
      const token = 'cookie-managed';
      const res = await fetch(`${API_URL}/api/admin/vault`, {
        });
      const data = await res.json();
      if (res.ok) setItems(data);
    } catch (_err) {
      console.error('[VAULT_FETCH_ERROR]', _err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpsert = async (item: Partial<VaultItem>) => {
    try {
      const token = 'cookie-managed';
      const id = item._id || 'new';
      const res = await fetch(`${API_URL}/api/admin/vault/${id}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          },
        body: JSON.stringify(item)
      });
      if (res.ok) fetchVault();
    } catch (_err) {
      console.error('[VAULT_UPSERT_ERROR]', _err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const token = 'cookie-managed';
      const res = await fetch(`${API_URL}/api/admin/vault/${id}`, {
        method: 'DELETE',
        });
      if (res.ok) fetchVault();
    } catch (_err) {
      console.error('[VAULT_DELETE_ERROR]', _err);
    }
  };

  if (!isAuthed) {
    return <div className="p-20 text-center font-black text-white uppercase tracking-widest animate-pulse">Authenticating...</div>;
  }

  return (
    <div className="space-y-10 animate-fade-in relative pb-20">
      <header className="flex justify-between items-center bg-white/5 p-8 rounded-[40px] border border-white/5 glass">
        <div>
          <h2 className="text-3xl font-black text-white tracking-tighter uppercase">Nexus <span className="text-[#C9A84C]">Vault</span> Terminal</h2>
          <p className="text-gray-400 text-sm font-bold uppercase tracking-widest mt-1">Daily Scarcity & FOMO Management</p>
        </div>
        <button 
          onClick={() => setIsAdding(!isAdding)}
          className="px-8 py-3 bg-[#C9A84C] text-black text-[10px] font-black uppercase tracking-widest rounded-2xl hover:scale-105 transition-all"
        >
          {isAdding ? 'Close Terminal' : 'Initialize Item'}
        </button>
      </header>

      {isAdding && (
        <div className="glass-card p-10 border-[#C9A84C]/30 animate-in fade-in slide-in-from-top-4 duration-500">
          <h3 className="text-xl font-black text-white uppercase tracking-tight mb-8 flex items-center gap-3">
             <span className="w-8 h-8 bg-[#C9A84C]/20 rounded-lg flex items-center justify-center text-sm">📦</span>
             Onboard New Scarcity Asset
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Asset Name</label>
              <input 
                placeholder="e.g. Premium Coffee Origin" 
                className="vault-input" 
                value={newItem.name} 
                onChange={(e) => setNewItem({...newItem, name: e.target.value})} 
              />
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Asset Asset/Image</label>
              <div className="flex gap-4">
                <input 
                  type="file" 
                  accept="image/*"
                  id="vault-image-upload"
                  className="hidden" 
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setImageFile(file);
                      setIsUploading(true);
                      const formData = new FormData();
                      formData.append('image', file);
                      try {
                        const res = await fetch(`${API_URL}/api/upload`, { method: 'POST', body: formData });
                        const data = await res.json();
                        if (data.imageUrl) setNewItem({...newItem, imageUrl: data.imageUrl});
                      } catch (_err) { console.error("Vault Upload Error", _err); }
                      finally { setIsUploading(false); }
                    }
                  }} 
                />
                <label 
                  htmlFor="vault-image-upload"
                  className="flex-1 bg-white/5 border border-white/10 rounded-2xl p-4 text-[10px] font-black uppercase tracking-widest text-center cursor-pointer hover:bg-white/10 transition-all flex items-center justify-center gap-3"
                >
                  {isUploading ? '📦 Syncing...' : imageFile ? `✅ ${imageFile.name.slice(0, 15)}...` : '📂 Upload from Local'}
                </label>
                <input 
                  placeholder="Or paste URL" 
                  className="vault-input flex-[2]" 
                  value={newItem.imageUrl} 
                  onChange={(e) => setNewItem({...newItem, imageUrl: e.target.value})} 
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-6 md:col-span-2">
               <div className="space-y-3">
                 <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Live Price (₹)</label>
                 <input 
                   type="number" 
                   className="vault-input" 
                   value={newItem.price} 
                   onChange={(e) => setNewItem({...newItem, price: Number(e.target.value)})} 
                 />
               </div>
               <div className="space-y-3">
                 <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">MSRP (₹)</label>
                 <input 
                   type="number" 
                   className="vault-input" 
                   value={newItem.originalPrice} 
                   onChange={(e) => setNewItem({...newItem, originalPrice: Number(e.target.value)})} 
                 />
               </div>
               <div className="space-y-3">
                 <label className="text-[10px] font-black uppercase tracking-widest text-[#C9A84C] ml-1">Initial Stock</label>
                 <input 
                   type="number" 
                   className="vault-input border-[#C9A84C]/20 bg-[#C9A84C]/5 text-[#C9A84C]" 
                   value={newItem.remainingCount} 
                   onChange={(e) => setNewItem({...newItem, remainingCount: Number(e.target.value)})} 
                 />
               </div>
            </div>
          </div>
          <div className="flex gap-4 mt-10">
            <button 
              onClick={async () => {
                setIsCreating(true);
                await handleUpsert({ ...newItem, isActive: true });
                setIsCreating(false);
                setIsAdding(false);
                setImageFile(null);
                setNewItem({ name: '', price: 0, originalPrice: 0, remainingCount: 1, imageUrl: '' });
              }}
              disabled={isCreating || !newItem.name}
              className="flex-1 py-5 bg-[#C9A84C] text-black font-black uppercase tracking-[0.3em] rounded-3xl text-xs disabled:opacity-50"
            >
              {isCreating ? 'Securing Asset...' : 'Initialize Node'}
            </button>
            <button 
              onClick={() => setIsAdding(false)}
              className="px-10 py-5 bg-white/5 text-gray-500 font-black uppercase tracking-widest rounded-3xl text-xs hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {loading ? (
            <div className="col-span-full py-20 text-center font-black text-gray-500 animate-pulse tracking-widest uppercase">Syncing with Secure Vault...</div>
        ) : items.map((item) => (
          <VaultItemComponent 
            key={item._id} 
            item={item} 
            onUpdate={handleUpsert} 
            onDelete={handleDelete} 
          />
        ))}
      </div>

      <div className="glass-card p-10 flex items-center justify-between border-[#C9A84C]/20 bg-[#C9A84C]/[0.02]">
         <div className="flex items-center gap-6">
            <span className="text-3xl">🕯️</span>
            <div>
               <h4 className="text-sm font-black text-white uppercase tracking-wider">The Psychology of Scarcity</h4>
               <p className="text-[10px] text-gray-500 leading-relaxed uppercase tracking-wide">The Vault generates intensity through limited numbers. By updating these counts in real-time, you trigger the campus FOMO engine.</p>
            </div>
         </div>
      </div>
      <style jsx>{`
        .vault-input { 
          width: 100%;
          background: rgba(255,255,255,0.03); 
          border: 1px solid rgba(255,255,255,0.05); 
          padding: 1.25rem; 
          border-radius: 1.5rem; 
          color: white; 
          font-weight: 900; 
          outline: none; 
          transition: all 0.3s ease;
        }
        .vault-input:focus { 
          border-color: rgba(201, 168, 76, 0.4); 
          background: rgba(201, 168, 76, 0.02);
        }
      `}</style>
    </div>
  );
}

// ─── Optimized Sub-Components ─────────────────────────────────

const VaultItemComponent = memo(({ item, onUpdate, onDelete }: { item: VaultItem, onUpdate: (i: Partial<VaultItem>) => void, onDelete: (id: string) => void }) => (
  <div className="glass-card p-8 group relative overflow-hidden flex flex-col justify-between h-full border-white/5 hover:border-[#C9A84C]/20 transition-all duration-500">
    <div className="flex gap-8 relative z-10">
      <div className="w-32 h-32 rounded-3xl overflow-hidden border border-white/10 shrink-0 relative bg-slate-900 pointer-events-none">
        <Image 
          src={item.imageUrl || "/assets/placeholder.png"} 
          fill 
          style={{ objectFit: 'cover' }} 
          alt={item.name} 
          className="group-hover:scale-110 transition-transform duration-700 ease-out will-change-transform" 
        />
      </div>
      <div className="flex-1 space-y-4">
        <div className="flex justify-between items-start">
          <h4 className="text-xl font-black text-white uppercase tracking-tight">{item.name}</h4>
          <button onClick={() => onDelete(item._id)} className="text-red-500/40 hover:text-red-500 hover:scale-125 transition-all text-sm">✕</button>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block mb-1">Live Price</label>
            <input 
              type="number" 
              defaultValue={item.price}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-2 text-xs text-white font-black focus:border-[#C9A84C]/40 outline-none"
              onBlur={(e) => onUpdate({ ...item, price: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="text-[8px] font-black text-gray-500 uppercase tracking-widest block mb-1">MSRP</label>
            <input 
              type="number" 
              defaultValue={item.originalPrice}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-2 text-xs text-gray-400 font-bold focus:border-[#C9A84C]/40 outline-none"
              onBlur={(e) => onUpdate({ ...item, originalPrice: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="text-[8px] font-black text-[#C9A84C] uppercase tracking-widest block mb-1">Remaining</label>
            <input 
              type="number" 
              defaultValue={item.remainingCount}
              className="w-full bg-[#C9A84C]/10 border border-[#C9A84C]/20 rounded-xl p-2 text-xs text-[#C9A84C] font-black focus:border-[#C9A84C]/60 outline-none"
              onBlur={(e) => onUpdate({ ...item, remainingCount: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 pt-2">
          <div className={`w-2 h-2 rounded-full ${item.remainingCount > 0 ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-red-500 animate-pulse'}`} />
          <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
            {item.remainingCount > 0 ? 'ACTIVE IN VAULT' : 'OUT OF STOCK / HIDDEN'}
          </span>
        </div>
      </div>
    </div>
    <div className="absolute bottom-0 left-0 h-0.5 bg-[#C9A84C]/30 transition-all duration-1000" style={{ width: `${Math.min(100, (item.remainingCount / 10) * 100)}%` }} />
    <style jsx>{`
       input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    `}</style>
  </div>
));
VaultItemComponent.displayName = 'VaultItemComponent';
