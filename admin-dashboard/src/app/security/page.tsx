"use client";
/**
 * S1: Account security — admin 2-step sign-in: a code from an authenticator app (TOTP) or, since 1 Nov 2026,
 * a code emailed to an address confirmed here (owner: "add mail or otp verification for admin").
 * Authenticator setup shows the otpauth:// link and the secret for manual entry in Google Authenticator (no QR
 * library in the dashboard), enable with a code, one-time recovery codes (copy / download), new codes, turn off.
 * Endpoints: GET /api/admin/2fa/status, POST /api/admin/2fa/setup | enable | disable | recovery-codes,
 * POST /api/admin/2fa/email/setup | enable | send-code.
 */
import {
  Button, Card, CardBody, CardFooter, CardHeader, DescriptionList, Input, Notice, PageHeader, Skeleton, StatusPill, useConfirm,
  IconCopy, IconDownload,
} from '@/components/ui';
import { formatDateTime, formatTime } from '@/lib/format';
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
  method: 'totp' | 'email' | null;
  emailHint: string | null;
  emailAvailable: boolean;
  profileEmail: string | null;
}
interface Setup { otpauthUri: string; secret: string; account: string; issuer: string; expiresInMinutes: number }


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
  // Email codes: the setup card (address, then the emailed code) and the one-a-minute resend wait.
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailAddr, setEmailAddr] = useState('');
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const [emailCode, setEmailCode] = useState('');
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

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
    setEmailOpen(false);
    setSetup(await adminRequest<Setup>('/api/admin/2fa/setup', { method: 'POST', body: '{}' }));
  });
  const openEmailSetup = () => {
    setCodes(null);
    setSetup(null);
    setEmailSentTo(null);
    setEmailCode('');
    setEmailAddr(status?.profileEmail || '');
    setEmailOpen(true);
  };
  const sendSetupCode = () => run(async () => {
    const r = await adminRequest<{ sentTo: string; resendAfter: number }>('/api/admin/2fa/email/setup', { method: 'POST', body: JSON.stringify({ email: emailAddr.trim() }) });
    setEmailSentTo(r.sentTo);
    setResendIn(r.resendAfter || 60);
    setMsg(`Code sent to ${r.sentTo}. Check your inbox (and spam).`);
  });
  const enableEmail = () => run(async () => {
    const r = await adminRequest<{ recoveryCodes: string[]; token: string; message: string }>('/api/admin/2fa/email/enable', { method: 'POST', body: JSON.stringify({ code: emailCode.split(' ').join('') }) });
    setCodes(r.recoveryCodes);
    setEmailOpen(false);
    setEmailSentTo(null);
    setEmailCode('');
    setResendIn(0); // the setup code is used: a new one may go out at once
    setMsg(r.message);
    await adoptToken(r.token);
    await load();
  });
  const sendManageCode = () => run(async () => {
    const r = await adminRequest<{ resendAfter: number; message: string }>('/api/admin/2fa/email/send-code', { method: 'POST', body: '{}' });
    setResendIn(r.resendAfter || 60);
    setMsg(r.message);
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
    if (!(await confirm({ title: 'Turn off 2-step sign-in?', description: 'This admin account will sign in with a password only. Other sessions will be signed out.', confirmLabel: 'Turn off', tone: 'danger' }))) return;
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
    const text = `ZCS Admin recovery codes (${user?.name || 'admin'})\nEach code works once. Keep them somewhere safe.\n\n${codes.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zenvy-admin-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-3xl text-fg">
      <PageHeader
        title="Account security"
        description="2-step sign-in: after your password, a 6-digit code from an authenticator app on your phone, or one emailed to you."
      />

      <div className="space-y-4">
        {user?.mfaSetupRequired && (
          <Notice tone="warning" title="Set up 2-step sign-in to continue">2-step sign-in is required for admin accounts. Set it up below to use the dashboard.</Notice>
        )}
        {msg && <Notice tone="success" onClose={() => setMsg('')}>{msg}</Notice>}
        {err && <Notice tone="danger" onClose={() => setErr('')}>{err}</Notice>}

        <Card>
          <CardHeader
            title="2-step sign-in"
            actions={status ? <StatusPill status={status.enabled ? 'on' : 'off'} tone={status.enabled ? 'success' : 'warning'} label={status.enabled ? 'On' : 'Off'} /> : undefined}
          />
          <CardBody className="space-y-3">
            {!status ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <DescriptionList
                columns={2}
                items={[
                  { label: 'Status', value: status.enabled ? `On${status.enabledAt ? ` since ${formatDateTime(status.enabledAt)}` : ''}` : 'Off' },
                  ...(status.enabled ? [
                    { label: 'Code from', value: status.method === 'email' ? `Email to ${status.emailHint || 'your address'}` : 'Authenticator app' },
                    { label: 'Recovery codes left', value: String(status.recoveryCodesLeft) },
                  ] : []),
                ]}
              />
            )}
            {status?.locked && <Notice tone="danger">Locked after too many wrong codes until {status.lockedUntil ? formatTime(status.lockedUntil) : 'later'}.</Notice>}
          </CardBody>
          {status && !status.enabled && !setup && !emailOpen && (
            <CardFooter>
              <Button variant="primary" loading={busy} onClick={startSetup}>Use an authenticator app</Button>
              <Button disabled={busy || !status.emailAvailable} onClick={openEmailSetup}>Use email codes</Button>
              {!status.emailAvailable && <span className="text-xs text-fg-muted">Email codes need email sending on the server (Render: BREVO_API_KEY).</span>}
            </CardFooter>
          )}
        </Card>

        {emailOpen && (
          <Card>
            <CardHeader title="Set up email codes" description="Every sign-in will ask for a 6-digit code sent to this address. Use an inbox only you can open." />
            <CardBody className="space-y-5">
              <div className="space-y-2">
                <p className="text-sm font-medium text-fg">1. Your email address</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="w-72"
                    type="email"
                    autoComplete="email"
                    value={emailAddr}
                    onChange={(e) => { setEmailAddr(e.target.value); setEmailSentTo(null); }}
                    onKeyDown={(e) => e.key === 'Enter' && emailAddr.trim() && resendIn <= 0 && sendSetupCode()}
                    placeholder="you@example.com"
                    aria-label="Email address"
                  />
                  <Button variant={emailSentTo ? 'secondary' : 'primary'} disabled={!emailAddr.trim() || resendIn > 0} loading={busy && !emailSentTo} onClick={sendSetupCode}>
                    {emailSentTo ? (resendIn > 0 ? `Resend in ${resendIn} s` : 'Resend code') : 'Email me a code'}
                  </Button>
                </div>
              </div>
              {emailSentTo && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-fg">2. Enter the 6-digit code sent to {emailSentTo}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      className="w-40 text-center font-mono tracking-widest"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={7}
                      value={emailCode}
                      onChange={(e) => setEmailCode(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && emailCode.split(' ').join('').length === 6 && enableEmail()}
                      placeholder="123456"
                      aria-label="Emailed code"
                    />
                    <Button variant="primary" disabled={emailCode.split(' ').join('').length !== 6} loading={busy} onClick={enableEmail}>Turn on</Button>
                  </div>
                </div>
              )}
            </CardBody>
            <CardFooter>
              <Button variant="ghost" disabled={busy} onClick={() => { setEmailOpen(false); setEmailSentTo(null); setEmailCode(''); }}>Cancel</Button>
            </CardFooter>
          </Card>
        )}

        {setup && (
          <Card>
            <CardHeader title="Set up 2-step sign-in" description={`This key expires in ${setup.expiresInMinutes} minutes if not confirmed.`} />
            <CardBody className="space-y-5">
              <div className="space-y-2">
                <p className="text-sm font-medium text-fg">1. Add the key to Google Authenticator (or any TOTP app)</p>
                <p className="text-sm text-fg-muted">In the app: + → Enter a setup key. Account: <span className="text-fg">{setup.issuer}</span>, key below, type: Time based.</p>
                <p className="select-all break-all rounded-md border border-line bg-surface-2 p-3 font-mono text-base text-fg">{setup.secret}</p>
                <p className="break-all text-xs text-fg-muted">Or open this link on the phone: <a className="text-accent-text hover:underline" href={setup.otpauthUri}>{setup.otpauthUri}</a></p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-fg">2. Enter the 6-digit code the app shows</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="w-40 text-center font-mono tracking-widest"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={7}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && enable()}
                    placeholder="123456"
                    aria-label="6-digit code"
                  />
                  <Button variant="primary" disabled={code.split(' ').join('').length !== 6} loading={busy} onClick={enable}>Turn on</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setSetup(null)}>Cancel</Button>
                </div>
              </div>
            </CardBody>
          </Card>
        )}

        {codes && (
          <Card>
            <CardHeader title="Recovery codes" description="Shown only once. If you cannot get a code (lost phone, email not arriving), each recovery code signs you in once. Store them offline." />
            <CardBody>
              <pre className="grid select-all grid-cols-2 gap-2 rounded-md border border-line bg-surface-2 p-3 font-mono text-sm text-fg">{codes.join('\n')}</pre>
            </CardBody>
            <CardFooter>
              <Button leftIcon={<IconCopy size={14} />} onClick={copyCodes}>Copy</Button>
              <Button leftIcon={<IconDownload size={14} />} onClick={downloadCodes}>Download .txt</Button>
            </CardFooter>
          </Card>
        )}

        {status?.enabled && (
          <Card>
            <CardHeader
              title="Manage"
              description={status.method === 'email'
                ? 'Email yourself a code (or use a recovery code) to get new recovery codes or turn 2-step sign-in off.'
                : 'Enter a current 6-digit code, or a recovery code to turn 2-step sign-in off.'}
            />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {status.method === 'email' && (
                  <Button disabled={busy || resendIn > 0} onClick={sendManageCode}>{resendIn > 0 ? `Email again in ${resendIn} s` : 'Email me a code'}</Button>
                )}
                <Input className="w-48 text-center font-mono" value={offCode} onChange={(e) => setOffCode(e.target.value)} placeholder="Code" aria-label="Code" maxLength={16} />
                <Button disabled={busy || !offCode.trim()} onClick={newCodes}>New recovery codes</Button>
                <Button variant="ghost" className="text-danger-text" disabled={busy || !offCode.trim()} onClick={disable}>Turn off</Button>
              </div>
              {status.required && <p className="text-xs text-warning-text">2-step sign-in is required for admins: turning it off removes admin access until you set it up again.</p>}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
