"use client";
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCart, Customizations } from '@/context/CartContext';
import SafeImage from '@/components/SafeImage';
import SuccessOverlay from '@/components/SuccessOverlay';
import CustomizeDrawer, { summarizeCustomizations } from '@/components/CustomizeDrawer';
import { MenuItem } from '@/types';
import Tilt from '@/components/Tilt';
import Magnetic from '@/components/Magnetic';
import { saveRecentlyViewed } from '@/components/RecentlyViewed';
import { API_URL } from '@/utils/api';
import ZenvyLoader from '@/components/ZenvyLoader';

export default function ProductDetailClient({ productId }: { productId: string }) {
  const router = useRouter();
  const { cart, addToCart, updateQuantity, removeFromCart } = useCart();
  const [product, setProduct] = useState<MenuItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [netError, setNetError] = useState(false);
  const [overlay, setOverlay] = useState<{ isOpen: boolean; title: string; message: string; type?: 'success' | 'error' }>({
    isOpen: false,
    title: '',
    message: '',
  });

  const [showCustomize, setShowCustomize] = useState(false);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const cleanId = productId.replace(/\/$/, "");
    fetch(`${API_URL}/api/users/products/${cleanId}`)
      .then(res => {
        if (!res.ok) throw new Error('NOT_FOUND');
        return res.json();
      })
      .then(data => {
        if (data && (data.name || data.id)) {
          const productData = { ...data, image: data.imageUrl || data.image };
          setProduct(productData);
          saveRecentlyViewed({
            id: productId,
            name: productData.name,
            image: productData.image,
            type: 'product',
            price: productData.price,
            restaurantName: productData.restaurantName
          });
        } else {
          setNetError(true);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('[FETCH_PRODUCT_ERROR]', err);
        setNetError(true); // Treat connection refuse as netError
        setLoading(false);
      });
  }, [productId]);

  if (loading) return <ZenvyLoader message="Accessing Product Matrix..." />;
  
  if (netError) {
    return (
      <div className="p-20 text-white light:text-gray-900 min-h-screen flex flex-col items-center justify-center text-center gap-6 bg-[#0A0A0B]">
        <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center animate-pulse">
           <svg className="w-10 h-10 text-primary-yellow/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
        </div>
        <div>
          <h2 className="text-2xl font-black mb-2">Zenvy Servers are sleeping</h2>
          <p className="text-zinc-500 max-w-xs mx-auto">We&apos;re performing a quick system sweep. Please try refreshing in a few seconds.</p>
        </div>
        <button onClick={() => window.location.reload()} className="px-8 py-3 bg-white/5 border border-white/10 rounded-full hover:bg-white/10 transition-all font-bold">Wake them up</button>
      </div>
    );
  }

  if (!product) return <div className="p-20 text-white light:text-gray-900 min-h-screen text-center font-bold">Product not found.</div>;

  const cartItem = cart.find(i => i.id === (product.id || product._id));
  const currentQty = cartItem ? cartItem.quantity : 0;

  const handleInstantAdd = () => {
    setShowCustomize(true);
  };

  const handleCustomizeConfirm = (customizations: Customizations, finalPrice: number) => {
    setShowCustomize(false);
    addToCart({
      id: product.id || product._id || "",
      name: product.name,
      price: finalPrice,
      basePrice: product.price,
      quantity: 1,
      image: product.image || product.imageUrl || "",
      restaurantId: product.restaurantId || 'unknown',
      restaurantName: product.restaurantName || 'Zenvy Kitchen',
      customizations,
    });
    setOverlay({
      isOpen: true,
      title: 'Added to Basket',
      message: `${product.name} (${summarizeCustomizations(customizations) || 'default'}) added to cart.`,
      type: 'success'
    });
  };

  return (
    <main className="min-h-screen bg-[#0A0A0B] light:bg-[#f8f8fa] text-white light:text-black relative flex flex-col overflow-x-hidden">
      {/* ── Immersive Full-Bleed Parallax Hero Image ── */}
      <div className="relative h-[380px] w-full shrink-0 overflow-hidden">
         <div 
           className="absolute inset-0 w-full h-full"
         >
           <SafeImage 
             src={product.image || product.imageUrl || "/assets/placeholder_premium.png"} 
             alt={product.name}
             fill
             style={{ objectFit: 'cover' }}
             priority
           />
         </div>
          {/* Sharp bottom mask to blend image into background, leaving the top 100% clear */}
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#0A0A0B] to-transparent light:from-[#f8f8fa]" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/80 to-transparent h-40 light:from-black" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(201,168,76,0.1),transparent_70%)]" />
          <div className="absolute inset-0 bg-[#0A0A0B]/30 light:bg-transparent" />

         {/* Hero Top Nav */}
         <div className="absolute top-0 left-0 right-0 p-4 md:p-8 pt-10 md:pt-12 flex justify-between items-center z-20 bg-gradient-to-b from-black/80 light:from-white to-transparent">
           <Link href="/" onClick={(e) => { e.preventDefault(); router.back(); }} className="w-12 h-12 bg-white/5 light:bg-black backdrop-blur-xl rounded-full flex items-center justify-center border border-white/10 light:border-gray-200 light:shadow-[0_4px_15px_rgba(0,0,0,0.05)] hover:bg-white/10 light:hover:bg-black/10 hover:scale-105 transition-all shadow-2xl text-white light:text-black">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
              </svg>
           </Link>
           <div className="bg-black/40 light:bg-white backdrop-blur-xl border border-white/10 light:border-gray-200 light:shadow-[0_4px_15px_rgba(0,0,0,0.05)] px-4 py-2 rounded-full flex items-center gap-2 text-white light:text-black">
             <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
             <span className="text-[9px] uppercase font-black tracking-widest">Available Now</span>
           </div>
         </div>

         {/* Scroll Indicator */}
         <div className={`absolute bottom-20 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 transition-opacity duration-500 ${scrollY > 50 ? 'opacity-0 pointer-events-none' : 'opacity-80'}`}>
            <div className="w-5 h-8 border border-white/30 light:border-gray-200 light:shadow-[0_4px_15px_rgba(0,0,0,0.05)] rounded-full flex justify-center pt-2">
               <div className="w-1 h-1.5 bg-white/60 light:bg-black rounded-full animate-[bounce_1.5s_infinite]" />
            </div>
            <span className="text-[8px] uppercase tracking-[0.3em] font-bold text-white light:text-gray-900/50 light:text-black">Explore</span>
         </div>
      </div>

      {/* ── Product Details Content ── */}
      <div className="flex-1 -mt-16 relative z-10 px-4 md:px-8 pb-40">
         {/* Ambient Breathing Orb */}
         <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[300px] bg-primary-yellow/10 blur-[120px] rounded-full pointer-events-none animate-pulse mix-blend-screen light:mix-blend-multiply light:" />

         <div className="mb-10 relative animate-in fade-in slide-in-from-bottom-8 duration-1000" style={{ animationFillMode: 'both', animationDelay: '100ms' }}>
            <span className="text-[10px] uppercase tracking-[0.4em] text-primary-yellow font-black block mb-4 drop-shadow-md">Zenvy Signature Selection</span>
            <h1 className="text-4xl md:text-5xl font-black text-white light:text-black leading-[1] mb-6 drop-shadow-2xl text-gold-shimmer">{product.name}</h1>
            <p className="text-[15px] text-zinc-300/60 light:text-zinc-600 leading-relaxed font-medium max-w-[95%]">{product.description || `An exquisite culinary masterpiece crafted with the finest ingredients and precision.`}</p>
         </div>

         {/* ── Elite Attributes Grid with Tilt ── */}
         <div className="grid grid-cols-3 gap-4 mb-12 relative animate-in fade-in slide-in-from-bottom-8 duration-1000" style={{ animationFillMode: 'both', animationDelay: '250ms' }}>
            {[
              { icon: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z', label: 'Premium\nQuality' },
              { icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', label: 'Made\nFresh' },
              { icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', label: 'Elite\nStandard' }
            ].map((attr, i) => (
              <Tilt key={i} scale={1.05} className="rounded-[24px] md:rounded-[32px]">
                <div className="bg-black/40 light:bg-white backdrop-blur-xl border border-white/5 light:border-gray-200 light:shadow-[0_4px_15px_rgba(0,0,0,0.05)] rounded-[24px] md:rounded-[32px] p-2 sm:p-4 md:p-5 py-5 md:py-6 flex flex-col items-center justify-center text-center gap-2 md:gap-3 hover:bg-white/[0.08] light:hover:bg-white hover:border-primary-yellow/30 transition-all duration-500 group h-full shadow-sm light:shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
                   <svg className="w-7 h-7 text-primary-yellow group-hover:scale-110 transition-transform duration-500 filter drop-shadow-[0_0_8px_rgba(201,168,76,0.2)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={attr.icon} /></svg>
                   <span className="text-[7px] sm:text-[10px] uppercase tracking-[0.1em] sm:tracking-[0.25em] font-black text-white light:text-gray-900/40 light:text-black group-hover:text-white light:text-gray-900/70 light:group-hover:text-black transition-colors leading-tight whitespace-pre">{attr.label}</span>
                </div>
              </Tilt>
            ))}
         </div>

         <div className="gold-line mb-8 opacity-20 relative animate-in fade-in duration-1000" style={{ animationFillMode: 'both', animationDelay: '400ms' }} />

         <div className="flex justify-between items-center mb-4 relative animate-in fade-in slide-in-from-bottom-8 duration-700" style={{ animationFillMode: 'both', animationDelay: '300ms' }}>
            <div>
               <p className="text-[10px] uppercase tracking-[0.3em] text-secondary-text mb-1.5 font-bold">Total Price</p>
               <div className="text-[34px] font-black text-primary-yellow light:!text-[#EF4F5F] tracking-tighter drop-shadow-[0_0_15px_rgba(201,168,76,0.2)] light:drop-shadow-none">
                 ₹{product.price * (currentQty || 1)}
               </div>
            </div>

            {/* Premium Quantity Selector */}
            <div className="flex items-center gap-4 md:gap-6 bg-white/[0.03] light:bg-white backdrop-blur-2xl border border-white/5 light:border-gray-200 rounded-full px-2 py-2 md:px-3 md:py-3 shadow-inner light:shadow-[0_4px_15px_rgba(0,0,0,0.05)]">
               <Magnetic>
                 <button 
                   onClick={() => {
                     if (currentQty > 1) updateQuantity(product.id || product._id || "", currentQty - 1);
                     else if (currentQty === 1) removeFromCart(product.id || product._id || "");
                   }}
                   className="w-12 h-12 rounded-full bg-black light:bg-[#F4F4F5] text-white light:text-black border border-white/5 light:border-gray-200 flex items-center justify-center text-xl hover:bg-white/10 light:hover:bg-[#E4E4E7] active:scale-90 transition-all shadow-xl light:shadow-none"
                 >−</button>
               </Magnetic>
               <span className="text-2xl font-black w-6 text-center tabular-nums text-white light:text-black">
                 {currentQty}
               </span>
               <Magnetic>
                 <button 
                   onClick={() => {
                     if (currentQty === 0) handleInstantAdd();
                     else updateQuantity(product.id || product._id || "", currentQty + 1);
                   }}
                   className="w-12 h-12 rounded-full bg-gradient-to-br from-[#C9A84C] to-[#8B7332] light:!bg-none light:bg-[#EF4F5F] text-black light:text-white light:text-gray-900 border border-transparent shadow-[0_0_25px_rgba(201,168,76,0.35)] light:shadow-[0_0_25px_rgba(239,79,95,0.35)] flex items-center justify-center text-xl hover:brightness-110 active:scale-90 transition-all"
                 >+</button>
               </Magnetic>
            </div>
         </div>
      </div>

      {/* ── Bottom Action Bar ── */}
      <div className="fixed bottom-0 left-0 right-0 pr-6 pt-12 pb-8 pl-[84px] md:px-6 md:pt-12 md:pb-8 bg-gradient-to-t from-[#050507] via-[#050507]/95 light:from-[#f8f8fa] light:via-[#f8f8fa] to-transparent z-[110] animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-500" style={{ animationFillMode: 'both' }}>
        <div className="flex gap-3 md:gap-4">
           {currentQty === 0 ? (
             <button 
               onClick={handleInstantAdd}
               className="flex-1 bg-gradient-to-r from-[#C9A84C] via-[#E8D18C] to-[#C9A84C] light:!bg-none light:bg-[#EF4F5F] text-black light:text-white light:text-gray-900 h-[70px] rounded-[24px] flex items-center justify-center gap-1.5 sm:gap-3 shadow-[0_15px_30px_-10px_rgba(201,168,76,0.4)] light:shadow-[0_8px_20px_-6px_rgba(239,79,95,0.5)] transition-all active:scale-95 hover:brightness-110 group overflow-hidden relative"
             >
                <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-12" />
                <span className="font-black text-[11px] sm:text-[13px] uppercase tracking-normal sm:tracking-[0.1em] whitespace-nowrap relative z-10">Add To Cart</span>
                <span className="w-1.5 h-1.5 rounded-full bg-black/40 light:bg-white relative z-10" />
                <span className="font-black text-[13px] sm:text-[15px] whitespace-nowrap relative z-10">₹{product.price}</span>
             </button>
           ) : (
             <Link 
               href="/basket"
               className="flex-1 bg-gradient-to-r from-[#C9A84C] via-[#E8D18C] to-[#C9A84C] light:!bg-none light:bg-[#EF4F5F] text-black light:text-white light:text-gray-900 h-[70px] rounded-[24px] flex items-center justify-center gap-1 sm:gap-2 shadow-[0_15px_30px_-10px_rgba(201,168,76,0.4)] light:shadow-[0_8px_20px_-6px_rgba(239,79,95,0.5)] transition-all active:scale-95 group relative overflow-hidden"
             >
                <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-12" />
                <span className="font-black text-[10px] sm:text-[13px] uppercase tracking-normal sm:tracking-[0.1em] whitespace-nowrap relative z-10">Basket</span>
                <span className="w-1.5 h-1.5 rounded-full bg-black/20 relative z-10" />
                <span className="font-black text-[12px] sm:text-[14px] whitespace-nowrap relative z-10">{currentQty} Itm (₹{product.price * currentQty})</span>
             </Link>
           )}
           
           <Link href="/basket" className="w-[70px] h-[70px] shrink-0 bg-[#1A1A1C] light:bg-white border border-white/10 light:border-gray-200 light:shadow-[0_4px_15px_rgba(0,0,0,0.05)] flex items-center justify-center rounded-[24px] hover:bg-white/10 light:hover:bg-black/5 hover:border-[#C9A84C]/50 transition-all active:scale-95 shadow-xl group">
              <svg className="w-6 h-6 text-white light:text-black group-hover:text-[#C9A84C] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
           </Link>
        </div>
      </div>

      <CustomizeDrawer
        isOpen={showCustomize}
        onClose={() => setShowCustomize(false)}
        onConfirm={handleCustomizeConfirm}
        itemName={product.name}
        basePrice={product.price}
        tags={product.tags}
        category={product.category}
      />

      <SuccessOverlay 
        isOpen={overlay.isOpen}
        title={overlay.title}
        message={overlay.message}
        type={overlay.type}
        onClose={() => setOverlay(prev => ({ ...prev, isOpen: false }))}
      />
    </main>
  );
}
