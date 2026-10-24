/**
 * PG v2 demo content (owner decision, 24 Oct 2026: a pitch demo for PG owners, mock content is fine).
 *
 * One switch: PG_V2_DEMO_CONTENT. While it is on, every field a listing is missing is filled with
 * believable sample content so no screen shows an empty state; real data always wins field by field.
 * Everything added here is marked `isDemoContent` (on the PG, per section and on each sample review)
 * so it can be found, captioned and switched off once owners add real data in the PG owner app.
 */
import type {
  PgDetail, MessTimetable, DayKey, PgRuleGroup, PgPolicies, PgSafety, PgMoveIn, PgLocationGuide, PgFaq, PgTimings, PgReview,
} from '../pg/pgApi';
import { genderKey } from '../pg/pgApi';


export const PG_V2_DEMO_CONTENT = true;

/** Which sections of a PG came from this file (real data never appears here). */
export interface DemoFlags {
  isDemoContent: boolean;
  about: boolean; highlights: boolean; mess: boolean; rules: boolean; policies: boolean; safety: boolean;
  moveIn: boolean; location: boolean; nearby: boolean; faq: boolean; reviews: boolean; amenities: boolean;
}
export type PgWithDemo = PgDetail & { demo: DemoFlags };
export interface DemoReview extends PgReview { isDemoContent: true }

/** SRM University AP, main gate (approximate). Demo pins sit around it at the listing's real distance. */
export const SRM_AP = { lat: 16.4626, lng: 80.507 };

const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const pick = <T,>(list: T[], seed: number, n: number) => Array.from({ length: Math.min(n, list.length) }, (_, i) => list[(seed + i * 7) % list.length])
  .filter((v, i, a) => a.indexOf(v) === i);

// ── Mess: four meals, a 7-day South Indian student menu ─────────────────────────────────────────
const MEALS = [
  { key: 'breakfast', label: 'Breakfast', start: '07:30', end: '09:00' },
  { key: 'lunch', label: 'Lunch', start: '12:30', end: '14:00' },
  { key: 'snacks', label: 'Snacks', start: '17:00', end: '17:45' },
  { key: 'dinner', label: 'Dinner', start: '20:00', end: '21:30' },
];
const MENU: Record<DayKey, [string, string, string, string]> = {
  mon: ['Idli, sambar, coconut chutney', 'Rice, dal, beans poriyal, rasam, curd', 'Tea, onion pakoda', 'Chapati, mixed veg kurma, rice, buttermilk'],
  tue: ['Pongal, vada, chutney', 'Rice, sambar, cabbage fry, rasam, curd', 'Coffee, biscuits', 'Phulka, paneer butter masala, jeera rice'],
  wed: ['Poori, potato masala', 'Veg pulao, raita, dal, papad', 'Tea, samosa', 'Chicken curry or egg curry, rice, chapati'],
  thu: ['Upma, chutney, banana', 'Rice, tomato dal, bhindi fry, rasam, curd', 'Tea, bhel', 'Chapati, chana masala, rice, curd'],
  fri: ['Dosa, sambar, chutney', 'Lemon rice, curd rice, potato fry, pickle', 'Coffee, mirchi bajji', 'Veg biryani, raita, gulab jamun'],
  sat: ['Bread, omelette or jam, milk', 'Rice, dal tadka, aloo gobi, rasam, curd', 'Tea, cake', 'Chicken biryani or veg biryani, raita'],
  sun: ['Masala dosa, chutney', 'Special thali: rice, sambar, two curries, sweet', 'Tea, cutlet', 'Light dinner: chapati, dal, curd'],
};
const NONVEG_DAYS: DayKey[] = ['wed', 'sat'];

const demoMess = (): MessTimetable => {
  const days: MessTimetable['days'] = {};
  (Object.keys(MENU) as DayKey[]).forEach((d) => {
    const row: Record<string, { menu: string; tag: 'veg' | 'nonveg' | 'egg' | null }> = {};
    MEALS.forEach((m, i) => {
      const nonveg = i === 3 && NONVEG_DAYS.includes(d);
      row[m.key] = { menu: MENU[d][i], tag: nonveg ? 'nonveg' : d === 'sat' && i === 0 ? 'egg' : 'veg' };
    });
    days[d] = row;
  });
  return { meals: MEALS, days, notes: 'Non-veg on Wednesday and Saturday dinner. Mess holiday: second Sunday of the month (dinner served).' };
};

// ── Rules, policies, safety, move-in ─────────────────────────────────────────────────────────────
const demoTimings = (girls: boolean): PgTimings => ({
  gateOpen: '05:30', gateClose: girls ? '21:30' : '22:30', visitorFrom: '10:00', visitorTo: '19:00',
  checkIn: '10:00', checkOut: '11:00', quietFrom: '22:30', quietTo: '06:00',
  curfewNote: 'Late entry after gate closing is allowed with a prior note to the warden.',
});
const demoRules = (girls: boolean): PgRuleGroup[] => [
  { category: 'gate', label: 'Gate and entry', rules: [`Main gate closes at ${girls ? '9:30 PM' : '10:30 PM'}; inform the warden for late entry.`, 'Sign the register for night outs.'] },
  { category: 'visitors', label: 'Visitors and guests', rules: ['Visitors are welcome in the lobby from 10 AM to 7 PM.', girls ? 'Male visitors are not allowed beyond the lobby.' : 'Guests are not allowed in rooms after 7 PM.', 'Parents can stay overnight in the guest room on request.'] },
  { category: 'noise', label: 'Quiet hours', rules: ['Quiet hours from 10:30 PM to 6 AM.', 'Use headphones for music and calls after 10 PM.'] },
  { category: 'smoking', label: 'Smoking and alcohol', rules: ['No smoking, alcohol or other substances anywhere on the premises.'] },
  { category: 'cleanliness', label: 'Cleanliness', rules: ['Rooms are cleaned daily; keep floors clear for housekeeping.', 'Wet waste goes in the green bin, dry waste in the blue bin.'] },
  { category: 'electricity', label: 'Electricity', rules: ['Switch off the AC and lights when you leave the room.', 'Induction stoves and heaters are not allowed in rooms.'] },
];
const demoPolicies = (deposit: number): PgPolicies => ({
  booking: { steps: 'Send a request in the app. The PG confirms within 24 hours, then you visit, sign the agreement and move in.', tokenAmount: 2000, confirmation: 'Confirmed by the PG owner' },
  rent: { dueDay: 5, lateFee: 100, lateFeeUnit: 'day', methods: ['upi', 'cash', 'bank'], notes: 'Rent is paid monthly in advance.' },
  deposit: { amount: deposit, refundDays: 7, deductions: 'Refunded within 7 days of moving out, minus any unpaid dues or damage.' },
  stay: { noticeMonths: 1, lockInMonths: 3, notes: 'During exam months the mess and Wi-Fi run longer hours. In the summer holidays you can keep your bed at half rent for up to two months.' },
  cancellation: { freeCancelDays: 2, refundPercent: 100, text: 'Cancel a request any time before it is confirmed. After confirmation, the token is refunded in full if you cancel within 2 days.' },
  included: ['food', 'wifi', 'water', 'housekeeping', 'maintenance'],
  extraCharges: [{ item: 'Electricity (AC rooms)', amount: 10, unit: 'unit' }, { item: 'Laundry', amount: 400, unit: 'month' }],
  maintenance: { responseHours: 24, notes: 'Report issues to the warden or in the app; most are fixed within a day.' },
});
const demoSafety = (girls: boolean): PgSafety => ({
  cctv: true, entry: girls ? 'biometric' : 'keycard', guard: '24x7', fireExtinguishers: true, firstAid: true,
  wardenName: girls ? 'Mrs. Lakshmi (resident warden)' : 'Mr. Ravi (resident caretaker)', wardenAvailability: 'On site, 24 hours',
  emergency: girls ? 'Women-only floors with a resident lady warden. Emergency: ZCS housing desk in the app.' : 'Emergency: ZCS housing desk in the app.',
});
const demoMoveIn = (): PgMoveIn => ({
  documents: ['College ID card', 'Aadhaar card (copy)', 'Two passport-size photos', 'Parent or guardian contact'],
  bring: ['Bedsheet and pillow cover', 'Bucket and mug', 'Padlock for your cupboard', 'Toiletries', 'Laptop lock'],
  provided: ['Bed with mattress', 'Cupboard', 'Study table and chair', 'Wi-Fi', 'Drinking water'],
  steps: ['Send a booking request in the app', 'Visit the PG and see your room', 'Pay the token and sign the agreement', 'Submit your documents', 'Collect your keys and move in'],
});
const NEARBY = [
  { name: 'SRM AP main gate', category: 'college' as const, distanceM: 0 },
  { name: 'Campus food court', category: 'restaurant' as const, distanceM: 450 },
  { name: 'Apollo Pharmacy', category: 'pharmacy' as const, distanceM: 600 },
  { name: 'SBI ATM', category: 'atm' as const, distanceM: 700 },
  { name: 'Neerukonda bus stop', category: 'bus_stop' as const, distanceM: 350 },
  { name: 'Mangalagiri AIIMS', category: 'hospital' as const, distanceM: 9000 },
  { name: 'Daily needs supermarket', category: 'supermarket' as const, distanceM: 500 },
];
const demoGuide = (km: number): PgLocationGuide => {
  const campus = Math.max(150, Math.round(km * 1000));
  return {
    howToReach: `About ${Math.max(2, Math.round(campus / 80))} minutes' walk to the SRM AP main gate. Shared autos stop at the corner.`,
    nearby: NEARBY.map((n) => {
      const d = n.category === 'college' ? campus : n.distanceM;
      return { ...n, distanceM: d, walkMinutes: d <= 2500 ? Math.max(1, Math.round(d / 80)) : undefined };
    }),
  };
};
const demoFaq = (girls: boolean): PgFaq[] => [
  { id: 'd1', q: 'Is food included in the rent?', a: 'Yes. Breakfast, lunch, evening snacks and dinner are included, with a weekly menu.' },
  { id: 'd2', q: 'Can I visit before booking?', a: 'Yes. Visits are open from 10 AM to 7 PM; send a request and the PG will set a time.' },
  { id: 'd3', q: 'What is the notice period?', a: 'One month. The deposit is refunded within 7 days of moving out.' },
  { id: 'd4', q: 'Is there a curfew?', a: girls ? 'The gate closes at 9:30 PM. Late entry is fine with a prior note to the warden.' : 'The gate closes at 10:30 PM. Late entry is fine with a prior note to the warden.' },
  { id: 'd5', q: 'Is Wi-Fi good enough for online classes?', a: 'Rooms get 100 Mbps fibre Wi-Fi with backup power, so classes and exams are not interrupted.' },
  { id: 'd6', q: 'What happens in the summer holidays?', a: 'You can keep your bed at half rent for up to two months, or move out with one month\'s notice.' },
];
const demoAbout = (pg: PgDetail, girls: boolean) => {
  const km = pg.distanceFromCollege;
  const walk = Math.max(2, Math.round((km * 1000) / 80));
  return `${pg.name} is a ${girls ? 'safe, women-only' : genderKey(pg.genderType) === 'Co-ed' ? 'modern co-living' : 'well-run'} residence about ${walk} minutes' walk from the SRM AP main gate. `
    + 'Rooms are furnished with a bed, study table and cupboard, and are cleaned every day. '
    + 'A home-style mess serves four meals with a weekly South Indian menu, and fibre Wi-Fi with power backup keeps study time uninterrupted. '
    + `${girls ? 'A resident lady warden, biometric entry and CCTV' : 'A resident caretaker, keycard entry and CCTV'} make it an easy choice for students and parents.`;
};
const demoHighlights = (pg: PgDetail, girls: boolean) => [
  `${Math.max(2, Math.round((pg.distanceFromCollege * 1000) / 80))} min walk to campus`,
  '24×7 water and power backup',
  'Four meals a day included',
  girls ? 'Women-only, lady warden on site' : 'Daily housekeeping',
];
const DEMO_AMENITIES = ['WiFi', 'Power Backup', 'Hot Water', 'RO Water', 'Lift', 'AC', 'Furnished Rooms', 'Study Table', 'Wardrobe', 'Mess', 'Laundry', 'Housekeeping', 'CCTV', 'Warden', 'Biometric Entry', 'Fire Safety', 'Gym', 'Common Room', 'Parking'];

/** Demo pin around campus at the listing's real distance, in a stable direction per PG. */
const demoPin = (pg: PgDetail) => {
  const km = Math.max(0.15, Number(pg.distanceFromCollege) || 0.5);
  const angle = (hash(pg.id) % 360) * (Math.PI / 180);
  return { lat: SRM_AP.lat + (km / 111) * Math.cos(angle), lng: SRM_AP.lng + (km / (111 * Math.cos(SRM_AP.lat * Math.PI / 180))) * Math.sin(angle) };
};

/** Fill every missing section (only while PG_V2_DEMO_CONTENT is on); real data wins field by field. */
export const applyDemo = (pg: PgDetail): PgWithDemo => {
  const none: DemoFlags = { isDemoContent: false, about: false, highlights: false, mess: false, rules: false, policies: false, safety: false, moveIn: false, location: false, nearby: false, faq: false, reviews: false, amenities: false };
  if (!PG_V2_DEMO_CONTENT) return { ...pg, demo: none };
  const girls = genderKey(pg.genderType) === 'Girls';
  const deposit = pg.securityDeposit > 0 ? pg.securityDeposit : Math.round((pg.rentFrom || pg.baseRent || 6000) / 1000) * 1000;
  const f = { ...none };
  const out: PgDetail = { ...pg };
  if (!pg.description?.trim() || pg.description.trim().length < 90) { out.description = demoAbout(pg, girls); f.about = true; }
  if (!(pg.highlights || []).length) { out.highlights = demoHighlights(pg, girls); f.highlights = true; }
  if (!pg.messTimetable || !pg.messTimetable.meals.length) { out.messTimetable = demoMess(); f.mess = true; }
  if (!(pg.houseRules || []).length) { out.houseRules = demoRules(girls); f.rules = true; }
  if (!pg.timings) { out.timings = demoTimings(girls); f.rules = true; }
  if (!pg.policies) { out.policies = demoPolicies(deposit); f.policies = true; }
  if (!pg.safety) { out.safety = demoSafety(girls); f.safety = true; }
  if (!pg.moveIn) { out.moveIn = demoMoveIn(); f.moveIn = true; }
  if (!pg.location) { out.location = demoPin(pg); f.location = true; }
  if (!pg.locationGuide) { out.locationGuide = demoGuide(pg.distanceFromCollege); f.nearby = true; }
  if (!(pg.faq || []).length) { out.faq = demoFaq(girls); f.faq = true; }
  if (pg.amenities.length < 8) {
    out.amenities = [...pg.amenities, ...DEMO_AMENITIES.filter((a) => !pg.amenities.some((x) => x.toLowerCase().includes(a.toLowerCase().split(' ')[0])))];
    f.amenities = true;
  }
  f.reviews = true; // sample reviews are added below the real ones (captioned)
  f.isDemoContent = Object.entries(f).some(([k, v]) => k !== 'isDemoContent' && v);
  return { ...out, demo: f };
};

// ── Sample reviews (captioned "Sample review" wherever shown) ───────────────────────────────────
const REVIEWS: { rating: number; text: string; name: string }[] = [
  { rating: 5, text: 'Food is like home, especially the Sunday thali. Warden is strict about timings but very helpful.', name: 'Harsha' },
  { rating: 4, text: 'Rooms are clean and the Wi-Fi works well during exams. Hot water can be slow in the mornings.', name: 'Sneha' },
  { rating: 5, text: 'Walking distance to the gate, so I never miss the first class. Good value for the rent.', name: 'Karthik' },
  { rating: 4, text: 'Quiet place to study. Laundry is extra but quick. Would like more variety in snacks.', name: 'Divya' },
  { rating: 5, text: 'Felt safe from day one. CCTV, biometric entry and the staff are friendly.', name: 'Ananya' },
  { rating: 4, text: 'Power backup never failed in two semesters. The study table and chair are comfortable.', name: 'Rahul' },
  { rating: 3, text: 'Good location and food. Rooms on the top floor get warm in April, so pick an AC room.', name: 'Vamsi' },
];
export const demoReviews = (pg: PgDetail): DemoReview[] => {
  if (!PG_V2_DEMO_CONTENT) return [];
  const seed = hash(pg.id);
  return pick(REVIEWS, seed % REVIEWS.length, 3 + (seed % 3)).map((r, i) => ({
    id: `demo-${pg.id}-${i}`, rating: r.rating, text: r.text, firstName: r.name,
    createdAt: new Date(Date.UTC(2026, 6 + (i % 3), 3 + i * 5)).toISOString(), isDemoContent: true as const,
  }));
};
export const demoSummary = (list: { rating: number }[]) => (list.length ? { average: list.reduce((a, r) => a + r.rating, 0) / list.length, count: list.length } : { average: null, count: 0 });
