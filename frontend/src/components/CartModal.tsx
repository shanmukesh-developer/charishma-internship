import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SuccessOverlay from './SuccessOverlay';

interface CartModalProps {
  isOpen: boolean;
  onClose: () => void;
}

import { User } from '@/types';

const CartModal = ({ isOpen, onClose }: CartModalProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [isSuccessOpen, setIsSuccessOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) setUser(JSON.parse(stored));
  }, [isOpen]);

  const handleCheckout = () => {
    setIsSuccessOpen(true);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative w-full max-w-xl bg-[#0A0A0B] border border-white/10 rounded-[40px] p-10 shadow-2xl animate-reveal backdrop-blur-2xl">
        <div className="flex justify-between items-center mb-10">
          <h2 className="text-3xl font-black uppercase tracking-widest text-[#C9A84C] drop-shadow-[0_0_10px_rgba(201,168,76,0.3)]">Your Selection</h2>
          <button onClick={onClose} className="p-3 hover:bg-[#C9A84C]/10 rounded-full transition-colors text-white light:text-gray-900/40">✕</button>
        </div>

        {/* Feature Highlight: Batch Delivery */}
        <div className="bg-[#0A0A0B] border border-[#C9A84C]/10 rounded-3xl p-6 mb-10 flex items-center space-x-6">
          <div className="w-16 h-16 bg-gradient-to-br from-[#1C1C1E] to-black rounded-2xl flex items-center justify-center border border-[#C9A84C]/20">
            {user?.isElite ? (
              <svg className="w-10 h-10 text-[#C9A84C] drop-shadow-[0_0_15px_rgba(201,168,76,0.5)]" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M25 25 L75 25 L25 75 L75 75" />
              </svg>
            ) : (
              <span className="text-3xl">🧑‍🎓</span>
            )}
          </div>
          <div>
            <p className="text-[10px] font-black tracking-widest text-[#C9A84C] uppercase mb-1">Privilege Window</p>
            <h4 className="font-bold text-white light:text-gray-900">Next Curated Batch: 7:30 PM</h4>
            <p className="text-xs text-white light:text-gray-900/40">Includes complimentary artisanal gift.</p>
          </div>
        </div>

        <div className="space-y-6 mb-12">
            <div className="flex justify-between items-center">
                <div>
                   <p className="font-bold text-white light:text-gray-900">Margherita Artisanal</p>
                   <p className="text-[10px] text-white light:text-gray-900/30 uppercase tracking-widest">Quantity: 01</p>
                </div>
                <span className="font-bold text-[#C9A84C]">₹249</span>
            </div>
            
            <div className="flex justify-between items-center text-[#C9A84C] italic font-medium">
                <span>Loyalty Distinction Applied</span>
                <span>-₹49</span>
            </div>

            <div className="bg-white/[0.03] p-6 rounded-3xl flex justify-between items-center border border-white/5">
                <div>
                   <p className="font-bold text-white light:text-gray-900 text-sm">Gate Reception</p>
                   <p className="text-[10px] text-white light:text-gray-900/30 uppercase tracking-widest mt-1">Acquire at Hostel Gate for 30% Relief</p>
                </div>
                <div className="w-12 h-6 bg-[#C9A84C]/20 rounded-full flex items-center px-1 cursor-pointer">
                    <div className="w-4 h-4 bg-[#C9A84C] rounded-full translate-x-6" />
                </div>
            </div>
        </div>

        <div className="border-t border-white/10 pt-8 space-y-3 mb-12">
          <div className="flex justify-between text-white light:text-gray-900/30 text-xs font-black uppercase tracking-widest">
            <span>Subtotal</span>
            <span>₹200</span>
          </div>
          <div className="flex justify-between text-white light:text-gray-900/30 text-xs font-black uppercase tracking-widest">
            <span>Service & Logistics</span>
            <span>₹25</span>
          </div>
          <div className="flex justify-between items-end pt-4">
            <span className="text-xl font-black uppercase tracking-widest text-white light:text-gray-900/60">Total</span>
            <span className="text-3xl font-black text-[#C9A84C]">₹225</span>
          </div>
        </div>

        <button 
          onClick={handleCheckout}
          className="w-full py-5 rounded-full bg-gradient-to-r from-[#C9A84C] via-[#E8D18C] to-[#C9A84C] text-black text-sm font-black tracking-[0.2em] shadow-xl shadow-primary-yellow/20 active:scale-95 transition-all"
        >
          PROCEED TO SECURE PAYMENT
        </button>
      </div>

      <SuccessOverlay 
        isOpen={isSuccessOpen} 
        onClose={() => {
          setIsSuccessOpen(false);
          onClose();
          router.push('/tracking');
        }} 
        title="Order Successful" 
        message="Your package is secured. Routing to Mission Tracking..." 
      />
    </div>
  );
};

export default CartModal;
