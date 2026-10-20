import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { ENDPOINTS } from '../constants/api';
import { postAuth, mapFirebasePhoneAuthError, NETWORK_ERROR_MESSAGE } from './auth';

/**
 * Real phone verification shared by login, register, Google sign-in and password reset.
 *
 * Primary (native): Firebase phone auth sends the SMS; the screen sends a Firebase ID token
 * (`firebaseToken`) to the server.
 * Fallback: Zenvy's own SMS (POST /api/users/send-otp, Fast2SMS, paid) — on web, or when Firebase
 * cannot send on this device. The code is never returned by the server; the screen sends it back as
 * `otp` to verify-otp / register / reset-password / google-complete.
 */
/** Failures where an emailed code is worth offering (the SMS itself could not be sent). */
const NOT_AN_SMS_PROBLEM = ['NETWORK', 'INVALID_PHONE', 'ACCOUNT_NOT_FOUND', 'PHONE_TAKEN', 'OTP_DAILY_LIMIT', 'OTP_COOLDOWN', 'auth/invalid-phone-number', 'auth/missing-phone-number'];
export const isSmsSendFailure = (r: SendOtpResult | null | undefined) =>
  !!r && !r.ok && !NOT_AN_SMS_PROBLEM.includes(String(r.code || ''));

const FIREBASE_NUMBER_ERRORS = ['auth/invalid-phone-number', 'auth/missing-phone-number'];
export type OtpPurpose = 'auth' | 'reset_password' | 'change_phone' | 'delete_account';
/** emailOtp + email: the email backup for a NEW account (sign-up, first Google sign-in). */
export type PhoneProof = { otp: string } | { firebaseToken: string } | { emailOtp: string; email: string };

export interface SendOtpResult {
  ok: boolean;
  message: string;
  code?: string;
}

interface Options {
  /** Android Firebase can verify the number in the background (no code typed). */
  onAutoVerified?: (phone: string, proof: PhoneProof) => void;
}

const getFirebaseAuth = (): any | null => {
  if (Platform.OS === 'web') return null;
  try {
    const auth = require('@react-native-firebase/auth').default;
    const instance = auth();
    return instance && typeof instance.signInWithPhoneNumber === 'function' ? instance : null;
  } catch {
    return null;
  }
};

export function usePhoneOtp(purpose: OtpPurpose = 'auth', options: Options = {}) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [mode, setMode] = useState<'sms' | 'firebase' | 'email' | null>(null);
  // Email backup (POST /api/users/send-email-otp): where the code went ("fr****@gmail.com") and, for a new
  // account, the address it is bound to.
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const emailBindRef = useRef<string>('');
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);

  const confirmationRef = useRef<any>(null);
  const autoHandledRef = useRef(false);
  const mountedRef = useRef(true);
  const onAutoRef = useRef(options.onAutoVerified);
  onAutoRef.current = options.onAutoVerified;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Resend countdown
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Firebase fallback: Android may read the SMS (or verify instantly) and sign in in the background.
  useEffect(() => {
    if (mode !== 'firebase' || !sentTo) return;
    const fbAuth = getFirebaseAuth();
    if (!fbAuth) return;
    let unsub: undefined | (() => void);
    try {
      unsub = fbAuth.onAuthStateChanged(async (fbUser: any) => {
        if (!fbUser || fbUser.phoneNumber !== '+91' + sentTo || autoHandledRef.current || !onAutoRef.current) return;
        try {
          const firebaseToken = await fbUser.getIdToken();
          if (!firebaseToken || autoHandledRef.current || !mountedRef.current) return;
          autoHandledRef.current = true;
          onAutoRef.current?.(sentTo, { firebaseToken });
        } catch (e) {
          console.warn('[PHONE_OTP] auto-verify token failed', e);
        }
      });
    } catch (e) {
      console.warn('[PHONE_OTP] auto-verify listener failed', e);
    }
    return () => { if (unsub) unsub(); };
  }, [mode, sentTo]);

  const sendViaFirebase = async (phone10: string): Promise<SendOtpResult | null> => {
    const fbAuth = getFirebaseAuth();
    if (!fbAuth) return null;
    try {
      // A lingering Firebase session must not count as a fresh verification
      if (fbAuth.currentUser) { try { await fbAuth.signOut(); } catch {} }
      const confirmation = await fbAuth.signInWithPhoneNumber('+91' + phone10);
      confirmationRef.current = confirmation;
      if (mountedRef.current) {
        setMode('firebase');
        setSentTo(phone10);
        setCountdown(60);
      }
      return { ok: true, message: `We've sent a 6-digit code to +91 ${phone10}` };
    } catch (e: any) {
      return { ok: false, message: mapFirebasePhoneAuthError(e?.code, e?.message), code: e?.code };
    }
  };

  /** Sends a code to a 10-digit Indian mobile number. Never throws. */
  const send = useCallback(async (phone10: string): Promise<SendOtpResult> => {
    setSending(true);
    autoHandledRef.current = false;
    try {
      // Primary: Firebase phone auth (owner's choice — free tier). Only problems with the number
      // itself stop here; anything else (app not authorised, quota, device issue) falls back to SMS.
      const fb = await sendViaFirebase(phone10);
      if (fb?.ok) return fb;
      if (fb && FIREBASE_NUMBER_ERRORS.includes(String(fb.code))) return fb;

      // Fallback: Zenvy's own SMS (Fast2SMS, paid) — web, or when Firebase can't send on this device.
      const r = await postAuth(ENDPOINTS.sendOtp, { phone: phone10, purpose });
      if (r.ok) {
        confirmationRef.current = null;
        if (mountedRef.current) {
          setMode('sms');
          setSentTo(phone10);
          setCountdown(Number(r.data?.resendAfter) || 60);
        }
        return { ok: true, message: r.message || `We've sent a 6-digit code to +91 ${phone10}` };
      }
      if (r.code === 'OTP_COOLDOWN') {
        // A code was sent to this number moments ago and is still valid: let the user type it.
        const wait = Number(r.data?.retryAfter) || 60;
        if (mountedRef.current) {
          setMode('sms');
          setSentTo(phone10);
          setCountdown(wait);
        }
        return { ok: true, message: `We already sent a code to +91 ${phone10}. Enter it below, or resend in ${wait}s.` };
      }
      // Both channels failed: prefer Firebase's friendly reason when it had one
      if (fb && !fb.ok && r.code === 'SMS_UNAVAILABLE') return fb;
      return { ok: false, message: r.message, code: r.code };
    } catch {
      return { ok: false, message: NETWORK_ERROR_MESSAGE, code: 'NETWORK' };
    } finally {
      if (mountedRef.current) setSending(false);
    }
  }, [purpose]);

  /**
   * Email backup when the SMS could not be sent. Reset / account deletion: the code goes to the account's
   * email on file (no email needed here). Sign-up / Google completion: pass the new account's email.
   * Never throws.
   */
  const sendEmail = useCallback(async (phone10: string, email?: string): Promise<SendOtpResult> => {
    setSending(true);
    autoHandledRef.current = false;
    try {
      const body: Record<string, string> = { phone: phone10, purpose: purpose === 'change_phone' ? 'auth' : purpose };
      const bound = (email || '').trim().toLowerCase();
      if (purpose === 'auth') body.email = bound;
      const r = await postAuth(ENDPOINTS.sendEmailOtp, body);
      if (r.ok || r.code === 'OTP_COOLDOWN') {
        confirmationRef.current = null;
        emailBindRef.current = purpose === 'auth' ? bound : '';
        if (mountedRef.current) {
          setMode('email');
          setSentTo(phone10);
          setEmailSentTo(String(r.data?.sentTo || bound || 'your email'));
          setCountdown(Number(r.data?.resendAfter || r.data?.retryAfter) || 60);
        }
        return { ok: true, message: r.ok ? (r.message || 'We have emailed you a 6-digit code.') : 'We already sent a code. Enter it below.' };
      }
      return { ok: false, message: r.message, code: r.code };
    } catch {
      return { ok: false, message: NETWORK_ERROR_MESSAGE, code: 'NETWORK' };
    } finally {
      if (mountedRef.current) setSending(false);
    }
  }, [purpose]);

  /**
   * Turns the typed code into a proof for the server. Throws an Error with a friendly message.
   * In Firebase mode the code is confirmed with Firebase first (or the background auto-verification is used).
   */
  const getProof = useCallback(async (code: string): Promise<PhoneProof> => {
    const clean = (code || '').replace(/\D/g, '');
    if (mode === 'firebase') {
      const fbAuth = getFirebaseAuth();
      const expected = '+91' + sentTo;
      if (!fbAuth) throw new Error('We could not verify your number. Please tap Resend OTP.');
      const alreadyVerified = fbAuth.currentUser && fbAuth.currentUser.phoneNumber === expected;
      if (!alreadyVerified) {
        if (clean.length !== 6) throw new Error('Enter the 6-digit code we sent you.');
        if (!confirmationRef.current || typeof confirmationRef.current.confirm !== 'function') {
          throw new Error('This code has expired. Tap Resend OTP.');
        }
        try {
          await confirmationRef.current.confirm(clean);
        } catch (e: any) {
          // Android may have consumed the code in the background: accept that verification
          const cu = fbAuth.currentUser;
          if (!(cu && cu.phoneNumber === expected)) throw new Error(mapFirebasePhoneAuthError(e?.code, e?.message));
        }
      }
      const firebaseToken = await fbAuth.currentUser?.getIdToken();
      if (!firebaseToken) throw new Error('We could not verify your number. Please tap Resend OTP.');
      autoHandledRef.current = true;
      return { firebaseToken };
    }
    if (clean.length !== 6) throw new Error('Enter the 6-digit code we sent you.');
    // Email code for a new account: bound to the address it went to. Reset / deletion: an ordinary code.
    if (mode === 'email' && purpose === 'auth') return { emailOtp: clean, email: emailBindRef.current };
    return { otp: clean };
  }, [mode, sentTo, purpose]);

  /** Back to the phone-number step (e.g. "Change number"). */
  const reset = useCallback(() => {
    confirmationRef.current = null;
    autoHandledRef.current = false;
    setSentTo(null);
    setMode(null);
    setEmailSentTo(null);
    emailBindRef.current = '';
    setCountdown(0);
  }, []);

  /** Allow the background auto-verification to fire again after a failed server call. */
  const allowAutoRetry = useCallback(() => { autoHandledRef.current = false; }, []);

  return { sentTo, mode, emailSentTo, countdown, sending, send, sendEmail, getProof, reset, allowAutoRetry };
}
