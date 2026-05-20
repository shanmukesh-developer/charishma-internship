"use client";
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '@/utils/firebase';
import SuccessOverlay from '@/components/SuccessOverlay';

export default function RegisterPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({ name: '', phone: '', password: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [overlay, setOverlay] = useState<{ isOpen: boolean; title: string; message: string; type?: 'success' | 'error' }>({
    isOpen: false, title: '', message: '',
  });

  const handleRegister = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!formData.name || !formData.phone || !formData.password) {
      setOverlay({ isOpen: true, title: 'Missing Details', message: 'Please fill in all required fields.', type: 'error' });
      return;
    }
    
    setIsSubmitting(true);
    try {
      // Support alphabetic IDs
      const phoneVal = formData.phone;
      const last10 = /[a-zA-Z]/.test(phoneVal) ? phoneVal : phoneVal.replace(/\D/g, '').slice(-10);
      
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
      const response = await fetch(`${API_URL}/api/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: formData.name, 
          phone: last10, 
          password: formData.password 
        }),
      });

      const data = await response.json();

      if (response.ok) {
        
        localStorage.setItem('user', JSON.stringify({ id: data._id, name: data.name, phone: data.phone }));
        setOverlay({ isOpen: true, title: '🎉 Welcome to Zenvy!', message: 'Your account has been created successfully.', type: 'success' });
        setTimeout(() => router.push('/'), 2000);
      } else {
        setOverlay({ isOpen: true, title: 'Registration Failed', message: data.message || 'Something went wrong.', type: 'error' });
      }
    } catch (err: unknown) {
      console.error("Registration error:", err);
      setOverlay({ 
        isOpen: true, 
        title: 'Network Error', 
        message: 'Could not connect to the registration server. Please try again.', 
        type: 'error' 
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsSubmitting(true);
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
        setOverlay({ isOpen: true, title: '🎉 Welcome to Zenvy!', message: 'Your account has been created successfully.', type: 'success' });
        setTimeout(() => router.push('/'), 2000);
      } else {
        setOverlay({ isOpen: true, title: 'ACCESS DENIED', message: data.message || 'Google Auth failed.', type: 'error' });
      }
    } catch (err: any) {
      console.error('[GOOGLE_LOGIN_ERROR]', err);
      setOverlay({ isOpen: true, title: 'GOOGLE LINK FAILURE', message: err.message || 'Could not connect to Google.', type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#020203] text-white p-6 md:p-10 flex flex-col justify-start md:justify-center relative overflow-y-auto">
      {/* 🌌 Optimized Cyber-Nexus Background */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden bg-[#020203]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(201,168,76,0.1),transparent_70%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_100%,rgba(139,92,246,0.05),transparent_70%)]" />
      </div>

      <div className="relative z-10 w-full max-w-lg mx-auto">
        <Link href="/login" className="w-11 h-11 bg-white/5 backdrop-blur-3xl rounded-2xl flex items-center justify-center border border-white/10 hover:border-primary-yellow/40 transition-all mb-10 ml-4">
          <svg className="w-4 h-4 text-white/20 hover:text-primary-yellow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>

        {/* 🎭 Nexus Header */}
        <div className="text-left mb-12 ml-4">
          <h1 className="text-[10px] font-black uppercase tracking-[1em] text-primary-yellow/60 mb-4 brightness-125">
            IDENTITY TERMINAL
          </h1>
          <h2 className="text-[54px] md:text-[64px] font-black leading-[0.8] tracking-tighter text-white uppercase italic" style={{ fontFamily: "'Syne', sans-serif" }}>
             NEW <br />
             <span className="text-gold-gradient-glow font-black not-italic">OPERATIVE</span>
          </h2>
        </div>

        <form onSubmit={handleRegister} autoComplete="on" className="glass-card-extreme p-8 md:p-10 space-y-8 border-white/5 relative">
          <div className="space-y-1">
            <label className="text-[8px] font-black uppercase tracking-[0.4em] text-white/30 ml-2">Display Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              autoComplete="name"
              placeholder="ENTER FULL NAME"
              className="w-full bg-[#020203] border border-white/[0.05] hover:border-white/10 focus:border-primary-yellow/40 rounded-2xl h-[68px] px-8 font-bold text-sm tracking-[0.2em] transition-all outline-none uppercase placeholder:text-white/5"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[8px] font-black uppercase tracking-[0.4em] text-white/30 ml-2">Uplink ID</label>
            <div className="relative group/input">
              <span className="absolute left-6 top-1/2 -translate-y-1/2 text-primary-yellow font-black text-xs tracking-widest opacity-20 group-focus-within/input:opacity-100 transition-opacity">+91</span>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                autoComplete="tel"
                placeholder="AUTHORIZE ID"
                className="w-full bg-[#020203] border border-white/[0.05] hover:border-white/10 focus:border-primary-yellow/40 rounded-2xl h-[68px] pl-16 pr-6 font-bold text-sm tracking-[0.2em] transition-all outline-none uppercase placeholder:text-white/5"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[8px] font-black uppercase tracking-[0.4em] text-white/30 ml-2">Security Cipher</label>
            <div className="relative group/input">
              <input
                type={showPassword ? "text" : "password"}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                autoComplete="new-password"
                placeholder="NEXUS CIPHER"
                className="w-full bg-[#020203] border border-white/[0.05] hover:border-white/10 focus:border-primary-yellow/40 rounded-2xl h-[68px] px-8 font-bold text-sm tracking-[0.2em] transition-all outline-none uppercase placeholder:text-white/5"
              />
              <button 
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-6 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-white/20 hover:text-primary-yellow transition-all text-xl"
              >
                 {showPassword ? '◌' : '●'}
              </button>
            </div>
          </div>

          <div className="pt-4">
              <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-[68px] relative rounded-2xl bg-black border border-primary-yellow/50 text-primary-yellow text-xs uppercase font-black tracking-[0.6em] shadow-[0_0_50px_rgba(201,168,76,0.1)] hover:shadow-[0_0_80px_rgba(201,168,76,0.25)] transition-all duration-700 group/btn overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary-yellow/20 to-transparent opacity-0 group-hover/btn:opacity-100 transition-opacity" />
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover/btn:animate-shimmer" />
              <span className="relative z-10">
                {isSubmitting ? 'INITIALIZING...' : 'ESTABLISH ACCESS'}
              </span>
            </button>
          </div>

          {/* Google Auth Option */}
          <div className="flex items-center gap-4 my-2 opacity-50">
             <div className="flex-1 h-px bg-gradient-to-r from-transparent to-white/20" />
             <span className="text-[8px] font-black uppercase tracking-widest">OR</span>
             <div className="flex-1 h-px bg-gradient-to-l from-transparent to-white/20" />
          </div>
          
          <button 
            type="button"
            onClick={handleGoogleLogin}
            disabled={isSubmitting}
            className="w-full h-[60px] relative rounded-2xl bg-white/5 border border-white/10 text-white text-[10px] uppercase font-black tracking-widest shadow-lg hover:bg-white/10 transition-all duration-300 flex items-center justify-center gap-3 group active:scale-95"
          >
             <svg className="w-5 h-5 group-hover:scale-110 transition-transform" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
             </svg>
             <span>Register with Google</span>
          </button>

          <div className="text-center pt-4">
            <p className="text-[9px] text-white/20 uppercase tracking-[0.3em] font-black">
              Known Operative? <Link href="/login" className="text-primary-yellow hover:text-white transition-colors underline underline-offset-8 ml-2">Login To Terminal</Link>
            </p>
          </div>
        </form>
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
