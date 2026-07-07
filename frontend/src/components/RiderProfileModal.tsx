"use client";
import { motion, AnimatePresence } from 'framer-motion';
import SafeImage from './SafeImage';

interface RiderProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  partner: {
    name: string;
    phone?: string;
    photoUrl?: string;
    averageRating?: number;
    totalRatings?: number;
    vehicleType?: string;
    vehicleNumber?: string;
    bio?: string;
  } | null;
}

export default function RiderProfileModal({ isOpen, onClose, partner }: RiderProfileModalProps) {
  if (!partner) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-xl"
          />
          
          <motion.div 
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="relative w-full max-w-sm glass-card p-8 border-primary-yellow/20 overflow-hidden"
          >
            {/* Background Grain/Texture */}
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
            
            <button 
              onClick={onClose}
              className="absolute top-4 right-4 p-4 text-white light:text-gray-900/40 hover:text-white light:text-gray-900 transition-colors text-2xl font-bold z-50 cursor-pointer"
            >
              ✕
            </button>

            <div className="flex flex-col items-center text-center relative z-10">
              <div className="w-32 h-32 rounded-[40px] overflow-hidden border-2 border-primary-yellow/30 shadow-2xl mb-6 bg-slate-800">
                {partner.photoUrl ? (
                  <SafeImage src={partner.photoUrl} alt={partner.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-5xl">🛵</div>
                )}
              </div>

              <div className="mb-6">
                <div className="flex items-center justify-center gap-2 mb-1">
                   <h2 className="text-xl font-black text-white light:text-gray-900 uppercase tracking-tighter">{partner.name}</h2>
                   <span className="bg-emerald-500/10 text-emerald-500 text-[8px] font-black px-2 py-0.5 rounded border border-emerald-500/20">VERIFIED</span>
                </div>
                <div className="flex items-center justify-center gap-2 text-primary-yellow mb-2">
                   <span className="text-sm font-black">{partner.averageRating || '5.0'} ⭐</span>
                   <span className="text-[10px] text-white light:text-gray-900/40 uppercase font-black tracking-widest">({partner.totalRatings || 0} Deliveries)</span>
                </div>
                {partner.phone && (
                  <p className="text-sm font-bold text-white light:text-gray-900/70 tracking-widest">{partner.phone}</p>
                )}
              </div>

              <div className="w-full space-y-3 mb-8">
                 {(partner.vehicleType || partner.vehicleNumber) && (
                   <div className="bg-white/5 border border-white/5 p-4 rounded-3xl text-left">
                      <p className="text-[8px] font-black text-white light:text-gray-900/30 uppercase tracking-[0.2em] mb-1.5">Vehicle</p>
                      <div className="flex items-center justify-between">
                         {partner.vehicleType && <span className="text-xs font-bold text-white light:text-gray-900 uppercase">{partner.vehicleType}</span>}
                         {partner.vehicleNumber && (
                           <span className="bg-white/10 px-3 py-1 rounded-xl text-[10px] font-black text-primary-yellow border border-white/5">
                             {partner.vehicleNumber}
                           </span>
                         )}
                      </div>
                   </div>
                 )}

                 <div className="flex gap-3">
                   <a 
                     href={`tel:${partner.phone}`}
                     className="flex-[2] bg-primary-yellow hover:bg-white text-black py-4 rounded-[40px] font-black uppercase tracking-[0.1em] text-sm transition-all shadow-xl shadow-primary-yellow/20 active:scale-95 text-center"
                   >
                     📞 Call
                   </a>
                   {partner.phone && (
                     <a
                       href={`https://wa.me/91${partner.phone?.replace(/\D/g,'')}`}
                       target="_blank"
                       rel="noopener noreferrer"
                       className="flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-400 py-4 rounded-[40px] font-black uppercase tracking-[0.1em] text-sm transition-all active:scale-95 text-center"
                     >
                       💬
                     </a>
                   )}
                 </div>
              </div>

              {partner.bio && (
                <div className="text-left w-full">
                   <p className="text-[8px] font-black text-white light:text-gray-900/30 uppercase tracking-widest mb-2">Captain&apos;s Note</p>
                   <p className="text-[10px] text-white light:text-gray-900/60 italic leading-relaxed">&quot;{partner.bio}&quot;</p>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
