"use client";
import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import SafeImage from './SafeImage';
import { playTakeoverSound } from '@/utils/sensory';

interface BrandTakeoverSplashProps {
  brandName: string;
  logoAnimationType: 'kfc-bucket-drop' | 'dominos-flip' | 'mcd-glow';
  logoUrl: string;
  onComplete: () => void;
}

// Legendary data for each brand — founders, iconic items, taglines
const BRAND_LORE: Record<string, {
  founder: string;
  foundedYear: string;
  tagline: string;
  legendaryItems: { name: string; icon: string }[];
  capsule: string;
}> = {
  'kfc-bucket-drop': {
    founder: 'Colonel Harland Sanders',
    foundedYear: '1952',
    tagline: 'IT\'S FINGER LICKIN\' GOOD',
    legendaryItems: [
      { name: 'Hot & Crispy Bucket', icon: '🍗' },
      { name: 'Zinger Burger', icon: '🍔' },
      { name: 'Popcorn Chicken', icon: '🌽' },
      { name: 'Coleslaw', icon: '🥗' },
    ],
    capsule: 'The Colonel\'s Secret Recipe of 11 herbs & spices, perfected over 70+ years.'
  },
  'dominos-flip': {
    founder: 'Tom Monaghan',
    foundedYear: '1960',
    tagline: 'OH YES WE DID',
    legendaryItems: [
      { name: 'Cheese Burst', icon: '🧀' },
      { name: 'Peppy Paneer', icon: '🫑' },
      { name: 'Garlic Breadsticks', icon: '🥖' },
      { name: 'Choco Lava Cake', icon: '🍫' },
    ],
    capsule: '30 minutes or free — the pizza promise that changed delivery forever.'
  },
  'mcd-glow': {
    founder: 'Ray Kroc',
    foundedYear: '1955',
    tagline: 'I\'M LOVIN\' IT',
    legendaryItems: [
      { name: 'Big Mac', icon: '🍔' },
      { name: 'McFlurry Oreo', icon: '🍦' },
      { name: 'Golden Fries', icon: '🍟' },
      { name: 'Happy Meal', icon: '🎁' },
    ],
    capsule: 'From a single drive-in to 40,000+ restaurants — the Golden Arches empire.'
  }
};

export default function BrandTakeoverSplash({
  brandName,
  logoAnimationType,
  logoUrl,
  onComplete
}: BrandTakeoverSplashProps) {
  const lore = BRAND_LORE[logoAnimationType] || BRAND_LORE['kfc-bucket-drop'];

  useEffect(() => {
    // Play brand-specific sensory audio feedback at initiation
    playTakeoverSound(logoAnimationType);
    
    // Extended duration (3.8s) to let the legendary sequence play out fully
    const timer = setTimeout(() => {
      onComplete();
    }, 3800);

    return () => clearTimeout(timer);
  }, [onComplete, logoAnimationType]);

  const glowColor = 
    logoAnimationType === 'kfc-bucket-drop' ? 'rgba(228,0,43,0.22)' :
    logoAnimationType === 'dominos-flip' ? 'rgba(0,100,145,0.2)' :
    'rgba(255,199,44,0.2)';

  const accentColor = 
    logoAnimationType === 'kfc-bucket-drop' ? '#FFC72C' :
    logoAnimationType === 'dominos-flip' ? '#006491' :
    '#FFC72C';

  const primaryColor = 
    logoAnimationType === 'kfc-bucket-drop' ? '#E4002B' :
    logoAnimationType === 'dominos-flip' ? '#E31B23' :
    '#DA291C';

  return (
    <div className="fixed inset-0 z-[9999] overflow-hidden select-none pointer-events-none">
      
      {/* Left Shutter Panel */}
      <motion.div
        initial={{ x: "-100%" }}
        animate={{ x: 0 }}
        exit={{ x: "-100%" }}
        transition={{ 
          duration: 0.75,
          ease: [0.76, 0, 0.24, 1]
        }}
        className="absolute inset-y-0 left-0 w-1/2 bg-black pointer-events-auto shadow-[10px_0_30px_rgba(0,0,0,0.8)]"
        style={{ borderRight: `2px solid ${accentColor}40` }}
      />
      
      {/* Right Shutter Panel */}
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ 
          duration: 0.75,
          ease: [0.76, 0, 0.24, 1]
        }}
        className="absolute inset-y-0 right-0 w-1/2 bg-black pointer-events-auto shadow-[-10px_0_30px_rgba(0,0,0,0.8)]"
        style={{ borderLeft: `2px solid ${accentColor}40` }}
      />

      {/* Ambient Portal Aura */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.6 }}
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(circle at center, ${glowColor} 0%, transparent 70%)`
        }}
      />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.15 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.6 }}
        className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.01)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.01)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"
      />

      {/* Floating Luxury Embers / Particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {[...Array(15)].map((_, i) => (
          <motion.div
            key={i}
            initial={{ 
              x: Math.random() * 300 - 150 + (typeof window !== 'undefined' ? window.innerWidth / 2 : 200),
              y: (typeof window !== 'undefined' ? window.innerHeight / 2 : 400) + 120,
              scale: Math.random() * 0.4 + 0.15,
              opacity: Math.random() * 0.6 + 0.4
            }}
            animate={{ 
              y: (typeof window !== 'undefined' ? window.innerHeight / 2 : 400) - 150, 
              opacity: 0,
              x: `calc(${Math.random() * 100 - 50}px + ${Math.random() * 300 - 150 + (typeof window !== 'undefined' ? window.innerWidth / 2 : 200)}px)`
            }}
            transition={{ 
              duration: Math.random() * 1.5 + 1.2, 
              ease: "easeOut",
              repeat: Infinity,
              delay: Math.random() * 1.0 
            }}
            className="absolute w-3.5 h-3.5 rounded-full blur-[0.5px]"
            style={{
              backgroundColor: i % 2 === 0 ? accentColor : primaryColor,
              boxShadow: `0 0 10px ${i % 2 === 0 ? accentColor : primaryColor}`
            }}
          />
        ))}
      </div>

      {/* Center Cinematic Content */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92, filter: "blur(5px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, scale: 1.12, filter: "blur(10px)" }}
        transition={{ 
          duration: 0.7, 
          ease: [0.16, 1, 0.3, 1]
        }}
        className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 pointer-events-auto"
      >
        {/* ═══════════════════════════════════════════ */}
        {/* KFC Legendary Classic Pure Luxury Animation */}
        {/* ═══════════════════════════════════════════ */}
        {logoAnimationType === 'kfc-bucket-drop' && (
          <div className="flex flex-col items-center justify-center relative">
            
            {/* Expanding gold shockwave ring */}
            <motion.div
              initial={{ scale: 0.65, opacity: 0, border: "2px solid #FFC72C" }}
              animate={{ scale: [0.65, 1.45], opacity: [0, 0.6, 0] }}
              transition={{ delay: 0.3, duration: 1.6, ease: "easeOut", repeat: Infinity, repeatDelay: 0.4 }}
              className="absolute w-60 h-60 rounded-full pointer-events-none"
              style={{ boxShadow: "0 0 20px rgba(255,199,44,0.3)" }}
            />

            {/* Elegant luxury scale logo */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ 
                duration: 1.3, 
                ease: [0.16, 1, 0.3, 1]
              }}
              className="relative w-36 h-36 mb-5 filter drop-shadow-[0_0_40px_rgba(228,0,43,0.4)]"
            >
              <SafeImage
                src={logoUrl}
                alt="KFC logo"
                fill
                style={{ objectFit: 'contain' }}
              />
            </motion.div>

            {/* Cinematic Luxury Title */}
            <motion.h2
              initial={{ opacity: 0, letterSpacing: "0.15em" }}
              animate={{ opacity: 1, letterSpacing: "0.3em" }}
              transition={{ delay: 0.3, duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
              className="text-3xl font-light tracking-[0.3em] uppercase text-white font-serif"
            >
              KFC <span className="text-[#FFC72C] font-semibold">PREMIUM</span>
            </motion.h2>

            <motion.div
              initial={{ width: 0 }}
              animate={{ width: 160 }}
              transition={{ delay: 0.6, duration: 0.8, ease: "easeOut" }}
              className="h-[1px] bg-gradient-to-r from-transparent via-[#FFC72C] to-transparent mt-3 mb-3"
            />

            {/* Founder Caption */}
            <motion.p
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 0.9, y: 0 }}
              transition={{ delay: 0.7, duration: 0.6 }}
              className="text-[11px] font-bold uppercase tracking-[0.3em] mb-1"
              style={{ color: '#E2E8F0', opacity: 0.9 }}
            >
              Est. {lore.foundedYear} · Founded by {lore.founder}
            </motion.p>

            {/* Tagline */}
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, duration: 0.8, ease: "easeOut" }}
              className="text-[12px] font-black uppercase tracking-[0.45em] text-[#FFC72C]"
            >
              ★ {lore.tagline} ★
            </motion.p>

            {/* Legendary Items Row */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.2, duration: 0.6 }}
              className="flex gap-4 mt-5"
            >
              {lore.legendaryItems.map((item, i) => (
                <motion.div
                  key={item.name}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 1.3 + i * 0.12, duration: 0.4, ease: "backOut" }}
                  className="flex flex-col items-center gap-1"
                >
                  <span className="text-xl drop-shadow-[0_0_8px_rgba(255,199,44,0.5)]">{item.icon}</span>
                  <span className="text-[9px] font-black uppercase tracking-[0.15em] max-w-[65px] text-center leading-tight" style={{ color: '#FFFFFF', opacity: 0.85 }}>{item.name}</span>
                </motion.div>
              ))}
            </motion.div>

            {/* Capsule */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.8 }}
              transition={{ delay: 2.0, duration: 0.6 }}
              className="text-[10px] uppercase tracking-[0.15em] mt-5 max-w-[280px] leading-relaxed text-center"
              style={{ color: '#CBD5E1', opacity: 0.8 }}
            >
              {lore.capsule}
            </motion.p>
          </div>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* Domino's Flip Card Animation              */}
        {/* ═══════════════════════════════════════════ */}
        {logoAnimationType === 'dominos-flip' && (
          <div className="flex flex-col items-center justify-center relative">
            
            {/* Expanding blue/red shockwave */}
            <motion.div
              initial={{ scale: 0.65, opacity: 0, border: "2px solid #006491" }}
              animate={{ scale: [0.65, 1.45], opacity: [0, 0.6, 0] }}
              transition={{ delay: 0.3, duration: 1.6, ease: "easeOut", repeat: Infinity, repeatDelay: 0.4 }}
              className="absolute w-60 h-60 rounded-full pointer-events-none"
              style={{ boxShadow: "0 0 20px rgba(0,100,145,0.3)" }}
            />

            {/* Flipping 3D Domino */}
            <motion.div
              initial={{ rotateX: 0, rotateY: 0, rotateZ: -180, scale: 0 }}
              animate={{ 
                rotateX: [360, 720, 720],
                rotateY: [180, 540, 720],
                rotateZ: 0,
                scale: 1 
              }}
              transition={{ 
                duration: 1.3,
                times: [0, 0.7, 1.0],
                ease: "easeInOut"
              }}
              className="relative w-32 h-32 mb-5 filter drop-shadow-[0_0_40px_rgba(0,100,145,0.6)]"
            >
              <SafeImage
                src={logoUrl}
                alt="Domino's logo"
                fill
                style={{ objectFit: 'contain' }}
              />
            </motion.div>

            {/* Cinematic Title Entrance */}
            <motion.h2
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.8, duration: 0.4 }}
              className="text-3xl font-black text-[#006491] tracking-[0.1em] uppercase font-sans flex items-center gap-2"
              style={{ textShadow: "0 0 30px rgba(0,100,145,0.3)" }}
            >
              Domino&apos;s <span className="text-[#E31B23]">Pizza</span>
            </motion.h2>

            {/* Founder Caption */}
            <motion.p
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 0.9, y: 0 }}
              transition={{ delay: 0.95, duration: 0.5 }}
              className="text-[11px] font-bold uppercase tracking-[0.3em] mt-2"
              style={{ color: '#E2E8F0', opacity: 0.9 }}
            >
              Est. {lore.foundedYear} · Founded by {lore.founder}
            </motion.p>

            {/* Tagline */}
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.0, duration: 0.4 }}
              className="mt-2 text-white text-[12px] font-black uppercase tracking-[0.45em]"
            >
              🍕 {lore.tagline} 🍕
            </motion.p>

            {/* Legendary Items Row */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.4, duration: 0.6 }}
              className="flex gap-4 mt-5"
            >
              {lore.legendaryItems.map((item, i) => (
                <motion.div
                  key={item.name}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 1.5 + i * 0.12, duration: 0.4, ease: "backOut" }}
                  className="flex flex-col items-center gap-1"
                >
                  <span className="text-xl drop-shadow-[0_0_8px_rgba(0,100,145,0.5)]">{item.icon}</span>
                  <span className="text-[9px] font-black uppercase tracking-[0.15em] max-w-[65px] text-center leading-tight" style={{ color: '#FFFFFF', opacity: 0.85 }}>{item.name}</span>
                </motion.div>
              ))}
            </motion.div>

            {/* Capsule */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.8 }}
              transition={{ delay: 2.2, duration: 0.6 }}
              className="text-[10px] uppercase tracking-[0.15em] mt-5 max-w-[280px] leading-relaxed text-center"
              style={{ color: '#CBD5E1', opacity: 0.8 }}
            >
              {lore.capsule}
            </motion.p>
          </div>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* McDonald's Neon Arches Glow Animation      */}
        {/* ═══════════════════════════════════════════ */}
        {logoAnimationType === 'mcd-glow' && (
          <div className="flex flex-col items-center justify-center relative">
            
            {/* Expanding yellow shockwave */}
            <motion.div
              initial={{ scale: 0.65, opacity: 0, border: "2px solid #FFC72C" }}
              animate={{ scale: [0.65, 1.45], opacity: [0, 0.6, 0] }}
              transition={{ delay: 0.3, duration: 1.6, ease: "easeOut", repeat: Infinity, repeatDelay: 0.4 }}
              className="absolute w-60 h-60 rounded-full pointer-events-none"
              style={{ boxShadow: "0 0 20px rgba(255,199,44,0.3)" }}
            />

            {/* Glowing Golden Arches */}
            <motion.div
              initial={{ opacity: 0.1, scale: 0.8 }}
              animate={{ 
                opacity: [0.1, 0.3, 0.1, 1, 0.8, 1],
                scale: [0.8, 1.05, 1]
              }}
              transition={{ 
                duration: 1.1, 
                times: [0, 0.2, 0.4, 0.6, 0.8, 1.0],
                ease: "easeOut"
              }}
              className="relative w-36 h-36 mb-5 filter drop-shadow-[0_0_30px_rgba(255,199,44,0.7)]"
            >
              <SafeImage
                src={logoUrl}
                alt="McDonald's logo"
                fill
                style={{ objectFit: 'contain' }}
              />
            </motion.div>

            {/* Title */}
            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, duration: 0.4 }}
              className="text-3xl font-extrabold text-[#FFC72C] tracking-widest uppercase font-serif"
              style={{ textShadow: "0 0 25px rgba(255,199,44,0.5)" }}
            >
              McDonald&apos;s
            </motion.h2>

            {/* Founder Caption */}
            <motion.p
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 0.9, y: 0 }}
              transition={{ delay: 0.95, duration: 0.5 }}
              className="text-[11px] font-bold uppercase tracking-[0.3em] mt-2"
              style={{ color: '#E2E8F0', opacity: 0.9 }}
            >
              Est. {lore.foundedYear} · Founded by {lore.founder}
            </motion.p>

            {/* Tagline */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.0, duration: 0.5 }}
              className="mt-2 text-[#DA291C] text-[12px] font-black uppercase tracking-[0.45em]"
            >
              🍔 {lore.tagline} 🍔
            </motion.p>

            {/* Legendary Items Row */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.4, duration: 0.6 }}
              className="flex gap-4 mt-5"
            >
              {lore.legendaryItems.map((item, i) => (
                <motion.div
                  key={item.name}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 1.5 + i * 0.12, duration: 0.4, ease: "backOut" }}
                  className="flex flex-col items-center gap-1"
                >
                  <span className="text-xl drop-shadow-[0_0_8px_rgba(255,199,44,0.5)]">{item.icon}</span>
                  <span className="text-[9px] font-black uppercase tracking-[0.15em] max-w-[65px] text-center leading-tight" style={{ color: '#FFFFFF', opacity: 0.85 }}>{item.name}</span>
                </motion.div>
              ))}
            </motion.div>

            {/* Capsule */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.8 }}
              transition={{ delay: 2.2, duration: 0.6 }}
              className="text-[10px] uppercase tracking-[0.15em] mt-5 max-w-[280px] leading-relaxed text-center"
              style={{ color: '#CBD5E1', opacity: 0.8 }}
            >
              {lore.capsule}
            </motion.p>
          </div>
        )}
      </motion.div>

      {/* Cinematic Bright Flash Overlay on Exit */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0 }}
        exit={{ opacity: [0, 1, 1, 0] }}
        transition={{ duration: 0.6, ease: "easeInOut", times: [0, 0.2, 0.4, 1.0] }}
        className="absolute inset-0 pointer-events-none mix-blend-screen z-[10000]"
        style={{ backgroundColor: `${accentColor}33` }}
      />
    </div>
  );
}
