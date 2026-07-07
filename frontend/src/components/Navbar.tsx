"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDeviceProtocol } from '@/hooks/useDeviceProtocol';

const Navbar = () => {
  const [userName, setUserName] = useState('');
  const [location, setLocation] = useState('Amaravathi, AP');
  const [badgeCount, setBadgeCount] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isElite, setIsElite] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const pathname = usePathname();
  const isHomePage = pathname === '/';
  const { protocol, carrier } = useDeviceProtocol();

  useEffect(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const parsed = JSON.parse(stored);
        setUserName(parsed.name || '');
        setIsElite(parsed.isElite || false);
        if (parsed.badges) setBadgeCount(parsed.badges.length || 0);
        if (parsed.address) setLocation(parsed.address.split(',')[0] || 'Amaravathi, AP');
      }
    } catch { /* ignore */ }

    try {
      const savedTheme = localStorage.getItem('zenvy_theme');
      if (savedTheme === 'light') {
        setTheme('light');
        document.documentElement.classList.add('light');
      } else {
        setTheme('dark');
        document.documentElement.classList.remove('light');
      }
    } catch {}

    // Only trigger re-render when state actually CHANGES (not on every scroll pixel)
    let wasScrolled = false;
    const handleScroll = () => {
      const nowScrolled = window.scrollY > 20;
      if (nowScrolled !== wasScrolled) {
        wasScrolled = nowScrolled;
        setIsScrolled(nowScrolled);
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    try {
      localStorage.setItem('zenvy_theme', nextTheme);
      if (nextTheme === 'light') {
        document.documentElement.classList.add('light');
      } else {
        document.documentElement.classList.remove('light');
      }
    } catch {}
  };

  const handleLogout = () => {
    
    localStorage.removeItem('user');
    window.location.href = '/login/';
  };

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 px-6 transition-all duration-500 flex items-center justify-between border-b ${
      isScrolled 
      ? 'h-16 bg-black/40 light:bg-white/90 backdrop-blur-2xl border-white/10 light:border-gray-200 shadow-[0_4px_30px_rgba(0,0,0,0.3)] light:shadow-[0_4px_20px_rgba(0,0,0,0.05)]' 
      : 'h-16 bg-transparent border-transparent'
    }`}>
      {/* Location - Hidden on Home Top to avoid HUD clash */}
      <div className={`flex flex-col group cursor-pointer transition-opacity duration-500 ${(isHomePage && !isScrolled) ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <div className="flex items-center gap-1.5">
          <span className="text-primary-yellow text-sm animate-bounce">📍</span>
          <div className="relative">
            <span className="text-white light:text-gray-900 text-[13px] font-black tracking-tight truncate max-w-[100px] sm:max-w-[160px] group-hover:text-primary-yellow transition-colors">{location}</span>
            <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-primary-yellow scale-x-0 group-hover:scale-x-100 transition-transform origin-left" />
          </div>
          <svg className="w-3 h-3 text-primary-yellow  group-hover:opacity-100 transition-opacity" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </div>
        <span className="text-secondary-text light:text-gray-500 text-[9px] font-black tracking-[0.2em] uppercase mt-0.5  light:opacity-100 group-hover:opacity-100 transition-opacity">
          {userName ? `HEY, ${userName.split(' ')[0]} 👋` : 'DELIVERING TO'}
        </span>
      </div>

      {/* Avatar Section (Legendary Upgrade) */}
      <div className="flex items-center gap-4">
        <div className="hidden sm:flex flex-col items-right text-right">
           <span className="text-[8px] font-black text-primary-yellow uppercase tracking-widest leading-none">{carrier}</span>
           <div className="flex items-center justify-end gap-1.5 mt-1">
             <span className="text-[10px] font-bold text-white light:text-gray-900/40 light:text-gray-400 leading-none">{protocol === 'ios' ? '' : protocol === 'android' ? '🤖' : '💻'} v4.2.0</span>
             <div className={`w-1.5 h-1.5 rounded-full ${isScrolled ? 'bg-emerald-500' : 'bg-primary-yellow'} animate-pulse shadow-[0_0_8px_currentColor]`} />
           </div>
        </div>
        
        <Link 
          href="/pg"
          className="hidden md:flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-white/10 bg-white/5 text-white light:text-gray-900 font-black uppercase tracking-widest text-[9px] hover:text-primary-yellow hover:border-primary-yellow/40 transition-all"
        >
          <span>🏠</span> PG Hostels
        </Link>

        <button 
          onClick={toggleTheme}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90 border bg-white/5 border-white/10 text-white light:text-gray-900/60 hover:text-primary-yellow hover:border-primary-yellow/40"
          title={theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        <Link href="/profile" className="relative group block">
          <div className={`w-9 h-9 rounded-xl bg-gradient-to-br from-[#C9A84C] to-[#8B7332] flex items-center justify-center text-black font-black text-lg shadow-[0_0_15px_rgba(201,168,76,0.3)] transition-all hover:scale-110 active:scale-95 cursor-pointer ${isElite ? 'vip-gold-halo' : ''}`}>
            <svg className="w-6 h-6 text-black" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
               <path strokeLinecap="round" strokeLinejoin="round" d="M2 19h20M2 19l2-8 4 3 4-7 4 7 4-3 2 8" />
            </svg>
          </div>
          
          {badgeCount > 0 && (
            <div className="absolute -top-1 -right-1 w-5 h-5 bg-black border border-primary-yellow rounded-full flex items-center justify-center text-[8px] font-black text-primary-yellow shadow-lg group-hover:scale-110 transition-transform">
              {badgeCount}
            </div>
          )}
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-black light:border-[#FAF5EF] rounded-full shadow-lg" />
        </Link>
        
        <button 
          onClick={handleLogout}
          className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-90 header-action-btn hover:!border-red-500 hover:!text-red-500 light:hover:!border-red-500 light:hover:!text-red-500"
          title="Sign Out"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    </nav>
  );
};

export default Navbar;
