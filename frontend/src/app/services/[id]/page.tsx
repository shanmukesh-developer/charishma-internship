'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ShoppingCart, Stethoscope, WashingMachine, Printer, Bicycle, Cake, Beef, Apple, Plus } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { useCart } from '@/context/CartContext';
import { API_URL } from '@/utils/api';

const SERVICE_CONFIG = {
  grocery: { name: 'Fresh Groceries', icon: Apple, color: 'text-green-500', bg: 'bg-green-500/10' },
  meat: { name: 'Raw Meat & Fish', icon: Beef, color: 'text-red-500', bg: 'bg-red-500/10' },
  bakery: { name: 'Cakes & Sweets', icon: Cake, color: 'text-pink-500', bg: 'bg-pink-500/10' },
  rentals: { name: 'Campus Rentals', icon: Bicycle, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  pharmacy: { name: 'Pharmacy SOS', icon: Stethoscope, color: 'text-teal-500', bg: 'bg-teal-500/10' },
  laundry: { name: 'Wash & Fold', icon: WashingMachine, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
  print: { name: 'Print & Drop', icon: Printer, color: 'text-gray-300', bg: 'bg-gray-500/10' },
  mart: { name: 'Zenvy Mini-Mart', icon: ShoppingCart, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
};

export default function ZenvyServicePage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { addToCart } = useCart();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const service = SERVICE_CONFIG[params.id as keyof typeof SERVICE_CONFIG];

  useEffect(() => {
    // In a real app, we would fetch specifically filtered items from the backend based on the service ID.
    // Here we'll fetch all items and filter them natively just like the homepage does.
    const fetchItems = async () => {
      try {
        const res = await fetch(`${API_URL}/api/users/restaurants`);
        const restaurants = await res.json();
        
        let allProducts = restaurants.flatMap((r: any) => 
          (r.menu || []).map((m: any) => ({
            ...m,
            restaurantName: r.name,
            restaurantId: r._id || r.id,
            vendorType: r.vendorType,
            tags: Array.isArray(m.tags) ? m.tags : []
          }))
        );

        // Filter based on the service category
        allProducts = allProducts.filter((p: any) => {
          const t = p.tags || [];
          const vt = p.vendorType;
          if (params.id === 'grocery') return t.includes('fruits') || vt === 'GROCERY';
          if (params.id === 'meat') return t.includes('meat') || vt === 'MEAT';
          if (params.id === 'bakery') return t.includes('sweets') || vt === 'SWEETS';
          if (params.id === 'rentals') return t.includes('rental') || vt === 'RENTAL';
          if (params.id === 'pharmacy') return t.includes('medicine') || t.includes('pharmacy') || vt === 'PHARMACY';
          if (params.id === 'laundry') return t.includes('laundry') || vt === 'LAUNDRY';
          if (params.id === 'print') return t.includes('stationary') || t.includes('print') || vt === 'STATIONARY';
          if (params.id === 'mart') return t.includes('mart') || vt === 'MART';
          return false;
        });

        // Add dummy data if empty so the UI doesn't look blank during development
        if (allProducts.length === 0) {
          allProducts = [
            { id: '1', name: 'Premium Service Item', price: 99, description: 'High quality ' + params.id + ' service.', imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=500', isAvailable: true },
            { id: '2', name: 'Standard Request', price: 49, description: 'Quick and reliable ' + params.id + ' request.', imageUrl: 'https://images.unsplash.com/photo-1588675646184-f5b0b0b0b2de?w=500', isAvailable: true }
          ];
        }

        setItems(allProducts);
      } catch (err) {
        console.error('Failed to fetch service items', err);
      } finally {
        setLoading(false);
      }
    };
    fetchItems();
  }, [params.id]);

  if (!service) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] text-white flex flex-col items-center justify-center">
        <h1 className="text-2xl font-bold mb-4">Service Not Found</h1>
        <button onClick={() => router.push('/')} className="bg-white/10 px-6 py-2 rounded-full">Go Back</button>
      </div>
    );
  }

  const Icon = service.icon;

  return (
    <main className="min-h-screen bg-[#0A0A0B] pb-24">
      <Navbar onMenuClick={() => {}} userName="" isElite={false} user={null} />
      
      {/* Dynamic Header */}
      <div className={`${service.bg} pt-24 pb-8 px-4 border-b border-white/5`}>
        <div className="max-w-4xl mx-auto">
          <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors">
            <ArrowLeft className="w-5 h-5" />
            <span className="font-semibold text-sm">Back to Home</span>
          </button>
          
          <div className="flex items-center gap-4">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center bg-black/40 border border-white/10`}>
              <Icon className={`w-8 h-8 ${service.color}`} />
            </div>
            <div>
              <h1 className="text-3xl font-black text-white">{service.name}</h1>
              <p className="text-sm text-gray-300 mt-1">Zenvy Ecosystem Hub</p>
            </div>
          </div>
        </div>
      </div>

      {/* Items Grid */}
      <div className="max-w-4xl mx-auto px-4 mt-8">
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="animate-pulse bg-white/5 rounded-2xl h-60"></div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map((item, idx) => (
              <div key={item.id || idx} className="bg-[#1A1A1A] border border-white/5 rounded-2xl overflow-hidden flex flex-col">
                <div className="h-32 w-full bg-black relative">
                  <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover opacity-80" />
                  {!item.isAvailable && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm">
                      <span className="text-white font-bold text-sm tracking-widest uppercase">Unavailable</span>
                    </div>
                  )}
                </div>
                <div className="p-3 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white line-clamp-2 leading-tight">{item.name}</h3>
                    <p className="text-xs text-gray-400 mt-1 line-clamp-2">{item.description}</p>
                  </div>
                  <div className="flex items-center justify-between mt-4">
                    <span className="font-black text-white">₹{item.price}</span>
                    <button 
                      disabled={!item.isAvailable}
                      onClick={() => addToCart(item, { id: item.restaurantId, name: item.restaurantName || 'Zenvy Hub' } as any)}
                      className={`p-2 rounded-full ${item.isAvailable ? 'bg-white text-black hover:bg-gray-200' : 'bg-white/10 text-white/30 cursor-not-allowed'}`}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
