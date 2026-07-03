"use client";
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '@/utils/firebase';
import SuccessOverlay from '@/components/SuccessOverlay';
import { API_URL } from '@/utils/api';

export default function RegisterPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({ name: '', phone: '', password: '', referralCode: '' });
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
      const last10 = /[a-zA-Z]/.test(formData.phone) ? formData.phone : formData.phone.replace(/\D/g, '').slice(-10);
      const response = await fetch(`${API_URL}/api/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          phone: last10,
          password: formData.password,
          referralCode: formData.referralCode.trim().toUpperCase(),
        }),
      });
      const data = await response.json();
      if (response.ok) {
        localStorage.setItem('user', JSON.stringify({ id: data._id, name: data.name, phone: data.phone, token: data.token }));
        if (formData.referralCode.trim()) {
          try {
            await fetch(`${API_URL}/api/features/referral/apply`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ referralCode: formData.referralCode.trim().toUpperCase() }),
            });
          } catch { /* silent */ }
        }
        setOverlay({
          isOpen: true,
          title: 'Account Created',
          message: formData.referralCode ? 'Welcome to Zenvy! You earned 50 ZenPoints.' : 'Welcome to Zenvy!',
          type: 'success',
        });
        setTimeout(() => router.push('/'), 2000);
      } else {
        setOverlay({ isOpen: true, title: 'Registration Failed', message: data.message || 'Something went wrong.', type: 'error' });
      }
    } catch (err: unknown) {
      setOverlay({ isOpen: true, title: 'Connection Error', message: 'Could not reach the server. Please try again.', type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setIsSubmitting(true);
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
        setOverlay({ isOpen: true, title: 'Account Created', message: 'Welcome to Zenvy!', type: 'success' });
        setTimeout(() => router.push('/'), 2000);
      } else {
        setOverlay({ isOpen: true, title: 'Google Sign-Up Failed', message: data.message || 'Try again.', type: 'error' });
      }
    } catch (err: any) {
      setOverlay({ isOpen: true, title: 'Google Sign-Up Failed', message: err.message || 'Could not connect to Google.', type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0A0A0B] text-white flex items-center justify-center p-5">
      <div className="w-full max-w-lg">

        {/* Brand Header */}
        <div className="text-center mb-10">
          <Link href="/login" className="inline-flex items-center gap-2 text-[#C9A84C] hover:text-[#E8D48B] transition-colors mb-6">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-xs font-semibold tracking-widest uppercase">Back to Sign In</span>
          </Link>
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="w-8 h-px bg-[#C9A84C]/30" />
            <span className="text-[10px] font-bold tracking-[0.4em] uppercase text-[#C9A84C]/60">Zenvy</span>
            <div className="w-8 h-px bg-[#C9A84C]/30" />
          </div>
          <h1 className="text-4xl font-bold text-white tracking-tight">Create Account</h1>
          <p className="text-sm text-[#6B6B6B] mt-2">Join Zenvy and start ordering.</p>
        </div>

        {/* Card */}
        <div className="bg-[#141416] border border-[#C9A84C]/10 rounded-3xl p-10 shadow-xl shadow-black/40">

          {/* Google Sign Up */}
          <button
            type="button"
            onClick={handleGoogleSignUp}
            disabled={isSubmitting}
            className="w-full h-14 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/8 hover:border-white/15 text-white text-base font-semibold flex items-center justify-center gap-3 transition-colors disabled:opacity-60 mb-5"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Sign up with Google
          </button>

          {/* Divider */}
          <div className="flex items-center gap-4 mb-5">
            <div className="flex-1 h-px bg-white/8" />
            <span className="text-xs text-[#6B6B6B] font-medium">or sign up with phone</span>
            <div className="flex-1 h-px bg-white/8" />
          </div>

          <form onSubmit={handleRegister} autoComplete="on" className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-semibold text-[#6B6B6B] mb-2 tracking-wider uppercase">Full Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                autoComplete="name"
                placeholder="Enter your name"
                className="w-full bg-[#0A0A0B] border border-white/8 hover:border-white/15 focus:border-[#C9A84C]/50 rounded-2xl h-16 px-5 text-base font-medium text-white placeholder:text-white/20 outline-none transition-colors"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-semibold text-[#6B6B6B] mb-2 tracking-wider uppercase">Phone Number</label>
              <div className="relative">
                <span className="absolute left-5 top-1/2 -translate-y-1/2 text-[#C9A84C] text-base font-bold">+91</span>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  autoComplete="tel"
                  placeholder="Enter phone number"
                  className="w-full bg-[#0A0A0B] border border-white/8 hover:border-white/15 focus:border-[#C9A84C]/50 rounded-2xl h-16 pl-16 pr-5 text-base font-medium text-white placeholder:text-white/20 outline-none transition-colors"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-semibold text-[#6B6B6B] mb-2 tracking-wider uppercase">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  autoComplete="new-password"
                  placeholder="Create a password"
                  className="w-full bg-[#0A0A0B] border border-white/8 hover:border-white/15 focus:border-[#C9A84C]/50 rounded-2xl h-16 px-5 pr-14 text-base font-medium text-white placeholder:text-white/20 outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-5 top-1/2 -translate-y-1/2 text-white/30 hover:text-[#C9A84C] transition-colors"
                >
                  {showPassword
                    ? <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  }
                </button>
              </div>
            </div>

            {/* Referral Code */}
            <div>
              <label className="block text-sm font-semibold text-[#6B6B6B] mb-2 tracking-wider uppercase">
                Referral Code <span className="text-[#6B6B6B]/40 normal-case font-medium">(optional)</span>
              </label>
              <input
                type="text"
                value={formData.referralCode}
                onChange={(e) => setFormData({ ...formData, referralCode: e.target.value.toUpperCase() })}
                placeholder="ZV-XXXXXX"
                maxLength={10}
                className="w-full bg-[#0A0A0B] border border-white/8 hover:border-white/15 focus:border-[#C9A84C]/40 rounded-2xl h-16 px-5 text-base font-medium text-white placeholder:text-white/20 outline-none transition-colors"
              />
              {formData.referralCode && (
                <p className="text-xs text-emerald-400/70 mt-2 ml-1">Both of you will earn 50 ZenPoints ✦</p>
              )}
            </div>

            {/* Create Account Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-16 rounded-2xl bg-[#C9A84C] hover:bg-[#D4B56A] disabled:opacity-60 disabled:cursor-not-allowed text-[#0A0A0B] text-base font-bold tracking-wide transition-colors mt-1"
            >
              {isSubmitting ? 'Creating account…' : 'Create Account'}
            </button>
          </form>

          {/* Footer */}
          <p className="text-center text-xs text-[#6B6B6B] mt-6">
            Already have an account?{' '}
            <Link href="/login" className="text-[#C9A84C] hover:text-[#E8D48B] font-semibold transition-colors">
              Sign in
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
