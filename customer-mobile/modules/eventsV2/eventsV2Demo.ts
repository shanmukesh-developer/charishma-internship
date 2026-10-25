/**
 * Campus Events v2 demo content (owner decision, 25 Oct 2026: "mock data with great images, to show users").
 *
 * One switch: EVENTS_V2_DEMO_CONTENT. While it is on, sample events fill the screens so the section looks alive
 * while real events are few (or while Events is still switched off on the server). Real events always come first.
 * Every sample carries `isDemoContent: true`: the screens show a small "Sample" tag on it, and its Register opens
 * a polite "sample event" sheet. Samples never reach a registration endpoint.
 * Dates are relative to today (the coming weeks); venues are around SRM University AP; prices Free or ₹99–₹299.
 */
import type { ImageSourcePropType } from 'react-native';
import { istDate, type Category, type EventDetail } from '../campusEvents/campusEventsApi';
import { SAMPLE_ART, type SampleArtKey } from './eventsV2Art';

export const EVENTS_V2_DEMO_CONTENT = true;

export interface AgendaItem { time: string; label: string }
/** A real event (from the server) or a sample, in one shape (the server's EventDetail). */
export type EvEvent = EventDetail & { isDemoContent?: boolean; art?: ImageSourcePropType; agenda?: AgendaItem[] };

interface Seed {
  slug: string; art: SampleArtKey; title: string; category: Category; categoryLabel: string; tags: string[];
  club: string; day: number; start: string; hours: number; venue: string; price: number; capacity: number; left: number;
  about: string; agenda?: AgendaItem[]; equipment?: string;
}

const SEEDS: Seed[] = [
  { slug: 'cricket-cup', art: 'cricket', title: 'Inter-Hostel Cricket Cup Finals', category: 'TOURNAMENT', categoryLabel: 'Sports', tags: ['Sports', 'Tournament'], club: 'Sports Council', day: 4, start: '16:00', hours: 3, venue: 'Main Cricket Ground', price: 0, capacity: 300, left: 112,
    about: 'The two best hostel sides meet under the evening sky for the cup. Bring your hostel colours, grab a spot on the stands and cheer them home. Free entry for every student.',
    agenda: [{ time: '3:30 PM', label: 'Gates open, warm-up' }, { time: '4:00 PM', label: 'First innings (20 overs)' }, { time: '5:45 PM', label: 'Second innings' }, { time: '7:00 PM', label: 'Trophy and player of the match' }] },
  { slug: 'design-sprint', art: 'design', title: 'Figma to Prototype Design Sprint', category: 'WORKSHOP', categoryLabel: 'Workshop', tags: ['Workshop', 'Design'], club: 'Design Club', day: 2, start: '10:00', hours: 4, venue: 'Innovation Hub, Level 2', price: 149, capacity: 60, left: 18,
    about: 'A hands-on sprint: research a campus problem, sketch flows on paper, then build a clickable prototype in Figma with mentors from the Design Club.',
    agenda: [{ time: '10:00 AM', label: 'Problem framing and sketching' }, { time: '11:30 AM', label: 'Wireframes in Figma' }, { time: '1:00 PM', label: 'Prototype and test' }, { time: '1:45 PM', label: 'Show and tell' }], equipment: 'Laptop with Figma (free account), notebook' },
  { slug: 'football-night', art: 'football', title: '5-a-side Football Night', category: 'SPORTS', categoryLabel: 'Sports', tags: ['Sports', 'Football'], club: 'Sports Council', day: 1, start: '19:00', hours: 3, venue: 'Football Turf, Sports Complex', price: 99, capacity: 80, left: 12,
    about: 'Floodlit 5-a-side under the lights. Sign up solo and get placed in a mixed team, or come with friends. Bibs and balls provided.', equipment: 'Studs or turf shoes, water bottle' },
  { slug: 'quiz-league', art: 'quiz', title: 'Campus Quiz League Round 1', category: 'COMPETITION', categoryLabel: 'Competition', tags: ['Quiz', 'Competition'], club: 'Quiz Club', day: 3, start: '17:30', hours: 2, venue: 'Seminar Hall 2, Academic Block', price: 0, capacity: 90, left: 31,
    about: 'General quiz with a campus twist: pop culture, sport, science and Andhra history. Teams of two, top eight go through to the finals.' },
  { slug: 'founders-talk', art: 'talk', title: 'Founders Talk: Dorm to Startup', category: 'TALK', categoryLabel: 'Talk', tags: ['Talk', 'Startups'], club: 'E-Cell', day: 5, start: '18:00', hours: 2, venue: 'Admin Block Auditorium', price: 99, capacity: 250, left: 88,
    about: 'Three alumni founders on building their first product in a hostel room, raising a first cheque and the mistakes they would skip. Open Q&A at the end.' },
  { slug: 'riverside-beats', art: 'concert', title: 'Riverside Beats Fest Night', category: 'CULTURAL', categoryLabel: 'Cultural', tags: ['Fest', 'Music'], club: 'Cultural Committee', day: 6, start: '19:00', hours: 4, venue: 'Open Air Theatre', price: 299, capacity: 600, left: 212,
    about: 'The headline night of the fest: student bands open, then a live DJ set with full stage lights. Wristbands at the gate with your ticket QR.' },
  { slug: 'photo-walk', art: 'photo', title: 'Golden Hour Photo Walk', category: 'CLUB', categoryLabel: 'Club activity', tags: ['Club', 'Photography'], club: 'Photography Club', day: 8, start: '16:45', hours: 2, venue: 'Starts at the Central Lawn', price: 0, capacity: 40, left: 9,
    about: 'Walk the campus at golden hour with the Photography Club. Phones are welcome: we cover composition, light and quick edits.', equipment: 'Any camera or phone' },
  { slug: 'sunset-jam', art: 'jam', title: 'Sunset Jam Session', category: 'CLUB', categoryLabel: 'Club activity', tags: ['Club', 'Music'], club: 'Music Club', day: 9, start: '17:30', hours: 2, venue: 'Food Court Lawn', price: 0, capacity: 70, left: 26,
    about: 'Unplugged jam on the lawn. Bring a guitar, a cajon or just your voice. Open to every skill level.' },
  { slug: 'hackap', art: 'hackathon', title: 'HackAP 24-Hour Hackathon', category: 'HACKATHON', categoryLabel: 'Hackathon', tags: ['Hackathon', 'Tech'], club: 'Coding Club', day: 12, start: '09:00', hours: 24, venue: 'Library Block, Ground Floor', price: 199, capacity: 200, left: 64,
    about: 'Build anything that makes campus life better in 24 hours. Mentors on the floor, meals and midnight snacks included, prizes for the top three teams.',
    agenda: [{ time: '9:00 AM', label: 'Kick-off and team formation' }, { time: '1:00 PM', label: 'Mentor round 1' }, { time: '12:00 AM', label: 'Midnight check-in' }, { time: '9:00 AM', label: 'Demos and judging' }], equipment: 'Laptop and charger' },
  { slug: 'neon-dance', art: 'dance', title: 'Neon Dance Night', category: 'CULTURAL', categoryLabel: 'Cultural', tags: ['Fest', 'Dance'], club: 'Dance Club', day: 13, start: '18:30', hours: 3, venue: 'Convocation Hall', price: 249, capacity: 400, left: 150,
    about: 'Crews from across campus battle it out under neon lights, followed by an open floor. Hip-hop, contemporary and freestyle.' },
  { slug: 'open-mic', art: 'mic', title: 'Open Mic: Poetry and Stand-up', category: 'CULTURAL', categoryLabel: 'Cultural', tags: ['Cultural', 'Open mic'], club: 'Literary Club', day: 16, start: '18:00', hours: 2, venue: 'Mini Auditorium, Block C', price: 99, capacity: 120, left: 47,
    about: 'Five-minute slots for poetry, stand-up and spoken word in Telugu, Hindi or English. Sign up to perform at the desk, or just come and listen.' },
];

const at = (day: number, hhmm: string, plusHours = 0) =>
  new Date(new Date(`${istDate(day)}T${hhmm}:00+05:30`).getTime() + plusHours * 3600000).toISOString();

function build(s: Seed): EvEvent {
  const free = s.price === 0;
  const startAt = at(s.day, s.start);
  return {
    id: `sample-${s.slug}`, title: s.title, category: s.category, categoryLabel: s.categoryLabel, tags: s.tags, posterUrl: null,
    organizer: { name: s.club, club: { id: `sample-club-${s.club}`, name: s.club, type: 'CLUB', verified: true } },
    startAt, endAt: at(s.day, s.start, s.hours), venue: s.venue, format: 'INDIVIDUAL', isTeam: false,
    price: { priceType: free ? 'FREE' : 'PAID', isFree: free, amount: s.price, extras: 0, total: s.price, extraCharges: [], label: free ? 'Free' : `₹${s.price}` },
    regOpensAt: null, regClosesAt: at(s.day, s.start, -2), capacity: { kind: 'SEATS', capacity: s.capacity, confirmed: s.capacity - s.left, remaining: s.left, waitlistCount: 0 },
    registrationState: 'OPEN', featured: s.day <= 6, publishedAt: null, myStatus: null,
    description: s.about, gallery: [], venueDirections: null, venueLat: null, venueLon: null, eligibility: {}, rules: '', rulesVersion: 1, questions: [],
    equipment: s.equipment || null, contactText: null, instructions: 'Show your ticket QR at the entry desk.', cancellationPolicy: { userCancelUntilHours: 6, refundPct: free ? null : 100 },
    team: null, maxBookingsPerStudent: 1, approvalRequired: false, waitlistEnabled: false, paymentModes: free ? ['NONE'] : ['VENUE'], entryOpensBeforeMin: 30,
    status: 'PUBLISHED', cta: { action: 'REGISTER_NOW', label: free ? 'Register for free' : `Buy ticket · ₹${s.price}`, enabled: true },
    isDemoContent: true, art: SAMPLE_ART[s.art], agenda: s.agenda,
  };
}

let cache: { day: string; list: EvEvent[] } | null = null;
/** Sample events, soonest first (rebuilt once a day so "Today" / "This week" stay true). */
export function demoEvents(): EvEvent[] {
  if (!EVENTS_V2_DEMO_CONTENT) return [];
  const d = istDate(0);
  if (!cache || cache.day !== d) cache = { day: d, list: SEEDS.map(build).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt))) };
  return cache.list;
}
export const demoEvent = (id: string) => demoEvents().find((e) => e.id === id) || null;
export const isSampleId = (id?: string | null) => !!id && id.startsWith('sample-');

/** Sample clubs (for the Clubs row) built from the sample organisers. */
export function demoClubs(): { id: string; name: string; eventCount: number; isDemoContent: true }[] {
  const m = new Map<string, number>();
  for (const e of demoEvents()) m.set(e.organizer.name, (m.get(e.organizer.name) || 0) + 1);
  return [...m.entries()].map(([name, n]) => ({ id: `sample-club-${name}`, name, eventCount: n, isDemoContent: true as const }));
}
