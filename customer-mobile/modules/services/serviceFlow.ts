/**
 * Step flow for a campus service booking (ServiceBookingSheet) and the services category page.
 *
 * Everything here maps the REAL catalogue items onto the steps; nothing is priced here:
 *   - Repairs: device (phone / laptop / other) -> issue -> details -> booking. Each issue is a
 *     catalogue item (its form in serviceForms.ts), or the doorstep diagnosis item with the
 *     problem pre-ticked when the shop has no dedicated item for it.
 *   - Tailoring: category tile -> service -> details -> measurement and booking.
 *   - Print and laundry: service -> details -> booking.
 * Day and time chips become the same free-text pickupSlot the server stored before.
 */
import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import { formatISTDate, istHour, formatINR } from '../../utils/format';
import { laundryMeasure, resolveServiceForm, type Answers, type ServiceForm } from './serviceForms';
import type { ServiceFamily } from './serviceTheme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export type { IconName };

export interface ServiceItem {
  id: string;
  name: string;
  price: number;
  desc: string;
  image?: string | null;
  inStock?: boolean;
  storeName?: string;
}

// ── Prices on cards ─────────────────────────────────────────────────────────────────────────

/** "From ₹2,999", "₹99", "₹59 / kg", "₹2 / page" for a catalogue item (prices from the catalogue). */
export const servicePriceLabel = (shelfId: string, item: { name: string; price: number }): { main: string; note: string | null } => {
  const form = resolveServiceForm(shelfId, item.name);
  const price = formatINR(item.price);
  if (form.pricing.kind === 'fixed') {
    if (form.priceLabel === 'Starting price') return { main: `From ${price}`, note: null };
    return { main: price, note: form.priceLabel === 'Inspection charge' ? 'inspection' : form.priceLabel === 'Visit charge' ? 'visit' : null };
  }
  if (form.pricing.kind === 'print') {
    if (/spiral|hard\s*bound|thesis/i.test(item.name)) return { main: price, note: 'per book' };
    return { main: price, note: 'per page' };
  }
  if (form.category === 'laundry') {
    const m = laundryMeasure(item.name);
    const unit = m.unit === 'kg' ? 'kg' : m.word(1);
    return { main: price, note: `per ${unit}` };
  }
  return { main: price, note: 'per piece' };
};

// ── Icons for catalogue rows ────────────────────────────────────────────────────────────────

export interface IconTile { icon: IconName; color: string }

const C = {
  blue: '#3B82F6', green: '#16A34A', amber: '#D97706', sky: '#0284C7', teal: '#0D9488', orange: '#EA580C',
  red: '#DC2626', violet: '#7C3AED', slate: '#64748B', pink: '#DB2777', indigo: '#4F46E5',
};

export const itemIcon = (shelfId: string, name: string): IconTile => {
  const form = resolveServiceForm(shelfId, name);
  switch (form.id) {
    case 'repairs.laptopScreen': return { icon: 'laptop-outline', color: C.blue };
    case 'repairs.phoneScreen': return { icon: 'phone-portrait-outline', color: C.indigo };
    case 'repairs.keyboard': return { icon: 'keypad-outline', color: C.orange };
    case 'repairs.cleaning': return { icon: 'thermometer-outline', color: C.red };
    case 'repairs.storage': return { icon: 'speedometer-outline', color: C.violet };
    case 'repairs.diagnosis': return { icon: 'search-outline', color: C.teal };
    case 'tailoring.labCoat': return { icon: 'flask-outline', color: C.sky };
    case 'tailoring.measurement': return { icon: 'body-outline', color: C.teal };
    case 'tailoring.length': return { icon: 'resize-outline', color: C.blue };
    case 'tailoring.zipper': return { icon: 'git-commit-outline', color: C.amber };
    case 'tailoring.stitchNew': return { icon: 'color-palette-outline', color: C.pink };
    case 'tailoring.fitting': return { icon: 'shirt-outline', color: C.green };
    case 'tailoring.repair': return { icon: 'construct-outline', color: C.orange };
    case 'print.a3': return { icon: 'easel-outline', color: C.violet };
    case 'laundry.dryClean': return { icon: 'shirt-outline', color: C.violet };
    case 'laundry.shoes': return { icon: 'footsteps-outline', color: C.orange };
    case 'laundry.blanket': return { icon: 'bed-outline', color: C.indigo };
    default: break;
  }
  if (form.category === 'print') {
    if (/spiral|hard\s*bound|thesis/i.test(name)) return { icon: 'book-outline', color: C.amber };
    if (/colou?r/i.test(name)) return { icon: 'color-palette-outline', color: C.pink };
    return { icon: 'document-text-outline', color: C.slate };
  }
  if (form.category === 'laundry') {
    if (/iron|press/i.test(name)) return { icon: 'shirt-outline', color: C.teal };
    if (/bedsheet/i.test(name)) return { icon: 'bed-outline', color: C.indigo };
    return { icon: 'water-outline', color: C.sky };
  }
  return { icon: 'briefcase-outline', color: C.slate };
};

// ── Repairs: device -> issue ────────────────────────────────────────────────────────────────

export type DeviceKind = 'Phone' | 'Laptop' | 'Other';

export const DEVICES: { kind: DeviceKind; title: string; sub: string; icon: IconName }[] = [
  { kind: 'Phone', title: 'Mobile phone', sub: 'iPhone, Android', icon: 'phone-portrait-outline' },
  { kind: 'Laptop', title: 'Laptop', sub: 'Windows, Mac, Chromebook', icon: 'laptop-outline' },
  { kind: 'Other', title: 'Tablet or other device', sub: 'Tablet, earbuds, smartwatch', icon: 'tablet-portrait-outline' },
];

export interface RepairIssue {
  id: string;
  title: string;
  sub: string;
  icon: IconName;
  color: string;
  /** The catalogue item booked for this issue. */
  item: ServiceItem;
  /** Answers filled in from the device and issue (diagnosis: device + problem). */
  prefill: Answers;
  /** Field keys answered by the device / issue steps, hidden in the details step. */
  locked: string[];
}

interface IssueDef {
  id: string;
  title: string;
  sub: string;
  icon: IconName;
  color: string;
  /** Dedicated catalogue form for this issue (if the shop lists one). */
  formId?: string;
  /** Diagnosis problem ticked when there is no dedicated item. */
  problem: string;
}

const PHONE_ISSUES: IssueDef[] = [
  { id: 'screen', title: 'Screen damage', sub: 'Cracked glass, display or touch', icon: 'phone-portrait-outline', color: C.indigo, formId: 'repairs.phoneScreen', problem: 'Screen' },
  { id: 'battery', title: 'Battery issue', sub: 'Drains fast, not charging fully', icon: 'battery-half-outline', color: C.green, problem: 'Battery' },
  { id: 'charging', title: 'Charging problem', sub: 'Loose port, slow or no charging', icon: 'flash-outline', color: C.amber, problem: 'Charging' },
  { id: 'water', title: 'Water damage', sub: 'Liquid spill, not turning on', icon: 'water-outline', color: C.sky, problem: 'Water damage' },
  { id: 'software', title: 'Software issue', sub: 'Hangs, boot loop, update failed', icon: 'settings-outline', color: C.teal, problem: 'Slow or software issue' },
  { id: 'other', title: 'Other', sub: 'Describe your issue', icon: 'ellipsis-horizontal', color: C.slate, problem: 'Other' },
];

const LAPTOP_ISSUES: IssueDef[] = [
  { id: 'screen', title: 'Screen replacement', sub: 'Cracked, lines, flicker or no display', icon: 'laptop-outline', color: C.blue, formId: 'repairs.laptopScreen', problem: 'Screen' },
  { id: 'keyboard', title: 'Keyboard & trackpad', sub: 'Keys not working, sticky, liquid spill', icon: 'keypad-outline', color: C.orange, formId: 'repairs.keyboard', problem: 'Keyboard or trackpad' },
  { id: 'heat', title: 'Overheating & fan noise', sub: 'Gets hot, loud fan, shuts down', icon: 'thermometer-outline', color: C.red, formId: 'repairs.cleaning', problem: 'Overheating' },
  { id: 'storage', title: 'Slow laptop & SSD upgrade', sub: 'Faster storage, files moved over', icon: 'speedometer-outline', color: C.violet, formId: 'repairs.storage', problem: 'Slow or software issue' },
  { id: 'battery', title: 'Battery issue', sub: 'Drains fast, not holding charge', icon: 'battery-half-outline', color: C.green, problem: 'Battery' },
  { id: 'charging', title: 'Charging port', sub: 'Loose, slow or not charging', icon: 'flash-outline', color: C.amber, problem: 'Charging' },
  { id: 'software', title: 'Software & OS issue', sub: 'Slow, virus, Windows problems', icon: 'settings-outline', color: C.teal, problem: 'Slow or software issue' },
  { id: 'water', title: 'Water damage', sub: 'Liquid spill on the laptop', icon: 'water-outline', color: C.sky, problem: 'Water damage' },
  { id: 'other', title: 'Other', sub: 'Describe your issue', icon: 'ellipsis-horizontal', color: C.slate, problem: 'Other' },
];

const OTHER_ISSUES: IssueDef[] = [
  { id: 'screen', title: 'Screen or display', sub: 'Cracked, dead pixels, no display', icon: 'tablet-portrait-outline', color: C.blue, problem: 'Screen' },
  { id: 'battery', title: 'Battery issue', sub: 'Drains fast, swollen, not charging', icon: 'battery-half-outline', color: C.green, problem: 'Battery' },
  { id: 'charging', title: 'Charging problem', sub: 'Loose port or cable', icon: 'flash-outline', color: C.amber, problem: 'Charging' },
  { id: 'water', title: 'Water damage', sub: 'Liquid spill', icon: 'water-outline', color: C.sky, problem: 'Water damage' },
  { id: 'software', title: 'Software issue', sub: 'Hangs, pairing, updates', icon: 'settings-outline', color: C.teal, problem: 'Slow or software issue' },
  { id: 'other', title: 'Other', sub: 'Describe your issue', icon: 'ellipsis-horizontal', color: C.slate, problem: 'Other' },
];

const bookable = (i: ServiceItem) => i.inStock !== false;

/** The doorstep diagnosis / inspection item: the fallback for every issue without its own item. */
export const diagnosisItem = (items: ServiceItem[]): ServiceItem | null => {
  const diag = items.filter((i) => bookable(i) && resolveServiceForm('repairs', i.name).id === 'repairs.diagnosis');
  return diag.find((i) => /diagnos|inspect|check|pickup/i.test(i.name)) || diag[0] || null;
};

/** Issue rows for a device, each pointing at a real catalogue item. Issues with no bookable item are left out. */
export const repairIssues = (device: DeviceKind, items: ServiceItem[]): RepairIssue[] => {
  const defs = device === 'Phone' ? PHONE_ISSUES : device === 'Laptop' ? LAPTOP_ISSUES : OTHER_ISSUES;
  const diag = diagnosisItem(items);
  const byForm = (formId: string) => items.find((i) => bookable(i) && resolveServiceForm('repairs', i.name).id === formId) || null;
  const out: RepairIssue[] = [];
  for (const d of defs) {
    const own = d.formId ? byForm(d.formId) : null;
    if (own) {
      out.push({ id: d.id, title: d.title, sub: d.sub, icon: d.icon, color: d.color, item: own, prefill: {}, locked: [] });
    } else if (diag) {
      const prefill: Answers = { problems: [d.problem] };
      const locked: string[] = [];
      if (device !== 'Other') { prefill.device = device; locked.push('device'); } else prefill.device = 'Tablet';
      out.push({ id: d.id, title: d.title, sub: d.sub, icon: d.icon, color: d.color, item: diag, prefill, locked });
    }
  }
  // Repair items an admin added that have no issue of their own yet (they use the diagnosis form).
  const extra = items.filter((i) => bookable(i) && i.id !== diag?.id && resolveServiceForm('repairs', i.name).id === 'repairs.diagnosis');
  for (const i of extra) {
    const prefill: Answers = device !== 'Other' ? { device } : {};
    out.splice(Math.max(0, out.length - 1), 0, {
      id: `item-${i.id}`, title: i.name, sub: i.desc || 'Repair service', icon: 'construct-outline', color: C.slate,
      item: i, prefill, locked: device !== 'Other' ? ['device'] : [],
    });
  }
  return out;
};

/** Device implied by a dedicated repair item ("Laptop Screen Replacement" -> Laptop). */
export const deviceOfForm = (form: ServiceForm): DeviceKind | null => {
  const v = form.fixed?.find((f) => f.key === 'device')?.value;
  return v === 'Phone' || v === 'Laptop' ? v : null;
};

// ── Tailoring categories ────────────────────────────────────────────────────────────────────

export interface ServiceGroup { id: string; label: string; sub: string; icon: IconName; color: string; forms: string[] }

export const TAILOR_GROUPS: ServiceGroup[] = [
  { id: 'alterations', label: 'Alterations', sub: 'Length, fitting, taper', icon: 'resize-outline', color: C.blue, forms: ['tailoring.length', 'tailoring.fitting'] },
  { id: 'custom', label: 'Custom stitching', sub: 'Kurti, blouse, fest wear', icon: 'color-palette-outline', color: C.pink, forms: ['tailoring.stitchNew'] },
  { id: 'fixes', label: 'Repairs & fixes', sub: 'Buttons, seams, zippers', icon: 'construct-outline', color: C.orange, forms: ['tailoring.repair', 'tailoring.zipper'] },
  { id: 'labcoat', label: 'Lab coats', sub: 'Resize and name tags', icon: 'flask-outline', color: C.sky, forms: ['tailoring.labCoat'] },
  { id: 'measure', label: 'Measurement visit', sub: 'Tailor meets you at the hostel', icon: 'body-outline', color: C.teal, forms: ['tailoring.measurement'] },
  { id: 'other', label: 'Other work', sub: 'Anything else for the tailor', icon: 'cut-outline', color: C.slate, forms: ['tailoring.general'] },
];

export const groupItems = <T extends ServiceItem>(group: ServiceGroup, shelfId: string, items: T[]): T[] =>
  items.filter((i) => group.forms.includes(resolveServiceForm(shelfId, i.name).id));

// ── Which fields go on which step ───────────────────────────────────────────────────────────

/** Tailoring: how the tailor gets your size. Shown as "fit" cards on the measurement step. */
export const MEASURE_KEYS = ['measurements', 'fitting', 'lengthHow'];
/** Asked on the booking step (when it is needed), not the details step. */
const BOOKING_STEP_KEYS = ['neededBy'];

export const isBookingStepField = (family: ServiceFamily, key: string) =>
  BOOKING_STEP_KEYS.includes(key) || (family === 'tailoring' && MEASURE_KEYS.includes(key));

// ── Pickup / drop ───────────────────────────────────────────────────────────────────────────

export interface HandoverChoice { value: string; label: string; icon: IconName }

export const handoverFor = (family: ServiceFamily): { label: string; options: HandoverChoice[] } => {
  if (family === 'print') {
    return {
      label: 'Delivery',
      options: [
        { value: 'Deliver to my room', label: 'My room', icon: 'bed-outline' },
        { value: 'Meet at the hostel lobby', label: 'Hostel lobby', icon: 'business-outline' },
      ],
    };
  }
  return {
    label: family === 'repairs' ? 'Preferred pickup and drop' : 'Pickup and drop',
    options: [
      { value: 'Pickup from my room', label: 'My room', icon: 'bed-outline' },
      { value: 'Meet at the hostel lobby', label: 'Hostel lobby', icon: 'business-outline' },
    ],
  };
};

// ── Date and time chips (India time) ────────────────────────────────────────────────────────

export interface DayChip { key: string; top: string; bottom: string; long: string; offset: number }
export interface TimeChip { key: string; label: string; start: number }

const TIME_SLOTS: TimeChip[] = [
  { key: 'now', label: 'Within 2 hours', start: -1 },
  { key: '10', label: '10 AM – 12 PM', start: 10 },
  { key: '12', label: '12 – 2 PM', start: 12 },
  { key: '14', label: '2 – 4 PM', start: 14 },
  { key: '16', label: '4 – 6 PM', start: 16 },
  { key: '19', label: '7 – 9 PM', start: 19 },
];

/** Time slots still ahead of us on that day (a 4–6 PM slot is not offered at 5 PM, whatever the phone's zone). */
export const timeSlotsFor = (dayOffset: number, now = new Date()): TimeChip[] => {
  const h = istHour(now);
  if (dayOffset > 0) return TIME_SLOTS.filter((s) => s.start >= 0);
  return TIME_SLOTS.filter((s) => (s.start < 0 ? h >= 8 && h < 20 : h < s.start));
};

/** Today (if any slot is left) and the next days. */
export const dayChips = (count = 5, now = new Date()): DayChip[] => {
  const out: DayChip[] = [];
  for (let k = 0; k < count + 1 && out.length < count; k++) {
    if (k === 0 && timeSlotsFor(0, now).length === 0) continue;
    const at = new Date(now.getTime() + k * 86400000);
    const long = formatISTDate(at, { weekday: true }); // "Wed 22 Oct"
    const [wd, ...rest] = long.split(' ');
    out.push({ key: String(k), offset: k, top: k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : wd, bottom: rest.join(' '), long });
  }
  return out;
};

/** Stored as booking.pickupSlot (free text, max 100 on the server): "Thu 23 Oct, 10 AM – 12 PM". */
export const slotText = (day: DayChip, time: TimeChip) => (time.start < 0 ? `Within 2 hours (${day.long})` : `${day.long}, ${time.label}`);

// ── Short booking reference (same as Orders, Services) ──────────────────────────────────────

export const shortBookingRef = (id: unknown) => String(id || '').slice(-6).toUpperCase();
