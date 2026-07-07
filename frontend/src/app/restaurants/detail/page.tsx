"use client";
import Link from 'next/link';
import { useState } from 'react';
import { useCart } from '@/context/CartContext';
import Image from 'next/image';

export default function DetailPage() {
  const [quantity, setQuantity] = useState(2);
  const { addToCart } = useCart();

  const handleAdd = () => {
    addToCart({
      id: 'biryani-01', // Logic for dynamic IDs later
      name: 'Special Chicken Dum Biryani',
      price: 249,
      quantity,
      image: 'https://images.unsplash.com/photo-1589302168068-1c498202f722?q=80&w=600&auto=format&fit=crop',
      restaurantId: 'saffron-hub'
    });
    const btn = document.getElementById('basket-btn');
    if (btn) {
       const orig = btn.innerText;
       btn.innerText = 'Added! 🚀';
       btn.classList.add('bg-emerald-500', 'text-white light:text-gray-900');
       setTimeout(() => {
          btn.innerText = orig;
          btn.classList.remove('bg-emerald-500', 'text-white light:text-gray-900');
       }, 2000);
    }
  };

  return (
    <main className="min-h-screen bg-background text-white light:text-gray-900 relative overflow-hidden flex flex-col">
      {/* Wave Background Overlay at bottom */}
      <div className="wave-bg dark-wave " />

      {/* Header */}
      <div className="relative z-10 p-8 flex items-center justify-between">
        <Link href="/" className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center border border-white/10">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h2 className="text-[17px] font-bold tracking-tight opacity-90">Saffron Hub</h2>
        <div className="w-12 shrink-0" /> {/* Spacer */}
      </div>

      {/* Main Product View */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-10">
        {/* Large Centered Product Image */}
        <div className="relative w-full max-w-[320px] aspect-square mb-12 animate-float">
          {/* Subtle light glow behind image */}
          <div className="absolute inset-0 bg-primary-yellow/20 blur-[100px] rounded-full" />
          <Image 
            src="/images/biryani.png" 
            alt="Biryani"
            fill
            style={{ objectFit: 'contain' }}
            className="relative z-10 drop-shadow-[0_20px_50px_rgba(0,0,0,0.8)]"
          />
        </div>

        {/* Product Title */}
        <h1 className="text-[32px] font-black text-center leading-tight mb-10">
          Special Chicken <br /> Dum Biryani
        </h1>

        {/* Quantity Selector Pill */}
        <div className="flex flex-col items-center gap-6">
           <div className="qty-pill">
              <button 
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="qty-btn"
              >−</button>
              <span className="text-[28px] font-black w-10 text-center">
                {quantity.toString().padStart(2, '0')}
              </span>
              <button 
                onClick={() => setQuantity(quantity + 1)}
                className="qty-btn"
              >+</button>
           </div>
           
           {/* Price Tag */}
           <div className="price-box">
             ₹249.00
           </div>
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="relative z-20 p-10 pt-4 flex gap-4 items-center">
        <button 
          onClick={handleAdd}
          className="flex-1 bg-white/5 hover:bg-white/10 transition-colors border border-white/10 h-[72px] rounded-[36px] flex items-center justify-center font-black text-[15px] uppercase tracking-widest"
        >
           Add To Cart
        </button>
        
        <button onClick={() => window.location.href = '/checkout'} className="w-[72px] h-[72px] bg-black border border-white/10 flex items-center justify-center rounded-[24px] shadow-2xl">
           <svg className="w-7 h-7 text-primary-yellow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
           </svg>
        </button>
      </div>
    </main>
  );
}
