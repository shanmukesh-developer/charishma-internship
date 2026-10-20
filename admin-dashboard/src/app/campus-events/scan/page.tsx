"use client";

// Campus Events gate scanner (admin web). Online only: every scan is validated by the server
// (POST /api/campus-events/check-in/validate, then /confirm). No offline mode: if the server cannot be
// reached the answer is "Cannot verify — do not admit". Camera scanning uses the browser BarcodeDetector API
// (Chrome / Edge / Android) with the rear camera; a typed ticket code always works.
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';
import {
  CheckInNetworkError, campusEventsApi, scanPayload,
  type CheckInEvent, type RecentScan, type Verdict,
} from '@/lib/campusEventsApi';
import { Btn, ErrorBox, Loading, errText, inr, label, timeOnly, when } from '@/components/campusEvents/shared';

// Minimal typings for the Shape Detection API (not in TypeScript's DOM lib yet).
interface DetectedBarcode { rawValue: string; format: string }
interface BarcodeDetectorLike { detect: (src: CanvasImageSource) => Promise<DetectedBarcode[]> }
interface BarcodeDetectorCtor { new (opts?: { formats?: string[] }): BarcodeDetectorLike; getSupportedFormats?: () => Promise<string[]> }
const getDetectorCtor = (): BarcodeDetectorCtor | null => (typeof window !== 'undefined' && 'BarcodeDetector' in window ? (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector : null);

type CamState = 'off' | 'starting' | 'on' | 'unsupported' | 'denied' | 'error';
type Shown = { verdict: Verdict; payload: { token?: string; code?: string }; at: number } | { network: true; at: number } | { error: string; at: number };

const HEADLINES: Record<string, string> = {
  VALID: 'VALID', ALREADY_USED: 'ALREADY USED', CANCELLED: 'CANCELLED', INVALID: 'INVALID', NOT_YET_VALID: 'NOT YET VALID',
  EXPIRED: 'EVENT OVER', WRONG_EVENT: 'WRONG EVENT', UNPAID: 'UNPAID', PENDING: 'NOT CONFIRMED', PAYMENT_DUE: 'COLLECT FEE',
};
const TONE: Record<string, string> = {
  VALID: 'border-success/30 bg-success text-on-solid', ADMITTED: 'border-success/30 bg-success text-on-solid',
  ALREADY_USED: 'border-warning/30 bg-accent text-on-solid', NOT_YET_VALID: 'border-info/30 bg-accent text-on-solid',
  PAYMENT_DUE: 'border-warning/30 bg-accent text-accent-fg',
};
const toneOf = (r: string) => TONE[r] || 'border-danger/30 bg-danger text-on-solid';
const DUPLICATE_MS = 5000;

export default function CampusEventsScanPage() {
  const { isAuthed } = useAdminAuth();
  const [events, setEvents] = useState<CheckInEvent[] | null>(null);
  const [eventsError, setEventsError] = useState('');
  const [eventId, setEventId] = useState('');
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const [recent, setRecent] = useState<RecentScan[]>([]);
  const [recentError, setRecentError] = useState('');
  const [online, setOnline] = useState(true);
  const [cam, setCam] = useState<CamState>('off');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });
  const busyRef = useRef(false);
  const holdRef = useRef(false); // a VALID verdict waits for the staff decision: ignore new camera reads

  const loadEvents = useCallback(() => {
    setEventsError('');
    campusEventsApi.checkInEvents()
      .then((d) => { setEvents(d.events); setEventId((cur) => cur || (d.events[0] ? d.events[0].id : '')); })
      .catch((e) => setEventsError(errText(e, 'Could not load events.')));
  }, []);
  useEffect(() => { if (isAuthed) loadEvents(); }, [isAuthed, loadEvents]);

  const loadRecent = useCallback((id: string) => {
    if (!id) return;
    campusEventsApi.recentScans(id).then((d) => { setRecent(d.checkIns); setRecentError(''); }).catch((e) => setRecentError(errText(e, 'Could not load recent scans.')));
  }, []);
  useEffect(() => { setShown(null); setRecent([]); holdRef.current = false; loadRecent(eventId); }, [eventId, loadRecent]);

  useEffect(() => {
    const up = () => setOnline(navigator.onLine);
    up();
    window.addEventListener('online', up);
    window.addEventListener('offline', up);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', up); };
  }, []);

  const validate = useCallback(async (raw: string) => {
    const value = String(raw || '').trim();
    if (!value || !eventId || busyRef.current) return;
    const now = Date.now();
    if (lastRef.current.value === value && now - lastRef.current.at < DUPLICATE_MS) return; // same QR still in view
    lastRef.current = { value, at: now };
    busyRef.current = true; setBusy(true);
    const payload = scanPayload(value);
    try {
      const verdict = await campusEventsApi.validate(eventId, payload);
      holdRef.current = verdict.result === 'VALID';
      setShown({ verdict, payload, at: Date.now() });
      try { navigator.vibrate?.(verdict.result === 'VALID' ? 80 : [60, 60, 60]); } catch { /* optional */ }
    } catch (e) {
      holdRef.current = false;
      setShown(e instanceof CheckInNetworkError ? { network: true, at: Date.now() } : { error: errText(e, 'Could not check this ticket. Do not admit.'), at: Date.now() });
    } finally {
      busyRef.current = false; setBusy(false);
      loadRecent(eventId);
    }
  }, [eventId, loadRecent]);

  const admit = async (collect: boolean) => {
    if (!shown || !('verdict' in shown) || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const verdict = await campusEventsApi.confirm(eventId, shown.payload, collect);
      holdRef.current = verdict.result === 'PAYMENT_DUE';
      setShown({ verdict, payload: shown.payload, at: Date.now() });
      if (verdict.admitted) setEvents((cur) => cur && cur.map((e) => (e.id === eventId ? { ...e, checkedIn: e.checkedIn + 1 } : e)));
    } catch (e) {
      holdRef.current = false;
      setShown(e instanceof CheckInNetworkError ? { network: true, at: Date.now() } : { error: errText(e, 'Could not confirm entry. Do not admit.'), at: Date.now() });
    } finally {
      busyRef.current = false; setBusy(false);
      loadRecent(eventId);
    }
  };
  const next = () => { holdRef.current = false; setShown(null); lastRef.current = { value: '', at: 0 }; };

  // ── Camera ────────────────────────────────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (loopRef.current) { clearInterval(loopRef.current); loopRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCam((c) => (c === 'unsupported' ? c : 'off'));
  }, []);
  const validateRef = useRef(validate);
  validateRef.current = validate;
  const startCamera = async () => {
    const Ctor = getDetectorCtor();
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) { setCam('unsupported'); return; }
    try {
      const formats = Ctor.getSupportedFormats ? await Ctor.getSupportedFormats() : ['qr_code'];
      if (!formats.includes('qr_code')) { setCam('unsupported'); return; }
    } catch { /* assume supported */ }
    setCam('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      const detector = new Ctor({ formats: ['qr_code'] });
      let detecting = false;
      loopRef.current = setInterval(async () => {
        if (detecting || busyRef.current || holdRef.current || !videoRef.current || videoRef.current.readyState < 2) return;
        detecting = true;
        try {
          const codes = await detector.detect(videoRef.current);
          const hit = codes.find((c) => c.rawValue);
          if (hit) validateRef.current(hit.rawValue);
        } catch { /* frame not ready */ } finally { detecting = false; }
      }, 250);
      setCam('on');
    } catch (e) {
      const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: string }).name) : '';
      setCam(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error');
      stopCamera();
      setCam(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error');
    }
  };
  useEffect(() => () => stopCamera(), [stopCamera]);
  useEffect(() => { if (!getDetectorCtor()) setCam('unsupported'); }, []);

  if (!isAuthed) return <div className="p-10 text-center text-sm text-fg-muted" role="status">Checking your admin session…</div>;
  const ev = events?.find((e) => e.id === eventId) || null;

  return (
    <div className="mx-auto max-w-3xl space-y-5 text-fg">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <Link href="/campus-events" className="text-xs font-semibold text-info-text underline">← Campus Events admin</Link>
          <h1 className="text-2xl font-semibold text-fg">Event check-in scanner</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">Scan the student&apos;s QR or type the 10-character ticket code. The server decides; only admit on a green result.</p>
        </div>
      </header>

      <div role="note" className={`border p-3 text-sm ${online ? 'border-line text-fg-muted' : 'border-danger/30 bg-danger-soft font-semibold text-danger-text'}`}>
        {online ? 'Online only: every ticket is checked live with the server. If the server cannot be reached, do not admit — ask the student to wait.' : 'You are offline. Cannot verify tickets — do not admit anyone until the connection is back.'}
      </div>

      {eventsError && <ErrorBox text={eventsError} retry={loadEvents} />}
      {!events && !eventsError && <Loading text="Loading events…" />}
      {events && events.length === 0 && <div className="rounded-lg border border-line bg-surface p-4 shadow-xs text-sm text-fg-muted">No published events are running or upcoming. Check-in opens for published events.</div>}

      {events && events.length > 0 && (
        <>
          <label className="block text-xs font-semibold text-fg-muted">Event
            <select value={eventId} onChange={(e) => setEventId(e.target.value)} className="mt-1 w-full border border-line bg-surface p-3 text-base font-normal normal-case text-fg">
              {events.map((e) => <option key={e.id} value={e.id}>{e.title} · {when(e.startAt)}{e.status === 'APPROVED' ? ' · scheduled (not live yet)' : ''}</option>)}
            </select>
          </label>
          {ev && <p className="text-sm text-fg-muted">{ev.venue || '—'} · {when(ev.startAt)} → {timeOnly(ev.endAt)} · <b className="text-fg">{ev.checkedIn}</b> of {ev.confirmed} confirmed checked in</p>}

          <section className="space-y-3 border border-line p-4" aria-label="Scan">
            <div className="flex flex-wrap items-center gap-3">
              {cam === 'on' || cam === 'starting'
                ? <Btn onClick={stopCamera}>Stop camera</Btn>
                : <Btn tone="primary" disabled={cam === 'unsupported'} onClick={startCamera}>Start camera</Btn>}
              <span className="text-xs text-fg-muted">
                {cam === 'unsupported' && 'Camera scanning needs a browser with QR detection (Chrome / Edge on Android or desktop). Type the code instead.'}
                {cam === 'denied' && 'Camera permission was refused. Allow the camera for this site, or type the code.'}
                {cam === 'error' && 'The camera could not start. Type the code instead.'}
                {cam === 'starting' && 'Starting the rear camera…'}
                {cam === 'on' && (busy ? 'Checking…' : 'Point the camera at the QR code.')}
              </span>
            </div>
            <video ref={videoRef} muted playsInline className={`w-full max-h-[50vh] bg-surface-2 object-cover ${cam === 'on' || cam === 'starting' ? '' : 'hidden'}`} aria-label="Camera preview" />
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); lastRef.current = { value: '', at: 0 }; validate(typed); setTyped(''); }}>
              <input value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} placeholder="Ticket code, e.g. 7K3M9QX2BD" maxLength={200} autoCapitalize="characters" autoComplete="off" spellCheck={false}
                className="w-full border border-line bg-surface p-3 font-mono text-lg text-fg" aria-label="Ticket code" />
              <Btn type="submit" tone="primary" disabled={busy || !typed.trim()}>{busy ? '…' : 'Check'}</Btn>
            </form>
          </section>

          {shown && <ResultCard shown={shown} busy={busy} admit={admit} next={next} />}

          <section className="space-y-2" aria-label="Recent scans">
            <div className="flex items-center justify-between"><h2 className="text-xs font-semibold text-fg-muted">Recent scans</h2><button type="button" className="text-xs font-semibold underline" onClick={() => loadRecent(eventId)}>Refresh</button></div>
            {recentError && <p className="text-xs text-danger-text">{recentError}</p>}
            {recent.length === 0 ? <p className="text-sm text-fg-muted">No scans yet for this event.</p> : (
              <ul className="divide-y divide-line border border-line">
                {recent.slice(0, 20).map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-14 text-xs text-fg-muted">{timeOnly(r.at)}</span>
                    <span className={`px-2 py-0.5 text-xs font-semibold ${r.action === 'CONFIRM' && r.result === 'VALID' ? 'bg-success' : r.result === 'VALID' ? 'bg-success-soft' : r.result === 'ALREADY_USED' ? 'bg-accent' : 'bg-danger-soft'}`}>{r.action === 'CONFIRM' && r.result === 'VALID' ? 'ADMITTED' : label(r.result)}</span>
                    <span className="font-mono text-xs">{r.ticketCode || '—'}</span>
                    <span className="ml-auto text-xs text-fg-muted">{r.method}{r.collectedPayment ? ' · fee collected' : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function ResultCard({ shown, busy, admit, next }: { shown: Shown; busy: boolean; admit: (collect: boolean) => void; next: () => void }) {
  if ('network' in shown) {
    return (
      <div role="alert" className="border-4 border-danger/30 bg-danger p-6 text-center text-on-solid">
        <p className="text-4xl font-semibold">Cannot verify</p>
        <p className="mt-2 text-xl font-semibold">Do not admit.</p>
        <p className="mt-1 text-sm">The server could not be reached. Check the connection and scan again.</p>
        <div className="mt-4"><Btn onClick={next}>Scan next</Btn></div>
      </div>
    );
  }
  if ('error' in shown) {
    return (
      <div role="alert" className="border-4 border-danger/30 bg-danger-soft p-6 text-center text-fg">
        <p className="text-3xl font-semibold">Not verified</p>
        <p className="mt-2 text-base">{shown.error}</p>
        <p className="mt-1 text-sm font-semibold">Do not admit.</p>
        <div className="mt-4"><Btn onClick={next}>Scan next</Btn></div>
      </div>
    );
  }
  const v = shown.verdict;
  const admitted = !!v.admitted;
  const key = admitted ? 'ADMITTED' : v.result;
  const due = v.paymentDue || v.ticket?.paymentDue || 0;
  const needsFee = !admitted && (v.result === 'PAYMENT_DUE' || (v.result === 'VALID' && due > 0));
  const canAdmit = !admitted && v.result === 'VALID' && v.admit;
  const t = v.ticket;
  const firstName = t?.holder ? t.holder.split(/\s+/)[0] : null;
  return (
    <div role="status" aria-live="assertive" className={`border-4 p-6 ${toneOf(key)}`}>
      <p className="text-center text-5xl font-semibold">{admitted ? 'Admitted' : HEADLINES[v.result] || v.result}</p>
      <p className="mt-2 text-center text-lg font-semibold">{admitted ? (v.collected ? `Entry recorded · ${inr(v.collected)} collected` : 'Entry recorded') : v.label}</p>
      {v.result === 'NOT_YET_VALID' && v.entryOpensAt && <p className="mt-1 text-center text-sm">Entry opens {when(v.entryOpensAt)}</p>}
      {t && (
        <dl className="mx-auto mt-4 grid max-w-md grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-base">
          {firstName && <><dt className="opacity-80">Name</dt><dd className="font-semibold">{firstName}</dd></>}
          {t.team && <><dt className="opacity-80">Team</dt><dd className="font-semibold">{t.team}</dd></>}
          {t.slot && <><dt className="opacity-80">Slot</dt><dd className="font-semibold">{t.slot.label || ''} {timeOnly(t.slot.startAt)}–{timeOnly(t.slot.endAt)}</dd></>}
          <dt className="opacity-80">Ticket</dt><dd className="font-mono">{t.ticketCode}</dd>
          {t.usedAt && <><dt className="opacity-80">Used at</dt><dd>{when(t.usedAt)}</dd></>}
        </dl>
      )}
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        {needsFee && <button type="button" disabled={busy} onClick={() => admit(true)} className="bg-surface-2 px-6 py-3 text-lg font-semibold text-fg disabled:opacity-50">{busy ? 'Recording…' : `Collected ${inr(due)} — admit`}</button>}
        {canAdmit && !needsFee && <button type="button" disabled={busy} onClick={() => admit(false)} className="bg-surface-2 px-6 py-3 text-lg font-semibold text-fg disabled:opacity-50">{busy ? 'Recording…' : 'Confirm entry'}</button>}
        <button type="button" disabled={busy} onClick={next} className="border-2 border-current px-6 py-3 text-lg font-semibold disabled:opacity-50">{admitted || !canAdmit ? 'Scan next' : 'Do not admit'}</button>
      </div>
    </div>
  );
}
