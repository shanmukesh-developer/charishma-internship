import { Alert, Linking } from 'react-native';

/**
 * CampusBites local vendors (stalls) are ordered INSIDE Zenvy: the item goes in the basket, the order is
 * cash on delivery to the stall, and the stall delivers it themselves (no rider, no delivery PIN).
 * The stall sees and manages the order in the Zenvy Vendor app. Mirrors backend utils/vendorTypes.js
 * (isLocalVendorStore) and the order's `fulfilment: 'VENDOR'`.
 */
export const LOCAL_VENDOR_TYPES = ['LOCAL_VENDOR', 'LOCAL', 'STALL'];

export const isLocalVendor = (store: any): boolean =>
  !!store && (LOCAL_VENDOR_TYPES.includes(String(store.vendorType || '').toUpperCase()) || store.isLocalVendor === true);

export const isLocalVendorType = (vendorType: any): boolean =>
  LOCAL_VENDOR_TYPES.includes(String(vendorType || '').toUpperCase());

/** Digits with the India country code; null when the number is missing or invalid. */
const toDialable = (raw: any): string | null => {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
};

/** The vendor's own WhatsApp number (never a Zenvy number). */
export const vendorWhatsappNumber = (vendor: any): string | null => toDialable(vendor?.whatsappNumber);

/** The vendor's own phone number; their WhatsApp number is also callable. */
export const vendorCallNumber = (vendor: any): string | null => toDialable(vendor?.phone) || toDialable(vendor?.whatsappNumber);

export const callVendor = (vendor: any) => {
  const num = vendorCallNumber(vendor);
  if (!num) return;
  Linking.openURL(`tel:+${num}`).catch(() => Alert.alert("Couldn't open the dialer", `Call +${num} from your phone app.`));
};

export const whatsappVendor = (vendor: any, itemName?: string) => {
  const num = vendorWhatsappNumber(vendor);
  if (!num) return;
  const name = String(vendor?.name || 'your stall');
  const msg = itemName
    ? `Hi ${name}! I found you on ZENV and would like to order ${itemName}.`
    : `Hi ${name}! I found you on ZENV and would like to place an order.`;
  Linking.openURL(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`)
    .catch(() => Alert.alert("Couldn't open WhatsApp", 'Make sure WhatsApp is installed, or call the stall instead.'));
};

/** Shown on stall pages: how a stall order works. */
export const STALL_ORDER_COPY = 'Order here on ZENV. The stall delivers it to you themselves — pay them in cash on delivery.';

/** "Pay cash to <stall> on delivery" */
export const stallPayCopy = (stallName?: string | null) => `Pay cash to ${String(stallName || 'the stall').trim() || 'the stall'} on delivery`;

/** True when an order (GET /api/orders/:id or a list row) is delivered by the stall itself. */
export const isVendorFulfilled = (order: any): boolean =>
  !!order && (String(order.fulfilment || '').toUpperCase() === 'VENDOR'
    || (!order.fulfilment && String(order.category || '').toUpperCase() === 'LOCAL_VENDOR'));

/** Friendly copy for the backend's stall error codes; null when the code is not a stall one. */
export const stallErrorMessage = (code: any, serverMessage?: string | null, stallName?: string | null): { title: string; message: string } | null => {
  const name = String(stallName || 'This stall');
  switch (String(code || '')) {
    case 'STALL_COD_ONLY':
      return { title: 'Cash only', message: serverMessage || `${name} takes cash on delivery only. Pay the stall when your order arrives.` };
    case 'COUPON_NOT_FOR_STALL':
      return { title: 'Coupon not applied', message: serverMessage || `Coupons can't be used on ${name} orders — you pay the stall in cash.` };
    case 'ADDONS_NOT_FOR_STALL':
      return { title: 'Remove add-ons', message: serverMessage || `Add-ons can't be added to a ${name} order.` };
    case 'MULTIPLE_STORES':
      return { title: 'One place per order', message: serverMessage || 'Each order comes from one store or stall. Place the other items as a separate order.' };
    case 'STORE_CLOSED':
      return { title: 'Closed right now', message: serverMessage || `${name} is not taking orders right now. Try again when it opens.` };
    case 'MIN_ORDER_NOT_MET':
      return { title: 'Add a little more', message: serverMessage || `${name} has a minimum order value. Add a few more items.` };
    default:
      return null;
  }
};
