"use client";
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ZenvyModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  type?: 'info' | 'success' | 'warning' | 'error';
}

export default function ZenvyModal({
  isOpen,
  onClose,
  title,
  message,
  confirmLabel = 'Understood',
  cancelLabel,
  onConfirm,
  type = 'info'
}: ZenvyModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !isOpen || typeof document === 'undefined') return null;

  const handleConfirm = () => {
    if (onConfirm) onConfirm();
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 animate-in fade-in duration-300">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        onClick={onClose}
      />
      
      {/* Modal Card */}
      <div className="relative w-full max-w-[360px] glass-card border-[#C9A84C]/30 p-8 text-center animate-in zoom-in-95 duration-300 shadow-[0_0_50px_rgba(201,168,76,0.15)]">
        <div className="mb-6 flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#C9A84C] to-[#8B7332] flex items-center justify-center shadow-lg shadow-[#C9A84C]/20">
            <span className="text-2xl">
              {type === 'success' ? '✨' : type === 'warning' ? '⚠️' : type === 'error' ? '❌' : '💎'}
            </span>
          </div>
        </div>

        <h3 className="text-xl font-black text-white light:text-gray-900 uppercase tracking-widest mb-3">
          {title}
        </h3>
        
        <p className="text-sm font-medium text-secondary-text leading-relaxed mb-8">
          {message}
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={handleConfirm}
            className="w-full bg-primary-yellow text-black font-black py-4 rounded-2xl uppercase tracking-tighter text-xs shadow-lg shadow-primary-yellow/20 active:scale-95 transition-transform"
          >
            {confirmLabel}
          </button>
          
          {cancelLabel && (
            <button
              onClick={onClose}
              className="w-full bg-white/5 text-secondary-text font-black py-4 rounded-2xl uppercase tracking-tighter text-xs border border-white/5 active:scale-95 transition-transform"
            >
              {cancelLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
