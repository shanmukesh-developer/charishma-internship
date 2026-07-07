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

  // Zomato style random price for two
  const priceForTwo = Math.floor(Math.random() * (350 - 150 + 1) + 150);
  
  // Zomato style random offer
  const offers = ["50% OFF up to ₹100", "Flat ₹75 OFF", "Free Delivery", "60% OFF up to ₹120", "Buy 1 Get 1 Free"];
  const offer = offers[Math.floor(Math.random() * offers.length)];
  const hasOffer = Math.random() > 0.3; // 70% chance to have an offer

  return (
    <Link href={`/restaurants/${id}`} className="block w-full outline-none">
      <motion.div 
        whileHover={{ scale: 0.98 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => playSensoryFeedback()}
        transition={{ duration: 0.2 }}
        className="relative flex flex-col rounded-[16px] overflow-hidden bg-white light:bg-gradient-to-br light:from-white/95 light:to-white/60 light:backdrop-blur-lg shadow-[0_2px_12px_rgba(0,0,0,0.04)] border border-transparent light:border-white/40 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition-all group"
      >
        {/* Food Image Container */}
        <div className="aspect-[1.3] w-full relative overflow-hidden bg-gray-100">
          <SafeImage 
            src={imageUrl} 
            alt={name}
            fallback="/assets/placeholder_premium.png"
            fill
            className="object-cover transition-transform duration-700"
          />

          {/* Featured Badge / Promoted */}
          {isFeatured && (
            <div className="absolute top-2 left-2 z-10">
              <span className="bg-black/60 backdrop-blur-sm text-white light:text-gray-900 text-[9px] font-medium tracking-wide px-1.5 py-0.5 rounded shadow-sm">
                Promoted
              </span>
            </div>
          )}

          {/* Favorite Icon (Zomato Style Top Right Heart) */}
          <button 
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              playSensoryFeedback();
              setIsFavorite(!isFavorite);
            }}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white shadow-md flex items-center justify-center transition-all z-10 hover:scale-110 active:scale-90"
          >
            <svg className={`w-4 h-4 ${isFavorite ? 'fill-[#E23744] text-[#E23744]' : 'fill-none stroke-[#E23744]'}`} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </button>

          {/* Time Chip Overlay (Zomato Style Bottom Right) */}
          <div className="absolute bottom-2 right-2 bg-white/90 backdrop-blur-sm rounded px-1.5 py-0.5 flex items-center shadow-sm">
            <span className="text-[9px] font-bold text-gray-800">{time}</span>
          </div>
          
          {/* Discount Overlay (Zomato Style Bottom Left Blue/Red Ribbon) */}
          {hasOffer && (
            <div className="absolute bottom-2 left-0 bg-[#256fef] rounded-r text-white light:text-gray-900 px-2 py-0.5 shadow-sm">
              <span className="text-[9px] font-bold">{offer.split(' ')[0]} OFF</span>
            </div>
          )}
        </div>

        {/* Info Content Area - PURE WHITE BACKGROUND ZOMATO STYLE */}
        <div className="p-3 bg-white flex flex-col justify-between">
          
          {/* Title and Rating Row */}
          <div className="flex justify-between items-start gap-2 mb-0.5">
            <h3 className="font-bold text-[15px] leading-tight text-gray-900 line-clamp-1 truncate" style={{ fontFamily: "Inter, sans-serif" }}>
              {name}
            </h3>
            {/* Zomato Green Rating Badge */}
            <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#24963F] text-white light:text-gray-900 shrink-0 mt-0.5">
              <span className="text-[10px] font-bold leading-none">{rating}</span>
              <svg className="w-[8px] h-[8px] fill-current" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
            </div>
          </div>

          {/* Subtitle / Canteen description & Price */}
          <div className="flex justify-between items-center mb-2.5">
            <p className="text-[11px] text-gray-500 line-clamp-1 truncate">
              {canteenType}
            </p>
            <p className="text-[11px] text-gray-500 shrink-0 ml-2">
              ₹{priceForTwo} for one
            </p>
          </div>

          {/* Offer Zomato Dashed Line */}
          {hasOffer && (
            <div className="pt-2 border-t border-dashed border-gray-200 flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-full bg-blue-50 flex items-center justify-center">
                 <span className="text-[8px]">🏷️</span>
              </div>
              <span className="text-[10px] font-medium text-gray-600 line-clamp-1">{offer}</span>
            </div>
          )}
        </div>
      </motion.div>
    </Link>
  );
};

export default RestaurantCard;
