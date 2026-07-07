import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

interface VaultItem {
  id: string;
  name: string;
  price: number;
  originalPrice: number;
  remainingCount: number;
  imageUrl: string;
  streakRequirement?: number;
}

interface VaultClaimModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: VaultItem | null;
  userStreak: number;
  onClaim: (itemId: string) => Promise<boolean>;
}

export default function VaultClaimModal({
  isOpen,
  onClose,
  item,
  userStreak,
  onClaim
}: VaultClaimModalProps) {
  const router = useRouter();
  const [isClaiming, setIsClaiming] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [mounted, setMounted] = useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !isOpen || !item || typeof document === 'undefined') return null;

  const isLocked = item.streakRequirement ? userStreak < item.streakRequirement : false;

  const handleSecureAccess = async () => {
    setIsClaiming(true);
    const success = await onClaim(item.id);
    if (success) {
      setIsSuccess(true);
      // Wait a bit then maybe redirect?
    }
    setIsClaiming(false);
  };

  const handleClose = () => {
    setIsSuccess(false);
    onClose();
  };

  const handleViewProduct = () => {
    setIsSuccess(false);
    onClose();
    router.push(`/products/${item.id}`);
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={isClaiming ? undefined : handleClose}
            className="absolute inset-0 bg-black/95 backdrop-blur-3xl"
          />

          {/* Modal Container */}
          <motion.div
            layoutId={`vault-item-${item.id}`}
            initial={{ scale: 0.8, opacity: 0, rotateY: 20 }}
            animate={{ scale: 1, opacity: 1, rotateY: 0 }}
            exit={{ scale: 0.8, opacity: 0, rotateY: -20 }}
            transition={{ type: "spring", damping: 20, stiffness: 200 }}
            className={`relative w-full max-w-lg overflow-hidden rounded-[48px] border border-white/10 ${isSuccess ? 'bg-[#121214]' : 'bg-gradient-to-br from-white/10 to-transparent'} shadow-[0_50px_100px_rgba(0,0,0,0.9)]`}
          >
            {/* Cinematic Particles Layer (Simulated with CSS) */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#C9A84C] to-transparent animate-[shimmer_2s_infinite]" />
            </div>

            <AnimatePresence mode="wait">
              {!isSuccess ? (
                <motion.div 
                  key="claim-view"
                  exit={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
                  className="relative"
                >
                  {/* Image Section */}
                  <div className="relative h-72 w-full overflow-hidden">
                    <motion.img
                      initial={{ scale: 1.2 }}
                      animate={{ scale: 1 }}
                      src={item.imageUrl}
                      alt={item.name}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#121214] via-transparent to-black/60" />
                    
                    {/* Badge */}
                    <div className="absolute top-8 left-8 px-5 py-2 rounded-full bg-white/10 backdrop-blur-2xl border border-white/20 shadow-2xl">
                      <span className="text-[10px] font-black text-primary-gold uppercase tracking-[0.4em]">
                        {isLocked ? "ACCESS SEALED" : "UNLOCKED SEQUENCE"}
                      </span>
                    </div>
                  </div>

                  {/* Content Section */}
                  <div className="p-10">
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <h2 className="text-3xl font-black text-white light:text-gray-900 tracking-tighter uppercase leading-none mb-3">
                          {item.name}
                        </h2>
                        <div className="flex items-center gap-3">
                          <span className="text-primary-gold font-black text-2xl">₹{item.price}</span>
                          <span className="text-secondary-text/40 line-through text-sm font-bold">₹{item.originalPrice}</span>
                          <span className="text-[10px] font-black bg-[#C9A84C]/20 text-[#C9A84C] px-2 py-0.5 rounded ml-2">-{Math.round((1 - item.price/item.originalPrice)*100)}%</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-black text-secondary-text uppercase tracking-widest mb-1.5 ">Batch Release</p>
                        <p className="text-lg font-black text-white light:text-gray-900">{item.remainingCount} UNITS</p>
                      </div>
                    </div>

                    {/* Requirement Section */}
                    {item.streakRequirement ? (
                      <div className={`mb-10 p-5 rounded-[24px] border ${isLocked ? 'border-red-500/20 bg-red-500/5' : 'border-[#C9A84C]/20 bg-[#C9A84C]/5'}`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest mb-1 text-secondary-text opacity-70">Requirement</p>
                            <span className={`text-sm font-black ${isLocked ? 'text-red-400' : 'text-[#C9A84C]'}`}>
                              {item.streakRequirement} DAY STREAK
                            </span>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] font-black uppercase tracking-widest mb-1 text-secondary-text opacity-70">Identity Status</p>
                            <span className="text-sm font-black text-white light:text-gray-900">
                              {userStreak} DAYS
                            </span>
                          </div>
                        </div>
                        {isLocked && (
                          <div className="mt-3 text-[11px] font-bold text-red-400/80 italic">
                            Authentication failed. Increase streak to secure this rarity.
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mb-10 opacity-0 h-4" /> 
                    )}

                    {/* Action Button */}
                    <div className="relative group">
                      <motion.button
                        whileHover={!isLocked && !isClaiming ? { scale: 1.02, y: -2 } : {}}
                        whileTap={!isLocked && !isClaiming ? { scale: 0.98 } : {}}
                        disabled={isLocked || isClaiming}
                        onClick={handleSecureAccess}
                        className={`w-full py-6 rounded-[24px] font-black uppercase tracking-[0.3em] text-xs transition-all duration-700 relative z-10 overflow-hidden
                          ${isLocked 
                            ? 'bg-white/5 text-white light:text-gray-900/10 border border-white/10 cursor-not-allowed' 
                            : 'bg-primary-gold text-black shadow-[0_20px_40px_rgba(201,168,76,0.3)]'
                          }`}
                      >
                        {isClaiming ? (
                          <div className="flex items-center justify-center gap-3">
                            <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                            <span>PROCESSING ACCESS...</span>
                          </div>
                        ) : isLocked ? (
                          "INSUFFICIENT CLEARANCE"
                        ) : (
                          "SECURE ACCESS NOW"
                        )}
                      </motion.button>
                      {!isLocked && !isClaiming && (
                        <div className="absolute inset-0 bg-[#C9A84C] blur-2xl opacity-20 group-hover: transition-opacity" />
                      )}
                    </div>

                    <button
                      onClick={handleClose}
                      disabled={isClaiming}
                      className="w-full mt-6 text-[10px] font-black text-secondary-text uppercase tracking-widest hover:text-white light:text-gray-900 transition-colors  hover:opacity-100"
                    >
                      ABORT TRANSITION
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  key="success-view"
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  className="p-12 text-center flex flex-col items-center"
                >
                  <div className="w-24 h-24 rounded-full bg-[#C9A84C]/20 border border-[#C9A84C]/40 flex items-center justify-center mb-8 relative">
                    <motion.div 
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', damping: 10 }}
                      className="text-4xl"
                    >
                      ✨
                    </motion.div>
                    <motion.div 
                      animate={{ scale: [1, 2], opacity: [0.5, 0] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute inset-0 rounded-full border-2 border-[#C9A84C]" 
                    />
                  </div>
                  
                  <h2 className="text-4xl font-black text-white light:text-gray-900 tracking-tighter uppercase mb-4 leading-none">
                    ACCESS GRANTED
                  </h2>
                  <p className="text-secondary-text text-[13px] font-medium tracking-wide mb-10 leading-relaxed max-w-[80%] mx-auto">
                    The sequence is complete. <span className="text-white light:text-gray-900 font-bold">{item.name}</span> has been secured for your collection.
                  </p>

                  <div className="flex flex-col gap-3 w-full">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={handleViewProduct}
                      className="w-full py-5 bg-white text-black rounded-[20px] font-black uppercase tracking-[0.2em] text-[10px] shadow-2xl"
                    >
                      INITIALIZE PRODUCT DETAIL
                    </motion.button>
                    <button
                      onClick={handleClose}
                      className="w-full py-5 text-[10px] font-black text-secondary-text uppercase tracking-widest hover:text-white light:text-gray-900 transition-colors"
                    >
                      RETURN TO HOME
                    </button>
                  </div>

                  {/* Confetti Animation Placeholder Effect */}
                  <div className="absolute inset-0 pointer-events-none">
                     {[...Array(12)].map((_, i) => (
                       <motion.div
                        key={i}
                        initial={{ opacity: 1, y: 0 }}
                        animate={{ 
                          opacity: 0, 
                          y: -100 - Math.random() * 200,
                          x: (Math.random() - 0.5) * 400
                        }}
                        transition={{ duration: 3, ease: 'easeOut' }}
                        className="absolute bottom-0 text-xl"
                        style={{ left: `${Math.random() * 100}%` }}
                       >
                         {['✨', '💎', '💳', '⭐'][Math.floor(Math.random() * 4)]}
                       </motion.div>
                     ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
