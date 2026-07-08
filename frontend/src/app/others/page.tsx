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
    <div className={`min-h-screen bg-white text-black font-sans pb-24 ${phase === 'covering' || phase === 'uncovering' ? 'pointer-events-none' : ''}`}>
      <Navbar />

      <main className="pt-24 max-w-7xl mx-auto">
        {/* Header Section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mb-6 px-6"
        >
          <h2 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.4em] mb-1">Ecosystem</h2>
          <p className="text-3xl font-black text-black tracking-tight">Explore More</p>
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
        <div className="mb-12 px-2 sm:px-6">
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-500 mb-5 px-4">Categories</h3>
          <div className="flex gap-5 overflow-x-auto scrollbar-hide pb-4 px-4 snap-x">
            {topCategories.map((cat, index) => (
              <Link href={`/category/${cat.id}`} key={cat.id} className="flex flex-col items-center gap-3 shrink-0 snap-start group">
                <motion.div 
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4, delay: 0.1 + (index * 0.05) }}
                  className="w-[72px] h-[72px] sm:w-[88px] sm:h-[88px] rounded-full overflow-hidden border-2 border-transparent group-hover:border-black transition-all shadow-[0_4px_12px_rgba(0,0,0,0.05)] group-hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)] bg-gray-50 relative"
                >
                  <SafeImage src={cat.img} alt={cat.name} fill style={{ objectFit: 'cover' }} className="group-hover:scale-110 transition-transform duration-500" />
                </motion.div>
                <span className="text-[10px] sm:text-[11px] font-bold text-gray-600 group-hover:text-black transition-colors text-center w-full leading-tight">{cat.name}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* 3. Trending Services Deal Grid (Amazon/Flipkart Style) */}
        <div className="px-6 mb-16">
           <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-500 mb-5">Trending Collections</h3>
           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
             {trendingDeals.map((deal, index) => (
               <motion.div
                 key={deal.id}
                 initial={{ opacity: 0, y: 20 }}
                 animate={{ opacity: 1, y: 0 }}
                 transition={{ duration: 0.4, delay: 0.2 + (index * 0.1) }}
               >
                 <Link href={deal.link} className="block group relative rounded-[28px] overflow-hidden bg-gray-50 border border-gray-100 shadow-sm hover:shadow-2xl transition-all duration-300 h-[220px]">
                   <div className="absolute inset-0 z-0">
                     <SafeImage src={deal.img} alt={deal.title} fill style={{ objectFit: 'cover' }} className="group-hover:scale-105 transition-transform duration-700 opacity-90 group-hover:opacity-100" />
                   </div>
                   <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent z-10" />
                   
                   <div className="absolute top-4 left-4 z-20">
                     <span className="px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-[9px] font-black uppercase tracking-widest text-white border border-white/20">
                       {deal.tag}
                     </span>
                   </div>
                   
                   <div className="absolute bottom-5 left-5 right-5 z-20">
                     <h4 className="text-xl font-black text-white leading-tight mb-1">{deal.title}</h4>
                     <p className="text-[11px] font-bold text-gray-300 uppercase tracking-wider">{deal.desc}</p>
                     
                     <div className="mt-4 flex items-center justify-between opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                        <span className="text-[10px] font-black uppercase tracking-widest text-white">Explore Collection</span>
                        <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-black">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7" /></svg>
                        </div>
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
