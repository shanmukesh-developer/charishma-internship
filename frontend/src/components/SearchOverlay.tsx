"use client";
import { useState, useEffect, useRef } from 'react';
import SafeImage from './SafeImage';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { API_URL } from '@/utils/api';

interface SearchRestaurant {
  _id: string;
  name: string;
  location: string;
  imageUrl?: string;
  rating: number;
}

interface SearchMenuItem {
  _id: string;
  name: string;
  price: number;
  description?: string;
  imageUrl?: string;
  image?: string;
  restaurantId?: {
    _id: string;
    name: string;
  };
}

interface SearchResult {
  restaurants: SearchRestaurant[];
  items: SearchMenuItem[];
  isTrending?: boolean;
}

export default function SearchOverlay({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult>({ restaurants: [], items: [] });
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
  }, [isOpen]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      // Fetch even if empty to get Trending results
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/users/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data);
        }
      } catch (err) {
        console.error('[SEARCH_ERROR]', err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
          transition={{ duration: 0.4, ease: [0.19, 1, 0.22, 1] }}
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-3xl flex flex-col"
        >
          {/* Animated Mesh Background */}
          <div className="absolute inset-0 z-0 opacity-30 pointer-events-none overflow-hidden">
             <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-[#C9A84C]/20 blur-[120px] rounded-full animate-pulse" />
             <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/10 blur-[100px] rounded-full animate-pulse" style={{ animationDelay: '1s' }} />
          </div>
      {/* Header */}
      <div className="p-4 md:p-6 pt-10 md:pt-12 flex items-center gap-2 md:gap-4">
        <button onClick={onClose} className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center border border-white/10">
          <svg className="w-5 h-5 text-white light:text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search food or restaurants..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-full py-2.5 md:py-3 px-5 md:px-6 text-white light:text-gray-900 text-base md:text-lg focus:outline-none focus:ring-2 focus:ring-primary-yellow/50"
          />
          {loading && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              <div className="w-5 h-5 border-2 border-primary-yellow border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>

      {/* Results Scroll Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8 pb-32">
        {results.isTrending && (
          <div className="bg-gradient-to-r from-primary-yellow/10 to-transparent p-4 rounded-2xl border-l-4 border-primary-yellow mb-4 animate-slide-up">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary-yellow mb-1">City Pulse</p>
            <h3 className="text-sm font-black text-white light:text-gray-900">Trending in Amaravathi Central 🔥</h3>
          </div>
        )}

        {results.restaurants.length === 0 && results.items.length === 0 && query.length > 1 && !loading && (
          <div className="text-center py-20">
            <p className="text-secondary-text text-xl">No results found for &quot;{query}&quot; 😕</p>
          </div>
        )}

        {/* Restaurants Section */}
        {results.restaurants.length > 0 && (
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-secondary-text mb-4">Restaurants</h3>
            <div className="grid grid-cols-1 gap-4">
              {results.restaurants.map((res) => (
                <Link key={res._id} href={`/restaurants/${res._id}`} onClick={onClose} className="bg-white/5 border border-white/5 p-4 rounded-3xl flex items-center gap-4 hover:bg-white/10 transition-all">
                  <div className="w-16 h-16 relative flex-shrink-0 rounded-2xl overflow-hidden">
                    <SafeImage
                      src={res.imageUrl}
                      alt={res.name}
                      fill
                    />
                  </div>
                  <div>
                    <h4 className="font-bold text-white light:text-gray-900 text-lg">{res.name}</h4>
                    <p className="text-secondary-text text-xs uppercase tracking-wider">⭐ {res.rating} • {res.location}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Menu Items Section */}
        {results.items.length > 0 && (
          <div>
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-secondary-text mb-4">Dishes</h3>
            <div className="grid grid-cols-1 gap-4">
              {results.items.map((item) => (
                <Link key={item._id} href={`/products/${item._id}`} onClick={onClose} className="bg-white/5 border border-white/5 p-4 rounded-3xl flex items-center gap-4 hover:bg-white/10 transition-all">
                  <div className="w-16 h-16 relative flex-shrink-0 rounded-2xl overflow-hidden">
                    <SafeImage
                      src={item.image || item.imageUrl}
                      alt={item.name}
                      fill
                    />
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <h4 className="font-bold text-white light:text-gray-900">{item.name}</h4>
                      <span className="text-primary-yellow font-black">₹{item.price}</span>
                    </div>
                    <p className="text-secondary-text text-xs overflow-hidden text-ellipsis line-clamp-1">{item.description}</p>
                    <p className="text-[10px] font-black uppercase text-secondary-text mt-1">From {item.restaurantId?.name || 'Unknown'}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Default Suggestions / Trending (Optional) */}
        {query.length <= 1 && (
          <div className="space-y-6">
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-secondary-text">Popular Searches</h3>
            <div className="flex flex-wrap gap-2">
              {['Biryani', 'Burger', 'Pizza', 'Milkshake', 'Domino', 'Chinese'].map(tag => (
                <button
                  key={tag}
                  onClick={() => setQuery(tag)}
                  className="px-6 py-2 bg-white/5 border border-white/10 rounded-full text-sm text-white light:text-gray-900 hover:bg-primary-yellow hover:text-black transition-all"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )}
</AnimatePresence>
  );
}

