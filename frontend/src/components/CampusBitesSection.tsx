"use client";
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SafeImage from '@/components/SafeImage';
import { Restaurant } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

// Campus presets with coordinates for auto-detection
const CAMPUSES = [
  { code: 'ALL', label: 'All Campuses', emoji: '🌐' },
  { code: 'SRM', label: 'SRM University', emoji: '🏛️', lat: 16.4673, lon: 80.5002 },
  { code: 'VIT', label: 'VIT Vellore', emoji: '🎓', lat: 12.9692, lon: 79.1559 },
  { code: 'KLU', label: 'KL University', emoji: '📚', lat: 16.4420, lon: 80.6220 },
];

interface CampusBitesSectionProps {
  restaurants: Restaurant[];
}

export default function CampusBitesSection({ restaurants }: CampusBitesSectionProps) {
  const [selectedCampus, setSelectedCampus] = useState('ALL');
  const [stallSearch, setStallSearch] = useState('');
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);

  // Filter local vendors from the restaurant list
  const localVendors = useMemo(() => {
    return restaurants
      .filter(r => {
        const vt = (r.vendorType || '').toUpperCase();
        return vt === 'LOCAL_VENDOR';
      })
      .filter(r => {
        if (selectedCampus === 'ALL') return true;
        return (r.campus || '').toUpperCase() === selectedCampus;
      })
      .filter(r => {
        if (!stallSearch) return true;
        const q = stallSearch.toLowerCase();
        return (
          (r.name || '').toLowerCase().includes(q) ||
          (r.stallDescription || '').toLowerCase().includes(q) ||
          (r.menu || []).some(item => (item.name || '').toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        // Premium vendors first, then by rating
        const aTier = a.subscriptionTier === 'premium' ? 1 : 0;
        const bTier = b.subscriptionTier === 'premium' ? 1 : 0;
        if (bTier !== aTier) return bTier - aTier;
        return (Number(b.rating) || 0) - (Number(a.rating) || 0);
      });
  }, [restaurants, selectedCampus, stallSearch]);

  // Track click analytics (fire-and-forget)
  const trackClick = (vendorId: string) => {
    fetch(`${API_URL}/api/restaurants/${vendorId}/click`, { method: 'POST' }).catch(() => {});
  };

  // Generate WhatsApp order link
  const getWhatsAppLink = (vendor: Restaurant, itemName?: string) => {
    const phone = vendor.whatsappNumber || '919391955674';
    const campus = CAMPUSES.find(c => c.code === vendor.campus)?.label || vendor.campus || 'Campus';
    let msg = `Hi! I'd like to order from ${vendor.name} via CampusBites (Zenvy). My campus: ${campus}.`;
    if (itemName) msg += `\n\nItem: ${itemName}`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  };

  if (localVendors.length === 0 && !stallSearch) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className="mb-14"
      id="campusbites-section"
    >
      {/* Section Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center text-sm shadow-lg shadow-orange-500/20">
              🏪
            </div>
            <span className="text-[9px] font-black text-orange-400 uppercase tracking-[0.4em]">CampusBites</span>
          </div>
          <h2 className="text-xl md:text-2xl font-black text-white italic tracking-tighter uppercase" style={{ fontFamily: "'Syne', sans-serif" }}>
            Local <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-amber-300">Vendor Stalls</span>
          </h2>
          <p className="text-[9px] font-bold text-secondary-text uppercase tracking-widest mt-1 max-w-[340px] leading-relaxed">
            Discover roadside food stalls near your campus. Browse menus & order via WhatsApp.
          </p>
        </div>

        {/* Campus Selector Pills */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          {CAMPUSES.map(c => (
            <button
              key={c.code}
              onClick={() => setSelectedCampus(c.code)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-[9px] font-black uppercase tracking-widest whitespace-nowrap transition-all border ${
                selectedCampus === c.code
                  ? 'bg-orange-500/10 text-orange-400 border-orange-500/30 shadow-[0_0_12px_rgba(249,115,22,0.15)]'
                  : 'bg-white/5 text-secondary-text border-white/10 hover:border-white/20'
              }`}
            >
              <span className="text-xs">{c.emoji}</span> {c.code === 'ALL' ? 'All' : c.code}
            </button>
          ))}
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative mb-6 group">
        <input
          type="text"
          placeholder="Search local stalls, dishes..."
          value={stallSearch}
          onChange={(e) => setStallSearch(e.target.value)}
          className="w-full bg-white/[0.03] border border-white/10 rounded-2xl py-3.5 pl-12 pr-4 text-xs font-bold tracking-wide outline-none focus:border-orange-500/40 transition-all placeholder:text-white/20 shadow-lg"
        />
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 group-focus-within:text-orange-400/60 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
      </div>

      {/* Vendor Cards Grid */}
      {localVendors.length === 0 ? (
        <div className="w-full flex flex-col items-center justify-center py-12 px-6 border border-white/5 rounded-[30px] bg-white/[0.02]">
          <span className="text-4xl mb-4 opacity-50">🏪</span>
          <p className="text-xs font-black text-secondary-text uppercase tracking-widest">
            {stallSearch ? 'No stalls match your search' : 'No local vendors available yet'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <AnimatePresence mode="popLayout">
            {localVendors.map((vendor, index) => {
              const isExpanded = expandedVendor === (vendor._id || vendor.id);
              const isPremium = vendor.subscriptionTier === 'premium';
              const isOpen = vendor.isOpenNow !== false;

              return (
                <motion.div
                  key={vendor._id || vendor.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                  className={`relative overflow-hidden rounded-[28px] border transition-all duration-500 group ${
                    isPremium
                      ? 'border-orange-500/30 bg-gradient-to-br from-[#141416] to-orange-900/[0.06] shadow-[0_0_20px_rgba(249,115,22,0.08)]'
                      : 'border-white/[0.06] bg-[#141416]/80'
                  } ${!isOpen ? 'opacity-70' : ''}`}
                >
                  {/* Premium Badge */}
                  {isPremium && (
                    <div className="absolute top-0 right-0 z-10">
                      <div className="bg-gradient-to-l from-orange-500 to-amber-500 text-black text-[7px] font-black uppercase tracking-widest px-3 py-1 rounded-bl-xl shadow-lg">
                        ⭐ Featured
                      </div>
                    </div>
                  )}

                  <div className="p-5">
                    {/* Top Row: Image + Info */}
                    <div className="flex gap-4">
                      {/* Vendor Image */}
                      <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl overflow-hidden border border-white/10 shrink-0 relative">
                        <SafeImage
                          src={vendor.imageUrl || '/assets/placeholder_premium.png'}
                          alt={vendor.name}
                          fill
                          className="object-cover group-hover:scale-110 transition-transform duration-700"
                        />
                        {/* Open/Closed Indicator */}
                        <div className={`absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full backdrop-blur-md text-[7px] font-black uppercase tracking-widest ${
                          isOpen
                            ? 'bg-emerald-500/80 text-white'
                            : 'bg-red-500/80 text-white'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-white animate-pulse' : 'bg-white/60'}`} />
                          {isOpen ? 'Open' : 'Closed'}
                        </div>
                      </div>

                      {/* Vendor Info */}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-[15px] font-black text-white uppercase tracking-tight truncate">{vendor.name}</h3>

                        {/* Campus + Rating */}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[8px] font-black text-orange-400 uppercase tracking-widest bg-orange-400/10 px-2 py-0.5 rounded-full">
                            {vendor.campus || 'Campus'}
                          </span>
                          <span className="text-[9px] font-bold text-secondary-text">
                            ⭐ {Number(vendor.rating || 0).toFixed(1)}
                          </span>
                        </div>

                        {/* Description */}
                        <p className="text-[9px] text-secondary-text font-medium mt-1.5 line-clamp-2 leading-relaxed">
                          {vendor.stallDescription || 'Local food stall near campus'}
                        </p>

                        {/* Promo Offer */}
                        {vendor.promoOffer && (
                          <div className="mt-2 inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2 py-1">
                            <span className="text-[8px] font-black text-amber-400 uppercase tracking-wide">{vendor.promoOffer}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Operating Hours */}
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/[0.04]">
                      <div className="flex items-center gap-4">
                        <span className="text-[8px] font-bold text-secondary-text uppercase tracking-widest">
                          🕐 {vendor.operatingHours
                            ? `${vendor.operatingHours.start || '?'} — ${vendor.operatingHours.end || '?'}`
                            : 'Hours vary'}
                        </span>
                        {vendor.menu && vendor.menu.length > 0 && (
                          <span className="text-[8px] font-bold text-secondary-text uppercase tracking-widest">
                            📋 {vendor.menu.length} items
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {/* View Menu Toggle */}
                        <button
                          onClick={() => {
                            trackClick(vendor._id || vendor.id || '');
                            setExpandedVendor(isExpanded ? null : (vendor._id || vendor.id || null));
                          }}
                          className="text-[8px] font-black uppercase tracking-widest text-orange-400 hover:text-orange-300 transition-colors"
                        >
                          {isExpanded ? 'Hide Menu ▴' : 'View Menu ▾'}
                        </button>

                        {/* WhatsApp Order Button */}
                        <a
                          href={getWhatsAppLink(vendor)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => trackClick(vendor._id || vendor.id || '')}
                          className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                        >
                          💬 Order
                        </a>
                      </div>
                    </div>

                    {/* Expanded Menu */}
                    <AnimatePresence>
                      {isExpanded && vendor.menu && vendor.menu.length > 0 && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: 'easeInOut' }}
                          className="overflow-hidden"
                        >
                          <div className="mt-4 pt-4 border-t border-white/[0.04] space-y-2">
                            <p className="text-[8px] font-black text-orange-400 uppercase tracking-[0.3em] mb-3">📋 Menu</p>
                            {vendor.menu.map((item, i) => (
                              <div
                                key={item._id || item.id || i}
                                className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.02] border border-white/[0.04] hover:border-orange-500/20 transition-all group/item"
                              >
                                {/* Item Image */}
                                <div className="w-12 h-12 rounded-xl overflow-hidden border border-white/10 shrink-0 relative">
                                  <SafeImage
                                    src={item.image || item.imageUrl || '/assets/placeholder_premium.png'}
                                    alt={item.name}
                                    fill
                                    className="object-cover"
                                  />
                                  {item.isVegetarian && (
                                    <div className="absolute top-0.5 left-0.5 w-3 h-3 border border-emerald-500/50 flex items-center justify-center rounded-[2px] bg-black/60">
                                      <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                                    </div>
                                  )}
                                </div>

                                {/* Item Info */}
                                <div className="flex-1 min-w-0">
                                  <h4 className="text-[11px] font-black text-white truncate">{item.name}</h4>
                                  {item.description && (
                                    <p className="text-[8px] text-secondary-text truncate mt-0.5">{item.description}</p>
                                  )}
                                </div>

                                {/* Price + WhatsApp */}
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-[13px] font-black text-orange-400">₹{item.price}</span>
                                  <a
                                    href={getWhatsAppLink(vendor, item.name)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-[10px] hover:bg-emerald-500/20 transition-all opacity-0 group-hover/item:opacity-100"
                                  >
                                    💬
                                  </a>
                                </div>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Section Footer */}
      <div className="mt-6 text-center">
        <p className="text-[8px] font-bold text-secondary-text/50 uppercase tracking-widest">
          Zenvy acts as a discovery platform. Orders are placed directly with vendors via WhatsApp.
        </p>
      </div>
    </motion.section>
  );
}
