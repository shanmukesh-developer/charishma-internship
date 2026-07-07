"use client";
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { socket } from '@/utils/socket';
import { playSensoryFeedback } from '@/utils/sensory';
import { useRouter } from 'next/navigation';

export default function ZenvyPulse({ userBlock }: { userBlock: string | null }) {
  const [pulses, setPulses] = useState<{ id: number; block: string; message: string; isEcosystem?: boolean; link?: string; icon?: string }[]>([]);
  const [isEnabled, setIsEnabled] = useState(true);
  const router = useRouter();

  // Random trending messages for normal food pulses
  const messages = [
    "just ordered Chicken Biryani",
    "secured a Late Night Combo",
    "unlocked Elite Free Delivery",
    "is tracking a live order",
    "just spun the Zenvy Wheel"
  ];

  useEffect(() => {
    socket.on('systemUpdate', ({ type, data }: { type: string; data: { key: string; value: boolean } }) => {
      if (type === 'CONFIG_UPDATED' && data.key === 'pulse_enabled') {
        setIsEnabled(data.value);
      }
    });

    socket.on('blockOrderPulse', ({ blockName }: { blockName: string }) => {
      if (!isEnabled) return;
      if (blockName === userBlock || !userBlock) {
        if (typeof window !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(5);
        }
        
        const id = Date.now();
        const randomMsg = messages[Math.floor(Math.random() * messages.length)];
        
        setPulses(prev => [...prev, { id, block: blockName, message: randomMsg }]);
        setTimeout(() => {
          setPulses(prev => prev.filter(p => p.id !== id));
        }, 4000);
      }
    });

    return () => {
      socket.off('systemUpdate');
      socket.off('blockOrderPulse');
    };
  }, [userBlock, isEnabled]);

  // For testing/demo purposes, simulate a pulse every 12 seconds
  useEffect(() => {
    if (!isEnabled) return;
    const interval = setInterval(() => {
      const id = Date.now();
      
      const blocks = ['Block A', 'Block B', 'Block C', 'PG 1'];
      const randomBlock = blocks[Math.floor(Math.random() * blocks.length)];
      const randomMsg = messages[Math.floor(Math.random() * messages.length)];
      setPulses(prev => [...prev, { id, block: randomBlock, message: randomMsg }]);

      setTimeout(() => {
        setPulses(prev => prev.filter(p => p.id !== id));
      }, 5000); 
    }, 12000);
    return () => clearInterval(interval);
  }, [isEnabled]);

  if (!isEnabled) return null;

  return (
    <div className="fixed bottom-[100px] left-4 z-50 pointer-events-none flex flex-col justify-end">
      <AnimatePresence>
        {pulses.map(pulse => (
          <motion.div
            key={pulse.id}
            initial={{ opacity: 0, y: 20, scale: 0.9, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -20, scale: 0.9, filter: 'blur(10px)' }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            onClick={() => {
              if (pulse.link) {
                playSensoryFeedback();
                router.push(pulse.link);
              }
            }}
            className={`mb-2 bg-black/80 light:bg-white/90 backdrop-blur-2xl border border-white/10 light:border-gray-200 p-2.5 pr-5 rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.2)] light:shadow-[0_8px_30px_rgb(0,0,0,0.08)] flex items-center gap-3 overflow-hidden ${pulse.link ? 'cursor-pointer pointer-events-auto hover:bg-black light:hover:bg-gray-50' : ''}`}
          >
            {/* Glowing Dot */}
            <div className="relative flex h-3 w-3 shrink-0 ml-1">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#EF4F5F] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[#EF4F5F]"></span>
            </div>
            
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-white light:text-black">{pulse.block}</span>
                <span className="text-[8px] bg-white/10 light:bg-black/5 text-white light:text-gray-900/70 light:text-black/70 px-1.5 py-0.5 rounded-sm font-bold tracking-widest">LIVE</span>
              </div>
              <span className="text-[9px] text-white light:text-gray-900/60 light:text-gray-500 font-medium truncate max-w-[200px]">{pulse.message}</span>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
