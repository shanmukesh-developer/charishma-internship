"use client";
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SafeImage from './SafeImage';

export interface PromoOffer {
  id: string;
  imageUrl: string;
  tagline: string;
  title1: string;
  title2: string;
  description: string;
  buttonText: string;
  isActive: boolean;
  redirectUrl?: string;
}

interface PromoCarouselProps {
  offers: PromoOffer[];
}

export default function PromoCarousel({ offers }: PromoCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const activeOffers = offers.filter(o => o.isActive);

  useEffect(() => {
    if (activeOffers.length <= 1) return;
    
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % activeOffers.length);
    }, 2500); 
    
    return () => clearInterval(interval);
  }, [activeOffers.length]);

  if (activeOffers.length === 0) return null;

  const currentOffer = activeOffers[currentIndex];

  return (
    <div className="relative mb-4 group">
      <div className="absolute inset-x-0 -top-10 h-40 bg-gradient-to-b from-primary-yellow/5 to-transparent pointer-events-none" />
      <motion.div 
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.15}
        onDragEnd={(e, info) => {
          const swipeThreshold = 50;
          if (info.offset.x < -swipeThreshold) {
            setCurrentIndex((prev) => (prev + 1) % activeOffers.length);
          } else if (info.offset.x > swipeThreshold) {
            setCurrentIndex((prev) => (prev - 1 + activeOffers.length) % activeOffers.length);
          }
        }}
        className="glass-card-extreme overflow-hidden rounded-[30px] border border-white/5 relative min-h-[210px] h-auto md:h-[280px] flex items-center px-6 md:px-12 py-10 md:py-0 group cursor-grab active:cursor-grabbing"
      >
        
        {/* Background Image Container */}
        <div className="absolute inset-0 w-full h-full pointer-events-none z-0">
           <div className="absolute inset-0 bg-gradient-to-r from-[#0A0A0B] via-[#0A0A0B]/90 to-transparent z-10 light:from-white light:via-white/90" />
           <AnimatePresence mode="wait">
             <motion.div
               key={currentOffer.id}
               initial={{ opacity: 0, scale: 1.05 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0 }}
               transition={{ duration: 0.8 }}
               className="absolute inset-0"
             >
               <SafeImage 
                  src={currentOffer.imageUrl} 
                  alt={currentOffer.title1}
                  fallback="/assets/placeholder_premium.png"
                  fill
                  className="group-hover:scale-110 transition-transform duration-700 object-cover"
                />
             </motion.div>
           </AnimatePresence>
        </div>
        
        {/* Left Side Content */}
        <div className="relative z-20 max-w-md w-full">
           <AnimatePresence mode="wait">
             <motion.div
               key={currentOffer.id + "-text"}
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: -10 }}
               transition={{ duration: 0.4 }}
             >
                 <span className="text-[10px] font-black text-[#C9A84C] light:text-[#C9A84C] uppercase tracking-[0.5em] mb-4 block">
                    {currentOffer.tagline} 🌆
                 </span>
                 <h1 className="text-xl md:text-5xl font-black text-white light:text-gray-900 leading-[0.9] italic tracking-tighter mb-4" style={{ fontFamily: "'Syne', sans-serif" }}>
                    {currentOffer.title1} <br />
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-yellow to-[#C9A84C] light:from-[#C9A84C] light:to-[#F5A623]">
                      {currentOffer.title2}
                    </span>
                 </h1>
                 <p className="text-[9px] font-bold text-secondary-text light:text-gray-500 uppercase tracking-widest max-w-[280px] leading-relaxed mb-6">
                    {currentOffer.description}
                 </p>
                 <motion.button 
                  whileTap={{ scale: 0.95 }}
                  whileHover={{ scale: 1.02 }}
                  onClick={() => {
                    if (currentOffer.redirectUrl) {
                      window.location.href = currentOffer.redirectUrl;
                    } else if (currentOffer.buttonText === 'CREATE BASKET') {
                      window.location.href = '/mega-basket';
                    } else {
                      document.getElementById('restaurant-feed')?.scrollIntoView({ behavior: 'smooth' });
                    }
                  }}
                  className="bg-[#C9A84C] hover:bg-[#b5953e] text-black text-[10px] font-black py-4 px-10 rounded-full shadow-[0_0_30px_rgba(201,168,76,0.2)] uppercase tracking-widest transition-colors"
                 >
                    {currentOffer.buttonText} →
                 </motion.button>
             </motion.div>
           </AnimatePresence>
        </div>

        {/* Slide Indicators */}
        {activeOffers.length > 1 && (
          <div className="absolute bottom-4 left-6 md:left-12 flex items-center gap-1.5 z-30">
            {activeOffers.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex(idx)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  idx === currentIndex ? 'w-6 bg-[#C9A84C]' : 'w-1.5 border border-white/40 light:border-gray-300 hover:bg-white/20'
                }`}
                aria-label={`Go to offer ${idx + 1}`}
              />
            ))}
          </div>
        )}

        {/* Stardust Aura Effect */}
        <div className="absolute bottom-0 left-1/4 w-1/2 h-px bg-gradient-to-r from-transparent via-[#C9A84C]/40 to-transparent blur-sm" />
      </motion.div>
    </div>
  );
}
