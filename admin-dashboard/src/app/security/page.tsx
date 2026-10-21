"use client";
/**
 * S1: Account security — admin 2-step sign-in (TOTP).
 * Setup shows the otpauth:// link and the secret for manual entry in Google Authenticator (no QR library
 * in the dashboard), enable with a code, one-time recovery codes (copy / download), new codes, turn off.
 * Endpoints: GET /api/admin/2fa/status, POST /api/admin/2fa/setup | enable | disable | recovery-codes.
 */
import { useConfirm } from '@/components/ui';
import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from '@/lib/api';
import { getAuthState, startSession, verifySession } from '@/lib/session';
import { useAdminAuth } from '@/utils/useAdminAuth';

interface Status {
  enabled: boolean;
  required: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
  locked: boolean;
  lockedUntil: string | null;
}
interface Setup { otpauthUri: string; secret: string; account: string; issuer: string; expiresInMinutes: number }

const box = 'rounded-lg border border-line bg-surface-2/60 p-6 space-y-4';
const btn = 'px-5 py-3 rounded-xl bg-accent text-accent-fg text-xs font-semibold hover:bg-surface-2 disabled:opacity-50';
const btn2 = 'px-5 py-3 rounded-xl border border-line text-xs font-semibold text-fg-muted hover:bg-surface-2/60 disabled:opacity-50';
const input = 'w-full max-w-xs bg-surface-2/60 border border-line rounded-xl py-3 px-4 text-fg font-semibold outline-none focus:border-accent text-center';

/** Swap in the new session token the server issued (enable / disable revoke the old ones). */
const adoptToken = async (token?: string) => {
  const user = getAuthState().user;
  if (token && user) startSession(token, { ...user, mfaSetupRequired: false });
  await verifySession();
};

export default function SecurityPage() {
  const confirm = useConfirm();
  const { user } = useAdminAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [offCode, setOffCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      setStatus(await adminRequest<Status>('/api/admin/2fa/status'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load the 2-step status.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr('');
    setMsg('');
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setBusy(false); }
  };

  const startSetup = () => run(async () => {
    setCodes(null);
    setSetup(await adminRequest<Setup>('/api/admin/2fa/setup', { method: 'POST', body: '{}' }));
  });
  const enable = () => run(async () => {
    const r = await adminRequest<{ recoveryCodes: string[]; token: string; message: string }>('/api/admin/2fa/enable', { method: 'POST', body: JSON.stringify({ code: code.split(' ').join('') }) });
    setCodes(r.recoveryCodes);
    setSetup(null);
    setCode('');
    setMsg(r.message);
    await adoptToken(r.token);
    await load();
  });
  const newCodes = () => run(async () => {
    const r = await adminRequest<{ recoveryCodes: string[]; message: string }>('/api/admin/2fa/recovery-codes', { method: 'POST', body: JSON.stringify({ code: offCode.split(' ').join('') }) });
    setCodes(r.recoveryCodes);
    setOffCode('');
    setMsg(r.message);
    await load();
  });
  const disable = () => run(async () => {
    if (!(await confirm({ title: 'Turn off 2-step sign-in for this admin account? Other sessions will be signed out.' }))) return;
    const c = offCode.trim();
    const body = /^[0-9 ]+$/.test(c) ? { code: c.split(' ').join('') } : { recoveryCode: c };
    const r = await adminRequest<{ token: string; message: string }>('/api/admin/2fa/disable', { method: 'POST', body: JSON.stringify(body) });
    setOffCode('');
    setCodes(null);
    setMsg(r.message);
    await adoptToken(r.token);
    await load();
  });

  const copyCodes = async () => {
    if (!codes) return;
    try { await navigator.clipboard.writeText(codes.join('\n')); setMsg('Recovery codes copied.'); } catch { setErr('Copy failed: select the codes and copy them by hand.'); }
  };
  const downloadCodes = () => {
    if (!codes) return;
    const text = `Zenvy Admin recovery codes (${user?.name || 'admin'})\nEach code works once. Keep them somewhere safe.\n\n${codes.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zenvy-admin-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-fg">Account security</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-muted">2-step sign-in: after your password, a 6-digit code from an authenticator app on your phone.</p>
      </div>

      {user?.mfaSetupRequired && (
        <p className="rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-warning-text">2-step sign-in is required for admin accounts. Set it up below to use the dashboard.</p>
      )}
      {msg && <p className="rounded-xl border border-success/30 bg-success-soft p-4 text-sm text-success-text" role="status">{msg}</p>}
      {err && <p className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger-text" role="alert">{err}</p>}

      <div className={box}>
        <p className="text-sm text-fg font-semibold">Status: {status ? (status.enabled ? `On${status.enabledAt ? ` since ${new Date(status.enabledAt).toLocaleString('en-IN')}` : ''}` : 'Off') : '...'}</p>
        {status?.enabled && <p className="text-sm text-fg-muted">Recovery codes left: {status.recoveryCodesLeft}</p>}
        {status?.locked && <p className="text-sm text-danger-text">Locked after too many wrong codes until {status.lockedUntil ? new Date(status.lockedUntil).toLocaleTimeString('en-IN') : 'later'}.</p>}
        {status && !status.enabled && !setup && <button className={btn} disabled={busy} onClick={startSetup}>Set up 2-step sign-in</button>}
      </div>

      {setup && (
        <div className={box}>
          <p className="text-sm text-fg font-semibold">1. Add the key to Google Authenticator (or any TOTP app)</p>
          <p className="text-sm text-fg-muted">In the app: + &rarr; Enter a setup key. Account: <span className="text-fg">{setup.issuer}</span>, key below, type: Time based.</p>
          <p className="font-mono text-lg text-fg break-all select-all bg-surface-2 rounded-xl p-4">{setup.secret}</p>
          <p className="text-xs text-fg-muted break-all">Or open this link on the phone: <a className="text-info-text underline" href={setup.otpauthUri}>{setup.otpauthUri}</a></p>
          <p className="text-sm text-fg font-semibold">2. Enter the 6-digit code the app shows</p>
          <div className="flex flex-wrap gap-3 items-center">
            <input className={input} inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && enable()} placeholder="123456" aria-label="6-digit code" />
            <button className={btn} disabled={busy || code.split(' ').join('').length !== 6} onClick={enable}>Turn on</button>
            <button className={btn2} disabled={busy} onClick={() => setSetup(null)}>Cancel</button>
          </div>
          <p className="text-xs text-fg-muted">This key expires in {setup.expiresInMinutes} minutes if not confirmed.</p>
        </div>
      )}

      {codes && (
        <div className={box}>
          <p className="text-sm text-fg font-semibold">Recovery codes (shown only once)</p>
          <p className="text-sm text-fg-muted">If you lose your phone, each code signs you in once. Store them offline.</p>
          <pre className="font-mono text-base text-fg bg-surface-2 rounded-xl p-4 grid grid-cols-2 gap-2 select-all">{codes.join('\n')}</pre>
          <div className="flex gap-3">
            <button className={btn2} onClick={copyCodes}>Copy</button>
            <button className={btn2} onClick={downloadCodes}>Download .txt</button>
          </div>
        </div>
      )}

      {status?.enabled && (
        <div className={box}>
          <p className="text-sm text-fg font-semibold">Manage</p>
          <p className="text-sm text-fg-muted">Enter a current 6-digit code (or a recovery code to turn it off).</p>
          <div className="flex flex-wrap gap-3 items-center">
            <input className={input} value={offCode} onChange={(e) => setOffCode(e.target.value)} placeholder="code" aria-label="Code" maxLength={16} />
            <button className={btn2} disabled={busy || !offCode.trim()} onClick={newCodes}>New recovery codes</button>
            <button className={btn2} disabled={busy || !offCode.trim()} onClick={disable}>Turn off</button>
          </div>
          {status.required && <p className="text-xs text-warning-text">2-step sign-in is required for admins: turning it off removes admin access until you set it up again.</p>}
        </div>
      )}
    </div>
  );
}
