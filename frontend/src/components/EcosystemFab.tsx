"use client";
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, usePathname } from 'next/navigation';
import { playSensoryFeedback } from '@/utils/sensory';

export default function EcosystemFab() {
  const [isOpen, setIsOpen] = useState(false);
  const [isIntroDone, setIsIntroDone] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const fabRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (fabRef.current && !fabRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [fabRef]);

  // Check intro status
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (sessionStorage.getItem('zenvy_intro_seen') === 'true') {
        setIsIntroDone(true);
      }
      
      const handleIntro = () => setIsIntroDone(true);
      window.addEventListener('introCompleted', handleIntro);
      return () => window.removeEventListener('introCompleted', handleIntro);
    }
  }, []);

  if (pathname !== '/') return null;
  if (!isIntroDone) return null;

  const apps = [
    { id: 'challenges', icon: '🏆', label: 'BlockWars', path: '/challenges', color: 'bg-amber-500/10 text-amber-500', shadow: 'shadow-amber-500/20' },
    { id: 'bikepool', icon: '🏍️', label: 'Co-Ride', path: '/bikepool', color: 'bg-indigo-500/10 text-indigo-500', shadow: 'shadow-indigo-500/20' },
    { id: 'pg', icon: '🏠', label: 'Stays', path: '/pg', color: 'bg-teal-500/10 text-teal-500', shadow: 'shadow-teal-500/20' }
  ];

  const handleAppClick = (path: string) => {
    playSensoryFeedback();
    setIsOpen(false);
    router.push(path);
  };

  const toggleFab = () => {
    playSensoryFeedback();
    setIsOpen(!isOpen);
  };

  return (
    <div className="fixed inset-0 max-w-md mx-auto pointer-events-none z-[60]">
      <div ref={fabRef} className="absolute right-4 bottom-[120px] flex flex-col items-center gap-3 pointer-events-auto">
        {/* Expanded Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className="flex flex-col gap-3 mb-1"
          >
            {apps.map((app, index) => (
              <motion.button
                key={app.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => handleAppClick(app.path)}
                className={`relative group flex items-center justify-center w-12 h-12 rounded-2xl bg-[#1c1c1e]/90 light:bg-white/90 backdrop-blur-xl border border-white/10 light:border-gray-200 shadow-lg ${app.shadow} hover:scale-110 active:scale-95 transition-all`}
              >
                <span className="text-xl relative z-10">{app.icon}</span>
                
                {/* Tooltip */}
                <div className="absolute right-full mr-3 px-2 py-1 bg-black/80 light:bg-white/90 backdrop-blur-md border border-white/10 light:border-gray-200 rounded-lg text-[9px] font-black uppercase tracking-widest text-white light:text-black opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 transition-all pointer-events-none whitespace-nowrap">
                  {app.label}
                </div>
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Toggle Button */}
      <motion.button
        onClick={toggleFab}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.9 }}
        className={`w-14 h-14 rounded-full flex items-center justify-center shadow-[0_4px_30px_rgba(0,0,0,0.3)] light:shadow-[0_4px_20px_rgba(0,0,0,0.1)] transition-colors duration-300 ${
          isOpen 
          ? 'bg-[#EF4F5F] text-white light:text-gray-900' 
          : 'bg-[#1c1c1e] light:bg-white border border-white/10 light:border-gray-200 text-white light:text-black'
        }`}
      >
        <motion.div
          animate={{ rotate: isOpen ? 45 : 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="relative flex items-center justify-center"
        >
          {isOpen ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
          ) : (
            <div className="relative">
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#EF4F5F] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#EF4F5F]"></span>
              </span>
              <svg className="w-6 h-6 text-primary-yellow" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            </div>
          )}
        </motion.div>
      </motion.button>
      </div>
    </div>
  );
}
