"use client";
import { useState, useMemo } from 'react';
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
      <div className="flex flex-col gap-2 bg-white/[0.02] border border-white/5 p-3 rounded-[24px]">
        {/* Row 1: Filters & Sort Integrated */}
        <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide no-scrollbar py-1">
          <div className="flex gap-2">
            {[
              { id: 'all', label: 'ALL', icon: '✨' },
              { id: 'veg', label: 'PURE VEG', icon: '🥗' },
            ].map((btn) => (
              <button
                key={btn.id}
                onClick={() => setActiveFilter(btn.id as 'all' | 'veg' | 'jain')}
                className={`h-9 py-1 px-4 px-3 rounded-xl flex items-center gap-1.5 transition-all border whitespace-nowrap ${
                  activeFilter === btn.id 
                  ? 'bg-primary-yellow text-black border-primary-yellow font-black' 
                  : 'bg-white/5 border-white/10 text-white/40'
                }`}
              >
                <span className="text-[10px]">{btn.icon}</span>
                <span className="text-[9px] uppercase tracking-widest">{btn.label}</span>
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-white/10 mx-1 shrink-0" />

          <div className="flex gap-2">
            {[
              { id: 'recommended', label: 'REC', icon: '✨' },
              { id: 'rating', label: 'TOP', icon: '⭐' },
              { id: 'fastest', label: 'FAST', icon: '⚡' },
            ].map((btn) => (
              <button
                key={btn.id}
                onClick={() => setActiveSort(btn.id as 'recommended' | 'rating' | 'fastest')}
                className={`h-9 py-1 px-4 px-3 rounded-xl flex items-center gap-1.5 transition-all border whitespace-nowrap ${
                  activeSort === btn.id 
                  ? 'bg-white text-black border-white font-black' 
                  : 'bg-white/5 border-white/10 text-white/40'
                }`}
              >
                <span className="text-[9px] uppercase tracking-widest">{btn.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Categories (Minified) */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide no-scrollbar py-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.label}
              onClick={() => setActiveCategory(cat.label)}
              className={`h-9 py-1 px-4 px-4 rounded-xl flex items-center gap-2 transition-all border shrink-0 ${
                activeCategory === cat.label 
                ? 'bg-primary-yellow/20 text-primary-yellow border-primary-yellow/40 font-black' 
                : 'bg-white/5 border-white/10 text-white/40'
              }`}
            >
              <span className="text-xs">{cat.emoji}</span>
              <span className="text-[9px] uppercase tracking-tighter">{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Explorer Canvas */}
      <div className="bg-[#141416]/50 backdrop-blur-3xl p-3 md:p-8 rounded-[24px] md:rounded-[48px] border border-white/5">
        <div className="flex flex-row justify-between items-center gap-2 mb-4 md:mb-6">
          <div>
             <h2 className="text-sm md:text-4xl font-black text-white italic uppercase tracking-tighter" style={{ fontFamily: "'Syne', sans-serif" }}>
               {activeCategory}
             </h2>
          </div>
          <div className="flex items-center gap-2">
             <div className="relative">
                <button 
                  onClick={() => setIsSortOpen(!isSortOpen)}
                  className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-[8px] md:text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-white/10 transition-all outline-none"
                >
                  <span className="max-w-[80px] md:max-w-none truncate">{sortValue === 'default' ? 'Sort' : sortValue === 'low' ? 'Low' : 'High'}</span>
                  <svg className={`w-2.5 h-2.5 text-primary-yellow transition-transform duration-300 ${isSortOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7" /></svg>
                </button>

                <AnimatePresence>
                  {isSortOpen && (
                    <motion.div 
                      initial={{ opacity: 0, y: 5, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 5, scale: 0.95 }}
                      className="absolute top-full right-0 mt-2 min-w-[140px] bg-[#1A1A1C] border border-white/10 rounded-xl overflow-hidden z-50 shadow-3xl backdrop-blur-3xl"
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
                            sortValue === opt.id ? 'bg-primary-yellow text-black' : 'text-white/40 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
             </div>
             <button className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-[8px] md:text-[10px] font-black uppercase tracking-widest text-secondary-text hover:bg-white/10 transition-all">
                Clear
             </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <AnimatePresence mode="popLayout">
            {filteredItems.slice(0, 4).map((item, idx) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: idx * 0.05 }}
              >
                <Tilt scale={1.03}>
                  <div className="group relative bg-white/[0.02] border border-white/5 rounded-[20px] md:rounded-[48px] p-2 md:p-6 hover:bg-white/[0.04] hover:border-white/10 transition-all duration-500 overflow-hidden cursor-pointer"
                       onClick={() => onSelectItem(item)}>
                    
                    {/* Image Hub */}
                    <div className="relative h-32 md:h-64 w-full rounded-[16px] md:rounded-[36px] overflow-hidden mb-3 md:mb-6 border border-white/5">
                      <SafeImage 
                        src={item.image || item.imageUrl} 
                        alt={item.name}
                        fill
                        className="object-cover group-hover:scale-110 transition-transform duration-700"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
                      
                      {/* Favorite Button */}
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (item.id || item._id) toggleFavorite((item.id || item._id)!);
                        }}
                        className="absolute top-6 right-6 w-12 h-12 rounded-full bg-black/40 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white/40 hover:text-red-500 transition-all active:scale-90"
                      >
                        <svg className={`w-5 h-5 ${(item.id && favorites.includes(item.id)) || (item._id && favorites.includes(item._id)) ? 'fill-red-500 text-red-500' : 'fill-none'}`} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                          <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                        </svg>
                      </button>
                    </div>

                    <div className="flex justify-between items-start pt-1">
                      <div>
                        <h3 className="text-[11px] md:text-xl font-black text-white leading-none mb-0.5 group-hover:text-primary-yellow transition-colors">{item.name}</h3>
                        <p className="text-[6px] md:text-[9px] font-black text-secondary-text uppercase tracking-widest">{item.restaurantName || 'Zenvy Elite Node'}</p>
                      </div>
                      <div className="text-right">
                         <span className="text-[11px] md:text-xl font-black text-primary-yellow">₹{item.price}</span>
                      </div>
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
