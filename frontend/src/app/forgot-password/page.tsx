"use client";
import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RecaptchaVerifier, signInWithPhoneNumber, ConfirmationResult } from 'firebase/auth';
import { auth } from '@/utils/firebase';
import SuccessOverlay from '@/components/SuccessOverlay';

declare global {
  interface Window { recaptchaVerifier?: RecaptchaVerifier; }
}

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const [overlay, setOverlay] = useState<{ isOpen: boolean; title: string; message: string; type?: 'success' | 'error' }>({
    isOpen: false, title: '', message: '',
  });

  // Cooldown timer for resend
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  // Setup invisible reCAPTCHA — always create a fresh instance
  // reCAPTCHA tokens are single-use and expire quickly, so we must
  // tear down the old verifier and create a new one every time.
  const setupRecaptcha = () => {
    // Tear down any existing verifier before creating a new one
    if (window.recaptchaVerifier) {
      try { window.recaptchaVerifier.clear(); } catch (_) {}
      window.recaptchaVerifier = undefined;
    }
    window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
      size: 'invisible',
      callback: () => {},
      'expired-callback': () => {
        // Auto-clear on expiry so next attempt always gets a fresh token
        if (window.recaptchaVerifier) {
          try { window.recaptchaVerifier.clear(); } catch (_) {}
          window.recaptchaVerifier = undefined;
        }
      },
    });
    return window.recaptchaVerifier;
  };

  // Step 1 — Send OTP
  const handleSendOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (digits.length < 10) {
      setOverlay({ isOpen: true, title: 'Invalid Number', message: 'Enter a valid 10-digit phone number.', type: 'error' });
      return;
    }

    // Developer Bypass for testing without Firebase SMS
    if (digits === '0000000000') {
      setStep(2);
      setResendCooldown(60);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
      return;
    }

    setLoading(true);
    try {
      const verifier = setupRecaptcha();
      const result = await signInWithPhoneNumber(auth, `+91${digits}`, verifier);
      confirmationRef.current = result;
      setStep(2);
      setResendCooldown(60);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch (err: any) {
      // Reset recaptcha on error so it can be used again
      window.recaptchaVerifier?.clear();
      window.recaptchaVerifier = undefined;
      setOverlay({
        isOpen: true,
        title: 'OTP Failed',
        message: err.code === 'auth/too-many-requests'
          ? 'Too many attempts. Please wait a few minutes and try again.'
          : err.message || 'Could not send OTP. Please try again.',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  // Step 2 — Verify OTP + Reset Password
  const handleVerifyAndReset = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const code = otp.join('');
    if (code.length < 6) {
      setOverlay({ isOpen: true, title: 'Enter OTP', message: 'Please enter the complete 6-digit code.', type: 'error' });
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setOverlay({ isOpen: true, title: 'Password Too Short', message: 'Password must be at least 6 characters.', type: 'error' });
      return;
    }
    const digits = phone.replace(/\D/g, '').slice(-10);
    
    // Check session except for bypass
    if (digits !== '0000000000' && !confirmationRef.current) {
      setOverlay({ isOpen: true, title: 'Session Expired', message: 'Please go back and request a new OTP.', type: 'error' });
      return;
    }

    setLoading(true);
    try {
      let firebaseToken = '';
      
      // 1. Confirm OTP with Firebase OR use Bypass
      if (digits === '0000000000') {
        if (code !== '000000') {
          throw { code: 'bypass-error', message: 'For bypass testing, please enter OTP 000000' };
        }
        firebaseToken = 'E2E_MOCK_TOKEN';
      } else {
        const result = await confirmationRef.current!.confirm(code);
        firebaseToken = await result.user.getIdToken();
      }

      // 2. Send token + new password to backend
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
      const response = await fetch(`${API_URL}/api/users/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: digits, firebaseToken, newPassword }),
      });
      const data = await response.json();

      if (response.ok) {
        setOverlay({ isOpen: true, title: 'Password Reset', message: 'Your password has been updated. Signing you in...', type: 'success' });
        setTimeout(() => router.push('/login'), 2000);
      } else {
        setOverlay({ isOpen: true, title: 'Reset Failed', message: data.message || 'Could not reset password.', type: 'error' });
      }
    } catch (err: any) {
      const isWrong = err.code === 'auth/invalid-verification-code' || err.code === 'auth/code-expired';
      setOverlay({
        isOpen: true,
        title: isWrong ? 'Incorrect OTP' : 'Error',
        message: isWrong ? 'The code you entered is wrong or expired. Try again.' : err.message || 'Something went wrong.',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  // OTP box key handler
  const handleOtpChange = (val: string, idx: number) => {
    if (!/^\d*$/.test(val)) return;
    const next = [...otp];
    next[idx] = val.slice(-1);
    setOtp(next);
    if (val && idx < 5) otpRefs.current[idx + 1]?.focus();
  };

  const handleOtpKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) otpRefs.current[idx - 1]?.focus();
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setOtp(pasted.split(''));
      otpRefs.current[5]?.focus();
    }
  };

  return (
    <main className="min-h-screen bg-[#0A0A0B] text-white flex items-center justify-center p-5">
      {/* Invisible reCAPTCHA anchor */}
      <div id="recaptcha-container" />

      <div className="w-full max-w-lg">

        {/* Brand Header */}
        <div className="text-center mb-10">
          <button
            onClick={() => step === 2 ? setStep(1) : router.push('/login')}
            className="inline-flex items-center gap-2 text-[#C9A84C] hover:text-[#E8D48B] transition-colors mb-6"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-xs font-semibold tracking-widest uppercase">
              {step === 2 ? 'Back' : 'Back to Sign In'}
            </span>
          </button>

          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="w-8 h-px bg-[#C9A84C]/30" />
            <span className="text-[10px] font-bold tracking-[0.4em] uppercase text-[#C9A84C]/60">Zenvy</span>
            <div className="w-8 h-px bg-[#C9A84C]/30" />
          </div>

          <h1 className="text-4xl font-bold text-white tracking-tight">
            {step === 1 ? 'Reset Password' : 'Verify & Reset'}
          </h1>
          <p className="text-sm text-[#6B6B6B] mt-2">
            {step === 1
              ? "We'll send a one-time code to your phone."
              : `Code sent to +91 ${phone.replace(/\D/g, '').slice(-10)}`}
          </p>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mt-5">
            <div className={`h-1 rounded-full transition-all duration-500 ${step === 1 ? 'w-8 bg-[#C9A84C]' : 'w-4 bg-[#C9A84C]/40'}`} />
            <div className={`h-1 rounded-full transition-all duration-500 ${step === 2 ? 'w-8 bg-[#C9A84C]' : 'w-4 bg-white/10'}`} />
          </div>
        </div>

        {/* Card */}
        <div className="bg-[#141416] border border-[#C9A84C]/10 rounded-3xl p-10 shadow-xl shadow-black/40">

          {/* ── STEP 1: Phone ── */}
          {step === 1 && (
            <form onSubmit={handleSendOtp} className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-[#6B6B6B] mb-2 tracking-wider uppercase">
                  Phone Number
                </label>
                <div className="relative">
                  <span className="absolute left-5 top-1/2 -translate-y-1/2 text-[#C9A84C] text-base font-bold">+91</span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Enter your registered number"
                    maxLength={10}
                    className="w-full bg-[#0A0A0B] border border-white/8 hover:border-white/15 focus:border-[#C9A84C]/50 rounded-2xl h-16 pl-16 pr-5 text-base font-medium text-white placeholder:text-white/20 outline-none transition-colors"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-16 rounded-2xl bg-[#C9A84C] hover:bg-[#D4B56A] disabled:opacity-60 disabled:cursor-not-allowed text-[#0A0A0B] text-base font-bold tracking-wide transition-colors"
              >
                {loading ? 'Sending OTP…' : 'Send OTP →'}
              </button>
            </form>
          )}

          {/* ── STEP 2: OTP + New Password ── */}
          {step === 2 && (
            <form onSubmit={handleVerifyAndReset} className="space-y-6">

              {/* OTP Boxes */}
              <div>
                <label className="block text-sm font-semibold text-[#6B6B6B] mb-4 tracking-wider uppercase">
                  6-Digit Code
                </label>
                <div className="flex gap-2 sm:gap-3 justify-center" onPaste={handleOtpPaste}>
                  {otp.map((digit, i) => (
                    <input
                      key={i}
                      ref={el => { otpRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(e.target.value, i)}
                      onKeyDown={(e) => handleOtpKeyDown(e, i)}
                      className={`w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-2xl text-center text-2xl font-bold bg-[#0A0A0B] border-2 outline-none transition-all min-w-0 ${
                        digit
                          ? 'border-[#C9A84C] text-[#C9A84C] shadow-[0_0_12px_rgba(201,168,76,0.2)]'
                          : 'border-white/10 text-white focus:border-[#C9A84C]/50'
                      }`}
                    />
                  ))}
                </div>

                {/* Resend */}
                <div className="mt-3 text-right">
                  {resendCooldown > 0 ? (
                    <span className="text-xs text-[#6B6B6B]">Resend in {resendCooldown}s</span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSendOtp}
                      disabled={loading}
                      className="text-xs text-[#C9A84C] hover:text-[#E8D48B] font-semibold transition-colors"
                    >
                      Resend OTP
                    </button>
                  )}
                </div>
              </div>

              {/* New Password */}
              <div>
                <label className="block text-sm font-semibold text-[#6B6B6B] mb-2 tracking-wider uppercase">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Choose a new password"
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
                <p className="text-xs text-[#6B6B6B]/60 mt-2 ml-1">Minimum 6 characters</p>
              </div>

              <button
                type="submit"
                disabled={loading || otp.join('').length < 6}
                className="w-full h-16 rounded-2xl bg-[#C9A84C] hover:bg-[#D4B56A] disabled:opacity-60 disabled:cursor-not-allowed text-[#0A0A0B] text-base font-bold tracking-wide transition-colors"
              >
                {loading ? 'Verifying…' : 'Verify & Reset Password'}
              </button>
            </form>
          )}

          <p className="text-center text-xs text-[#6B6B6B] mt-6">
            Remember your password?{' '}
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
