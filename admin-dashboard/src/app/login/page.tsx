"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL } from '@/lib/config';
import { getAuthState, startSession } from '@/lib/session';

/**
 * Only same-origin paths are allowed as the post-login redirect. The value is resolved by the URL
 * parser (as the browser would) instead of string checks: '/\evil.com', '/\t/evil.com' and similar are
 * read by browsers as '//evil.com' and slipped past a startsWith('//') test.
 */
const safeNext = () => {
  try {
    const raw = new URLSearchParams(window.location.search).get('next');
    if (!raw || !raw.startsWith('/')) return '/';
    const origin = window.location.origin;
    const url = new URL(raw, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/')) return '/';
    if (url.pathname.replace(/\/+$/, '') === '/login') return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { /* ignore */ }
  return '/';
};

const normalizePhone = (value: string) => value.replace(/\D/g, '').slice(-10);

export default function AdminLoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // S1: second step of the admin sign-in (2-step code or a recovery code).
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);

  // Explain why the admin landed here (expired session, non-admin account, ...).
  useEffect(() => {
    const reason = getAuthState().message;
    if (reason) setError(reason);
  }, []);

  /** Session from a login / login-mfa answer. */
  const finishLogin = (data: any, digits: string) => {
    if (String(data.role || '').toLowerCase() !== 'admin') {
      setError('This account does not have admin access.');
      return;
    }
    startSession(data.token, {
      id: String(data.id ?? data._id ?? ''),
      name: data.name || 'Admin',
      phone: data.phone ?? digits,
      email: data.email || null,
      role: data.role,
      mfaSetupRequired: !!data.mfaSetupRequired,
    });
    setPassword('');
    setMfaToken(null);
    setMfaCode('');
    router.replace(data.mfaSetupRequired ? '/security' : safeNext());
  };

  const handleMfa = async () => {
    const code = mfaCode.trim();
    if (!mfaToken) return;
    if (!useRecovery && !/^[0-9]{6}$/.test(code.split(' ').join(''))) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    if (useRecovery && code.replace(/[^a-z0-9]/gi, '').length !== 10) {
      setError('Enter one of your 10-character recovery codes.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/users/login/mfa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zenvy-Client': 'admin-web' },
        body: JSON.stringify(useRecovery ? { mfaToken, recoveryCode: code } : { mfaToken, code: code.split(' ').join('') }),
      });
      let data: any = {};
      try { data = await response.json(); } catch { /* non-JSON */ }
      if (response.ok && data.token) {
        finishLogin(data, normalizePhone(phone));
        return;
      }
      if (data.code === 'MFA_TOKEN_INVALID' || data.code === 'MFA_TOKEN_USED') {
        setMfaToken(null);
        setMfaCode('');
      }
      setError(data.message || 'That code did not work. Please try again.');
    } catch {
      setError('Could not reach the Zenvy server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    const digits = normalizePhone(phone);
    if (!/^[6-9]\d{9}$/.test(digits)) {
      setError('Enter the 10-digit mobile number of your admin account.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/users/login`, {
        method: 'POST',
        // S1: the admin web marker (exempt from App Check; the server then signs in admin accounts only).
        headers: { 'Content-Type': 'application/json', 'X-Zenvy-Client': 'admin-web' },
        body: JSON.stringify({ phone: digits, password }),
      });

      let data: any = {};
      try { data = await response.json(); } catch { /* non-JSON error page */ }

      if (response.ok && data.mfaRequired && data.mfaToken) {
        setMfaToken(data.mfaToken);
        setMfaCode('');
        setUseRecovery(false);
        return;
      }
      if (response.ok && data.token) {
        finishLogin(data, digits);
        return;
      }

      if (response.ok) {
        // e.g. { isNewUser: true } — not a usable admin login
        setError('No admin account uses this number.');
      } else if (response.status === 429) {
        setError(data.message || 'Too many attempts. Please wait 15 minutes and try again.');
      } else if (response.status === 401 && data.code === 'ACCOUNT_NOT_FOUND') {
        setError('No account uses this number.');
      } else if (response.status === 401) {
        setError('Wrong phone number or password.');
      } else if (response.status === 403) {
        setError(data.message || 'This account is suspended.');
      } else if (response.status >= 500) {
        setError('The server had a problem signing you in. Please try again.');
      } else {
        setError(data.message || data.errors?.[0]?.msg || 'Sign in failed. Please try again.');
      }
    } catch {
      setError('Could not reach the Zenvy server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0A0A0F] text-white flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-blue-600/10 blur-[120px] rounded-full" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-amber-600/5 blur-[120px] rounded-full" />

      {/* CSS entrance animation (framer-motion added ~40 KB gzipped to the first page every admin loads). */}
      <div className="w-full max-w-md glass p-10 rounded-[32px] border border-white/5 relative z-10 animate-slide-up">

        <div className="text-center mb-12">
          <div className="w-16 h-16 bg-blue-600/20 border border-blue-500/30 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-6 shadow-2xl">
            ⚡
          </div>
          <h1 className="text-3xl font-black tracking-tighter uppercase italic">Nexus <span className="text-blue-500">Secure</span></h1>
          <p className="text-[10px] font-black text-gray-500 uppercase tracking-[0.4em] mt-2">Administrative Command Terminal</p>
        </div>

        {mfaToken ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="admin-mfa" className="text-[10px] font-black text-blue-500 uppercase tracking-widest ml-1">{useRecovery ? 'Recovery code' : '2-step code'}</label>
              <input
                id="admin-mfa"
                autoFocus
                inputMode={useRecovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleMfa()}
                placeholder={useRecovery ? 'xxxxx-xxxxx' : '6-digit code'}
                maxLength={useRecovery ? 16 : 7}
                className="w-full bg-white/[0.02] border border-white/5 rounded-2xl py-4 px-6 text-white font-bold outline-none focus:border-blue-500/40 transition-all text-center tracking-[0.3em]"
              />
              <p className="text-xs text-gray-500 text-center">{useRecovery ? 'Each recovery code works once.' : 'Open your authenticator app (Google Authenticator) and enter the Zenvy Admin code.'}</p>
            </div>
            <button
              onClick={handleMfa}
              disabled={loading}
              className="w-full bg-white text-black py-5 rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] hover:bg-gray-200 transition-all shadow-xl shadow-blue-500/5 disabled:opacity-50"
            >
              {loading ? 'Checking...' : 'Verify'}
            </button>
            <div className="flex justify-between text-xs">
              <button type="button" onClick={() => { setUseRecovery((v) => !v); setMfaCode(''); setError(''); }} className="text-gray-400 hover:text-white">{useRecovery ? 'Use the authenticator code' : 'Use a recovery code'}</button>
              <button type="button" onClick={() => { setMfaToken(null); setMfaCode(''); setError(''); }} className="text-gray-400 hover:text-white">Back</button>
            </div>
          </div>
        ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="admin-phone" className="text-[10px] font-black text-blue-500 uppercase tracking-widest ml-1">Admin mobile number</label>
            <input
              id="admin-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="username"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="10-digit mobile number"
              maxLength={16}
              className="w-full bg-white/[0.02] border border-white/5 rounded-2xl py-4 px-6 text-white font-bold outline-none focus:border-blue-500/40 transition-all text-center tracking-[0.2em]"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="admin-password" className="text-[10px] font-black text-blue-500 uppercase tracking-widest ml-1">Password</label>
            <input
              id="admin-password"
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="••••••••••••"
              className="w-full bg-white/[0.02] border border-white/5 rounded-2xl py-4 px-6 text-white font-bold outline-none focus:border-blue-500/40 transition-all text-center tracking-[0.3em]"
            />
          </div>
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-white text-black py-5 rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] hover:bg-gray-200 transition-all shadow-xl shadow-blue-500/5 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-8 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs font-semibold text-center animate-fade-in"
          >
            {error}
          </div>
        )}
      </div>

      <div className="absolute bottom-10 text-[9px] font-bold text-gray-500 uppercase tracking-[0.3em]">
        Zenvy Operations Management Portal
      </div>
    </main>
  );
}
