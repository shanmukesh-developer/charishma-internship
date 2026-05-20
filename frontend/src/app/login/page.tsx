"use client";
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '@/utils/firebase';
import { motion } from 'framer-motion';
import SuccessOverlay from '@/components/SuccessOverlay';
import Magnetic from '@/components/Magnetic';

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [overlay, setOverlay] = useState<{ isOpen: boolean; title: string; message: string; type?: 'success' | 'error' }>({
    isOpen: false,
    title: '',
    message: '',
  });

  // Ensure field is clean on mount to prevent stale/phantom pre-fills
  useEffect(() => {
    setPhone('');
    setPassword('');
  }, []);

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!phone || phone.length < 10) {
      setOverlay({ isOpen: true, title: 'INVALID ID', message: 'Nexus authorization requires a valid 10-digit uplink ID.', type: 'error' });
      return;
    }
    if (!password) {
      setOverlay({ isOpen: true, title: 'CIPHER REQUIRED', message: 'Encryption cipher cannot be empty.', type: 'error' });
      return;
    }
    const isProd = typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
    
    if (isProd && API_URL.includes('localhost')) {
      console.warn('⚠️ WARNING: Production frontend is attempting to connect to localhost API. Check NEXT_PUBLIC_API_URL.');
    }
    console.log(`[AUTH_LINK] Target Gateway: ${API_URL}`);

    try {
      const last10 = /[a-zA-Z]/.test(phone) ? phone : phone.replace(/\D/g, '').slice(-10);
      const response = await fetch(`${API_URL}/api/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: last10, password })
      });
      const data = await response.json();
      if (response.ok) {
        localStorage.removeItem('zenvy_cart');
        
        localStorage.setItem('user', JSON.stringify({ 
          id: data._id, 
          name: data.name,
          phone: data.phone,
          hostelBlock: data.hostelBlock,
          roomNumber: data.roomNumber
        }));
        setOverlay({ isOpen: true, title: 'UPLINK ESTABLISHED', message: `Welcome back, Operative ${data.name.toUpperCase()}.`, type: 'success' });
        setTimeout(() => router.push('/'), 1500);
      } else {
        setOverlay({ isOpen: true, title: 'ACCESS DENIED', message: data.message || 'Authorization failed.', type: 'error' });
      }
    } catch (err: unknown) {
      console.error('[LOGIN_ERROR]', err);
      const error = err as Error;
      const isTimeout = error.name === 'AbortError' || error.message?.includes('timeout');
      setOverlay({ 
        isOpen: true, 
        title: 'LINK FAILURE', 
        message: isTimeout ? 'Connection to Nexus gateway timed out.' : `Uplink Error: ${error.message || 'Unknown network failure'}`, 
        type: 'error' 
      });
    } finally {
      setLoading(false);
    }
  };
   
  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const firebaseToken = await result.user.getIdToken();
      
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
      const response = await fetch(`${API_URL}/api/users/google-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firebaseToken })
      });
      
      const data = await response.json();
      if (response.ok) {
        localStorage.removeItem('zenvy_cart');
        
        localStorage.setItem('user', JSON.stringify({ 
          id: data._id, 
          name: data.name,
          phone: data.phone,
          hostelBlock: data.hostelBlock,
          roomNumber: data.roomNumber
        }));
        setOverlay({ isOpen: true, title: 'UPLINK ESTABLISHED', message: `Welcome back, Operative ${data.name.toUpperCase()}.`, type: 'success' });
        setTimeout(() => router.push('/'), 1500);
      } else {
        setOverlay({ isOpen: true, title: 'ACCESS DENIED', message: data.message || 'Google Auth failed.', type: 'error' });
      }
    } catch (err: any) {
      console.error('[GOOGLE_LOGIN_ERROR]', err);
      setOverlay({ isOpen: true, title: 'GOOGLE LINK FAILURE', message: err.message || 'Could not connect to Google.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };
   
  // 🛰️ Tactical Data Streams (Stabilized & Hydration-Safe)
  const DataStream = ({ side }: { side: 'left' | 'right' }) => {
    const techWords = ['SYNC', 'GATE', 'VRX', 'LINK', 'CORE', 'DATA', 'NODE', 'LOCK'];
    const hexCodes = ['X72', '8A1', 'F3D', '9C2', 'B0E', '57F', '1A4', '6E9'];
    
    return (
      <div className={`absolute top-0 bottom-0 ${side === 'left' ? 'left-8' : 'right-8'} w-12 flex flex-col justify-around py-40 pointer-events-none opacity-10 z-0`}>
        {[...Array(8)].map((_, i) => (
          <div
             key={i}
             className="text-[7px] font-mono text-primary-yellow tracking-tighter opacity-40 uppercase"
          >
            {techWords[i % techWords.length]}
            <br/>
            {hexCodes[i % hexCodes.length]}
          </div>
        ))}
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-[#020203] text-white p-6 md:p-10 flex flex-col justify-start md:justify-center relative overflow-y-auto">
      {/* 🔮 Re-materialization Glitch Layer */}
      <motion.div 
        initial={{ opacity: 1, scale: 1.5, filter: 'blur(100px)' }}
        animate={{ opacity: 0, scale: 1, filter: 'blur(0px)' }}
        transition={{ duration: 1.5, ease: 'easeInOut' }}
        className="fixed inset-0 bg-primary-yellow/10 z-[100] pointer-events-none"
      />

      {/* 🌌 Optimized Cyber-Nexus Background */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden bg-[#020203]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(201,168,76,0.1),transparent_70%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_100%,rgba(139,92,246,0.05),transparent_70%)]" />
        <div className="absolute inset-0 flex items-center justify-center opacity-20">
           <div className="w-[1000px] h-[1000px] bg-[conic-gradient(from_0deg_at_50%_50%,rgba(201,168,76,0.02)_0%,transparent_50%,rgba(201,168,76,0.02)_100%)]" />
        </div>
      </div>

      {/* 📽️ Holographic Light Source (Bottom-Up Projection) */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-32 bg-primary-yellow/10 blur-[100px] rounded-full pointer-events-none scale-y-50 z-0" />
      <div className="fixed bottom-[-10px] left-1/2 -translate-x-1/2 w-[400px] h-1 bg-gradient-to-r from-transparent via-primary-yellow/40 to-transparent blur-[2px] z-0" />

      {/* 🛰️ Data Streams */}
      <DataStream side="left" />
      <DataStream side="right" />

      <div className="relative z-10 w-full max-w-lg mx-auto flex flex-col items-center">
        {/* Back Link */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="mb-10 w-full flex justify-start pl-4"
        >
          <Magnetic>
            <Link href="/" className="group flex items-center gap-3">
              <div className="w-11 h-11 bg-white/5 backdrop-blur-3xl rounded-2xl flex items-center justify-center border border-white/10 group-hover:border-primary-yellow/40 transition-all">
                <svg className="w-4 h-4 text-white/20 group-hover:text-primary-yellow transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7" />
                </svg>
              </div>
              <div className="flex flex-col">
                <span className="text-[7px] font-black uppercase tracking-[0.4em] text-white/20">Protocol</span>
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40 group-hover:text-white transition-colors">Abort Mission</span>
              </div>
            </Link>
          </Magnetic>
        </motion.div>
        
        {/* 🎭 Innovative Header Section */}
        <div className="text-center mb-16 relative">
          <motion.h1 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-[10px] font-black uppercase tracking-[1em] text-primary-yellow/60 mb-4 brightness-125 flex items-center justify-center gap-4"
          >
            <span className="w-8 h-px bg-primary-yellow/20" />
            NEXUS GATEWAY
            <span className="w-8 h-px bg-primary-yellow/20" />
          </motion.h1>
          <motion.h2 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 1, delay: 0.1 }}
            className="text-[64px] md:text-[88px] font-black leading-[0.8] tracking-tighter text-white uppercase italic"
            style={{ fontFamily: "'Syne', sans-serif" }}
          >
             IDENTITY <br />
             <span className="text-gold-gradient-glow font-black not-italic">SYSTEM</span>
          </motion.h2>
          
          {/* Tactical Telemetry Icons */}
          <div className="mt-8 flex justify-center gap-12 opacity-30">
             {['📡 UPLINK: STABLE', '⚡ POWER: MAX', '🔒 ENCR: AES-256'].map((text, i) => (
               <div key={i} className="flex flex-col items-center gap-1">
                 <div className="w-1 h-3 bg-white/20 rounded-full overflow-hidden">
                    <motion.div 
                      animate={{ height: ['0%', '100%', '0%'] }} 
                      transition={{ duration: 2, repeat: Infinity, delay: i * 0.5 }}
                      className="bg-primary-yellow w-full"
                    />
                 </div>
                 <span className="text-[6px] font-black tracking-[0.2em]">{text}</span>
               </div>
             ))}
          </div>
        </div>

        {/* 💳 Holographic Form Module */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.4 }}
          className="w-full relative group"
        >
          {/* 📽️ Bottom Light Shadow (Making it feel projected) */}
          <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 w-3/4 h-10 bg-primary-yellow/10 blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />

          {/* Animated Border Module */}
          <div className="absolute -inset-[1px] bg-gradient-to-r from-primary-yellow/30 via-violet-500/20 to-primary-yellow/30 rounded-[40px] animate-gradient-x -z-1 opacity-50 group-hover:opacity-100 transition-opacity" />
          
          <form onSubmit={handleLogin} className="glass-card-extreme p-8 md:p-10 space-y-8 overflow-hidden border-white/5 relative">
            {/* Corner Bracket Decals */}
            <div className="absolute top-4 left-4 w-4 h-4 border-t-2 border-l-2 border-primary-yellow/20 rounded-tl-lg" />
            <div className="absolute top-4 right-4 w-4 h-4 border-t-2 border-r-2 border-primary-yellow/20 rounded-tr-lg" />
            <div className="absolute bottom-4 left-4 w-4 h-4 border-b-2 border-l-2 border-primary-yellow/20 rounded-bl-lg" />
            <div className="absolute bottom-4 right-4 w-4 h-4 border-b-2 border-r-2 border-primary-yellow/20 rounded-br-lg" />

            <div className="space-y-1">
              <div className="flex justify-between items-center px-2">
                <label className="text-[8px] font-black uppercase tracking-[0.4em] text-white/30">Node Identifier</label>
              </div>
              <div className="relative group/input">
                <span className="absolute left-6 top-1/2 -translate-y-1/2 text-primary-yellow font-black text-xs tracking-widest opacity-20 group-focus-within/input:opacity-100 transition-opacity">
                    +91
                </span>
                <input 
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="AUTHORIZE ID"
                  className="w-full bg-[#020203] border border-white/[0.05] group-hover/input:border-white/10 group-focus-within/input:border-primary-yellow/40 rounded-2xl h-[68px] pl-16 pr-6 font-bold text-sm tracking-[0.2em] transition-all outline-none uppercase placeholder:text-white/5"
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between items-center px-2">
                <label className="text-[8px] font-black uppercase tracking-[0.4em] text-white/30">Nexus Access Key</label>
              </div>
              <div className="relative group/input">
                <input 
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="NEXUS CIPHER"
                  autoComplete="current-password"
                  className="w-full bg-[#020203] border border-white/[0.05] group-hover/input:border-white/10 group-focus-within/input:border-primary-yellow/40 rounded-2xl h-[68px] px-8 font-bold text-sm tracking-[0.2em] transition-all outline-none uppercase placeholder:text-white/5"
                />
                <button 
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-6 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-white/20 hover:text-primary-yellow hover:drop-shadow-[0_0_8px_rgba(201,168,76,0.8)] transition-all text-xl"
                >
                   {showPassword ? '◌' : '●'}
                </button>
              </div>
            </div>

            <Magnetic>
              <button 
                type="submit"
                disabled={loading}
                className="w-full h-[68px] relative rounded-2xl bg-black border border-primary-yellow/50 text-primary-yellow text-xs uppercase font-black tracking-[0.6em] shadow-[0_0_50px_rgba(201,168,76,0.1)] hover:shadow-[0_0_80px_rgba(201,168,76,0.25)] transition-all duration-700 group/btn overflow-hidden"
              >
                 <div className="absolute inset-0 bg-gradient-to-br from-primary-yellow/20 to-transparent opacity-0 group-hover/btn:opacity-100 transition-opacity" />
                 <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover/btn:animate-shimmer" />
                 <span className="relative z-10 group-hover/btn:scale-105 transition-transform block">
                   {loading ? 'SYNCING CORE...' : 'ESTABLISH SECURE LINK'}
                 </span>
              </button>
            </Magnetic>

            {/* Google Auth Option */}
            <div className="flex items-center gap-4 my-2 opacity-50">
               <div className="flex-1 h-px bg-gradient-to-r from-transparent to-white/20" />
               <span className="text-[8px] font-black uppercase tracking-widest">OR</span>
               <div className="flex-1 h-px bg-gradient-to-l from-transparent to-white/20" />
            </div>
            
            <Magnetic>
              <button 
                type="button"
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full h-[60px] relative rounded-2xl bg-white/5 border border-white/10 text-white text-[10px] uppercase font-black tracking-widest shadow-lg hover:bg-white/10 transition-all duration-300 flex items-center justify-center gap-3 group active:scale-95"
              >
                 <svg className="w-5 h-5 group-hover:scale-110 transition-transform" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                 </svg>
                 <span>Continue with Google</span>
              </button>
            </Magnetic>

            {/* Registration Footer */}
            <div className="pt-6 flex flex-col items-center gap-4">
              <p className="text-[9px] text-white/20 uppercase tracking-[0.3em] font-black">
                Unregistered Node? <Link href="/register" className="text-primary-yellow hover:text-white transition-colors underline underline-offset-8 ml-2">Begin Onboarding</Link>
              </p>
              <p className="text-[9px] text-white/20 uppercase tracking-[0.3em] font-black mt-2">
                Lost Your Cipher? <Link href="/forgot-password" className="text-primary-yellow hover:text-white transition-colors underline underline-offset-8 ml-2">Override Protocol</Link>
              </p>
            </div>
          </form>
        </motion.div>

        {/* Global Technical Footer */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.15 }}
          transition={{ delay: 1.5 }}
          className="mt-16 flex flex-col items-center gap-3 pointer-events-none"
        >
          <div className="flex items-center gap-6">
             <span className="text-[6px] tracking-[0.5em] font-black uppercase">Lat: 16.5062° N</span>
             <div className="w-1.5 h-1.5 bg-primary-yellow rounded-full animate-pulse" />
             <span className="text-[6px] tracking-[0.5em] font-black uppercase">Long: 80.6480° E</span>
          </div>
          <span className="text-[8px] tracking-[1.5em] font-extrabold uppercase italic opacity-40">ZENVY NEXUS PROTOCOL v4.0.2</span>
        </motion.div>
      </div>

      <SuccessOverlay 
        isOpen={overlay.isOpen}
        onClose={() => setOverlay(prev => ({ ...prev, isOpen: false }))}
        title={overlay.title}
        message={overlay.message}
        type={overlay.type}
      />
    </main>
  );
}

