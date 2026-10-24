/**
 * Co-Ride v2 · repeat helpers (one-tap "Offer again"): the student's last offered ride from GET /my-rides,
 * the seats it first offered, and its IST clock time. Regular rides (templates that post themselves) are
 * "Coming soon" until the backend publisher exists.
 */
import type { Ride } from './coRideV2Data';
import { maxSeatsFor } from './coRideV2Data';

const IST = 330 * 60000;

export const clock12 = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** The student's last offered ride (host, offering seats). */
export function lastOffer(myRides: Ride[], myId: string): Ride | null {
  const mine = myRides.filter((r) => String(r.creatorId) === myId && r.creatorRole !== 'passenger');
  if (!mine.length) return null;
  const t = (r: Ride) => new Date(r.createdAt || r.departureTime).getTime() || 0;
  return [...mine].sort((a, b) => t(b) - t(a))[0];
}

/** Seats as first offered: what is left plus the approved riders. */
export const offeredSeats = (r: Ride) => {
  const approved = Array.isArray(r.requests) ? r.requests.filter((q: any) => q.status === 'Approved').length : 0;
  return Math.min(maxSeatsFor(r.vehicleType === 'Car' ? 'Car' : 'Bike'), Math.max(1, (Number(r.availableSeats) || 0) + approved));
};

export const timeOfRide = (r: Ride) => {
  const d = new Date(new Date(r.departureTime).getTime() + IST);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
