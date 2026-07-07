'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import SafeImage from '@/components/SafeImage';

export default function ZenvySuperPortal() {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  // Handle scroll to hide/show the pill if needed, or just shrink it
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 100);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Lock body scroll when portal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  return (
    <>
      {/* The "Dynamic Island" Trigger Pill */}
      <motion.div 
        className="fixed z-[90] bottom-28 left-1/2 -translate-x-1/2 cursor-pointer"
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 20, stiffness: 300, delay: 1 }}
        onClick={() => setIsOpen(true)}
      >
        <motion.div 
          className="bg-black/80 light:bg-white backdrop-blur-xl border border-white/10 light:border-black shadow-2xl rounded-full px-5 py-3 flex items-center gap-3"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          animate={{
            width: isScrolled ? 'auto' : 'auto',
          }}
        >
          <div className="flex -space-x-2">
            <div className="w-6 h-6 rounded-full bg-indigo-500/20 border border-indigo-500/50 flex items-center justify-center text-[10px]">🏍️</div>
            <div className="w-6 h-6 rounded-full bg-teal-500/20 border border-teal-500/50 flex items-center justify-center text-[10px] z-10">🏠</div>
            <div className="w-6 h-6 rounded-full bg-[#C9A84C]/20 border border-[#C9A84C]/50 flex items-center justify-center text-[10px] z-20">✨</div>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-black text-white light:text-black uppercase tracking-widest leading-none">Zenvy Hub</span>
            <span className="text-[7px] font-bold text-secondary-text uppercase tracking-widest mt-0.5">Explore Ecosystem</span>
          </div>
        </motion.div>
      </motion.div>

      {/* The 3D Flip Ecosystem Overlay */}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[150] perspective-1000 flex items-center justify-center pointer-events-none">
            {/* Backdrop Blur */}
            <motion.div 
              className="absolute inset-0 bg-black/60 light:bg-white backdrop-blur-md pointer-events-auto"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
            />

            {/* The 3D Flipping Container */}
            <motion.div 
              className="relative w-full max-w-md h-[85vh] mx-auto pointer-events-auto"
              initial={{ rotateY: -90, scale: 0.8, opacity: 0 }}
              animate={{ rotateY: 0, scale: 1, opacity: 1 }}
              exit={{ rotateY: 90, scale: 0.8, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              style={{ transformStyle: 'preserve-3d' }}
            >
              <div className="w-full h-full bg-[#0A0A0B] light:bg-[#f8f8fa] rounded-[40px] border border-white/10 light:border-black shadow-2xl overflow-hidden flex flex-col">
                
                {/* Header */}
                <div className="p-6 pb-2 flex items-center justify-between relative z-10">
                  <div>
                    <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-[#C9A84C]">Zenvy SuperApp</h2>
                    <h1 className="text-2xl font-black text-white light:text-black italic tracking-tighter uppercase">Ecosystem</h1>
                  </div>
                  <button 
                    onClick={() => setIsOpen(false)}
                    className="w-10 h-10 rounded-full bg-white/5 light:bg-black flex items-center justify-center text-white light:text-black hover:scale-110 transition-transform"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
                  
                  {/* Co-Ride */}
                  <Link href="/bikepool" className="block group relative overflow-hidden rounded-[30px] border border-indigo-500/30 hover:border-indigo-500/60 transition-colors shadow-lg">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#0A0A0B] light:from-white to-indigo-500/20 z-0" />
                    <div className="p-8 relative z-10">
                      <div className="w-14 h-14 rounded-[20px] bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-2xl mb-4 shadow-[0_0_20px_rgba(99,102,241,0.3)]">🏍️</div>
                      <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-indigo-400 mb-1">Collaborative Commute</h3>
                      <p className="text-3xl font-black italic tracking-tighter text-white light:text-black mb-2">Co-Ride</p>
                      <p className="text-[11px] font-bold text-white light:text-gray-900/60 light:text-black uppercase tracking-widest leading-relaxed">Share bike rides, split bills, safety gender filters. Travel smart.</p>
                      
                      <div className="mt-6 flex items-center text-[10px] font-black uppercase tracking-widest text-indigo-400">
                        Launch Service <span className="ml-2 group-hover:translate-x-2 transition-transform">→</span>
                      </div>
                    </div>
                  </Link>

                  {/* PG & Hostels */}
                  <Link href="/pg" className="block group relative overflow-hidden rounded-[30px] border border-teal-500/30 hover:border-teal-500/60 transition-colors shadow-lg">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#0A0A0B] light:from-white to-teal-500/20 z-0" />
                    <div className="p-8 relative z-10">
                      <div className="w-14 h-14 rounded-[20px] bg-teal-500/20 border border-teal-500/40 flex items-center justify-center text-2xl mb-4 shadow-[0_0_20px_rgba(20,184,166,0.3)]">🏠</div>
                      <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-teal-400 mb-1">Campus Housing</h3>
                      <p className="text-3xl font-black italic tracking-tighter text-white light:text-black mb-2">PG & Hostels</p>
                      <p className="text-[11px] font-bold text-white light:text-gray-900/60 light:text-black uppercase tracking-widest leading-relaxed">Discover, compare, and book verified stays around campus.</p>
                      
                      <div className="mt-6 flex items-center text-[10px] font-black uppercase tracking-widest text-teal-400">
                        Launch Service <span className="ml-2 group-hover:translate-x-2 transition-transform">→</span>
                      </div>
                    </div>
                  </Link>
                  
                  {/* BlockWars Challenge */}
                  <Link href="/challenges" className="block group relative overflow-hidden rounded-[30px] border border-[#C9A84C]/30 hover:border-[#C9A84C]/60 transition-colors shadow-lg">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#0A0A0B] light:from-white to-[#C9A84C]/20 z-0" />
                    <div className="p-8 relative z-10">
                      <div className="w-14 h-14 rounded-[20px] bg-[#C9A84C]/20 border border-[#C9A84C]/40 flex items-center justify-center text-2xl mb-4 shadow-[0_0_20px_rgba(201,168,76,0.3)]">🏆</div>
                      <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-[#C9A84C] mb-1">Weekly Challenge</h3>
                      <p className="text-3xl font-black italic tracking-tighter text-white light:text-black mb-2">BlockWars</p>
                      <p className="text-[11px] font-bold text-white light:text-gray-900/60 light:text-black uppercase tracking-widest leading-relaxed">Compete for campus discounts and glory.</p>
                      
                      <div className="mt-6 flex items-center text-[10px] font-black uppercase tracking-widest text-[#C9A84C]">
                        Enter Arena <span className="ml-2 group-hover:translate-x-2 transition-transform">→</span>
                      </div>
                    </div>
                  </Link>

                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
