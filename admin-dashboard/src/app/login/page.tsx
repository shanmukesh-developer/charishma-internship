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
  // Email-code method: where the code went, seconds until "Resend code" works, the last resend note.
  const [mfaMethod, setMfaMethod] = useState<'totp' | 'email'>('totp');
  const [emailHint, setEmailHint] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [info, setInfo] = useState('');
  const emailMethod = mfaMethod === 'email';

  // Explain why the admin landed here (expired session, non-admin account, ...).
  useEffect(() => {
    const reason = getAuthState().message;
    if (reason) setError(reason);
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const backToPassword = () => { setMfaToken(null); setMfaCode(''); setInfo(''); setResendIn(0); };

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
    backToPassword();
    router.replace(data.mfaSetupRequired ? '/security' : safeNext());
  };

  const handleMfa = async () => {
    const code = mfaCode.trim();
    if (!mfaToken) return;
    if (!useRecovery && !/^[0-9]{6}$/.test(code.split(' ').join(''))) {
      setError(emailMethod ? 'Enter the 6-digit code we emailed you.' : 'Enter the 6-digit code from your authenticator app.');
      return;
    }
    if (useRecovery && code.replace(/[^a-z0-9]/gi, '').length !== 10) {
      setError('Enter one of your 10-character recovery codes.');
      return;
    }
    setLoading(true);
    setError('');
    setInfo('');
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
      if (data.code === 'MFA_TOKEN_INVALID' || data.code === 'MFA_TOKEN_USED') backToPassword();
      setError(data.message || 'That code did not work. Please try again.');
    } catch {
      setError('Could not reach the ZCS server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  /** Email-code method: a new code for this sign-in step (one a minute). */
  const handleResend = async () => {
    if (!mfaToken || resendIn > 0) return;
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const response = await fetch(`${API_URL}/api/users/login/mfa/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Zenvy-Client': 'admin-web' },
        body: JSON.stringify({ mfaToken }),
      });
      let data: any = {};
      try { data = await response.json(); } catch { /* non-JSON */ }
      if (response.ok) {
        setResendIn(Number(data.resendAfter) || 60);
        setMfaCode('');
        setInfo(data.message || 'A new code was sent.');
        return;
      }
      if (data.code === 'MFA_TOKEN_INVALID' || data.code === 'MFA_TOKEN_USED') backToPassword();
      // Too soon, hourly limit or locked: Resend waits as long as the server says.
      if (Number(data.retryAfter) > 0) setResendIn(Number(data.retryAfter));
      setError(data.message || 'Could not send a new code. Please try again.');
    } catch {
      setError('Could not reach the ZCS server. Check your connection and try again.');
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
        setMfaMethod(data.mfaMethod === 'email' ? 'email' : 'totp');
        setEmailHint(data.emailHint || '');
        setResendIn(Number(data.resendAfter) || 0);
        setInfo('');
        // No email went out (locked, hourly limit, email off, send failed): the server says which; Resend later, or
        // a recovery code, still finishes the sign-in.
        if (data.mfaMethod === 'email' && data.emailSent === false) setError(data.message || 'The code email could not be sent. Send a new code, or use a recovery code.');
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
      setError('Could not reach the ZCS server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const mfaDigits = useRecovery ? mfaCode : mfaCode.split(' ').join('');

  return (
    <main className="flex min-h-screen flex-col bg-bg">
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-fg text-base font-semibold text-bg" aria-hidden>Z</span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-lg font-semibold tracking-[-0.01em] text-fg">ZCS</span>
              <span className="text-sm text-fg-subtle">Admin</span>
            </span>
          </div>

          <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
            {mfaToken ? (
              <form
                noValidate
                onSubmit={(e) => { e.preventDefault(); if (!loading) handleMfa(); }}
                className="space-y-5"
              >
                <div>
                  <h1 className="text-xl font-semibold text-fg">2-step verification</h1>
                  <p className="mt-1 text-sm text-fg-muted">
                    {useRecovery
                      ? 'Enter one of your recovery codes. Each code works once.'
                      : emailMethod
                        ? `We emailed a 6-digit code to ${emailHint || 'your email'}. Each code works for 10 minutes: use the latest one.`
                        : 'Open your authenticator app and enter the 6-digit code for ZCS Admin.'}
                  </p>
                </div>
                <div>
                  <label htmlFor="admin-mfa" className="mb-1 block text-sm font-medium text-fg">{useRecovery ? 'Recovery code' : emailMethod ? 'Email code' : 'Authentication code'}</label>
                  <input
                    id="admin-mfa"
                    autoFocus
                    inputMode={useRecovery ? 'text' : 'numeric'}
                    autoComplete="one-time-code"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    placeholder={useRecovery ? 'xxxxx-xxxxx' : '000000'}
                    maxLength={useRecovery ? 16 : 7}
                    aria-invalid={!!error || undefined}
                    aria-describedby={error ? 'login-error' : undefined}
                    className="zv-control h-10 text-center font-mono text-lg tracking-[0.3em]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !mfaDigits.trim()}
                  className="inline-flex h-10 w-full items-center justify-center rounded-md bg-accent text-sm font-medium text-accent-fg shadow-xs transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  {loading ? 'Checking…' : 'Verify and sign in'}
                </button>
                {emailMethod && !useRecovery && (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={loading || resendIn > 0}
                    className="inline-flex h-9 w-full items-center justify-center rounded-md border border-line text-sm font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
                  >
                    {resendIn > 120 ? `Resend code in ${Math.ceil(resendIn / 60)} min` : resendIn > 0 ? `Resend code in ${resendIn} s` : 'Resend code'}
                  </button>
                )}
                {info && <p role="status" className="text-sm text-success-text">{info}</p>}
                <div className="flex items-center justify-between text-sm">
                  <button type="button" onClick={() => { setUseRecovery((v) => !v); setMfaCode(''); setError(''); setInfo(''); }} className="text-accent-text hover:underline underline-offset-2">
                    {useRecovery ? (emailMethod ? 'Use the emailed code' : 'Use the authenticator code') : 'Use a recovery code'}
                  </button>
                  <button type="button" onClick={() => { backToPassword(); setError(''); }} className="text-fg-muted hover:text-fg">
                    Back
                  </button>
                </div>
              </form>
            ) : (
              <form
                noValidate
                onSubmit={(e) => { e.preventDefault(); if (!loading) handleLogin(); }}
                className="space-y-5"
              >
                <div>
                  <h1 className="text-xl font-semibold text-fg">Sign in</h1>
                  <p className="mt-1 text-sm text-fg-muted">Use the mobile number and password of your admin account.</p>
                </div>
                <div>
                  <label htmlFor="admin-phone" className="mb-1 block text-sm font-medium text-fg">Mobile number</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-fg-subtle">+91</span>
                    <input
                      id="admin-phone"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="username"
                      autoFocus
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="10-digit number"
                      maxLength={16}
                      aria-describedby={error ? 'login-error' : undefined}
                      className="zv-control h-10 pl-11"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="admin-password" className="mb-1 block text-sm font-medium text-fg">Password</label>
                  <input
                    id="admin-password"
                    autoComplete="current-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-describedby={error ? 'login-error' : undefined}
                    className="zv-control h-10"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex h-10 w-full items-center justify-center rounded-md bg-accent text-sm font-medium text-accent-fg shadow-xs transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            )}

            {error && (
              <div
                id="login-error"
                role="alert"
                className="mt-5 rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger-text"
              >
                {error}
              </div>
            )}
          </div>

          <p className="mt-6 text-center text-xs text-fg-subtle">
            For ZCS staff only.
          </p>
        </div>
      </div>
    </main>
  );
}
