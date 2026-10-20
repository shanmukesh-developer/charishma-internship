/**
 * Co-Ride (student bike pool) formatting helpers: departure times, rupee amounts, fuel / fare shares,
 * host names, ride preferences and the status shown on My rides. Pure functions, no network.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Rides are on and around campus: times always read in India time (IST, UTC+5:30), whatever the phone's zone.
const IST_MS = 330 * 60000;
const ist = (ms: number) => new Date(ms + IST_MS); // read with getUTC*

/** "6:30 pm" (IST) */
export const fmtClock12 = (d: Date) => {
  const t = ist(d.getTime());
  const h = t.getUTCHours();
  const m = String(t.getUTCMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'am' : 'pm'}`;
};

const istDayNumber = (ms: number) => Math.floor((ms + IST_MS) / 86400000);

/** { label: "Today, 6:30 pm", relative: "in 25 min" | null } */
export function fmtRideWhen(iso: any, now = Date.now()): { label: string; relative: string | null } {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return { label: 'Time not set', relative: null };
  const dayDiff = istDayNumber(d.getTime()) - istDayNumber(now);
  const t = ist(d.getTime());
  const day = dayDiff === 0 ? 'Today'
    : dayDiff === 1 ? 'Tomorrow'
      : dayDiff === -1 ? 'Yesterday'
        : `${DAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
  const mins = Math.round((d.getTime() - now) / 60000);
  let relative: string | null = null;
  if (mins >= -10 && mins <= 1) relative = 'Leaving now';
  else if (mins > 1 && mins < 60) relative = `in ${mins} min`;
  else if (mins >= 60 && mins < 180) {
    const h = Math.floor(mins / 60);
    const r = mins % 60;
    relative = r >= 5 ? `in ${h} h ${r} min` : `in ${h} h`;
  }
  return { label: `${day}, ${fmtClock12(d)}`, relative };
}

/** ₹1,250 (Indian grouping, whole rupees) */
export const inr = (n: number) => {
  const v = Math.round(Number(n) || 0);
  const s = String(Math.abs(v));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${v < 0 ? '-' : ''}₹${rest ? `${rest},${last3}` : last3}`;
};

/** "Ravi" from "ravi kumar" */
export const firstName = (name: any, fallback = 'Student') => {
  const f = String(name || '').trim().split(/\s+/)[0];
  if (!f) return fallback;
  return f.charAt(0).toUpperCase() + f.slice(1);
};

export const initialOf = (name: any) => (String(name || '').trim().charAt(0) || 'S').toUpperCase();

/** Autos now belong to Zenvy Auto; older pool posts with vehicleType 'Auto' still show, as a fare share. */
export const isAutoRide = (ride: any) => String(ride?.vehicleType || '') === 'Auto';
export const costWord = (ride: any) => (isAutoRide(ride) ? 'Fare share' : 'Fuel share');

export const vehicleLabel = (v: any) => {
  const t = String(v || 'Bike');
  return t === 'Auto' ? 'Auto' : t === 'Car' ? 'Car' : t === 'Scooter' ? 'Scooter' : 'Bike';
};

/** Per-person share while browsing: exact for one seat, a range when several seats may fill. */
export function browseShare(ride: any): { each: string | null; total: string | null } {
  const fuel = Number(ride?.estimatedFuelCost) || 0;
  if (fuel <= 0) return { each: null, total: null };
  const seats = Math.max(1, Number(ride?.availableSeats) || 1);
  const max = Math.ceil(fuel / 2); // you and the host
  const min = Math.ceil(fuel / (seats + 1)); // every open seat taken
  return { each: min === max ? `${inr(max)} each` : `${inr(min)}–${String(max)} each`, total: `${inr(fuel)} total` };
}

/** The app stores labels such as 'Silent Ride 🤫': show plain words, hide "Any". */
export const vibeLabel = (v: any): string | null => {
  const t = String(v || '').toLowerCase();
  if (!t || t === 'any') return null;
  if (t.includes('silent') || t.includes('quiet')) return 'Quiet ride';
  if (t.includes('chat')) return 'Chatty';
  if (t.includes('music')) return 'Music on';
  return null;
};

export const genderLabel = (g: any): string | null => {
  const t = String(g || '').trim();
  return !t || t === 'Prefer not to say' ? null : t;
};

export type Tone = 'neutral' | 'success' | 'warning';

/** Who I am on a ride from /my-rides, my request status, and the calm badge to show. */
export function myRideInfo(ride: any, myId: string) {
  const isCreator = String(ride.creatorId) === myId;
  const requests: any[] = Array.isArray(ride.requests) ? ride.requests : [];
  const pending = requests.filter(r => r.status === 'Pending');
  const approved = requests.filter(r => r.status === 'Approved');
  const myRequest = !isCreator ? requests.find(r => String(r.passengerId) === myId) : null;
  const myStatus: string | null = myRequest?.status || (String(ride.coRiderId) === myId ? 'Approved' : null);
  const isOpenRide = ride.status === 'Available' || ride.status === 'Matched';

  let badge: { label: string; tone: Tone };
  if (ride.status === 'Completed') badge = { label: 'Completed', tone: 'success' };
  else if (ride.status === 'Cancelled') badge = { label: 'Cancelled', tone: 'neutral' };
  else if (!isCreator) {
    badge = myStatus === 'Pending' ? { label: 'Request pending', tone: 'warning' }
      : myStatus === 'Approved' ? { label: 'Confirmed', tone: 'success' }
        : myStatus === 'Rejected' ? { label: 'Declined', tone: 'neutral' }
          : myStatus === 'Cancelled' ? { label: 'Withdrawn', tone: 'neutral' }
            : { label: 'Open', tone: 'neutral' };
  } else if (ride.status === 'Matched') badge = { label: 'Full', tone: 'success' };
  else if (pending.length) badge = { label: `${pending.length} new request${pending.length === 1 ? '' : 's'}`, tone: 'warning' };
  else badge = { label: 'Open', tone: 'neutral' };

  const isPast = !isOpenRide || (!isCreator && (myStatus === 'Rejected' || myStatus === 'Cancelled'));
  return { isCreator, requests, pending, approved, myStatus, isOpenRide, isPast, badge };
}

/** Upcoming (soonest first) and Past (latest first). */
export function groupMyRides(myRides: any[], myId: string) {
  const t = (r: any) => new Date(r.departureTime).getTime() || 0;
  const upcoming: any[] = [];
  const past: any[] = [];
  myRides.forEach(r => (myRideInfo(r, myId).isPast ? past : upcoming).push(r));
  upcoming.sort((a, b) => t(a) - t(b));
  past.sort((a, b) => t(b) - t(a));
  return { upcoming, past };
}

/** Destinations present in the loaded rides, most common first (client-side "Going to" filter). */
export function topDestinations(rides: any[], limit = 8): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  rides.forEach(r => {
    const label = String(r?.destination || '').trim();
    if (!label) return;
    const key = label.toLowerCase();
    const cur = counts.get(key);
    if (cur) cur.n += 1; else counts.set(key, { label, n: 1 });
  });
  return [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).slice(0, limit).map(x => x.label);
}

export const sameDestination = (a: any, b: any) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
