"use client";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Tilt from '@/components/Tilt';
import { API_URL } from '@/utils/api';

export default function PGAdminPage() {
  const router = useRouter();
  const [pgName, setPgName] = useState('');
  const [address, setAddress] = useState('');
  const [distance, setDistance] = useState(0);
  const [baseRent, setBaseRent] = useState(0);

  const handleCreatePG = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    if (!token) return router.push('/login');

    try {
      const res = await fetch(`${API_URL}/api/pg`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: pgName,
          address,
          distanceFromCollege: distance,
          baseRent
        })
      });
      if (res.ok) {
        alert("PG Created successfully! Add rooms in Phase 2.");
        setPgName(''); setAddress(''); setDistance(0); setBaseRent(0);
      } else {
        const data = await res.json();
        alert(data.message || "Failed to create PG.");
      }
    } catch (err) {
      alert("Error creating PG.");
    }
  };

  return (
    <div className="min-h-screen bg-app-black text-white font-sans overflow-hidden">
      <Navbar />
      <div className="pt-24 pb-20 px-4 max-w-4xl mx-auto relative z-10">
        <h1 className="text-3xl font-black uppercase mb-8 border-b border-white/10 pb-4">
          PG Owner Dashboard 🗝️
        </h1>
        
        <Tilt className="glass-card-extreme p-8 rounded-[30px] border border-white/10">
          <h2 className="text-xl font-bold mb-6 text-indigo-400">Add New PG Listing</h2>
          <form onSubmit={handleCreatePG} className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">PG Name</label>
              <input type="text" value={pgName} onChange={e => setPgName(e.target.value)} required className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Address</label>
              <input type="text" value={address} onChange={e => setAddress(e.target.value)} required className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Distance from College (km)</label>
                <input type="number" step="0.1" value={distance} onChange={e => setDistance(parseFloat(e.target.value))} required className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Base Rent (₹/mo)</label>
                <input type="number" value={baseRent} onChange={e => setBaseRent(parseInt(e.target.value))} required className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none" />
              </div>
            </div>
            <button type="submit" className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-3 rounded-xl mt-4 uppercase tracking-wider text-xs transition-colors">
              Create PG Listing
            </button>
          </form>
        </Tilt>
      </div>
    </div>
  );
}
