// Soundbox phrases (PhonePe style) in Telugu (default), Hindi and English.
// Written in native script so the phone's TTS pronounces them properly.
// PRIVACY: phrases take only campus names, counts and amounts. Never phone numbers, names or addresses.

export type VoiceLang = 'te' | 'hi' | 'en';

export const LANG_TAG: Record<VoiceLang, string> = { te: 'te-IN', hi: 'hi-IN', en: 'en-IN' };
export const LANG_LABEL: Record<VoiceLang, string> = { te: 'తెలుగు', hi: 'हिंदी', en: 'English' };
export const LANG_NAME_EN: Record<VoiceLang, string> = { te: 'Telugu', hi: 'Hindi', en: 'English' };
/** Fallback order when the chosen language has no voice on this phone. */
export const FALLBACK_CHAIN: VoiceLang[] = ['te', 'hi', 'en'];

export type VoiceEvent =
  | { kind: 'newOrder'; campus: string | null; items: number; total: number }
  | { kind: 'accepted'; mins: number }
  | { kind: 'rejected' }
  | { kind: 'cancelled' }
  | { kind: 'timedOut' }
  | { kind: 'riderArrived'; packed: boolean }
  | { kind: 'pickedUp' }
  | { kind: 'delivered'; amount: number }
  | { kind: 'storeOpen' }
  | { kind: 'storeClosed'; orders: number; sales: number }
  | { kind: 'offline' }
  | { kind: 'online' }
  | { kind: 'itemAdded' }
  | { kind: 'test' };

const CAMPUS_SPOKEN: Record<string, Record<VoiceLang, string>> = {
  srm: { te: 'ఎస్ ఆర్ ఎం', hi: 'एस आर एम', en: 'S R M' },
  vit: { te: 'వి ఐ టి', hi: 'वी आई टी', en: 'V I T' },
  amrita: { te: 'అమృత', hi: 'अमृता', en: 'Amrita' },
  kl: { te: 'కె ఎల్', hi: 'के एल', en: 'K L' },
};

function campusWord(campus: string | null, lang: VoiceLang): string | null {
  if (!campus) return null;
  const key = campus.trim().toLowerCase().split(/\s+/)[0];
  const known = CAMPUS_SPOKEN[key];
  if (known) return known[lang];
  // Unknown campus label: spoken only if it is plain words (anything with digits could be a room number).
  if (/\d/.test(campus)) return null;
  const clean = campus.replace(/[^A-Za-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean && clean.length <= 30 ? clean : null;
}

/** Whole rupees, as digits: the TTS reads the number in the chosen language. */
const amt = (n: number) => String(Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));

export function phrase(e: VoiceEvent, lang: VoiceLang): string {
  switch (e.kind) {
    case 'newOrder': {
      const c = campusWord(e.campus, lang);
      const n = Math.max(1, Math.round(e.items || 1));
      const total = amt(e.total);
      if (lang === 'te') {
        return `${c ? `${c} నుంచి` : 'జెన్వ్ లో'} కొత్త ఆర్డర్ వచ్చింది. ${n} ఐటమ్స్, ${total} రూపాయలు.`;
      }
      if (lang === 'hi') {
        return `${c ? `${c} से` : 'ज़ेन्व पर'} नया ऑर्डर आया है. ${n} आइटम, ${total} रुपये.`;
      }
      return `New order${c ? ` from ${c}` : ' on ZenWe'}. ${n} item${n === 1 ? '' : 's'}, ${total} rupees.`;
    }
    case 'accepted':
      if (lang === 'te') return `ఆర్డర్ యాక్సెప్ట్ చేశారు. ${e.mins} నిమిషాల్లో రెడీ చేయండి.`;
      if (lang === 'hi') return `ऑर्डर स्वीकार हो गया. ${e.mins} मिनट में तैयार करें.`;
      return `Order accepted. Make it ready in ${e.mins} minutes.`;
    case 'rejected':
      if (lang === 'te') return 'ఆర్డర్ రిజెక్ట్ చేశారు.';
      if (lang === 'hi') return 'ऑर्डर रिजेक्ट कर दिया.';
      return 'Order rejected.';
    case 'cancelled':
      if (lang === 'te') return 'ఆర్డర్ క్యాన్సిల్ అయ్యింది.';
      if (lang === 'hi') return 'ऑर्डर कैंसल हो गया.';
      return 'Order cancelled.';
    case 'timedOut':
      if (lang === 'te') return 'టైమ్ అయిపోయింది. ఆర్డర్ క్యాన్సిల్ అయ్యింది.';
      if (lang === 'hi') return 'समय खत्म. ऑर्डर कैंसल हो गया.';
      return 'Time ran out. Order cancelled.';
    case 'riderArrived':
      if (lang === 'te') return e.packed ? 'రైడర్ వచ్చాడు. ఆర్డర్ ఇవ్వండి.' : 'రైడర్ వచ్చాడు. ఆర్డర్ రెడీ చేయండి.';
      if (lang === 'hi') return e.packed ? 'राइडर आ गया है. ऑर्डर दे दीजिए.' : 'राइडर आ गया है. ऑर्डर तैयार करें.';
      return e.packed ? 'Rider has arrived. Hand over the order.' : 'Rider has arrived. Get the order ready.';
    case 'pickedUp':
      if (lang === 'te') return 'ఆర్డర్ రైడర్ కి ఇచ్చేశారు.';
      if (lang === 'hi') return 'ऑर्डर राइडर को दे दिया गया.';
      return 'Order handed to the rider.';
    case 'delivered':
      if (lang === 'te') return `${amt(e.amount)} రూపాయల ఆర్డర్ డెలివర్ అయ్యింది.`;
      if (lang === 'hi') return `${amt(e.amount)} रुपये का ऑर्डर डिलीवर हो गया.`;
      return `${amt(e.amount)} rupees order delivered.`;
    case 'storeOpen':
      if (lang === 'te') return 'స్టోర్ ఓపెన్ అయ్యింది. ఆర్డర్లు వస్తాయి.';
      if (lang === 'hi') return 'स्टोर खुल गया. ऑर्डर आएंगे.';
      return 'Store is open. Orders will come in.';
    case 'storeClosed': {
      const summary = e.orders > 0;
      if (lang === 'te') return `స్టోర్ క్లోజ్ అయ్యింది.${summary ? ` ఈ రోజు ${e.orders} ఆర్డర్లు, ${amt(e.sales)} రూపాయల సేల్.` : ''}`;
      if (lang === 'hi') return `स्टोर बंद हो गया.${summary ? ` आज ${e.orders} ऑर्डर, ${amt(e.sales)} रुपये की बिक्री.` : ''}`;
      return `Store is closed.${summary ? ` Today ${e.orders} order${e.orders === 1 ? '' : 's'}, ${amt(e.sales)} rupees sales.` : ''}`;
    }
    case 'offline':
      if (lang === 'te') return 'ఇంటర్నెట్ లేదు. కొత్త ఆర్డర్లు రావు.';
      if (lang === 'hi') return 'इंटरनेट बंद है. नए ऑर्डर नहीं आएंगे.';
      return 'No internet. New orders will not come in.';
    case 'online':
      if (lang === 'te') return 'మళ్ళీ కనెక్ట్ అయ్యింది.';
      if (lang === 'hi') return 'फिर से कनेक्ट हो गया.';
      return 'Connected again.';
    case 'itemAdded':
      if (lang === 'te') return 'కొత్త ఐటమ్ యాడ్ అయ్యింది.';
      if (lang === 'hi') return 'नया आइटम जुड़ गया.';
      return 'New item added.';
    case 'test':
      if (lang === 'te') return 'జెన్వ్ వాయిస్ పని చేస్తోంది. కొత్త ఆర్డర్ వస్తే ఇలా చెబుతాను.';
      if (lang === 'hi') return 'ज़ेन्व आवाज़ चालू है. नया ऑर्डर आने पर ऐसे बताऊंगी.';
      return 'ZenWe voice is working. I will announce new orders like this.';
  }
}

/** Text of the native heads-up notification for a new order (shown on the lock screen). */
export function orderNotification(orderNum: string, amount: string, lang: VoiceLang): { title: string; body: string } {
  if (lang === 'hi') {
    return { title: `🔔 ZenWe नया ऑर्डर! (₹${amount})`, body: `ऑर्डर #${orderNum}. खोलकर स्वीकार करें.` };
  }
  if (lang === 'en') {
    return { title: `🔔 New ZenWe order! (₹${amount})`, body: `Order #${orderNum}. Open the app to accept.` };
  }
  return { title: `🔔 ZenWe కొత్త ఆర్డర్! (₹${amount})`, body: `ఆర్డర్ #${orderNum}. యాప్ తెరిచి యాక్సెప్ట్ చేయండి.` };
}
