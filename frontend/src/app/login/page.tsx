"use client";
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '@/utils/firebase';
import SuccessOverlay from '@/components/SuccessOverlay';
import { API_URL } from '@/utils/api';
import { refreshSocketAuth } from '@/utils/socket';

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [overlay, setOverlay] = useState<{ isOpen: boolean; title: string; message: string; type?: 'success' | 'error' }>({
    isOpen: false, title: '', message: '',
  });

  useEffect(() => {
    setPhone('');
    setPassword('');
  }, []);

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!phone || phone.length < 10) {
      setOverlay({ isOpen: true, title: 'Invalid Number', message: 'Please enter a valid 10-digit phone number.', type: 'error' });
      return;
    }
    if (!password) {
      setOverlay({ isOpen: true, title: 'Password Required', message: 'Please enter your password.', type: 'error' });
      return;
    }

    setLoading(true);

    try {
      const last10 = /[a-zA-Z]/.test(phone) ? phone : phone.replace(/\D/g, '').slice(-10);
      const response = await fetch(`${API_URL}/api/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: last10, password }),
      });
      const data = await response.json();
      if (response.ok) {
        localStorage.removeItem('zenvy_cart');
        localStorage.setItem('user', JSON.stringify({
          id: data._id,
          name: data.name,
          phone: data.phone,
          hostelBlock: data.hostelBlock,
          roomNumber: data.roomNumber,
          token: data.token,
        }));
        refreshSocketAuth();
        setOverlay({ isOpen: true, title: 'Welcome Back', message: `Signed in as ${data.name}.`, type: 'success' });
        setTimeout(() => router.push('/'), 1500);
      } else {
        setOverlay({ isOpen: true, title: 'Sign In Failed', message: data.message || 'Incorrect phone or password.', type: 'error' });
      }
    } catch (err: unknown) {
      const error = err as Error;
      setOverlay({ isOpen: true, title: 'Connection Error', message: error.message || 'Could not reach the server.', type: 'error' });
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
      const response = await fetch(`${API_URL}/api/users/google-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firebaseToken }),
      });
      const data = await response.json();
      if (response.ok) {
        localStorage.removeItem('zenvy_cart');
        localStorage.setItem('user', JSON.stringify({
          id: data._id, name: data.name, phone: data.phone,
          hostelBlock: data.hostelBlock, roomNumber: data.roomNumber,
          token: data.token,
        }));
        refreshSocketAuth();
        setOverlay({ isOpen: true, title: 'Welcome', message: `Signed in as ${data.name}.`, type: 'success' });
        setTimeout(() => router.push('/'), 1500);
      } else {
        setOverlay({ isOpen: true, title: 'Google Sign-In Failed', message: data.message || 'Try again.', type: 'error' });
      }
    } catch (err: any) {
      setOverlay({ isOpen: true, title: 'Google Sign-In Failed', message: err.message || 'Could not connect to Google.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0A0A0B] text-white flex items-center justify-center p-5">
      <div className="w-full max-w-lg">

        {/* Logo / Brand */}
        <div className="text-center mb-10">
          <Link href="/" className="inline-flex items-center gap-2 text-[#C9A84C] hover:text-[#E8D48B] transition-colors mb-6">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-xs font-semibold tracking-widest uppercase">Back to Home</span>
          </Link>
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="w-8 h-px bg-[#C9A84C]/30" />
            <span className="text-[10px] font-bold tracking-[0.4em] uppercase text-[#C9A84C]/60">Zenvy</span>
            <div className="w-8 h-px bg-[#C9A84C]/30" />
          </div>
          <h1 className="text-4xl font-bold text-white tracking-tight">Sign In</h1>
          <p className="text-sm text-[#6B6B6B] mt-2">Welcome back. Sign in to your account.</p>
        </div>

        {/* Card */}
        <div className="bg-[#141416] border border-[#C9A84C]/10 rounded-3xl p-10 shadow-xl shadow-black/40">

          <form onSubmit={handleLogin} className="space-y-6">
            {/* Phone */}
            <div>
              <label className="block text-sm font-semibold text-[#6B6B6B] mb-2 tracking-wider uppercase">Phone Number</label>
              <div className="relative">
                <span className="absolute left-5 top-1/2 -translate-y-1/2 text-[#C9A84C] text-base font-bold">+91</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Enter phone number"
                  suppressHydrationWarning={true}
                  className="w-full bg-[#0A0A0B] border border-white/8 hover:border-white/15 focus:border-[#C9A84C]/50 rounded-2xl h-16 pl-16 pr-5 text-base font-medium text-white placeholder:text-white/20 outline-none transition-colors"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-semibold text-[#6B6B6B] tracking-wider uppercase">Password</label>
                <Link href="/forgot-password" className="text-xs text-[#C9A84C]/70 hover:text-[#C9A84C] transition-colors">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  suppressHydrationWarning={true}
                  className="w-full bg-[#0A0A0B] border border-white/8 hover:border-white/15 focus:border-[#C9A84C]/50 rounded-2xl h-16 px-5 pr-14 text-base font-medium text-white placeholder:text-white/20 outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  suppressHydrationWarning={true}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-[#C9A84C] transition-colors"
                >
                  {showPassword
                    ? <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  }
                </button>
              </div>
            </div>

            {/* Sign In Button */}
            <button
              type="submit"
              disabled={loading}
              suppressHydrationWarning={true}
              className="w-full h-16 rounded-2xl bg-[#C9A84C] hover:bg-[#D4B56A] disabled:opacity-60 disabled:cursor-not-allowed text-[#0A0A0B] text-base font-bold tracking-wide transition-colors mt-2"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-white/8" />
            <span className="text-xs text-[#6B6B6B] font-medium">or</span>
            <div className="flex-1 h-px bg-white/8" />
          </div>

          {/* Google */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            suppressHydrationWarning={true}
            className="w-full h-14 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/8 hover:border-white/15 text-white text-base font-semibold flex items-center justify-center gap-3 transition-colors disabled:opacity-60"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>

          {/* Footer */}
          <p className="text-center text-xs text-[#6B6B6B] mt-6">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="text-[#C9A84C] hover:text-[#E8D48B] font-semibold transition-colors">
              Create account
            </Link>
          </p>
        </div>

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
