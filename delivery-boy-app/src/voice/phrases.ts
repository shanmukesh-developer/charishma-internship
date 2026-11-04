// Soundbox phrases (PhonePe style). Telugu first, Hindi and English as fallbacks.
// Written in native script so the phone's text-to-speech pronounces them properly.
// RULE: never put private customer data here (no phone numbers, no addresses, no customer names).
// Store names and campus/area names are fine.

export type VoiceLang = 'te' | 'hi' | 'en';

export const LANG_CODE: Record<VoiceLang, string> = { te: 'te-IN', hi: 'hi-IN', en: 'en-IN' };
export const LANG_LABEL: Record<VoiceLang, string> = { te: 'తెలుగు (Telugu)', hi: 'हिन्दी (Hindi)', en: 'English' };

export type PhraseKey =
  | 'newOrder'
  | 'accepted'
  | 'ready'
  | 'delivered'
  | 'cod'
  | 'online'
  | 'offline'
  | 'cancelled'
  | 'tip'
  | 'test';

export interface PhraseArgs {
  store?: string | null;
  earning?: number | null;
  amount?: number | null;
}

/** "₹250.00" -> "250". Returns null for missing / non-positive amounts. */
export function spokenAmount(n: number | null | undefined): string | null {
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return null;
  const r = Math.round(n * 100) / 100;
  return String(r);
}

/** Store names only; trimmed and stripped of characters TTS reads out literally. */
function cleanStore(s: string | null | undefined): string | null {
  const v = String(s ?? '')
    .replace(/[#*_~`|<>[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return v ? v.slice(0, 60) : null;
}

type Builder = (a: PhraseArgs) => string;

const TE: Record<PhraseKey, Builder> = {
  newOrder: (a) => {
    const store = cleanStore(a.store);
    const earn = spokenAmount(a.earning);
    return [
      store ? `కొత్త డెలివరీ ఆర్డర్ వచ్చింది, ${store} నుంచి.` : 'కొత్త డెలివరీ ఆర్డర్ వచ్చింది.',
      earn ? `సంపాదన ${earn} రూపాయలు.` : '',
    ]
      .filter(Boolean)
      .join(' ');
  },
  accepted: () => 'ఆర్డర్ మీ దగ్గర ఉంది. పికప్ కి వెళ్ళండి.',
  ready: () => 'ఆర్డర్ రెడీ గా ఉంది, తీసుకోండి.',
  delivered: (a) => {
    const amt = spokenAmount(a.amount);
    return amt ? `మీ అకౌంట్ లో ${amt} రూపాయలు జమ అయ్యింది.` : 'ఆర్డర్ డెలివర్ అయ్యింది. బాగా చేశారు.';
  },
  cod: (a) => {
    const amt = spokenAmount(a.amount);
    return amt ? `కస్టమర్ నుంచి ${amt} రూపాయలు క్యాష్ తీసుకోండి.` : 'కస్టమర్ నుంచి క్యాష్ తీసుకోండి.';
  },
  online: () => 'మీరు ఆన్‌లైన్ లో ఉన్నారు. ఆర్డర్లు వస్తాయి.',
  offline: () => 'మీరు ఆఫ్‌లైన్ అయ్యారు.',
  cancelled: () => 'ఆర్డర్ క్యాన్సిల్ అయ్యింది. పికప్ చేయకండి.',
  tip: (a) => {
    const amt = spokenAmount(a.amount);
    return amt ? `మీకు ${amt} రూపాయలు టిప్ వచ్చింది.` : 'మీకు టిప్ వచ్చింది.';
  },
  test: () => 'జెన్వ్ వాయిస్ పని చేస్తోంది. మీ అకౌంట్ లో 10 రూపాయలు జమ అయ్యింది.',
};

const HI: Record<PhraseKey, Builder> = {
  newOrder: (a) => {
    const store = cleanStore(a.store);
    const earn = spokenAmount(a.earning);
    return [
      store ? `नया डिलीवरी ऑर्डर आया है, ${store} से।` : 'नया डिलीवरी ऑर्डर आया है।',
      earn ? `कमाई ${earn} रुपये।` : '',
    ]
      .filter(Boolean)
      .join(' ');
  },
  accepted: () => 'ऑर्डर आपके पास है। पिकअप के लिए जाइए।',
  ready: () => 'ऑर्डर तैयार है, ले लीजिए।',
  delivered: (a) => {
    const amt = spokenAmount(a.amount);
    return amt ? `आपके अकाउंट में ${amt} रुपये जमा हो गए।` : 'ऑर्डर डिलीवर हो गया। शाबाश।';
  },
  cod: (a) => {
    const amt = spokenAmount(a.amount);
    return amt ? `कस्टमर से ${amt} रुपये कैश लीजिए।` : 'कस्टमर से कैश लीजिए।';
  },
  online: () => 'आप ऑनलाइन हैं। ऑर्डर आने लगेंगे।',
  offline: () => 'आप ऑफलाइन हो गए हैं।',
  cancelled: () => 'ऑर्डर कैंसल हो गया है। पिकअप मत कीजिए।',
  tip: (a) => {
    const amt = spokenAmount(a.amount);
    return amt ? `आपको ${amt} रुपये की टिप मिली है।` : 'आपको टिप मिली है।';
  },
  test: () => 'ज़ेन्व वॉइस चालू है। आपके अकाउंट में 10 रुपये जमा हो गए।',
};

const EN: Record<PhraseKey, Builder> = {
  newOrder: (a) => {
    const store = cleanStore(a.store);
    const earn = spokenAmount(a.earning);
    return [store ? `New delivery order from ${store}.` : 'New delivery order.', earn ? `You earn ${earn} rupees.` : '']
      .filter(Boolean)
      .join(' ');
  },
  accepted: () => 'The order is yours. Head to pickup.',
  ready: () => 'Order is ready. Please collect it.',
  delivered: (a) => {
    const amt = spokenAmount(a.amount);
    return amt ? `${amt} rupees credited to your account.` : 'Order delivered. Well done.';
  },
  cod: (a) => {
    const amt = spokenAmount(a.amount);
    return amt ? `Collect ${amt} rupees cash from the customer.` : 'Collect cash from the customer.';
  },
  online: () => 'You are online. Orders will come in.',
  offline: () => 'You are offline.',
  cancelled: () => 'Order cancelled. Do not pick it up.',
  tip: (a) => {
    const amt = spokenAmount(a.amount);
    return amt ? `You received a ${amt} rupees tip.` : 'You received a tip.';
  },
  test: () => 'ZenWe voice is working. 10 rupees credited to your account.',
};

const TABLE: Record<VoiceLang, Record<PhraseKey, Builder>> = { te: TE, hi: HI, en: EN };

export function phrase(lang: VoiceLang, key: PhraseKey, args: PhraseArgs = {}): string {
  return TABLE[lang][key](args);
}
