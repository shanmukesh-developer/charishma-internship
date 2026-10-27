// Shop voice phrases in Telugu (default), Hindi and English.
// Written in native script so the phone's TTS pronounces them properly.
// PRIVACY: phrases take only counts and amounts. Never phone numbers, names or addresses.

export type VoiceLang = 'te' | 'hi' | 'en';

export const LANG_TAG: Record<VoiceLang, string> = { te: 'te-IN', hi: 'hi-IN', en: 'en-IN' };
export const LANG_LABEL: Record<VoiceLang, string> = { te: 'తెలుగు', hi: 'हिंदी', en: 'English' };
export const LANG_NAME_EN: Record<VoiceLang, string> = { te: 'Telugu', hi: 'Hindi', en: 'English' };
/** Fallback order when the chosen language has no voice on this phone. */
export const FALLBACK_CHAIN: VoiceLang[] = ['te', 'hi', 'en'];

export type VoiceEvent =
  | { kind: 'newOrder'; items: number; total: number }
  | { kind: 'accepted' }
  | { kind: 'rejected' }
  | { kind: 'outForDelivery'; cash: number }
  | { kind: 'delivered'; cash: number }
  /** by: who cancelled ('store' = this stall, e.g. from another phone or an accepted order it cancelled). */
  | { kind: 'cancelled'; by?: 'customer' | 'store' | 'support' | 'system' | null }
  | { kind: 'timedOut' }
  | { kind: 'storeOpen' }
  | { kind: 'storeClosed'; orders: number; cash: number }
  | { kind: 'offline' }
  | { kind: 'online' }
  | { kind: 'itemAdded' }
  | { kind: 'test' };

/** Whole rupees, as digits: the TTS reads the number in the chosen language. */
const amt = (n: number) => String(Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));

export function phrase(e: VoiceEvent, lang: VoiceLang): string {
  switch (e.kind) {
    case 'newOrder': {
      const n = Math.max(1, Math.round(e.items || 1));
      const total = amt(e.total);
      // "Kotha order vachindhi, {n} items, {total} rupees"
      if (lang === 'te') return `కొత్త ఆర్డర్ వచ్చింది. ${n} ఐటమ్స్, ${total} రూపాయలు.`;
      if (lang === 'hi') return `नया ऑर्डर आया है. ${n} आइटम, ${total} रुपये.`;
      return `New order. ${n} item${n === 1 ? '' : 's'}, ${total} rupees.`;
    }
    case 'accepted':
      if (lang === 'te') return 'ఆర్డర్ యాక్సెప్ట్ చేశారు. రెడీ చేసి డెలివరీ చేయండి.';
      if (lang === 'hi') return 'ऑर्डर स्वीकार हो गया. तैयार करके डिलीवर करें.';
      return 'Order accepted. Get it ready and deliver it.';
    case 'rejected':
      if (lang === 'te') return 'ఆర్డర్ రిజెక్ట్ చేశారు.';
      if (lang === 'hi') return 'ऑर्डर रिजेक्ट कर दिया.';
      return 'Order rejected.';
    case 'outForDelivery':
      if (e.cash > 0) {
        if (lang === 'te') return `డెలివరీకి బయలుదేరారు. కస్టమర్ దగ్గర ${amt(e.cash)} రూపాయలు క్యాష్ తీసుకోండి.`;
        if (lang === 'hi') return `डिलीवरी के लिए निकले. ग्राहक से ${amt(e.cash)} रुपये कैश लें.`;
        return `Out for delivery. Collect ${amt(e.cash)} rupees cash.`;
      }
      if (lang === 'te') return 'డెలివరీకి బయలుదేరారు.';
      if (lang === 'hi') return 'डिलीवरी के लिए निकले.';
      return 'Out for delivery.';
    case 'delivered':
      if (e.cash > 0) {
        if (lang === 'te') return `ఆర్డర్ డెలివర్ అయ్యింది. ${amt(e.cash)} రూపాయలు క్యాష్ వచ్చింది.`;
        if (lang === 'hi') return `ऑर्डर डिलीवर हो गया. ${amt(e.cash)} रुपये कैश मिला.`;
        return `Order delivered. ${amt(e.cash)} rupees cash collected.`;
      }
      if (lang === 'te') return 'ఆర్డర్ డెలివర్ అయ్యింది.';
      if (lang === 'hi') return 'ऑर्डर डिलीवर हो गया.';
      return 'Order delivered.';
    case 'cancelled':
      if (e.by === 'customer') {
        if (lang === 'te') return 'కస్టమర్ ఆర్డర్ క్యాన్సిల్ చేశారు.';
        if (lang === 'hi') return 'ग्राहक ने ऑर्डर कैंसल कर दिया.';
        return 'The customer cancelled the order.';
      }
      if (e.by === 'support') {
        if (lang === 'te') return 'జెన్వీ సపోర్ట్ ఆర్డర్ క్యాన్సిల్ చేశారు.';
        if (lang === 'hi') return 'ज़ेनवी सपोर्ट ने ऑर्डर कैंसल कर दिया.';
        return 'ZCS support cancelled the order.';
      }
      // The stall's own cancel, an automatic cancel, or not known: no blame on the customer.
      if (lang === 'te') return 'ఆర్డర్ క్యాన్సిల్ అయ్యింది.';
      if (lang === 'hi') return 'ऑर्डर कैंसल हो गया.';
      return 'Order cancelled.';
    case 'timedOut':
      if (lang === 'te') return 'టైమ్ అయిపోయింది. ఆర్డర్ క్యాన్సిల్ అయ్యింది.';
      if (lang === 'hi') return 'समय खत्म. ऑर्डर कैंसल हो गया.';
      return 'Time ran out. Order cancelled.';
    case 'storeOpen':
      if (lang === 'te') return 'షాప్ ఓపెన్ అయ్యింది. ఆర్డర్లు వస్తాయి.';
      if (lang === 'hi') return 'दुकान खुल गई. ऑर्डर आएंगे.';
      return 'Shop is open. Orders will come in.';
    case 'storeClosed': {
      const summary = e.orders > 0;
      if (lang === 'te') return `షాప్ క్లోజ్ అయ్యింది.${summary ? ` ఈ రోజు ${e.orders} ఆర్డర్లు, ${amt(e.cash)} రూపాయలు క్యాష్.` : ''}`;
      if (lang === 'hi') return `दुकान बंद हो गई.${summary ? ` आज ${e.orders} ऑर्डर, ${amt(e.cash)} रुपये कैश.` : ''}`;
      return `Shop is closed.${summary ? ` Today ${e.orders} order${e.orders === 1 ? '' : 's'}, ${amt(e.cash)} rupees cash.` : ''}`;
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
      if (lang === 'te') return 'జెన్వీ వాయిస్ పని చేస్తోంది. కొత్త ఆర్డర్ వస్తే ఇలా చెబుతాను.';
      if (lang === 'hi') return 'ज़ेनवी आवाज़ चालू है. नया ऑर्डर आने पर ऐसे बताऊंगी.';
      return 'ZCS voice is working. I will announce new orders like this.';
  }
}

/** Text of the native heads-up notification for a new order (shown on the lock screen). */
export function orderNotification(orderNum: string, amount: string, lang: VoiceLang): { title: string; body: string } {
  if (lang === 'hi') {
    return { title: `🔔 ज़ेनवी नया ऑर्डर! (₹${amount})`, body: `ऑर्डर #${orderNum}. खोलकर स्वीकार करें.` };
  }
  if (lang === 'en') {
    return { title: `🔔 New ZCS order! (₹${amount})`, body: `Order #${orderNum}. Open the app to accept.` };
  }
  return { title: `🔔 జెన్వీ కొత్త ఆర్డర్! (₹${amount})`, body: `ఆర్డర్ #${orderNum}. యాప్ తెరిచి యాక్సెప్ట్ చేయండి.` };
}
