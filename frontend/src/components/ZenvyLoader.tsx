"use client";
import React from 'react';
import { motion } from 'framer-motion';

interface ZenvyLoaderProps {
  message?: string;
  inline?: boolean;
}

export default function ZenvyLoader({ message = "Loading Zenvy...", inline = false }: ZenvyLoaderProps) {
  const content = (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      {/* Premium Rotating Halo with Zenvy Monogram */}
      <div className="relative w-24 h-24 flex items-center justify-center mb-6">
        {/* Spinner ring */}
        <div className="absolute inset-0 rounded-full border-2 border-[#C9A84C]/10 border-t-[#C9A84C] animate-spin" />
        
        {/* Ambient glow behind monogram */}
        <div className="absolute inset-2 bg-[#C9A84C]/5 blur-lg rounded-full animate-pulse" />
        
        {/* Zenvy signature Z monogram */}
        <svg className="w-10 h-10 text-[#C9A84C]" viewBox="0 0 100 100" fill="none">
          <motion.path
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.5, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" }}
            d="M25 25 L75 25 L25 75 L75 75"
            stroke="currentColor" 
            strokeWidth="8" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Styled brand indicator */}
      <h2 className="text-sm font-black uppercase tracking-[0.3em] text-[#C9A84C] mb-2" style={{ fontFamily: "'Syne', sans-serif" }}>
        Zenvy
      </h2>
      
      {/* Loading message */}
      <p className="text-[10px] font-bold text-secondary-text uppercase tracking-widest animate-pulse max-w-[200px]">
        {message}
      </p>
    </div>
  );

  if (inline) {
    return (
      <div className="w-full py-12 flex items-center justify-center">
        {content}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-[#0A0A0B]/90 backdrop-blur-md flex items-center justify-center">
      {content}
    </div>
  );
}
