"use client";
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';

interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SUPPORT_PHONE = "+919391955674";
const SUPPORT_DISPLAY = "+91 93919 55674";

export default function SupportModal({ isOpen, onClose }: SupportModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(SUPPORT_PHONE);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCall = () => {
    window.location.href = `tel:${SUPPORT_PHONE}`;
  };

  const handleWhatsApp = () => {
    const message = encodeURIComponent("Hello Zenvy Support, I need assistance with...");
    window.open(`https://wa.me/${SUPPORT_PHONE.replace('+', '')}?text=${message}`, '_blank');
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-6">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-xl"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative w-full max-w-[380px] bg-[#141416] border border-white/10 rounded-[40px] p-8 shadow-2xl overflow-hidden"
          >
            {/* Decorative Background Element */}
            <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none">
              <span className="text-[120px] font-black italic">ZN</span>
            </div>

            <div className="relative z-10 flex flex-col items-center text-center">
              {/* Icon */}
              <div className="w-20 h-20 rounded-[28px] bg-primary-yellow/10 border border-primary-yellow/20 flex items-center justify-center text-3xl mb-6 shadow-lg shadow-primary-yellow/5">
                📞
              </div>

              {/* Header */}
              <h3 className="text-2xl font-black uppercase tracking-widest mb-2">Nexus Concierge</h3>
              <p className="text-[10px] text-white light:text-gray-900/40 font-bold uppercase tracking-[0.3em] mb-8">24/7 Dedicated Support</p>

              {/* Status Indicator */}
              <div className="flex items-center gap-2 mb-8 bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 rounded-full">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Support Online</span>
              </div>

              {/* Phone Number Display */}
              <div className="w-full bg-white/5 border border-white/5 rounded-3xl p-6 mb-8 group active:scale-[0.98] transition-all cursor-pointer" onClick={handleCopy}>
                <p className="text-[8px] text-secondary-text font-black uppercase tracking-widest mb-1">Direct Line</p>
                <p className="text-xl font-black text-white light:text-gray-900 tracking-widest">{SUPPORT_DISPLAY}</p>
                <p className="text-[8px] text-primary-yellow font-bold uppercase tracking-widest mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {copied ? "Copied to Clipboard!" : "Tap to Copy Number"}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="w-full space-y-3">
                <button
                  onClick={handleCall}
                  className="w-full py-5 bg-primary-yellow text-black rounded-[24px] text-[11px] font-black uppercase tracking-[0.2em] shadow-xl shadow-primary-yellow/20 active:scale-95 transition-all flex items-center justify-center gap-3"
                >
                  <span>Initiate Call</span>
                  <span className="">→</span>
                </button>

                <button
                  onClick={handleWhatsApp}
                  className="w-full py-5 bg-[#25D366]/10 border border-[#25D366]/20 text-[#25D366] rounded-[24px] text-[11px] font-black uppercase tracking-[0.2em] active:scale-95 transition-all flex items-center justify-center gap-3"
                >
                  <span className="text-lg">💬</span>
                  <span>WhatsApp Support</span>
                </button>

                <button
                  onClick={onClose}
                  className="w-full py-5 bg-white/5 border border-white/5 text-white light:text-gray-900/40 rounded-[24px] text-[11px] font-black uppercase tracking-[0.2em] active:scale-95 transition-all"
                >
                  Back to Profile
                </button>
              </div>

              {/* Footer Note */}
              <p className="text-[8px] text-white light:text-gray-900/20 mt-8 font-medium italic">
                Zenvy Nexus ensures priority assistance for all Elite members.
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
