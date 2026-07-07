"use client";
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface SuccessOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  type?: 'success' | 'error';
  actionLabel?: string;
  onAction?: () => void;
}

export default function SuccessOverlay({ isOpen, onClose, title, message, type = 'success', actionLabel, onAction }: SuccessOverlayProps) {
  const [mounted, setMounted] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setShow(true);
      if (type === 'success') {
        const timer = setTimeout(() => {
          setShow(false);
          setTimeout(onClose, 500);
        }, 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [isOpen, onClose, type]);

  if (!mounted || typeof document === 'undefined') return null;
  if (!isOpen && !show) return null;

  const isError = type === 'error';

  return createPortal(
    <div className={`fixed inset-0 z-[200] flex items-center justify-center p-6 pointer-events-auto transition-all duration-500 ${show ? 'opacity-100' : 'opacity-0'}`}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />
      
      <div className={`relative w-full max-w-[320px] glass-card p-10 rounded-[40px] flex flex-col items-center text-center border-[#C9A84C]/20 shadow-2xl transition-all duration-700 ${show ? 'scale-100 translate-y-0' : 'scale-90 translate-y-10'}`}>
        {/* Animated Icon Ring */}
        <div className={`w-24 h-24 rounded-full border-2 ${isError ? 'border-red-500/50' : 'border-[#C9A84C]'} flex items-center justify-center mb-8 relative`}>
          <div className={`absolute inset-0 rounded-full border-2 ${isError ? 'border-red-500/50' : 'border-[#C9A84C]'} animate-ping opacity-20`} />
          <div className={`w-16 h-16 rounded-full bg-gradient-to-br ${isError ? 'from-red-500 to-red-600' : 'from-[#C9A84C] to-[#8B7332]'} flex items-center justify-center shadow-lg ${isError ? 'shadow-red-500/30' : 'shadow-[#C9A84C]/30'}`}>
            {isError ? (
              <svg className="w-8 h-8 text-white light:text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-8 h-8 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        </div>

        <h2 className={`text-2xl font-black mb-3 tracking-tight ${isError ? 'text-red-500' : 'text-gold-gradient'}`}>{title}</h2>
        <p className="text-secondary-text text-sm font-medium leading-relaxed mb-8">{message}</p>

        <div className="w-full space-y-3">
          {actionLabel && onAction && (
            <button 
              onClick={() => { onAction(); setShow(false); setTimeout(onClose, 500); }}
              className={`w-full h-14 ${isError ? 'bg-red-500 text-white light:text-gray-900' : 'bg-primary-yellow text-black'} rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-lg transition-all active:scale-95`}
            >
              {actionLabel}
            </button>
          )}
          <button 
            onClick={() => { setShow(false); setTimeout(onClose, 500); }}
            className="w-full h-14 bg-white/5 border border-white/10 rounded-full text-[10px] font-black uppercase tracking-[0.2em] hover:bg-white/10 transition-all"
          >
            {isError ? 'Close' : 'Dismiss'}
          </button>
        </div>

        {/* Ambient Glow */}
        <div className={`absolute -z-10 w-48 h-48 ${isError ? 'bg-red-500/10' : 'bg-[#C9A84C]/10'} rounded-full blur-[60px]`} />
      </div>
    </div>,
    document.body
  );
}
