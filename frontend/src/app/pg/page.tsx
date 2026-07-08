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
    <div className="min-h-screen bg-[#11111A] light:bg-[#FAFAFA] text-white light:text-gray-900 selection:bg-indigo-500/30 font-sans transition-colors duration-500 relative overflow-hidden pb-24">
      {/* Premium Background Glow */}
      <div className="absolute top-0 left-0 right-0 h-[600px] bg-gradient-radial from-indigo-50/60 via-transparent to-transparent opacity-80 pointer-events-none hidden light:block" />
      <div className="absolute top-0 left-0 right-0 h-[600px] bg-gradient-radial from-indigo-900/20 via-transparent to-transparent opacity-80 pointer-events-none block light:hidden" />

      <Navbar />
      
      <div className="pt-24 px-4 sm:px-6 max-w-7xl mx-auto relative z-10">
        
        {/* Header Hero */}
        <div className="text-center mb-12 flex flex-col items-center">
          <div className="inline-flex items-center justify-center px-4 py-1.5 rounded-full bg-white border border-gray-100 shadow-[0_2px_10px_rgba(0,0,0,0.03)] mb-6">
            <span className="text-[9px] font-black text-indigo-500 uppercase tracking-[0.4em]">Residences</span>
          </div>
          <motion.h1 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl md:text-7xl font-black uppercase tracking-tighter text-gray-900"
            style={{ fontFamily: "'Syne', sans-serif" }}
          >
            ZENVY <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-indigo-600 to-[#C9A84C]">HOMES</span>
          </motion.h1>
          <div className="w-16 h-1.5 bg-gradient-to-r from-blue-500 via-indigo-500 to-[#C9A84C] mt-6 rounded-full" />
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-gray-400 light:text-gray-500 text-[10px] md:text-xs mt-6 uppercase tracking-[0.3em] max-w-2xl mx-auto font-black"
          >
            Premium Student PGs • Zero Brokerage • Live Map Locations
          </motion.p>
        </div>

        {/* Premium Filter Dashboard */}
        <div className="bg-[#1A1A24] light:bg-white p-6 md:p-8 rounded-[36px] border border-white/5 light:border-gray-100 mb-14 shadow-[0_8px_30px_rgba(0,0,0,0.04)] space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            
            {/* Search */}
            <div className="md:col-span-2 relative">
              <span className="absolute left-5 top-4 text-lg opacity-50">🔍</span>
              <input
                type="text"
                placeholder="Search PG by name, college road or junction..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/5 light:bg-[#F8F9FA] border border-white/10 light:border-transparent rounded-2xl py-4 pl-14 pr-5 text-sm text-white light:text-gray-900 placeholder-gray-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-bold"
              />
            </div>

            {/* Sort Dropdown */}
            <div className="relative">
              <span className="absolute left-5 top-4 text-lg opacity-50">↕️</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full bg-white/5 light:bg-[#F8F9FA] border border-white/10 light:border-transparent rounded-2xl py-4 pl-14 pr-5 text-sm text-white light:text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-bold appearance-none cursor-pointer"
              >
                <option value="distance" className="text-black">Nearest First</option>
                <option value="rent-asc" className="text-black">Price: Low to High</option>
                <option value="rent-desc" className="text-black">Price: High to Low</option>
              </select>
            </div>

            {/* Gender Filters */}
            <div className="flex gap-2 p-1.5 bg-white/5 light:bg-[#F8F9FA] rounded-2xl border border-white/10 light:border-transparent">
              {['All', 'Boys', 'Girls', 'Co-ed'].map(gender => (
                <button
                  key={gender}
                  onClick={() => setGenderFilter(gender)}
                  className={`flex-1 py-2.5 text-[11px] font-black uppercase tracking-wider rounded-xl transition-all duration-300 ${
                    genderFilter === gender 
                      ? 'bg-indigo-600 text-white shadow-md' 
                      : 'text-gray-400 light:text-gray-500 hover:text-white light:hover:text-gray-900'
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
                  className="bg-[#1A1A24] light:bg-white rounded-[32px] border border-white/5 light:border-gray-100 overflow-hidden flex flex-col justify-between group shadow-[0_8px_24px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_40px_rgba(0,0,0,0.12)] hover:-translate-y-1 transition-all duration-500"
                >
                  <div>
                    {/* Swipeable Image Banner */}
                    <div className="relative h-64 w-full bg-black/40 overflow-hidden group/img">
                      <img 
                        src={currentImage} 
                        alt={pg.name}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
                      
                      {/* Carousel controls */}
                      {hasImages && pg.images.length > 1 && (
                        <>
                          <button
                            onClick={(e) => handlePrevImage(pg.id, pg.images.length, e)}
                            className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/20 backdrop-blur-md hover:bg-white/40 flex items-center justify-center text-white text-sm opacity-0 group-hover/img:opacity-100 transition-all active:scale-95"
                          >
                            ◀
                          </button>
                          <button
                            onClick={(e) => handleNextImage(pg.id, pg.images.length, e)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/20 backdrop-blur-md hover:bg-white/40 flex items-center justify-center text-white text-sm opacity-0 group-hover/img:opacity-100 transition-all active:scale-95"
                          >
                            ▶
                          </button>
                          
                          {/* Dot indicator indicators */}
                          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-20">
                            {pg.images.map((_, i) => (
                              <div 
                                key={i} 
                                className={`h-1.5 rounded-full transition-all duration-300 ${i === activeIndex ? 'bg-white w-4' : 'bg-white/40 w-1.5'}`}
                              />
                            ))}
                          </div>
                        </>
                      )}

                      {/* Top Badges */}
                      <div className="absolute top-5 left-5 flex gap-2 z-10">
                        <span className={`text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full backdrop-blur-md shadow-sm ${genderBg}`}>
                          {pg.genderType}
                        </span>
                        <span className="text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full bg-white/20 text-white backdrop-blur-md border border-white/30 shadow-sm">
                          ⭐ 4.8
                        </span>
                      </div>

                      <div className="absolute top-5 right-5 z-10">
                        <span className="text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full bg-emerald-500/90 text-white shadow-lg shadow-emerald-500/20">
                          VERIFIED
                        </span>
                      </div>
                    </div>

                    {/* Card Content */}
                    <div className="p-6 md:p-8 relative -mt-4 bg-[#1A1A24] light:bg-white rounded-t-[32px]">
                      <h3 className="text-2xl font-black leading-tight text-white light:text-gray-900 line-clamp-1" style={{ fontFamily: "'Syne', sans-serif" }}>{pg.name}</h3>
                      <p className="text-[11px] text-gray-400 light:text-gray-500 font-bold uppercase tracking-wider mt-2 line-clamp-1 flex items-center gap-1.5">
                        <span className="text-indigo-400">📍</span> {pg.address}
                      </p>
                      
                      <div className="flex gap-2.5 mt-4">
                        <span className="text-[10px] bg-indigo-50 light:bg-[#F8F9FA] text-indigo-600 font-black px-3 py-1.5 rounded-xl border border-indigo-100/50 light:border-transparent">
                          🏃 {pg.distanceFromCollege} km to Campus
                        </span>
                        <span className="text-[10px] bg-emerald-50 light:bg-emerald-50 text-emerald-600 font-black px-3 py-1.5 rounded-xl border border-emerald-100/50 light:border-transparent">
                          🔒 Deposit: ₹{pg.securityDeposit}
                        </span>
                      </div>

                      <p className="text-[13px] text-gray-400 light:text-gray-600 font-medium mt-5 line-clamp-2 leading-relaxed">
                        {pg.description}
                      </p>

                      {/* Amenities Preview */}
                      <div className="mt-6 pt-5 border-t border-white/5 light:border-gray-100 flex flex-wrap gap-2">
                        {pg.amenities.slice(0, 4).map((amenity, idx) => (
                          <span 
                            key={idx} 
                            className="text-[9px] font-bold text-gray-300 light:text-gray-600 border border-white/10 light:border-gray-200 px-3 py-1.5 rounded-lg uppercase tracking-wider bg-white/5 light:bg-transparent"
                          >
                            {amenity}
                          </span>
                        ))}
                        {pg.amenities.length > 4 && (
                          <span className="text-[9px] font-black text-indigo-500 px-2 py-1.5 flex items-center">
                            +{pg.amenities.length - 4} MORE
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* CTA Footer */}
                  <div className="p-6 md:p-8 pt-0 flex items-center justify-between gap-4 bg-[#1A1A24] light:bg-white">
                    <div>
                      <p className="text-[9px] font-black text-gray-400 light:text-gray-500 uppercase tracking-widest">Starts At</p>
                      <p className="text-2xl font-black text-indigo-600 mt-1 flex items-baseline gap-1">₹{pg.baseRent}<span className="text-[11px] text-gray-400 light:text-gray-400 font-bold uppercase tracking-wider">/mo</span></p>
                    </div>

                    <Link 
                      href={`/pg/${pg.id}`}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-black px-6 py-4 rounded-2xl text-[11px] uppercase tracking-widest transition-all shadow-[0_8px_20px_rgba(79,70,229,0.2)] hover:shadow-[0_12px_24px_rgba(79,70,229,0.3)] active:scale-95 flex items-center gap-2"
                    >
                      View Details
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7" /></svg>
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
