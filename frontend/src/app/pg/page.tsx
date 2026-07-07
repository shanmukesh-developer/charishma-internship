"use client";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import Navbar from '@/components/Navbar';
import { API_URL } from '@/utils/api';
import Link from 'next/link';

interface Room {
  id: string;
  sharingType: number;
  availableBeds: number;
  roomNumber: string;
  pricePerBed: number;
  hasAC: boolean;
  hasAttachedBathroom: boolean;
}

interface PG {
  id: string;
  name: string;
  address: string;
  genderType: string;
  distanceFromCollege: number;
  baseRent: number;
  securityDeposit: number;
  description: string;
  amenities: string[];
  images: string[];
  rooms?: Room[];
}

export default function PGPage() {
  const router = useRouter();
  const [pgs, setPgs] = useState<PG[]>([]);
  const [filteredPgs, setFilteredPgs] = useState<PG[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [genderFilter, setGenderFilter] = useState('All'); // 'All', 'Boys', 'Girls', 'Co-ed'
  const [maxPrice, setMaxPrice] = useState(15000);
  const [maxDistance, setMaxDistance] = useState(6);
  const [sortBy, setSortBy] = useState('distance'); // 'distance', 'rent-asc', 'rent-desc'

  // Carousel active image indices per PG ID
  const [carouselIndices, setCarouselIndices] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchPGs();
  }, []);

  const fetchPGs = async () => {
    try {
      const res = await fetch(`${API_URL}/api/pg`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setPgs(data);
        setFilteredPgs(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Run filters
  useEffect(() => {
    let result = pgs.filter(pg => {
      // Search matches name or address
      const matchesSearch = pg.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            pg.address.toLowerCase().includes(searchQuery.toLowerCase());
      
      // Gender filter
      const matchesGender = genderFilter === 'All' || pg.genderType === genderFilter;

      // Distance filter
      const matchesDistance = pg.distanceFromCollege <= maxDistance;

      // Price filter (based on base rent)
      const matchesPrice = pg.baseRent <= maxPrice;

      return matchesSearch && matchesGender && matchesDistance && matchesPrice;
    });

    // Sorting
    if (sortBy === 'distance') {
      result.sort((a, b) => a.distanceFromCollege - b.distanceFromCollege);
    } else if (sortBy === 'rent-asc') {
      result.sort((a, b) => a.baseRent - b.baseRent);
    } else if (sortBy === 'rent-desc') {
      result.sort((a, b) => b.baseRent - a.baseRent);
    }

    setFilteredPgs(result);
  }, [searchQuery, genderFilter, maxPrice, maxDistance, sortBy, pgs]);

  const handleNextImage = (pgId: string, imagesCount: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setCarouselIndices(prev => ({
      ...prev,
      [pgId]: ((prev[pgId] || 0) + 1) % imagesCount
    }));
  };

  const handlePrevImage = (pgId: string, imagesCount: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setCarouselIndices(prev => ({
      ...prev,
      [pgId]: ((prev[pgId] || 0) - 1 + imagesCount) % imagesCount
    }));
  };

  return (
    <div className="min-h-screen bg-app-black light:bg-[#f0ece4] text-white light:text-[#1a1a1a] selection:bg-indigo-500/30 font-sans transition-colors duration-300">
      <Navbar />
      
      <div className="pt-24 pb-20 px-4 max-w-7xl mx-auto relative z-10">
        
        {/* Header Hero */}
        <div className="text-center mb-10">
          <motion.h1 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-6xl font-black uppercase tracking-tighter"
          >
            ZENVY <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-500 via-indigo-500 to-[#C9A84C]">HOMES</span> 🏠
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-gray-400 light:text-gray-600 text-xs md:text-sm mt-3 uppercase tracking-[0.2em] max-w-2xl mx-auto font-black"
          >
            Premium Student PGs & Hostels • Zero Brokerage • Live Map Locations
          </motion.p>
        </div>

        {/* Premium Filter Dashboard */}
        <div className="glass-card p-6 rounded-[32px] border border-white/5 light:border-[#d4cfc5] mb-10 shadow-xl space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            
            {/* Search */}
            <div className="md:col-span-2 relative">
              <span className="absolute left-4 top-3.5 text-lg">🔍</span>
              <input
                type="text"
                placeholder="Search PG by name, college road or junction..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/5 light:bg-[#f5f3ee] border border-white/10 light:border-[#d4cfc5] rounded-2xl py-3 pl-12 pr-4 text-sm text-white light:text-[#1a1a1a] placeholder-gray-500 outline-none focus:border-indigo-500 transition-colors font-bold"
              />
            </div>

            {/* Sort Dropdown */}
            <div className="relative">
              <span className="absolute left-4 top-3.5 text-lg">↕️</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full bg-white/5 light:bg-[#f5f3ee] border border-white/10 light:border-[#d4cfc5] rounded-2xl py-3 pl-12 pr-4 text-sm text-white light:text-[#1a1a1a] outline-none focus:border-indigo-500 transition-colors font-bold appearance-none cursor-pointer"
              >
                <option value="distance" className="text-black">Sort: Nearest first</option>
                <option value="rent-asc" className="text-black">Price: Low to High</option>
                <option value="rent-desc" className="text-black">Price: High to Low</option>
              </select>
            </div>

            {/* Gender Filters */}
            <div className="flex gap-2 p-1 bg-white/5 light:bg-[#f5f3ee] rounded-2xl border border-white/10 light:border-[#d4cfc5]">
              {['All', 'Boys', 'Girls', 'Co-ed'].map(gender => (
                <button
                  key={gender}
                  onClick={() => setGenderFilter(gender)}
                  className={`flex-1 py-2 text-xs font-black rounded-xl transition-all ${
                    genderFilter === gender 
                      ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' 
                      : 'text-gray-400 light:text-gray-600 hover:text-white light:hover:text-black'
                  }`}
                >
                  {gender}
                </button>
              ))}
            </div>

          </div>

          {/* Slider Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-white/5 light:border-[#d4cfc5]">
            {/* Price Range */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 light:text-gray-600">Max Monthly Budget</span>
                <span className="text-xs font-black text-emerald-400">₹{maxPrice}</span>
              </div>
              <input
                type="range"
                min="4000"
                max="15000"
                step="500"
                value={maxPrice}
                onChange={(e) => setMaxPrice(Number(e.target.value))}
                className="w-full h-1 bg-white/10 light:bg-black/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>

            {/* Distance Slider */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 light:text-gray-600">Max Distance from Campus</span>
                <span className="text-xs font-black text-indigo-400">{maxDistance} km</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="6"
                step="0.5"
                value={maxDistance}
                onChange={(e) => setMaxDistance(Number(e.target.value))}
                className="w-full h-1 bg-white/10 light:bg-black/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Listings Grid */}
        {loading ? (
          <div className="text-center py-20">
            <div className="inline-block w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-gray-500 light:text-gray-600 mt-4 font-bold text-xs uppercase tracking-widest">Loading Premium Residences...</p>
          </div>
        ) : filteredPgs.length === 0 ? (
          <div className="text-center py-20 bg-white/5 light:bg-white rounded-[32px] border border-white/5 light:border-[#d4cfc5] p-10">
            <span className="text-5xl">🛌</span>
            <p className="text-gray-500 light:text-gray-600 mt-4 font-black uppercase tracking-widest text-sm">No residences match your filters.</p>
            <button 
              onClick={() => { setSearchQuery(''); setGenderFilter('All'); setMaxPrice(15000); setMaxDistance(6); }}
              className="mt-6 bg-indigo-500 hover:bg-indigo-600 text-white font-black py-3 px-6 rounded-2xl text-xs uppercase tracking-widest transition-colors shadow-lg active:scale-95"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredPgs.map(pg => {
              const activeIndex = carouselIndices[pg.id] || 0;
              const hasImages = pg.images && pg.images.length > 0;
              const currentImage = hasImages ? pg.images[activeIndex] : '/pg-images/pg_boys_exterior.png';

              // Determine gender tag styling
              let genderBg = 'bg-[#EF4F5F]/10 text-[#EF4F5F]';
              if (pg.genderType === 'Boys') genderBg = 'bg-blue-500/10 text-blue-400';
              if (pg.genderType === 'Girls') genderBg = 'bg-pink-500/10 text-pink-400';
              if (pg.genderType === 'Co-ed') genderBg = 'bg-purple-500/10 text-purple-400';

              return (
                <div 
                  key={pg.id} 
                  className="glass-card rounded-[36px] border border-white/5 light:border-[#d4cfc5] overflow-hidden flex flex-col justify-between group shadow-xl hover:shadow-2xl hover:border-indigo-500/30 transition-all duration-300 transform hover:-translate-y-1"
                >
                  <div>
                    {/* Swipeable Image Banner */}
                    <div className="relative h-56 w-full bg-black/40 overflow-hidden group/img">
                      <img 
                        src={currentImage} 
                        alt={pg.name}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      
                      {/* Carousel controls */}
                      {hasImages && pg.images.length > 1 && (
                        <>
                          <button
                            onClick={(e) => handlePrevImage(pg.id, pg.images.length, e)}
                            className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white text-xs opacity-0 group-hover/img:opacity-100 transition-opacity active:scale-90"
                          >
                            ◀
                          </button>
                          <button
                            onClick={(e) => handleNextImage(pg.id, pg.images.length, e)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white text-xs opacity-0 group-hover/img:opacity-100 transition-opacity active:scale-90"
                          >
                            ▶
                          </button>
                          
                          {/* Dot indicator indicators */}
                          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-20">
                            {pg.images.map((_, i) => (
                              <div 
                                key={i} 
                                className={`w-1.5 h-1.5 rounded-full transition-all ${i === activeIndex ? 'bg-indigo-500 w-3' : 'bg-white/50'}`}
                              />
                            ))}
                          </div>
                        </>
                      )}

                      {/* Top Badges */}
                      <div className="absolute top-4 left-4 flex gap-2 z-10">
                        <span className={`text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl backdrop-blur-md ${genderBg}`}>
                          {pg.genderType}
                        </span>
                        <span className="text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl bg-black/50 text-white backdrop-blur-md">
                          ⭐ 4.8
                        </span>
                      </div>

                      <div className="absolute top-4 right-4 z-10">
                        <span className="text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 backdrop-blur-md border border-emerald-500/30">
                          VERIFIED
                        </span>
                      </div>
                    </div>

                    {/* Card Content */}
                    <div className="p-6">
                      <h3 className="text-lg font-black leading-tight text-white light:text-[#1a1a1a] line-clamp-1">{pg.name}</h3>
                      <p className="text-[10px] text-gray-400 light:text-gray-600 font-bold uppercase tracking-wider mt-1 line-clamp-1">📍 {pg.address}</p>
                      
                      <div className="flex gap-2 mt-3">
                        <span className="text-[9px] bg-indigo-500/10 text-indigo-400 font-black px-2.5 py-1 rounded-xl">
                          🏃 {pg.distanceFromCollege} km to Campus
                        </span>
                        <span className="text-[9px] bg-emerald-500/10 text-emerald-400 font-black px-2.5 py-1 rounded-xl">
                          🔒 Deposit: ₹{pg.securityDeposit}
                        </span>
                      </div>

                      <p className="text-xs text-gray-400 light:text-gray-600 font-medium mt-4 line-clamp-2 leading-relaxed">
                        {pg.description}
                      </p>

                      {/* Amenities Preview */}
                      <div className="mt-5 pt-4 border-t border-white/5 light:border-[#d4cfc5] flex flex-wrap gap-1.5">
                        {pg.amenities.slice(0, 4).map((amenity, idx) => (
                          <span 
                            key={idx} 
                            className="text-[8px] font-black text-gray-400 light:text-gray-600 border border-white/10 light:border-[#d4cfc5] px-2 py-1 rounded-lg uppercase tracking-wide bg-white/5 light:bg-[#f5f3ee]"
                          >
                            {amenity}
                          </span>
                        ))}
                        {pg.amenities.length > 4 && (
                          <span className="text-[8px] font-black text-indigo-400 px-2 py-1">
                            +{pg.amenities.length - 4} more
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* CTA Footer */}
                  <div className="p-6 pt-0 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[8px] font-black text-gray-400 light:text-gray-600 uppercase tracking-widest">Monthly Rent Starts At</p>
                      <p className="text-xl font-black text-emerald-400 mt-0.5">₹{pg.baseRent}<span className="text-[10px] text-gray-400 light:text-gray-600 font-normal">/mo</span></p>
                    </div>

                    <Link 
                      href={`/pg/${pg.id}`}
                      className="bg-indigo-500 hover:bg-indigo-600 text-white font-black px-5 py-3 rounded-2xl text-[10px] uppercase tracking-widest transition-all shadow-lg shadow-indigo-500/10 active:scale-95"
                    >
                      View Details & Book
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
