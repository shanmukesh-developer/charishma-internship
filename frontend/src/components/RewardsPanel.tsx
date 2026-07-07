"use client";
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import SpinWheel from './SpinWheel';
import CouponSection from './CouponSection';
import { motion, AnimatePresence } from 'framer-motion';

export default function RewardsPanel({ onWin }: { onWin: (prize: { type: string; value: string | number }) => void }) {
  const [showSpin, setShowSpin] = useState(false);
  const [showCoupons, setShowCoupons] = useState(false);

  // Minimal SVG Icons
  const SpinIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );


  const ModalContent = ({ onClose, children }: { type: string, onClose: () => void, children: React.ReactNode }) => {
    const [mounted, setMounted] = useState(false);
    
    useEffect(() => {
      setMounted(true);
    }, []);

    if (!mounted || typeof document === 'undefined') return null;
    
    return createPortal(
      <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/90 backdrop-blur-xl"
        />
        <motion.div 
          initial={{ scale: 0.9, opacity: 0, y: 30 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 30 }}
          className="relative w-full max-w-[420px] bg-[#0A0A0B] rounded-[44px] p-8 border border-white/10 shadow-[0_0_100px_rgba(0,0,0,0.5)] max-h-[90vh] overflow-y-auto scrollbar-hide"
        >
          <button 
            onClick={onClose}
            className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white light:text-gray-900/40 hover:text-white light:text-gray-900 transition-colors z-10"
          >✕</button>
          <div className="mt-2">
            {children}
          </div>
        </motion.div>
      </div>,
      document.body
    );
  };

  return (
    <div className="flex items-center gap-3">
      {/* 🎡 Spin Trigger */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setShowSpin(true)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-[#C9A84C]/25 border border-[#C9A84C]/40 hover:bg-[#C9A84C]/40 transition-all group shadow-lg shadow-black/20"
        title="Lucky Spin"
      >
        <div className="text-[#C9A84C] group-hover:rotate-45 transition-transform duration-500 drop-shadow-[0_0_5px_rgba(201,168,76,0.3)]">
          <SpinIcon />
        </div>
        <span className="text-[10px] font-black uppercase tracking-widest text-white light:text-gray-900">Spin</span>
      </motion.button>


      {/* ─── Modals ─── */}
      <AnimatePresence>
        {showSpin && (
          <ModalContent type="spin" onClose={() => setShowSpin(false)}>
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-[#C9A84C] mb-8">Daily Luck</span>
              <SpinWheel onWin={(p) => { onWin(p); setTimeout(() => setShowSpin(false), 2500); }} />
            </div>
          </ModalContent>
        )}

        {showCoupons && (
          <ModalContent type="coupons" onClose={() => setShowCoupons(false)}>
             <div className="flex flex-col">
              <span className="text-[10px] font-black uppercase tracking-[0.4em] text-secondary-text mb-6">Gourmet Pass</span>
              <h2 className="text-2xl font-black text-white light:text-gray-900 mb-8">Active Rewards</h2>
              <CouponSection />
            </div>
          </ModalContent>
        )}
      </AnimatePresence>
    </div>
  );
}
