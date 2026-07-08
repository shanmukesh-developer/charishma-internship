"use client";
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { useWorldTransition } from '@/context/WorldTransitionContext';
import { motion } from 'framer-motion';
import PromoCarousel from '@/components/PromoCarousel';
import SafeImage from '@/components/SafeImage';

export default function OthersPage() {
  const { phase } = useWorldTransition();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    window.scrollTo(0, 0);
  }, []);

  const topCategories = [
    { id: 'stationary', name: 'Stationary', img: 'https://images.unsplash.com/photo-1531346878377-a5447cb02621?q=80&w=200&auto=format&fit=crop' },
    { id: 'sweets', name: 'Desserts', img: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?q=80&w=200&auto=format&fit=crop' },
    { id: 'drinks', name: 'Beverages', img: 'https://images.unsplash.com/photo-1461023058943-0708e58231cb?q=80&w=200&auto=format&fit=crop' },
    { id: 'pharmacy', name: 'Pharmacy', img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ad?q=80&w=200&auto=format&fit=crop' },
    { id: 'fruits', name: 'Fresh Fruits', img: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6faa6?q=80&w=200&auto=format&fit=crop' },
    { id: 'gym', name: 'Gym & Protein', img: 'https://images.unsplash.com/photo-1579722820308-d74e571900a9?q=80&w=200&auto=format&fit=crop' },
    { id: 'rentals', name: 'Campus Rides', img: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?q=80&w=200&auto=format&fit=crop' },
    { id: 'laundry', name: 'Dry Wash', img: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?q=80&w=200&auto=format&fit=crop' },
    { id: 'seasonal', name: 'Festive', img: 'https://images.unsplash.com/photo-1605493725791-318e874959db?q=80&w=200&auto=format&fit=crop' }
  ];

  const trendingDeals = [
    { 
      id: 'deal-1', 
      title: 'Midnight Cravings', 
      desc: 'Up to 20% off on late night snacks', 
      img: 'https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?q=80&w=600&auto=format&fit=crop', 
      tag: 'HOT',
      link: '/category/sweets' 
    },
    { 
      id: 'deal-2', 
      title: 'Exam Season Prep', 
      desc: 'Stationary & energy drinks combo', 
      img: 'https://images.unsplash.com/photo-1517842645767-c639042777db?q=80&w=600&auto=format&fit=crop', 
      tag: 'NEW',
      link: '/category/stationary'
    },
    { 
      id: 'deal-3', 
      title: 'Healthy Living', 
      desc: 'Fresh fruits and whey supplements', 
      img: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?q=80&w=600&auto=format&fit=crop', 
      tag: 'TRENDING',
      link: '/category/gym'
    },
    { 
      id: 'deal-4', 
      title: 'Campus Commute', 
      desc: 'Book your ride for tomorrow', 
      img: 'https://images.unsplash.com/photo-1595821927361-4238421d7baa?q=80&w=600&auto=format&fit=crop', 
      tag: 'ESSENTIAL',
      link: '/category/rentals'
    }
  ];

  if (!mounted) return <div className="min-h-screen bg-white" />;

  return (
    <div className={`min-h-screen bg-[#FAFAFA] text-black font-sans pb-24 relative overflow-hidden ${phase === 'covering' || phase === 'uncovering' ? 'pointer-events-none' : ''}`}>
      {/* Premium subtle background glow */}
      <div className="absolute top-0 left-0 right-0 h-[500px] bg-gradient-radial from-orange-50/50 via-transparent to-transparent opacity-80 pointer-events-none" />
      
      <Navbar />

      <main className="pt-24 max-w-7xl mx-auto relative z-10">
        {/* Header Section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mb-8 px-6 flex flex-col items-center text-center mt-2"
        >
          <div className="inline-flex items-center justify-center px-4 py-1.5 rounded-full bg-white border border-gray-100 shadow-[0_2px_10px_rgba(0,0,0,0.03)] mb-4">
            <span className="text-[9px] font-black text-gray-500 uppercase tracking-[0.4em]">Ecosystem</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-black text-gray-900 tracking-tighter" style={{ fontFamily: "'Syne', sans-serif" }}>
            Explore More
          </h2>
          <div className="w-12 h-1 bg-gradient-to-r from-gray-200 via-gray-400 to-gray-200 mt-6 rounded-full" />
        </motion.div>

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

        {/* 2. Swiggy/Zomato Style Circular Quick-Links */}
        <div className="mb-14 px-2 sm:px-6">
          <div className="flex items-center justify-between px-4 mb-6">
            <h3 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-800">Premium Categories</h3>
            <span className="text-[10px] font-bold text-gray-400 tracking-widest cursor-pointer hover:text-black transition-colors">SEE ALL</span>
          </div>
          <div className="flex gap-6 overflow-x-auto scrollbar-hide pb-6 px-4 snap-x">
            {topCategories.map((cat, index) => (
              <Link href={`/category/${cat.id}`} key={cat.id} className="flex flex-col items-center gap-3.5 shrink-0 snap-start group">
                <motion.div 
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4, delay: 0.1 + (index * 0.05) }}
                  className="w-[76px] h-[76px] sm:w-[96px] sm:h-[96px] rounded-full overflow-hidden border border-gray-100 group-hover:border-transparent transition-all shadow-[0_4px_16px_rgba(0,0,0,0.03)] group-hover:shadow-[0_12px_28px_rgba(0,0,0,0.12)] bg-white relative p-1"
                >
                  <div className="w-full h-full rounded-full overflow-hidden relative">
                    <SafeImage src={cat.img} alt={cat.name} fill style={{ objectFit: 'cover' }} className="group-hover:scale-110 transition-transform duration-700" />
                  </div>
                </motion.div>
                <span className="text-[11px] sm:text-[12px] font-extrabold text-gray-600 group-hover:text-black transition-colors text-center w-full leading-tight">{cat.name}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* 3. Trending Services Deal Grid (Amazon/Flipkart Style) */}
        <div className="px-6 mb-16">
           <div className="flex items-center justify-between mb-6">
             <h3 className="text-[12px] font-black uppercase tracking-[0.2em] text-gray-800">Trending Collections</h3>
           </div>
           <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
             {trendingDeals.map((deal, index) => (
               <motion.div
                 key={deal.id}
                 initial={{ opacity: 0, y: 20 }}
                 animate={{ opacity: 1, y: 0 }}
                 transition={{ duration: 0.4, delay: 0.2 + (index * 0.1) }}
               >
                 <Link href={deal.link} className="block group relative rounded-[32px] overflow-hidden bg-white border border-gray-100 shadow-[0_8px_24px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_40px_rgba(0,0,0,0.12)] hover:-translate-y-1 transition-all duration-500 h-[260px]">
                   <div className="absolute inset-0 z-0">
                     <SafeImage src={deal.img} alt={deal.title} fill style={{ objectFit: 'cover' }} className="group-hover:scale-105 transition-transform duration-700 opacity-95 group-hover:opacity-100" />
                   </div>
                   <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent z-10" />
                   
                   <div className="absolute top-5 left-5 z-20">
                     <span className="px-4 py-1.5 bg-white/20 backdrop-blur-md rounded-full text-[9px] font-black uppercase tracking-[0.2em] text-white border border-white/30 shadow-[0_4px_12px_rgba(0,0,0,0.1)]">
                       {deal.tag}
                     </span>
                   </div>
                   
                   <div className="absolute bottom-0 left-0 right-0 p-6 z-20 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
                     <h4 className="text-2xl font-black text-white leading-tight mb-1.5" style={{ fontFamily: "'Syne', sans-serif" }}>{deal.title}</h4>
                     <p className="text-[11px] font-bold text-gray-300 uppercase tracking-widest">{deal.desc}</p>
                     
                     <div className="mt-5 flex items-center justify-between overflow-hidden">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/90 group-hover:text-white transition-colors flex items-center gap-2 transform translate-y-8 group-hover:translate-y-0 duration-300">
                          Explore Collection
                          <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-black">
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

      </main>
    </div>
  );
}
