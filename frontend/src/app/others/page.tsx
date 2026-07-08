"use client";
import React, { useEffect } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { useWorldTransition } from '@/context/WorldTransitionContext';
import { motion } from 'framer-motion';

export default function OthersPage() {
  const { phase } = useWorldTransition();


  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className={`min-h-screen bg-white text-black font-sans pb-24 ${phase === 'covering' || phase === 'uncovering' ? 'pointer-events-none' : ''}`}>
      <Navbar />

      <main className="pt-24 px-6 max-w-7xl mx-auto">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mb-8"
        >
          <h2 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.4em] mb-1">Zenvy Others</h2>
          <p className="text-3xl font-black text-black tracking-tight">Explore More</p>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
        >
          {[
            { id: 'stationary', name: 'Stationary & Print', icon: '📚', color: 'bg-violet-50 text-violet-600' },
            { id: 'seasonal', name: 'Season Specials', icon: '🌟', color: 'bg-amber-50 text-amber-600' },
            { id: 'sweets', name: 'Delicious Desserts', icon: '🍰', color: 'bg-pink-50 text-pink-600' },
            { id: 'drinks', name: 'Drinks & Beverages', icon: '🥤', color: 'bg-cyan-50 text-cyan-600' },
            { id: 'gym', name: 'Gym & Protein', icon: '💪', color: 'bg-zinc-100 text-zinc-700' },
            { id: 'rentals', name: 'Campus Rides', icon: '🚲', color: 'bg-emerald-50 text-emerald-600' },
            { id: 'fruits', name: 'Fresh Fruits', icon: '🍎', color: 'bg-red-50 text-red-600' },
            { id: 'pharmacy', name: 'Pharmacy', icon: '💊', color: 'bg-rose-50 text-rose-600' },
            { id: 'laundry', name: 'Dry Wash', icon: '🧺', color: 'bg-blue-50 text-blue-600' }
          ].map((cat, i) => (
            <motion.div
              key={cat.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 + (i * 0.05) }}
            >
              <Link href={`/category/${cat.id}`} className="group relative overflow-hidden rounded-[24px] border border-gray-100 bg-white p-5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-all active:scale-95 flex flex-col items-center gap-3 text-center h-full">
                <div className={`w-14 h-14 rounded-[20px] flex items-center justify-center text-2xl ${cat.color} group-hover:scale-110 transition-transform duration-300`}>
                  {cat.icon}
                </div>
                <span className="text-[13px] font-bold text-gray-800 leading-tight">{cat.name}</span>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </main>
      
      {/* Footer Nav Space reserved - assume global footer or WorldSwitcher covers this eventually */}
    </div>
  );
}
