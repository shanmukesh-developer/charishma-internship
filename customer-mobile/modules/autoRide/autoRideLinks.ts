/**
 * Where an Auto-Ride push / in-app notification opens (backend modules/autoRide/services/notify.js:
 * data.type AUTO_*, data.screen 'auto_booking', data.bookingId / data.requestId / data.tripId).
 * Shared by the push tap handler (components/GlobalAnnouncement.tsx) and the inbox (app/notifications.tsx).
 * Driver-app types (AUTO_DRIVER_*, AUTO_VEHICLE_*) never reach customers and are ignored here.
 * bookingId wins: trip-wide pushes (full, delayed, departure, started, completed, cancelled) carry each
 * passenger's own bookingId, and an accepted full-auto request carries bookingId + requestId.
 */
const ID_RE = /^[0-9a-f-]{36}$/i;

export const autoRideHrefForNotification = (type?: string | null, rawData?: any): string | null => {
  let data: any = rawData;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { data = null; }
  }
  const isAuto = (typeof type === 'string' && type.startsWith('AUTO_')) || (data && data.screen === 'auto_booking');
  if (!isAuto) return null;
  if (typeof type === 'string' && (type.startsWith('AUTO_DRIVER') || type.startsWith('AUTO_VEHICLE'))) return null;
  const id = (k: string) => (data && typeof data[k] === 'string' && ID_RE.test(data[k]) ? data[k] : null);
  const bookingId = id('bookingId');
  if (bookingId) return `/auto-ride/booking/${bookingId}`;
  const requestId = id('requestId');
  if (requestId) return `/auto-ride/request/${requestId}`;
  const tripId = id('tripId');
  if (tripId) return `/auto-ride/trip/${tripId}`;
  return '/(tabs)/services?tab=coride&sub=auto&seg=bookings';
};
