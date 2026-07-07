"use client";
import { useState, useEffect, useRef } from 'react';
import SafeImage from './SafeImage';
import { motion, AnimatePresence } from 'framer-motion';
import VaultClaimModal from './VaultClaimModal';
import { API_URL } from '@/utils/api';

interface VaultItem {
  id: string;
  _id?: string; // For compatibility
  name: string;
  price: number;
  originalPrice: number;
  remainingCount: number;
  imageUrl: string;
  image?: string;
  streakRequirement?: number;
}

export default function ZenvyVault() {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [countdown, setCountdown] = useState('');
  const [isVaultActive, setIsVaultActive] = useState(true);
  const [userStreak, setUserStreak] = useState(0);
  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const vaultRef = useRef<HTMLDivElement>(null);
  const [rotateX, setRotateX] = useState(0);
  const [rotateY, setRotateY] = useState(0);

  useEffect(() => {
    fetchVaultItems();
    fetchUserStreak();
  }, []);

  const fetchVaultItems = async () => {
    try {
      const res = await fetch(`${API_URL}/api/vault`);
      const data = await res.json();
      if (res.ok) {
        const mappedData = data.map((item: VaultItem) => ({
          ...item,
          _id: item.id
        }));
        setItems(mappedData);
      }
    } catch (err) {
      console.error('[VAULT_FETCH_ERROR]', err);
    }
  };

  const fetchUserStreak = async () => {
    try {
      const res = await fetch(`${API_URL}/api/users/profile`, {
        headers: { 'Authorization': `Bearer ${'cookie-managed'}` }
      });
      const data = await res.json();
      setUserStreak(data.user?.streakCount || 0);
    } catch (err) {
      console.error('[STREAK_FETCH_ERROR]', err);
    }
  };

  const handleSecureAccess = (item: VaultItem) => {
    setSelectedItem(item);
    setIsModalOpen(true);
  };

  const handleClaim = async (itemId: string) => {
    console.log('[VAULT_CLAIM] Attempting match for:', itemId);
    try {
      const res = await fetch(`${API_URL}/api/vault/claim/${itemId}`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${'cookie-managed'}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await res.json();
      
      if (res.ok) {
        console.log('[VAULT_CLAIM_SUCCESS]', data.message);
        // Refresh items to update remainingCount
        fetchVaultItems();
        // The modal will handle the "Success" state internally or we can pass a prop
        return true; 
      } else {
        console.error('[VAULT_CLAIM_ERROR]', data.message);
        return false;
      }
    } catch (err) {
      console.error('[VAULT_CLAIM_API_ERROR]', err);
      return false;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!vaultRef.current || isOpen) return;
    const rect = vaultRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateXValue = (y - centerY) / 10;
    const rotateYValue = (centerX - x) / 10;
    setRotateX(rotateXValue);
    setRotateY(rotateYValue);
  };

  const handleMouseLeave = () => {
    setRotateX(0);
    setRotateY(0);
  };

  useEffect(() => {
    const endTime = new Date();
    endTime.setHours(23, 59, 59, 999);

    const timer = setInterval(() => {
      const now = new Date().getTime();
      const distance = endTime.getTime() - now;

      if (distance < 0) {
        setIsVaultActive(false);
        setCountdown("CLOSED");
        clearInterval(timer);
        return;
      }

      const h = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((distance % (1000 * 60)) / 1000);
      setCountdown(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  if (items.length === 0 && !isOpen) return null;

  return (
    <motion.div 
      ref={vaultRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      animate={{ 
        rotateX: isOpen ? 0 : rotateX, 
        rotateY: isOpen ? 0 : rotateY,
        scale: isOpen ? 1 : 1.02
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className={`relative rounded-[32px] overflow-hidden transition-all duration-700 ${isOpen ? 'vault-wrapper-open shadow-[0_30px_100px_rgba(0,0,0,0.8)]' : 'bg-transparent'}`}
      style={{ transformStyle: 'preserve-3d' }}
    >
      {/* Background Glow */}
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-gradient-to-b from-[#C9A84C]/10 via-transparent to-transparent pointer-events-none z-0" 
          />
        )}
      </AnimatePresence>

      {/* Main Header / Trigger */}
      <div 
        onClick={() => isVaultActive && setIsOpen(!isOpen)}
        className={`vault-header rounded-[32px] p-4 px-6 flex items-center justify-between cursor-pointer ${isOpen ? 'rounded-b-none' : ''} transition-all z-10 relative`}
      >
        <div className="flex items-center gap-5">
           <div className="w-14 h-14 rounded-full bg-black border border-[#C9A84C]/30 flex items-center justify-center relative shadow-[0_0_25px_rgba(201,168,76,0.2)] group">
              <span className="text-2xl group-hover:scale-125 transition-transform duration-500">✨</span>
              {isVaultActive && !isOpen && (
                <motion.div 
                  animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute inset-0 rounded-full border border-[#C9A84C]" 
                />
              )}
           </div>
           <div>
              <h3 className="text-xs font-black text-white light:text-black uppercase tracking-[0.3em] leading-tight mb-1">The Zenvy Vault</h3>
              <p className="text-[9px] font-bold text-gray-400 light:text-gray-500 uppercase tracking-widest">{items.length} ULTRA-PREMIUM DROPS</p>
           </div>
        </div>

        <div className="text-right flex flex-col items-end">
           {isVaultActive ? (
             <div className="flex flex-col items-end">
                <div className="bg-[#C9A84C]/10 border border-[#C9A84C]/30 light:bg-[#FFF9E6] light:border-[#FFE082] px-4 py-1.5 rounded-full mb-1 flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#C9A84C] animate-pulse" />
                  <span className="text-[11px] font-black text-[#C9A84C] light:text-[#D4A017] font-mono tracking-wider">{countdown}</span>
                </div>
                <span className="text-[8px] font-black uppercase text-secondary-text tracking-[0.3em]">UNTIL SEALED</span>
             </div>
           ) : (
             <span className="text-[10px] font-black text-red-500 uppercase tracking-widest px-4 py-2 border border-red-500/20 rounded-full">LOCKED FOR MAINTENANCE</span>
           )}
        </div>
      </div>

      {/* Expanded Content */}
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-x border-b border-[#C9A84C]/20 rounded-b-[32px] vault-body backdrop-blur-3xl relative z-10"
          >
             <div className="p-8">
                <motion.p 
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="text-[11px] font-medium text-secondary-text tracking-[0.15em] leading-relaxed mb-8 italic text-center px-8"
                >
                  &quot;Hand-selected campus rarities. Scarcity prioritized. Once claimed, the sequence terminates forever.&quot;
                </motion.p>

                <div className="grid grid-cols-1 gap-5">
                   {items.map((item, index) => (
                     <motion.div 
                        key={item.id}
                        initial={{ x: -20, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        transition={{ delay: 0.3 + index * 0.1 }}
                        className="bg-white/[0.03] rounded-3xl p-4 flex gap-6 border border-white/5 relative overflow-hidden group hover:bg-white/[0.06] hover:border-[#C9A84C]/40 transition-all duration-500"
                      >
                        {/* Shimmer Effect */}
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.05] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />
                        
                        <div className="w-28 h-28 rounded-2xl relative overflow-hidden shrink-0 border border-white/10">
                           <SafeImage 
                            src={item.image || item.imageUrl} 
                            alt={item.name} 
                            fill 
                            className="object-cover group-hover:scale-110 transition-transform duration-1000" 
                           />
                           <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-md px-2 py-1 rounded-lg text-[8px] font-black text-white light:text-gray-900 uppercase border border-white/10 tracking-widest">
                             {item.remainingCount} REMAINING
                           </div>
                        </div>

                        <div className="flex flex-col justify-center flex-1">
                           <div className="flex justify-between items-start mb-1">
                             <h4 className="text-base font-black text-white light:text-gray-900 leading-tight tracking-tight group-hover:text-primary-gold transition-colors">{item.name}</h4>
                             {item.streakRequirement && userStreak < item.streakRequirement && (
                               <span className="text-[9px] font-black text-red-400 bg-red-400/10 px-2 py-0.5 rounded border border-red-400/20 uppercase tracking-widest">
                                 Requires {item.streakRequirement}d Streak
                               </span>
                             )}
                           </div>
                           
                           <div className="flex items-baseline gap-3 mb-5">
                             <div className="flex flex-col">
                               <span className="text-[8px] font-bold text-secondary-text uppercase tracking-widest mb-0.5">Flash Price</span>
                               <span className="text-xl font-black text-primary-gold">₹{item.price}</span>
                             </div>
                             <span className="text-[12px] font-bold text-secondary-text/40 line-through">₹{item.originalPrice}</span>
                           </div>
                           
                           <motion.button 
                             whileHover={userStreak >= (item.streakRequirement || 0) ? { scale: 1.02 } : {}}
                             whileTap={userStreak >= (item.streakRequirement || 0) ? { scale: 0.98 } : {}}
                             onClick={() => handleSecureAccess(item)}
                             className={`w-full text-[10px] font-black uppercase tracking-[0.3em] py-3.5 rounded-2xl transition-all duration-300
                               ${item.streakRequirement && userStreak < item.streakRequirement 
                                 ? 'bg-white/5 text-white light:text-gray-900/20 border border-white/5 cursor-not-allowed' 
                                 : 'bg-[#C9A84C] text-black shadow-[0_5px_15px_rgba(201,168,76,0.3)] hover:shadow-[0_10px_30px_rgba(201,168,76,0.5)] hover:bg-white'
                               }`}
                           >
                             {item.streakRequirement && userStreak < item.streakRequirement ? 'ACCESS LOCKED' : 'SECURE ACCESS'}
                           </motion.button>
                        </div>
                     </motion.div>
                   ))}
                </div>
             </div>
          </motion.div>
        )}
      </AnimatePresence>

      <VaultClaimModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        item={selectedItem}
        userStreak={userStreak}
        onClaim={handleClaim}
      />
    </motion.div>
  );
}

