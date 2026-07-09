"use client";
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { useWorldTransition } from '@/context/WorldTransitionContext';
import { motion } from 'framer-motion';
import PromoCarousel from '@/components/PromoCarousel';
import SafeImage from '@/components/SafeImage';

import WorldSwitcher from '@/components/WorldSwitcher';
import { playSensoryFeedback } from '@/utils/sensory';

export default function OthersPage() {
  const { phase } = useWorldTransition();
  const [mounted, setMounted] = useState(false);
  const [searchPlaceholder, setSearchPlaceholder] = useState("Search the ecosystem...");
  const [timeOfDay, setTimeOfDay] = useState<'morning' | 'afternoon' | 'evening' | 'night'>('afternoon');

  useEffect(() => {
    setMounted(true);
    window.scrollTo(0, 0);

    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) setTimeOfDay('morning');
    else if (hour >= 12 && hour < 17) setTimeOfDay('afternoon');
    else if (hour >= 17 && hour < 21) setTimeOfDay('evening');
    else setTimeOfDay('night');

    const placeholders = [
      "Search for Paracetamol...",
      "Search Notebooks...",
      "Search Campus Rides...",
      "Search Gym Supplements...",
      "Search for Dry Wash..."
    ];
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % placeholders.length;
      setSearchPlaceholder(placeholders[i]);
    }, 2500);

    return () => clearInterval(interval);
  }, []);

  const topCategories = [
    { id: 'mega-basket', name: 'Mega Basket', img: '/assets/3d-basket.png' },
    { id: 'stationary', name: 'Stationary', img: '/assets/categories/stationary.png' },
    { id: 'sweets', name: 'Desserts', img: '/assets/categories/sweets.png' },
    { id: 'drinks', name: 'Beverages', img: '/assets/categories/drinks.png' },
    { id: 'pharmacy', name: 'Pharmacy', img: '/assets/categories/pharmacy.png' },
    { id: 'fruits', name: 'Fresh Fruits', img: '/assets/categories/fruits.png' },
    { id: 'gym', name: 'Gym & Protein', img: '/assets/categories/gym.png' },
    { id: 'rentals', name: 'Campus Rides', img: '/assets/categories/rides.png' },
    { id: 'laundry', name: 'Dry Wash', img: '/assets/categories/laundry.png' },
    { id: 'seasonal', name: 'Festive', img: '/assets/categories/sweets.png' }
  ];

  const trendingDeals = [
    { 
      id: 'mega-basket-deal', 
      title: 'Essentials Mega Basket', 
      desc: 'Build a custom grocery list & get delivery with live shop pricing', 
      img: '/assets/3d-basket.png', 
      tag: 'NEW SERVICE',
      urgencyBadge: '⚡ Zero Estimation Errors',
      targetTime: ['morning', 'afternoon', 'evening', 'night'],
      link: '/mega-basket' 
    },
    { 
      id: 'deal-1', 
      title: 'Midnight Cravings', 
      desc: 'Up to 20% off on late night snacks', 
      img: '/assets/categories/sweets.png', 
      tag: 'HOT',
      urgencyBadge: '🔥 45 ordered tonight',
      targetTime: ['evening', 'night'],
      link: '/category/sweets' 
    },
    { 
      id: 'deal-2', 
      title: 'Exam Season Prep', 
      desc: 'Stationary & energy drinks combo', 
      img: '/assets/categories/stationary.png', 
      tag: 'NEW',
      urgencyBadge: 'Ends in 2h',
      targetTime: ['morning', 'afternoon', 'evening', 'night'],
      link: '/category/stationary'
    },
    { 
      id: 'deal-3', 
      title: 'Healthy Living', 
      desc: 'Fresh fruits and whey supplements', 
      img: '/assets/categories/fruits.png', 
      tag: 'TRENDING',
      urgencyBadge: 'Selling Fast',
      targetTime: ['morning', 'afternoon'],
      link: '/category/gym'
    },
    { 
      id: 'deal-4', 
      title: 'Campus Commute', 
      desc: 'Book your ride for tomorrow', 
      img: '/assets/categories/rides.png', 
      tag: 'ESSENTIAL',
      urgencyBadge: 'High Demand',
      targetTime: ['evening', 'night', 'morning'],
      link: '/category/rentals'
    }
  ];

  const visibleDeals = [...trendingDeals].sort((a, b) => {
    const aMatch = a.targetTime.includes(timeOfDay) ? 1 : 0;
    const bMatch = b.targetTime.includes(timeOfDay) ? 1 : 0;
    return bMatch - aMatch;
  });

  if (!mounted) return <div className="min-h-screen bg-[#0a0a0c]" />;

  return (
    <div className={`min-h-screen bg-[#0a0a0c] light:bg-[#FAFAFA] text-white light:text-black font-sans pb-24 relative overflow-hidden ${phase === 'covering' || phase === 'uncovering' ? 'pointer-events-none' : ''}`}>
      {/* Premium subtle background glow */}
      <div className="absolute top-0 left-0 right-0 h-[500px] bg-gradient-radial from-[#C9A84C]/10 via-transparent to-transparent opacity-80 pointer-events-none" />
      
      <Navbar />

      <main className="pt-24 max-w-7xl mx-auto relative z-10">
        {/* Header Section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mb-8 px-6 flex flex-col items-center text-center mt-2"
        >
          <div className="inline-flex items-center justify-center px-4 py-1.5 rounded-full bg-white/5 border border-white/10 light:bg-white light:border-gray-100 shadow-sm mb-4">
            <span className="text-[9px] font-black text-[#C9A84C] uppercase tracking-[0.4em]">Ecosystem</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-black text-white light:text-gray-900 tracking-tighter" style={{ fontFamily: "'Syne', sans-serif" }}>
            Explore More
          </h2>
          <div className="w-12 h-1 bg-gradient-to-r from-[#C9A84C] to-transparent mt-6 rounded-full" />
        </motion.div>

        {/* 0. Global Search Bar */}
        <div className="mb-8 px-4 sm:px-6">
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="relative group max-w-2xl mx-auto"
          >
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none z-10 text-gray-500 group-focus-within:text-[#C9A84C] transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input 
              type="text" 
              placeholder={searchPlaceholder}
              className="w-full h-14 pl-12 pr-4 bg-[#141416]/80 light:bg-white backdrop-blur-xl border border-white/10 light:border-gray-100 rounded-2xl outline-none focus:border-[#C9A84C] transition-all font-bold text-white light:text-gray-800 placeholder-gray-500 shadow-lg hover:border-[#C9A84C]/50"
            />
            <div className="absolute inset-y-0 right-2 flex items-center">
              <button 
                onClick={(e) => {
                   e.preventDefault();
                   playSensoryFeedback();
                   alert("Search coming soon!");
                 }}
                className="bg-[#1a1a1c] text-[#C9A84C] text-[9px] font-black uppercase tracking-widest px-4 py-2 rounded-xl border border-[#C9A84C] hover:bg-[#C9A84C] hover:text-black transition-all shadow-[0_0_10px_rgba(201,168,76,0.3)] hover:shadow-[0_0_15px_rgba(201,168,76,0.5)] active:scale-95"
              >
                Search
              </button>
            </div>
          </motion.div>
        </div>

        {/* World Switcher (Between Search Bar and Hero Card) */}
        <div className="mb-8 px-4 sm:px-6">
          <WorldSwitcher activeWorld="food" />
        </div>

        {/* 1. Dynamic Hero Promotional Carousel */}
        <div className="mb-10 px-2 sm:px-6">
          <PromoCarousel 
            offers={[
              { 
                id: 'o1', 
                imageUrl: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?q=80&w=2070&auto=format&fit=crop', 
                tagline: 'MEGA DEAL', 
                title1: 'STATIONARY', 
                title2: 'BLOWOUT SALE', 
                description: 'FLAT 50% OFF ON ALL NOTEBOOKS AND PREMIUM PENS.', 
                buttonText: 'SHOP NOW', 
                isActive: true 
              },
              { 
                id: 'o2', 
                imageUrl: 'https://images.unsplash.com/photo-1579722820308-d74e571900a9?q=80&w=2070&auto=format&fit=crop', 
                tagline: 'FITNESS FIRST', 
                title1: 'PROTEIN', 
                title2: 'RESTOCK', 
                description: 'GET 100% AUTHENTIC WHEY. FREE SHAKER ON EVERY ORDER.', 
                buttonText: 'BROWSE SUPPLEMENTS', 
                isActive: true 
              },
              { 
                id: 'o3', 
                imageUrl: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?q=80&w=2070&auto=format&fit=crop', 
                tagline: 'CAMPUS RIDES', 
                title1: 'EASY', 
                title2: 'COMMUTE', 
                description: 'RENT CYCLES AND E-SCOOTERS FOR YOUR DAILY CLASSES.', 
                buttonText: 'BOOK A RIDE', 
                isActive: true 
              }
            ]} 
          />
        </div>

        {/* 2. Swiggy Instamart Style Grid */}
        <div className="mb-14 px-4 sm:px-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-[12px] font-black uppercase tracking-[0.2em] text-[#C9A84C] light:text-gray-800">Shop by Department</h3>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-y-8 gap-x-2">
            {topCategories.map((cat, index) => (
              <Link href={cat.id === 'mega-basket' ? '/mega-basket' : `/category/${cat.id}`} key={cat.id} className="flex flex-col items-center gap-2 group">
                <motion.div 
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4, delay: 0.1 + (index * 0.03) }}
                  className="w-[64px] h-[64px] sm:w-[80px] sm:h-[80px] rounded-2xl overflow-hidden bg-white/5 light:bg-white border border-white/10 light:border-gray-100 group-hover:border-[#C9A84C] transition-all shadow-lg group-hover:shadow-[0_0_20px_rgba(201,168,76,0.15)] group-hover:-translate-y-1 relative p-2"
                >
                  <div className="w-full h-full rounded-xl overflow-hidden relative">
                    <SafeImage src={cat.img} alt={cat.name} fill style={{ objectFit: 'cover' }} className="group-hover:scale-110 transition-transform duration-700" />
                  </div>
                </motion.div>
                <span className="text-[10px] sm:text-[11px] font-extrabold text-gray-400 group-hover:text-white light:text-gray-600 light:group-hover:text-black transition-colors text-center w-full leading-tight line-clamp-2 px-1">{cat.name}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* 3. Trending Services Deal Grid (Amazon/Flipkart Style) */}
        <div className="px-6 mb-16">
           <div className="flex items-center justify-between mb-6">
             <h3 className="text-[12px] font-black uppercase tracking-[0.2em] text-[#C9A84C] light:text-gray-800">Trending Collections</h3>
           </div>
           <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
             {visibleDeals.map((deal, index) => (
               <motion.div
                 key={deal.id}
                 initial={{ opacity: 0, y: 20 }}
                 animate={{ opacity: 1, y: 0 }}
                 transition={{ duration: 0.4, delay: 0.2 + (index * 0.1) }}
               >
                 <Link href={deal.link} className="block group relative rounded-[32px] overflow-hidden bg-[#141416]/80 light:bg-white border border-white/10 light:border-gray-100 shadow-lg hover:border-[#C9A84C] hover:shadow-[0_0_30px_rgba(201,168,76,0.2)] hover:-translate-y-1 transition-all duration-500 h-[260px]">
                   <div className="absolute inset-0 z-0">
                     <SafeImage src={deal.img} alt={deal.title} fill style={{ objectFit: 'cover' }} className="group-hover:scale-105 transition-transform duration-700 opacity-80 group-hover:opacity-100" />
                   </div>
                   <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0c]/90 via-[#0a0a0c]/40 to-transparent z-10" />
                   
                   <div className="absolute top-5 left-5 z-20 flex gap-2">
                     <span className="px-4 py-1.5 bg-[#141416]/60 backdrop-blur-md rounded-full text-[9px] font-black uppercase tracking-[0.2em] text-[#C9A84C] border border-[#C9A84C]/50 shadow-lg">
                       {deal.tag}
                     </span>
                     {deal.urgencyBadge && (
                       <span className="px-4 py-1.5 bg-[#EF4F5F] backdrop-blur-md rounded-full text-[9px] font-black uppercase tracking-widest text-white shadow-[0_0_15px_rgba(239,79,95,0.4)] animate-pulse">
                         {deal.urgencyBadge}
                       </span>
                     )}
                   </div>
                   
                   <div className="absolute bottom-0 left-0 right-0 p-6 z-20">
                     <h4 className="text-2xl font-black text-white leading-tight mb-1.5" style={{ fontFamily: "'Syne', sans-serif" }}>{deal.title}</h4>
                     <p className="text-[11px] font-bold text-gray-300 uppercase tracking-widest">{deal.desc}</p>
                     
                     <div className="mt-5 flex items-center justify-between overflow-hidden">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A84C]/80 group-hover:text-[#C9A84C] transition-colors flex items-center gap-2 transform translate-y-8 group-hover:translate-y-0 duration-300">
                          Explore Collection
                          <div className="w-8 h-8 rounded-full bg-[#C9A84C] flex items-center justify-center text-black">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7" /></svg>
                          </div>
                        </span>
                     </div>
                   </div>
                 </Link>
               </motion.div>
             ))}
           </div>
        </div>

        {/* 4. Trust & Social Proof Footer */}
        <div className="px-6 mb-10 pt-10 border-t border-white/10 light:border-gray-200/60 flex flex-col items-center justify-center text-center opacity-80">
          <div className="flex gap-4 mb-4">
            <span className="text-2xl drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">🎓</span>
            <span className="text-2xl drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">⚡</span>
            <span className="text-2xl drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">🛡️</span>
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#C9A84C] mb-2">Trusted by 5,000+ Students Daily</p>
          <p className="text-[9px] font-bold text-gray-500 max-w-sm">Secure payments, verified riders, and top quality campus essentials delivered on time.</p>
        </div>

      </main>
    </div>
  );
}
