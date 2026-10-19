// Phone verification for driver sign-up (and account deletion), modelled on customer-mobile/utils/phoneOtp.ts.
//
// Primary: Firebase phone auth (free). Firebase sends the SMS (or Android verifies the number in the
// background), the app gets a Firebase ID token and sends it to the server as `firebaseToken`
// (backend controllers/userController.js verifyPhoneProof checks it with Firebase Admin and requires the
// token's number to equal the number being registered).
// Fallback: Zenvy's own SMS (POST /api/users/send-otp, Fast2SMS) only when Firebase cannot run on this
// device; the typed code then goes to the server as `otp`.

export type PhoneProof = { firebaseToken: string } | { otp: string };

/** Firebase errors about the number itself: falling back to SMS would fail the same way. */
export const FIREBASE_NUMBER_ERRORS = ['auth/invalid-phone-number', 'auth/missing-phone-number'];

/** The native Firebase Auth instance, or null when the module is missing / not linked in this build. */
export function getFirebaseAuth(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-firebase/auth');
    const auth = mod && (mod.default || mod);
    const instance = typeof auth === 'function' ? auth() : null;
    return instance && typeof instance.signInWithPhoneNumber === 'function' ? instance : null;
  } catch {
    return null;
  }
}

/** Plain, specific copy for Firebase phone-auth errors. Never shows raw SDK text. */
export function firebasePhoneError(code?: string, rawMsg?: string): string {
  const msg = rawMsg || '';
  switch (code) {
    case 'auth/invalid-phone-number':
    case 'auth/missing-phone-number':
      return 'That mobile number is not valid. Check the 10 digits and try again.';
    case 'auth/invalid-verification-code':
    case 'auth/missing-verification-code':
      return 'That code is not correct. Check the SMS and type the 6 digits again.';
    case 'auth/session-expired':
    case 'auth/code-expired':
      return 'This code has expired. Tap Resend code.';
    case 'auth/too-many-requests':
    case 'auth/quota-exceeded':
      return 'Too many attempts from this phone. Please wait a few hours and try again.';
    case 'auth/network-request-failed':
      return 'No internet. Check mobile data and try again.';
  }
  if (msg.includes('TOO_MANY_ATTEMPTS') || msg.includes('17010')) return 'Too many attempts from this phone. Please wait a few hours and try again.';
  if (msg.includes('17020') || /network/i.test(msg)) return 'No internet. Check mobile data and try again.';
  return 'We could not verify your number right now. Please try again in a few minutes.';
}

/**
 * Sends a code to +91 phone10 through Firebase.
 *   { ok: true, confirmation }           code sent (or Android is verifying in the background)
 *   { ok: false, code, message }         Firebase refused
 *   null                                 Firebase is not available in this build
 */
export async function sendFirebaseCode(phone10: string): Promise<{ ok: true; confirmation: any } | { ok: false; code?: string; message: string } | null> {
  const fb = getFirebaseAuth();
  if (!fb) return null;
  try {
    // A lingering Firebase session must never count as a fresh verification.
    if (fb.currentUser) { try { await fb.signOut(); } catch { /* ignore */ } }
    const confirmation = await fb.signInWithPhoneNumber('+91' + phone10);
    return { ok: true, confirmation };
  } catch (e: any) {
    if (e?.code || e?.message) console.warn('[DRIVER_PHONE_AUTH]', e?.code, e?.message);
    return { ok: false, code: e?.code, message: firebasePhoneError(e?.code, e?.message) };
  }
}

/** True when Firebase has already verified +91 phone10 on this device (typed code or Android auto-verify). */
export function firebaseVerified(phone10: string): boolean {
  const fb = getFirebaseAuth();
  const u = fb && fb.currentUser;
  return !!(u && u.phoneNumber === '+91' + phone10);
}

/** Confirms the typed code with Firebase. Throws an Error with a plain message. */
export async function confirmFirebaseCode(confirmation: any, code: string, phone10: string): Promise<void> {
  if (firebaseVerified(phone10)) return;
  const clean = String(code || '').replace(/\D/g, '');
  if (clean.length !== 6) throw new Error('Enter the 6-digit code we sent you.');
  if (!confirmation || typeof confirmation.confirm !== 'function') throw new Error('This code has expired. Tap Resend code.');
  try {
    await confirmation.confirm(clean);
  } catch (e: any) {
    // Android may have used the code in the background already: accept that verification.
    if (!firebaseVerified(phone10)) {
      if (e?.code || e?.message) console.warn('[DRIVER_PHONE_AUTH]', e?.code, e?.message);
      throw new Error(firebasePhoneError(e?.code, e?.message));
    }
  }
}

/** A fresh Firebase ID token for +91 phone10, or null when this device has not verified that number. */
export async function firebaseIdToken(phone10: string): Promise<string | null> {
  if (!firebaseVerified(phone10)) return null;
  try {
    const token = await getFirebaseAuth().currentUser.getIdToken();
    return typeof token === 'string' && token ? token : null;
  } catch {
    return null;
  }
}

/** Listens for Android background verification of +91 phone10. Returns an unsubscribe function. */
export function onFirebaseVerified(phone10: string, cb: () => void): () => void {
  const fb = getFirebaseAuth();
  if (!fb) return () => {};
  try {
    const unsub = fb.onAuthStateChanged((u: any) => { if (u && u.phoneNumber === '+91' + phone10) cb(); });
    return typeof unsub === 'function' ? unsub : () => {};
  } catch {
    return () => {};
  }
}

/** Drops the Firebase session once the server has the proof (the app never uses Firebase sign-in itself). */
export async function signOutFirebase(): Promise<void> {
  const fb = getFirebaseAuth();
  if (fb && fb.currentUser) { try { await fb.signOut(); } catch { /* ignore */ } }
}
