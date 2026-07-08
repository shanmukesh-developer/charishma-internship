"use client";
import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import Navbar from '@/components/Navbar';
import Link from 'next/link';
import SafeImage from '@/components/SafeImage';
import { useCart } from '@/context/CartContext';

export default function CategoryPage() {
  const params = useParams();
  const router = useRouter();
  const categoryId = params.id as string;
  const { addToCart } = useCart();
  
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    window.scrollTo(0, 0);
  }, []);

  const getCategoryName = (id: string) => {
    const map: Record<string, string> = {
      stationary: 'Stationary & Print',
      seasonal: 'Season Specials',
      sweets: 'Delicious Desserts',
      drinks: 'Drinks & Beverages',
      gym: 'Gym & Protein',
      rentals: 'Campus Rides',
      fruits: 'Fresh Fruits',
      pharmacy: 'Pharmacy',
      laundry: 'Dry Wash'
    };
    return map[id] || 'Category';
  };

  const getMockData = (id: string) => {
    const data: Record<string, any[]> = {
      stationary: [
        { id: 'stat-1', name: 'Premium Notebook Set', price: 150, image: 'https://images.unsplash.com/photo-1531346878377-a5447cb02621?q=80&w=600&auto=format&fit=crop', desc: 'Set of 3 spiral notebooks, 200 pages' },
        { id: 'stat-2', name: 'Color Pens Pack', price: 80, image: 'https://images.unsplash.com/photo-1585040316886-4f51e0417935?q=80&w=600&auto=format&fit=crop', desc: '12 vibrant colors for sketching' },
        { id: 'stat-3', name: 'A4 Print Service (B&W)', price: 2, image: 'https://images.unsplash.com/photo-1593640408182-31c70c8268f5?q=80&w=600&auto=format&fit=crop', desc: 'Per page high quality laser print' }
      ],
      sweets: [
        { id: 'sw-1', name: 'Red Velvet Cake', price: 450, image: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?q=80&w=600&auto=format&fit=crop', desc: 'Rich slice of classic red velvet' },
        { id: 'sw-2', name: 'Fudge Brownies', price: 120, image: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?q=80&w=600&auto=format&fit=crop', desc: 'Gooey double chocolate brownies' },
        { id: 'sw-3', name: 'Assorted Macarons', price: 300, image: 'https://images.unsplash.com/photo-1569864358642-9d1684040f43?q=80&w=600&auto=format&fit=crop', desc: 'Box of 6 authentic French macarons' }
      ],
      drinks: [
        { id: 'dr-1', name: 'Iced Caramel Latte', price: 160, image: 'https://images.unsplash.com/photo-1461023058943-0708e58231cb?q=80&w=600&auto=format&fit=crop', desc: 'Chilled espresso with caramel swirl' },
        { id: 'dr-2', name: 'Mango Smoothie', price: 140, image: 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?q=80&w=600&auto=format&fit=crop', desc: 'Fresh seasonal mango blended' },
        { id: 'dr-3', name: 'Mint Mojito Mocktail', price: 120, image: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?q=80&w=600&auto=format&fit=crop', desc: 'Refreshing lime and mint cooler' }
      ],
      gym: [
        { id: 'gym-1', name: 'Whey Protein (1kg)', price: 2400, image: 'https://images.unsplash.com/photo-1579722820308-d74e571900a9?q=80&w=600&auto=format&fit=crop', desc: '100% Gold Standard Isolate' },
        { id: 'gym-2', name: 'Pre-Workout Rush', price: 1800, image: 'https://images.unsplash.com/photo-1594882645126-14020914d58d?q=80&w=600&auto=format&fit=crop', desc: 'Explosive energy and focus' },
        { id: 'gym-3', name: 'Steel Shaker Bottle', price: 450, image: 'https://images.unsplash.com/photo-1622393358058-294b0d014c99?q=80&w=600&auto=format&fit=crop', desc: '750ml leak-proof protein shaker' }
      ],
      rentals: [
        { id: 'ren-1', name: 'City Bicycle (Daily)', price: 150, image: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?q=80&w=600&auto=format&fit=crop', desc: 'Comfortable geared cycle' },
        { id: 'ren-2', name: 'Electric Scooter (Hourly)', price: 80, image: 'https://images.unsplash.com/photo-1595821927361-4238421d7baa?q=80&w=600&auto=format&fit=crop', desc: 'Fast EV scooter for campus' }
      ],
      fruits: [
        { id: 'fr-1', name: 'Fresh Apples (1kg)', price: 180, image: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6faa6?q=80&w=600&auto=format&fit=crop', desc: 'Crisp and sweet Washington apples' },
        { id: 'fr-2', name: 'Banana Bunch', price: 60, image: 'https://images.unsplash.com/photo-1603833665858-e61d17a86224?q=80&w=600&auto=format&fit=crop', desc: 'Premium robusta bananas' },
        { id: 'fr-3', name: 'Mixed Fruit Bowl', price: 120, image: 'https://images.unsplash.com/photo-1490474504059-cb14e08bfcd2?q=80&w=600&auto=format&fit=crop', desc: 'Freshly cut seasonal fruits' }
      ],
      pharmacy: [
        { id: 'phar-1', name: 'Paracetamol 500mg', price: 30, image: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ad?q=80&w=600&auto=format&fit=crop', desc: 'Fever and pain relief (Strip of 10)' },
        { id: 'phar-2', name: 'Multivitamin Complex', price: 250, image: 'https://images.unsplash.com/photo-1550572017-edb730592fdb?q=80&w=600&auto=format&fit=crop', desc: 'Daily health supplement (30 tabs)' },
        { id: 'phar-3', name: 'First Aid Kit Basic', price: 350, image: 'https://images.unsplash.com/photo-1603398938378-e54eab446dde?q=80&w=600&auto=format&fit=crop', desc: 'Bandages, antiseptic, cotton' }
      ],
      laundry: [
        { id: 'laun-1', name: 'Wash & Fold (Per kg)', price: 60, image: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?q=80&w=600&auto=format&fit=crop', desc: 'Standard machine wash and fold' },
        { id: 'laun-2', name: 'Premium Dry Cleaning', price: 150, image: 'https://images.unsplash.com/photo-1517677208171-0bc6725a3e60?q=80&w=600&auto=format&fit=crop', desc: 'For blazers and delicate fabrics' },
        { id: 'laun-3', name: 'Steam Ironing (Per pc)', price: 15, image: 'https://images.unsplash.com/photo-1590393802821-396a84c8a209?q=80&w=600&auto=format&fit=crop', desc: 'Crisp finish steam pressing' }
      ],
      seasonal: [
        { id: 'seas-1', name: 'Festive Sweet Box', price: 550, image: 'https://images.unsplash.com/photo-1605493725791-318e874959db?q=80&w=600&auto=format&fit=crop', desc: 'Assorted premium mithai' },
        { id: 'seas-2', name: 'Handmade Diyas (Set of 6)', price: 120, image: 'https://images.unsplash.com/photo-1603512392250-705a39626388?q=80&w=600&auto=format&fit=crop', desc: 'Decorative clay lamps' }
      ]
    };
    return data[id] || [];
  };

  const mockItems = getMockData(categoryId);

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-white text-black font-sans pb-24">
      <Navbar />

      <main className="pt-24 px-6 max-w-7xl mx-auto">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8 flex items-center justify-between"
        >
          <div className="flex items-center gap-4">
            <button onClick={() => router.back()} className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
              <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div>
              <h2 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.4em] mb-1">Zenvy Hub</h2>
              <p className="text-3xl font-black text-black tracking-tight">{getCategoryName(categoryId)}</p>
            </div>
          </div>
          <Link href="/others" className="text-xs font-bold text-gray-500 hover:text-black underline underline-offset-4">
            View All Categories
          </Link>
        </motion.div>

        {mockItems.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {mockItems.map((item, index) => (
              <motion.div 
                key={item.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + (index * 0.1) }}
                className="group bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300"
              >
                <div className="relative w-full h-48 overflow-hidden bg-gray-100">
                  <SafeImage src={item.image} alt={item.name} fill style={{ objectFit: 'cover' }} className="group-hover:scale-110 transition-transform duration-500" />
                </div>
                <div className="p-5">
                  <h3 className="text-lg font-bold text-gray-900 mb-1">{item.name}</h3>
                  <p className="text-xs text-gray-500 mb-4 line-clamp-2">{item.desc}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-black text-black">₹{item.price}</span>
                    <button 
                      onClick={() => addToCart({ ...item, quantity: 1, restaurantId: 'mock-vendor' })}
                      className="px-4 py-2 bg-black text-white rounded-full text-xs font-bold hover:bg-gray-800 transition-colors"
                    >
                      Add to Cart
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="flex flex-col items-center justify-center py-20 text-center bg-gray-50 rounded-3xl border border-gray-100"
          >
            <div className="text-6xl mb-4">🚀</div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Coming Soon</h3>
            <p className="text-gray-500 max-w-sm mb-6 text-sm">
              We are actively working with campus vendors to bring the best {getCategoryName(categoryId).toLowerCase()} directly to your fingertips.
            </p>
            <Link href="/others" className="px-6 py-3 bg-black text-white rounded-full font-bold text-sm hover:scale-105 transition-transform shadow-xl">
              Explore Other Services
            </Link>
          </motion.div>
        )}
      </main>
    </div>
  );
}
