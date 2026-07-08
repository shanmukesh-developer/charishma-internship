"use client";
import React, { useState, useMemo, useEffect } from 'react';
import { playSensoryFeedback } from '@/utils/sensory';
import { motion, AnimatePresence } from 'framer-motion';
import Tilt from '@/components/Tilt';
import SafeImage from './SafeImage';
import { Restaurant, NexusItem } from '@/types';

interface NexusExplorerProps {
  restaurants: Restaurant[];
  onSelectItem: (item: NexusItem) => void;
  favorites: string[];
  toggleFavorite: (id: string) => void;
}

export default function NexusExplorer({ restaurants, onSelectItem, favorites, toggleFavorite }: NexusExplorerProps) {
  const [activeFilter, setActiveFilter] = useState<'all' | 'veg' | 'jain'>('all');
  const [activeSort, setActiveSort] = useState<'recommended' | 'rating' | 'fastest'>('recommended');
  const [activeCategory, setActiveCategory] = useState<string>('Biryani');
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [sortValue, setSortValue] = useState('default');

  useEffect(() => {
    const handleCategoryChange = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail) {
        setActiveCategory(customEvent.detail);
      }
    };
    window.addEventListener('change-nexus-category', handleCategoryChange);
    return () => window.removeEventListener('change-nexus-category', handleCategoryChange);
  }, []);

  const CATEGORIES = [
    { emoji: '🍛', label: 'Biryani' },
    { emoji: '🍕', label: 'Pizza' },
    { emoji: '🥗', label: 'South Indian' },
    { emoji: '🍔', label: 'Burgers' },
    { emoji: '🥤', label: 'Drinks' },
    { emoji: '🍜', label: 'Chinese' },
  ];

  const filteredItems = useMemo(() => {
    // Collect all items from all restaurants
    const allItems = restaurants.flatMap(res => 
      (res.menu || []).map(item => {
        // Strict Veg parsing to prevent string "false" bugs
        const isVeg = item.isVegetarian === true || 
                      String(item.isVegetarian).toLowerCase() === 'true' || 
                      Number(item.isVegetarian) === 1 || 
                      item.tags?.includes('veg') || 
                      item.tags?.includes('fruits');

        return {
          ...item,
          isVegetarian: isVeg,
          restaurantName: res.name,
          restaurantId: res._id || res.id,
          rating: Number(res.rating) || 4.2,
        };
      })
    );

    return allItems.filter(item => {
      const matchesCategory = item.category?.toLowerCase().includes(activeCategory.toLowerCase()) || 
                             item.tags?.some((t: string) => t.toLowerCase().includes(activeCategory.toLowerCase())) ||
                             item.name?.toLowerCase().includes(activeCategory.toLowerCase());
      
      const matchesFilter = activeFilter === 'all' || 
                           (activeFilter === 'veg' && item.isVegetarian) ||
                           (activeFilter === 'jain' && item.tags?.includes('jain'));

      return matchesCategory && matchesFilter;
    }).sort((a, b) => {
      if (sortValue === 'low') return (Number(a.price) || 0) - (Number(b.price) || 0);
      if (sortValue === 'high') return (Number(b.price) || 0) - (Number(a.price) || 0);
      
      if (activeSort === 'rating') {
        return (Number(b.rating) || 0) - (Number(a.rating) || 0);
      }
      return 0;
    });
  }, [restaurants, activeCategory, activeFilter, activeSort, sortValue]);

  return (
    <div className="w-full space-y-2 pb-2">
      {/* HUD Controller Shell: Ultra-Compact */}
      <div className="flex flex-col gap-2 bg-transparent p-3">
        {/* Row 1: Filters & Sort Integrated */}
        <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide no-scrollbar py-1">
          <div className="flex gap-2">
            {[
              { id: 'all', label: 'ALL', icon: '✨' },
              { id: 'veg', label: 'PURE VEG', icon: '🥗' },
            ].map((btn) => (
              <button
                key={btn.id}
                onClick={() => { playSensoryFeedback(); setActiveFilter(btn.id as 'all' | 'veg' | 'jain'); }}
                className={`h-9 py-1 px-4 rounded-full flex items-center gap-1.5 transition-all border whitespace-nowrap ${
                  activeFilter === btn.id 
                  ? 'bg-[#EF4F5F] text-white border-[#EF4F5F] font-black shadow-sm' 
                  : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 font-bold'
                }`}
              >
                <span className="text-[10px]">{btn.icon}</span>
                <span className="text-[9px] uppercase tracking-widest">{btn.label}</span>
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-gray-300 mx-1 shrink-0" />

          <div className="flex gap-2">
            {[
              { id: 'recommended', label: 'REC', icon: '✨' },
              { id: 'rating', label: 'TOP', icon: '⭐' },
              { id: 'fastest', label: 'FAST', icon: '⚡' },
            ].map((btn) => (
              <button
                key={btn.id}
                onClick={() => { playSensoryFeedback(); setActiveSort(btn.id as 'recommended' | 'rating' | 'fastest'); }}
                className={`h-9 py-1 px-4 rounded-full flex items-center gap-1.5 transition-all border whitespace-nowrap ${
                  activeSort === btn.id 
                  ? 'bg-[#EF4F5F] text-white light:text-white border-[#EF4F5F] font-black shadow-sm' 
                  : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 font-bold'
                }`}
              >
                <span className="text-[9px] uppercase tracking-widest">{btn.label}</span>
              </button>
            ))}
          </div>
        </div>


      </div>

      {/* Main Explorer Canvas */}
      <div className="bg-transparent pt-2 md:p-8">
        <div className="flex flex-row justify-between items-center gap-2 mb-4 md:mb-6 hidden">
          <div>
             <h2 className="text-sm md:text-4xl font-black text-black italic uppercase tracking-tighter" style={{ fontFamily: "'Syne', sans-serif" }}>
               {activeCategory}
             </h2>
          </div>
          <div className="flex items-center gap-2">
              <div className="relative">
                <button 
                  onClick={() => setIsSortOpen(!isSortOpen)}
                  className="bg-white border border-gray-200 rounded-xl px-4 py-2 text-[8px] md:text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-gray-50 transition-all outline-none text-gray-900 shadow-sm"
                >
                  <span className="max-w-[80px] md:max-w-none truncate">{sortValue === 'default' ? 'Sort' : sortValue === 'low' ? 'Low' : 'High'}</span>
                  <svg className={`w-2.5 h-2.5 text-[#EF4F5F] transition-transform duration-300 ${isSortOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7" /></svg>
                </button>

                <AnimatePresence>
                  {isSortOpen && (
                    <motion.div 
                      initial={{ opacity: 0, y: 5, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 5, scale: 0.95 }}
                      className="absolute top-full right-0 mt-2 min-w-[140px] bg-white border border-gray-200 rounded-xl overflow-hidden z-50 shadow-lg"
                    >
                      {[
                        { id: 'default', label: 'Default' },
                        { id: 'low', label: 'Price: Low' },
                        { id: 'high', label: 'Price: High' }
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => {
                            setSortValue(opt.id);
                            setIsSortOpen(false);
                          }}
                          className={`w-full px-4 py-2 text-[8px] font-black uppercase tracking-widest text-left transition-colors ${
                            sortValue === opt.id 
                            ? 'bg-[#EF4F5F] text-white font-black' 
                            : 'text-gray-600 hover:bg-gray-50 hover:text-black'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
             </div>
             <button onClick={() => { setActiveFilter('all'); setActiveCategory('Biryani'); setSortValue('default'); }} className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-[8px] md:text-[10px] font-black uppercase tracking-widest text-gray-500 hover:bg-gray-50 transition-all shadow-sm">
                Clear
             </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:gap-6">
          <AnimatePresence mode="popLayout">
            {filteredItems.slice(0, 4).map((item, idx) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: idx * 0.05 }}
              >
                <Tilt scale={1.02}>
                  <div className="group relative flex flex-col gap-2 cursor-pointer"
                       onClick={() => onSelectItem(item)}>
                    
                    {/* Dish Image Tile (Square) */}
                    <div className="relative aspect-square w-full rounded-[24px] overflow-hidden bg-gray-50 shadow-sm group-hover:shadow-md transition-all duration-300">
                      <SafeImage 
                        src={item.image || item.imageUrl} 
                        alt={item.name}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      
                      {/* Compact Favorite Button */}
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (item.id || item._id) toggleFavorite((item.id || item._id)!);
                        }}
                        className="absolute top-2 right-2 w-6 h-6 md:w-7 md:h-7 rounded-full bg-white/90 backdrop-blur-sm shadow-sm flex items-center justify-center hover:scale-110 transition-transform active:scale-90 z-20"
                      >
                        <svg className={`w-3 h-3 md:w-4 md:h-4 ${(item.id && favorites.includes(item.id)) || (item._id && favorites.includes(item._id)) ? 'fill-[#EF4F5F] text-[#EF4F5F] stroke-[#EF4F5F]' : 'fill-none text-gray-500 stroke-gray-500'}`} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                          <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                        </svg>
                      </button>
                    </div>

                    {/* Minimal Text Below */}
                    <div className="flex flex-col px-1">
                      <div className="flex justify-between items-start gap-1 mb-0.5">
                        <h3 className="text-[11px] md:text-[13px] font-black text-gray-900 leading-tight group-hover:text-[#EF4F5F] transition-colors line-clamp-1">{item.name}</h3>
                        <span className="text-[11px] md:text-[13px] font-black text-[#EF4F5F] shrink-0">₹{item.price}</span>
                      </div>
                      <p className="text-[9px] font-bold text-gray-500 uppercase tracking-wider truncate">{item.restaurantName || 'Zenvy Elite'}</p>
                    </div>
                  </div>
                </Tilt>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
