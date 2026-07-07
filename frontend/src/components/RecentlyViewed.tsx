"use client";
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import SafeImage from './SafeImage';
import { motion } from 'framer-motion';

interface ViewedItem {
  id: string;
  name: string;
  restaurantName?: string;
  price?: number;
  image: string;
  type: 'product' | 'restaurant';
}

const STORAGE_KEY = 'zenvy_recently_viewed';

export function saveRecentlyViewed(item: ViewedItem) {
  if (typeof window === 'undefined') return;
  
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    let items: ViewedItem[] = existing ? JSON.parse(existing) : [];
    
    // Remove if already exists and push to front
    items = items.filter(i => i.id !== item.id);
    items.unshift(item);
    
    // Keep only last 10
    items = items.slice(0, 10);
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (e) {
    console.error('Error saving recently viewed:', e);
  }
}

export default function RecentlyViewed() {
  const [items, setItems] = useState<ViewedItem[]>([]);

  useEffect(() => {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) {
      setItems(JSON.parse(existing));
    }
  }, []);

  if (items.length === 0) return null;

  return (
    <section className="mb-14">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-[9px] font-black text-primary-yellow uppercase tracking-[0.4em] mb-2 ">Memory Cache</h2>
          <p className="text-xl font-black text-white light:text-gray-900 uppercase italic">Recently Visited</p>
        </div>
        <button 
          onClick={() => {
            localStorage.removeItem(STORAGE_KEY);
            setItems([]);
          }}
          className="text-[8px] font-black uppercase tracking-widest text-white light:text-gray-900/20 hover:text-white light:text-gray-900/40 transition-colors"
        >
          Clear History
        </button>
      </div>
      
      <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 -mx-6 px-6">
        {items.map((item, idx) => (
          <motion.div 
            key={item.id + idx}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.1 }}
          >
            <Link 
              href={item.type === 'product' ? `/products/${item.id}` : `/restaurants/${item.id}`} 
              className="relative shrink-0 w-[160px] block group active:scale-95 transition-transform"
            >
              <div className="aspect-square relative rounded-3xl overflow-hidden border border-white/10 group-hover:border-primary-yellow/30 transition-colors">
                <SafeImage src={item.image} alt={item.name} fill />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent " />
                <div className="absolute bottom-3 left-3 right-3">
                   <p className="text-[9px] font-black text-white light:text-gray-900 truncate drop-shadow-md">{item.name}</p>
                </div>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
