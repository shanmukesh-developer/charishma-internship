"use client";
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import BadgeDetailsModal from './BadgeDetailsModal';

interface Message {
  id: number;
  text: string;
  sender: 'user' | 'concierge';
  timestamp: string;
}

interface ConciergeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  user?: {
    name?: string;
    completedOrders?: number;
    lateNightOrders?: number;
    streakCount?: number;
  } | null;
}

const ConciergeDrawer: React.FC<ConciergeDrawerProps> = ({ isOpen, onClose, user }) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      text: `Welcome back, Elite Citizen ${user?.name || 'Guest'}. Your priority liaison is now standing by. How can we elevate your Zenvy experience today?`,
      sender: 'concierge',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [userBadges, setUserBadges] = useState<string[]>([]);
  const [selectedBadge, setSelectedBadge] = useState<string | null>(null);

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const parsed = JSON.parse(stored);
        setUserBadges(parsed.badges || []);
      }
    } catch { /* ignore */ }
  }, [isOpen]);

  const handleSend = () => {
    if (!inputValue.trim()) return;
    
    const newMessage: Message = {
      id: Date.now(),
      text: inputValue,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    
    setMessages(prev => [...prev, newMessage]);
    setInputValue('');
    
    // Simulate concierge response
    setTimeout(() => {
      const response: Message = {
        id: Date.now() + 1,
        text: "I'm looking into that for you right now. As an Elite member, your request has been bumped to the top of our queue. One moment...",
        sender: 'concierge',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, response]);
    }, 1500);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100]"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-[#0A0A0A] border-l border-[#C9A84C]/30 shadow-[0_0_50px_rgba(201,168,76,0.1)] z-[101] flex flex-col"
          >
            {/* Gold Header */}
            <div className="relative h-36 bg-gradient-to-b from-[#C9A84C]/25 to-transparent p-5 flex flex-col justify-end overflow-hidden border-b border-[#C9A84C]/10">
               {/* Animated Gold Sparkles & Dust */}
               <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-[-10%] left-[-10%] w-[120%] h-[120%] bg-[radial-gradient(circle_at_50%_50%,rgba(201,168,76,0.1)_0%,transparent_70%)] animate-pulse" />
                  <div className="gold-dust " />
               </div>
               
               <button 
                  onClick={onClose}
                  className="absolute top-6 right-6 w-12 h-12 rounded-full border border-[#C9A84C]/20 flex items-center justify-center text-[#C9A84C] hover:bg-[#C9A84C]/10 hover:scale-110 transition-all z-30 bg-black/40 backdrop-blur-md"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                  </svg>
               </button>

               <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-3">
                     <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#C9A84C] to-[#8B7332] flex items-center justify-center text-black shadow-[0_0_20px_rgba(201,168,76,0.4)]">
                        <svg className="w-6 h-6 text-black" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="8">
                           <path strokeLinecap="round" strokeLinejoin="round" d="M25 25 L75 25 L25 75 L75 75" />
                        </svg>
                     </div>
                     <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-[0.4em] text-[#C9A84C]">Elite Priority Support</span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                           <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                           <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">Liaison Online</span>
                        </div>
                     </div>
                  </div>
                  <h2 className="text-4xl font-black text-white light:text-gray-900 uppercase leading-none tracking-tight">Nexus <br /> <span className="text-gold-gradient">Concierge</span></h2>
                  <p className="text-[9px] text-[#C9A84C]/60 font-bold uppercase tracking-[0.3em] mt-3 bg-[#C9A84C]/5 w-fit px-3 py-1 rounded-full border border-[#C9A84C]/10">Sub-1m Response Guarantee</p>
               </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')]">
               {messages.map((msg) => (
                 <motion.div
                   key={msg.id}
                   initial={{ opacity: 0, y: 10, scale: 0.95 }}
                   animate={{ opacity: 1, y: 0, scale: 1 }}
                   className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                 >
                   <div className={`max-w-[85%] rounded-[20px] px-4 py-3 text-[12px] leading-relaxed shadow-xl ${
                     msg.sender === 'user' 
                       ? 'bg-gradient-to-br from-[#C9A84C] to-[#8B7332] text-black font-black rounded-tr-none border border-white/20' 
                       : 'bg-white/[0.04] border border-[#C9A84C]/20 text-white light:text-gray-900 rounded-tl-none backdrop-blur-xl'
                   }`}>
                     {msg.text}
                   </div>
                   <span className="text-[7px] font-black text-secondary-text uppercase tracking-[0.2em] mt-1.5 px-2 ">
                     {msg.timestamp} {msg.sender === 'concierge' && '• ELITE LIAISON'}
                   </span>
                 </motion.div>
               ))}
                <div className="h-4" /> {/* Spacer */}

                {/* Medals & Achievements Section */}
                {userBadges.length > 0 && (
                  <div className="px-6 pb-8 animate-in slide-in-from-bottom-5 duration-700">
                     <h3 className="text-[8px] font-black text-[#C9A84C] uppercase tracking-[0.3em] mb-4 ml-1">Medals & Achievements</h3>
                     <div className="grid grid-cols-2 gap-3">
                         {userBadges.map((badge, idx) => {
                            const isPlatinum = badge.includes('Platinum');
                            const isGold = badge.includes('Gold');
                            return (
                               <div 
                                 key={idx} 
                                 onClick={() => setSelectedBadge(badge)}
                                 className={`p-4 rounded-2xl border flex flex-col items-center gap-2 glass cursor-pointer hover:scale-105 transition-all active:scale-95 ${
                                  isPlatinum ? 'border-purple-500/30 bg-purple-500/5' : 
                                  isGold ? 'border-amber-500/30 bg-amber-500/5' : 
                                  'border-gray-400/30 bg-gray-400/5'
                               }`}>
                                  <span className="text-2xl">{isPlatinum ? '💎' : isGold ? '🥇' : '🥈'}</span>
                                  <span className={`text-[9px] font-black uppercase tracking-widest text-center ${
                                     isPlatinum ? 'text-purple-300' : isGold ? 'text-amber-300' : 'text-gray-200'
                                  }`}>{badge}</span>
                               </div>
                            );
                         })}
                     </div>
                  </div>
                )}
             </div>

            {/* Elite Features Grid */}
            <div className="px-4 pb-2">
               <h3 className="text-[7px] font-black text-[#C9A84C] uppercase tracking-[0.3em] mb-2 ml-1">Priority Operations</h3>
                <div className="grid grid-cols-2 gap-2">
                   <button onClick={() => setInputValue("I have a dispute regarding my recent order.")} className="flex items-center gap-3 p-3 bg-white/[0.03] border border-white/5 rounded-2xl group hover:bg-[#C9A84C]/10 hover:border-[#C9A84C]/30 transition-all text-left">
                      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-sm group-hover:scale-110 transition-transform">📍</div>
                      <div className="flex flex-col">
                        <span className="text-[9px] font-black text-white light:text-gray-900 uppercase tracking-tight">Express Mediation</span>
                        <span className="text-[7px] text-secondary-text font-bold uppercase">Order Disputes</span>
                      </div>
                   </button>
                   <button onClick={() => setInputValue("I want to use my priority access to the Vault Reserve.")} className="flex items-center gap-3 p-3 bg-white/[0.03] border border-white/5 rounded-2xl group hover:bg-[#C9A84C]/10 hover:border-[#C9A84C]/30 transition-all text-left">
                      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-sm group-hover:scale-110 transition-transform">⚡</div>
                      <div className="flex flex-col">
                        <span className="text-[9px] font-black text-white light:text-gray-900 uppercase tracking-tight">Vault Reserve</span>
                        <span className="text-[7px] text-secondary-text font-bold uppercase">Priority Access</span>
                      </div>
                   </button>
                </div>
            </div>

            {/* Input Area */}
            <div className="p-4 pt-2 bg-gradient-to-t from-black via-black/95 to-transparent border-t border-white/5">
               <div className="relative group">
                  <div className="absolute inset-[-1px] bg-gradient-to-r from-[#C9A84C]/40 to-transparent rounded-2xl opacity-0 group-focus-within:opacity-100 transition-opacity" />
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    placeholder="Message your Elite liaison..."
                    className="w-full bg-[#121214] border border-white/10 rounded-xl pl-5 pr-14 py-3.5 text-[12px] text-white light:text-gray-900 placeholder-secondary-text/60 focus:outline-none focus:border-[#C9A84C]/40 transition-all relative z-10"
                  />
                  <button 
                    onClick={handleSend}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl bg-gradient-to-br from-[#C9A84C] to-[#8B7332] text-black flex items-center justify-center hover:scale-105 transition-all active:scale-95 shadow-lg shadow-[#C9A84C]/20 z-20"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </button>
               </div>
               <div className="flex items-center justify-center gap-4 mt-5 opacity-30">
                  <div className="h-px w-8 bg-gradient-to-r from-transparent to-[#C9A84C]" />
                  <p className="text-[7px] text-secondary-text uppercase tracking-[0.4em] font-black">
                     Secure Nexus Channel
                  </p>
                  <div className="h-px w-8 bg-gradient-to-l from-transparent to-[#C9A84C]" />
               </div>
            </div>
          </motion.div>
        </>
      )}
      <BadgeDetailsModal 
        isOpen={!!selectedBadge} 
        onClose={() => setSelectedBadge(null)} 
        badgeName={selectedBadge || ''} 
        userStats={{
          completedOrders: user?.completedOrders || 0,
          lateNightOrders: user?.lateNightOrders || 0,
          streakCount: user?.streakCount || 0
        }}
      />
    </AnimatePresence>
  );
};

export default ConciergeDrawer;
