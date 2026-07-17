"use client";
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import SafeImage from './SafeImage';
import { playSensoryFeedback } from '@/utils/sensory';

interface RestaurantCardProps {
  id: string;
  name: string;
  rating: string;
  time: string;
  imageUrl: string;
  imagePosition?: 'left' | 'right';
  isFeatured?: boolean;
  featuredBadge?: string;
  canteenType?: string;
}

const RestaurantCard = ({ 
  id,
  name, 
  rating, 
  time, 
  imageUrl, 
  isFeatured, 
  featuredBadge,
  canteenType = "North Indian, Fast Food"
}: RestaurantCardProps) => {
  const [isFavorite, setIsFavorite] = useState(false);

  // Stable pseudo-random seed to prevent hydration mismatches
  const seed = (name || '').length + (id || '').charCodeAt(0) + (id || '').charCodeAt((id || '').length - 1 || 0);
  const priceForTwo = 150 + (seed * 7) % 201;
  const offers = ["50% OFF up to ₹100", "Flat ₹75 OFF", "Free Delivery", "60% OFF up to ₹120", "Buy 1 Get 1 Free"];
  const offer = offers[seed % offers.length];
  const hasOffer = (seed % 10) < 7;

  return (
    <Link href={`/restaurants/${id}`} className="block w-full outline-none">
      <motion.div 
        whileHover={{ y: -6 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        onClick={() => playSensoryFeedback()}
        className="relative flex flex-col rounded-2xl overflow-hidden bg-white dark:bg-zinc-900 shadow-[0_4px_20px_rgba(0,0,0,0.04)] border border-slate-100 dark:border-zinc-800/80 hover:shadow-[0_12px_30px_rgba(0,0,0,0.12)] dark:hover:shadow-[0_12px_30px_rgba(0,0,0,0.4)] transition-all duration-300 group"
      >
        {/* Food Image Container */}
        <div className="aspect-[4/3] w-full relative overflow-hidden bg-slate-100 dark:bg-zinc-800">
          <SafeImage 
            src={imageUrl} 
            alt={name}
            fallback="/assets/placeholder_premium.png"
            fill
            className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
          />

          {/* Gradient Overlay for text readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-60" />

          {/* Featured / Promoted Badge */}
          {isFeatured && (
            <div className="absolute top-3 left-3 z-10">
              <span className="bg-black/60 dark:bg-black/80 backdrop-blur-md text-white text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-md shadow-sm border border-white/10">
                PROMOTED
              </span>
            </div>
          )}

          {/* Favorite Icon */}
          <button 
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              playSensoryFeedback();
              setIsFavorite(!isFavorite);
            }}
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/80 dark:bg-black/60 backdrop-blur-md shadow-sm border border-white/20 dark:border-white/10 flex items-center justify-center transition-all z-10 hover:scale-110 active:scale-90 hover:bg-white dark:hover:bg-black"
          >
            <svg className={`w-4.5 h-4.5 transition-colors duration-300 ${isFavorite ? 'fill-[#FF385C] text-[#FF385C]' : 'fill-none stroke-gray-600 dark:stroke-gray-300'}`} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </button>

          {/* Time Chip Overlay */}
          <div className="absolute bottom-3 right-3 bg-black/65 backdrop-blur-md rounded-lg px-2 py-1 flex items-center shadow-sm border border-white/10">
            <span className="text-[10px] font-bold text-white tracking-wide">{time}</span>
          </div>
          
          {/* Discount Overlay */}
          {hasOffer && (
            <div className="absolute bottom-3 left-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-2.5 py-1 rounded-lg shadow-md border border-emerald-400/20">
              <span className="text-[10px] font-black tracking-wide uppercase">
                {offer.includes('%') ? offer.split(' ')[0] : (offer.includes('Flat') ? 'FLAT OFF' : 'BOGO')}
              </span>
            </div>
          )}
        </div>

        {/* Info Content Area */}
        <div className="p-3 bg-white dark:bg-zinc-900 flex flex-col justify-between flex-1">
          
          {/* Title and Rating Row */}
          <div className="flex justify-between items-center gap-2 mb-1.5">
            <h3 className="font-bold text-sm tracking-tight text-slate-800 dark:text-zinc-100 line-clamp-1 truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors duration-200" style={{ fontFamily: "Inter, sans-serif" }}>
              {name}
            </h3>
            {/* Emerald Rating Badge */}
            <div className="flex items-center gap-0.5 px-2 py-0.5 rounded-lg bg-emerald-600 text-white shrink-0 shadow-sm shadow-emerald-600/10">
              <span className="text-[10px] font-black leading-none">{rating}</span>
              <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
            </div>
          </div>

          {/* Subtitle / Canteen description & Price */}
          <div className="flex justify-between items-center mb-2.5">
            <p className="text-xs text-slate-500 dark:text-zinc-400 line-clamp-1 truncate flex-1 mr-2">
              {canteenType}
            </p>
            <p className="text-xs font-bold text-slate-700 dark:text-zinc-300 shrink-0">
              ₹{priceForTwo} <span className="text-[10px] font-normal text-slate-400">for two</span>
            </p>
          </div>

          {/* Offer Banner */}
          {hasOffer && (
            <div className="pt-2.5 border-t border-dashed border-slate-100 dark:border-zinc-800/60 flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center shrink-0">
                 <span className="text-xs">🏷️</span>
              </div>
              <span className="text-[10px] font-semibold text-slate-600 dark:text-zinc-400 line-clamp-1 truncate leading-none">{offer}</span>
            </div>
          )}
        </div>
      </motion.div>
    </Link>
  );
};

export default RestaurantCard;
