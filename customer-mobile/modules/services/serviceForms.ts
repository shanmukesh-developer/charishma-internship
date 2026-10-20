/**
 * Per-service booking forms for the campus services shelves (app/category/[id].tsx).
 *
 * The services themselves (names, prices, which store) come from the DB catalogue; this file only
 * decides which questions a booking for a catalogue item asks. A form is picked by the shelf
 * (repairs / tailoring / print / laundry) and, inside it, by the item name (first `match` wins,
 * the shelf's last form is the fallback). A new item an admin adds therefore always gets a sensible
 * form for its shelf.
 *
 * What is sent (POST /api/services/book, backend routes/serviceRoutes.js):
 *   - description: one readable line per answer ("Brand and model: HP Pavilion 15"), shown to the
 *     partner / admin dashboard and in My Orders -> Services.
 *   - specifications.details: the same answers as [{ key, label, value }] (bounded server-side).
 *   - specifications.formId: which form below produced them.
 *   - the pricing keys the server multiplies (laundry quantity + unit, print pageCount / copies /
 *     printColor / printSides / bindingType) stay at the top level of specifications, as before.
 * Prices are always the server's; estimatePrice() only mirrors priceServiceBooking for the sheet.
 */

import { formatINR } from '../../utils/format';

export type ServiceCategory = 'repairs' | 'tailoring' | 'print' | 'laundry' | 'general';

export type AnswerValue = string | string[] | number;
export type Answers = Record<string, AnswerValue | undefined>;

export interface PrintRates {
  bw: number | null;
  color: number | null;
  spiral: number | null;
  hardbound: number | null;
}

/** What option hints / visibility rules can look at. */
export interface FormContext {
  itemName: string;
  itemPrice: number;
  rates: PrintRates;
}

export interface ChoiceOption {
  value: string;
  label: string;
  /** Short extra line on the chip, e.g. a per-page price from the catalogue. */
  hint?: (ctx: FormContext) => string | null;
  /** Hidden when this returns true (e.g. a binding the store does not offer). */
  hiddenIf?: (ctx: FormContext) => boolean;
  /** Choosing this option opens a text box (stored under `${field.key}Text`). */
  withText?: { label: string; placeholder: string; multiline?: boolean; errorText?: string };
}

interface FieldBase {
  key: string;
  label: string;
  helper?: string;
  required?: boolean;
  /** Only asked when this returns true (based on earlier answers). */
  showIf?: (a: Answers) => boolean;
  /** Label used in the summary sent to the partner, when it should differ from the question. */
  summaryLabel?: string;
  /** Shown under the field when a required answer is missing. */
  errorText?: string;
}

export interface ChoiceField extends FieldBase {
  kind: 'choice';
  options: ChoiceOption[];
  multiple?: boolean;
}

export interface TextField extends FieldBase {
  kind: 'text';
  placeholder: string;
  multiline?: boolean;
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}

/** Typed whole number (pages, copies): a text box, for ranges too big for a stepper. */
export interface NumberField extends FieldBase {
  kind: 'number';
  placeholder: string;
  min: number;
  max: number;
}

/** Small whole number with − / + buttons (pieces, kg, pairs). */
export interface CountField extends FieldBase {
  kind: 'count';
  min: number;
  max: number;
  /** Unit after the number, e.g. "kg", "pairs". */
  unitLabel?: (n: number) => string;
}

export type FormField = ChoiceField | TextField | NumberField | CountField;

export type PricingRule =
  | { kind: 'fixed' }
  /** Laundry and tailoring: card price × the count in `key` (the server multiplies, max 50). */
  | { kind: 'perUnit'; key: 'quantity' | 'pieces' }
  /** Print: per-page rate × pages × copies + binding. `ownRate`: the item's own price is the page rate (A3). */
  | { kind: 'print'; ownRate?: boolean };

export interface ServiceForm {
  id: string;
  category: ServiceCategory;
  /** Matched against the catalogue item name. Omitted on the shelf's fallback form. */
  match?: RegExp;
  /** Backend serviceType (VALID_SERVICE_TYPES); a function when it depends on the answers. */
  serviceType: string | ((a: Answers) => string);
  /** Facts implied by the item (e.g. "Device: Laptop"); added to the summary, not asked. */
  fixed?: { key: string; label: string; value: string }[];
  fields: FormField[];
  /** Photo upload, only where a photo helps the partner. null = no photo box. */
  photo: { label: string; helper: string; showIf?: (a: Answers) => boolean } | null;
  pricing: PricingRule;
  /** Label over the price in the sheet header. */
  priceLabel: string;
  /** One line under the price: what happens after booking. */
  howItWorks: string;
  slot: { label: string; helper: string };
  /** What the partner does at the slot, used in sentences ("before the visit"). */
  visitNoun: 'pickup' | 'visit' | 'delivery';
  /** Heading over the hostel block / room fields. */
  whereLabel: string;
  /** PDF upload (print only). Shown only when showIf passes. */
  document?: { label: string; helper: string; showIf?: (a: Answers) => boolean } | null;
  notes: { label: string; placeholder: string };
  /** Short neutral note at the end of the form (e.g. data backup for repairs). */
  notice?: string;
}

// ── Shared building blocks ───────────────────────────────────────────────────────────────────

const MAX_PIECES = 20;
export const MAX_SERVICE_QTY = 50; // keep in sync with backend routes/serviceRoutes.js MAX_SERVICE_QTY

const brandModel = (placeholder: string, helper?: string): TextField => ({
  kind: 'text',
  key: 'brandModel',
  label: 'Brand and model',
  errorText: 'Enter the brand and model.',
  placeholder,
  helper,
  required: true,
  maxLength: 80,
  autoCapitalize: 'words',
});

const pieces = (label = 'Number of pieces'): CountField => ({
  kind: 'count',
  key: 'pieces',
  label,
  summaryLabel: 'Pieces',
  min: 1,
  max: MAX_PIECES,
  helper: 'Priced per piece. The tailor confirms or adjusts the total at pickup.',
  unitLabel: (n) => (n === 1 ? 'piece' : 'pieces'),
});

const neededBy: ChoiceField = {
  kind: 'choice',
  key: 'neededBy',
  label: 'Needed by',
  options: [
    { value: 'No rush', label: 'No rush' },
    { value: 'Within 2 days', label: 'Within 2 days' },
    { value: 'Within a week', label: 'Within a week' },
    { value: 'By a date', label: 'By a date', withText: { label: 'Date', placeholder: 'e.g. 25 Oct, before the fest', errorText: 'Enter the date.' } },
  ],
};

const otherOption = (label: string, placeholder: string): ChoiceOption => ({
  value: 'Other',
  label: 'Other',
  withText: { label, placeholder, errorText: 'Fill this in, since you picked Other.' },
});

const REPAIR_HOW = 'The technician calls you, checks the device and confirms the price before any work.';
const REPAIR_SLOT = { label: 'Preferred visit time', helper: 'The technician comes to your room in this slot to check or collect the device.' };
const REPAIR_NOTES = { label: 'Anything else (optional)', placeholder: 'e.g. Charger is also faulty, call after 5 PM' };
const REPAIR_NOTICE = 'Back up your files before you hand over a device, if you can. Do not write your password or PIN in this form.';
const deviceServiceType = (device: string) => (device === 'Phone' ? 'PHONE_REPAIR' : device === 'Laptop' ? 'LAPTOP_REPAIR' : 'GENERAL');

const TAILOR_HOW = 'The tailor calls you, confirms the price, then collects the clothes. Pay in cash on delivery.';
const TAILOR_SLOT = { label: 'Pickup time', helper: 'The tailor collects the clothes from your room in this slot.' };
const TAILOR_NOTES = { label: 'Anything else (optional)', placeholder: 'e.g. Keep the original buttons' };

const LAUNDRY_HOW = 'The partner calls you, collects the clothes and confirms the final price at pickup.';
const LAUNDRY_SLOT = { label: 'Pickup time', helper: 'The partner collects from your room in this slot.' };

const PRINT_HOW = 'The print shop calls you, confirms the price, prints and delivers to your room. Pay on delivery.';
const PRINT_SLOT = { label: 'Delivery time', helper: 'The print shop delivers to your room in this slot. If you chose a pen drive, they collect it first.' };
const PRINT_NOTES = { label: 'Print instructions (optional)', placeholder: 'e.g. Print pages 1 to 20 only, staple each set' };

const rupees = (n: number | null) => (n == null ? null : formatRupees(n));

// ── Laundry quantity: what one unit of the catalogue item is ────────────────────────────────

export interface LaundryMeasure {
  /** Sent as specifications.unit (backend accepts 'kg' | 'pcs'). */
  unit: 'kg' | 'pcs';
  label: string;
  helper: string;
  /** Word after the number: "kg", "loads", "pairs". */
  word: (n: number) => string;
  /** For the summary: "3 kg (approx.)", "2 loads of 3 kg". */
  summary: (n: number) => string;
}

export const laundryMeasure = (name: string): LaundryMeasure => {
  const kgPack = name.match(/\(\s*(\d+(?:\.\d+)?)\s*kg\s*\)/i);
  const itemPack = name.match(/\(\s*(\d+)\s*(?:items?|pieces?|pcs)\s*\)/i);
  if (/per\s*kg/i.test(name) || (kgPack && Number(kgPack[1]) === 1)) {
    return {
      unit: 'kg',
      label: 'Approximate weight',
      helper: 'The partner weighs the clothes at pickup and confirms the final price.',
      word: () => 'kg',
      summary: (n) => `${n} kg (approx.)`,
    };
  }
  if (kgPack) {
    const kg = kgPack[1];
    return {
      unit: 'pcs',
      label: 'Number of loads',
      helper: `One load is up to ${kg} kg of clothes. The partner weighs them at pickup.`,
      word: (n) => (n === 1 ? 'load' : 'loads'),
      summary: (n) => `${n} ${n === 1 ? 'load' : 'loads'} of ${kg} kg`,
    };
  }
  if (itemPack) {
    const size = itemPack[1];
    return {
      unit: 'pcs',
      label: 'Number of sets',
      helper: `One set is ${size} items. The partner counts them at pickup.`,
      word: (n) => (n === 1 ? 'set' : 'sets'),
      summary: (n) => `${n} ${n === 1 ? 'set' : 'sets'} of ${size} items`,
    };
  }
  if (/pair|shoe|sneaker/i.test(name)) {
    return {
      unit: 'pcs',
      label: 'Number of pairs',
      helper: 'The partner checks the shoes at pickup.',
      word: (n) => (n === 1 ? 'pair' : 'pairs'),
      summary: (n) => `${n} ${n === 1 ? 'pair' : 'pairs'}`,
    };
  }
  return {
    unit: 'pcs',
    label: 'Number of pieces',
    helper: 'The partner counts them at pickup.',
    word: (n) => (n === 1 ? 'piece' : 'pieces'),
    summary: (n) => `${n} ${n === 1 ? 'piece' : 'pieces'}`,
  };
};

// The quantity field's label / unit depend on the item, so it is built when the form is resolved.
const QUANTITY_KEY = 'quantity';
const quantityField = (): CountField => ({ kind: 'count', key: QUANTITY_KEY, label: 'Quantity', min: 1, max: MAX_SERVICE_QTY, required: true });

// ── Print fields ────────────────────────────────────────────────────────────────────────────

const printFields = (opts: { colour: boolean }): FormField[] => [
  { kind: 'number', key: 'pageCount', label: 'Pages in the file', placeholder: 'e.g. 24', min: 1, max: 5000, required: true, summaryLabel: 'Pages', errorText: 'Enter the number of pages.' },
  { kind: 'number', key: 'copies', label: 'Copies', placeholder: 'e.g. 1', min: 1, max: 500, required: true, helper: 'Number of full sets of the file.', errorText: 'Enter the number of copies.' },
  ...(opts.colour ? [{
    kind: 'choice',
    key: 'printColor',
    label: 'Print',
    summaryLabel: 'Print',
    required: true,
    options: [
      { value: 'bw', label: 'Black and white', hint: (c: FormContext) => (c.rates.bw != null ? `${rupees(c.rates.bw)} per page` : null) },
      { value: 'color', label: 'Colour', hint: (c: FormContext) => (c.rates.color != null ? `${rupees(c.rates.color)} per page` : null) },
    ],
  } as ChoiceField] : []),
  {
    kind: 'choice',
    key: 'printSides',
    label: 'Sides',
    required: true,
    options: [
      { value: 'single', label: 'Single-sided' },
      { value: 'double', label: 'Double-sided' },
    ],
  },
  {
    kind: 'choice',
    key: 'bindingType',
    label: 'Binding',
    required: true,
    options: [
      { value: 'none', label: 'No binding' },
      { value: 'spiral', label: 'Spiral', hint: (c) => (c.rates.spiral != null ? `+ ${rupees(c.rates.spiral)}` : null), hiddenIf: (c) => c.rates.spiral == null },
      { value: 'hardbound', label: 'Hardbound', hint: (c) => (c.rates.hardbound != null ? `+ ${rupees(c.rates.hardbound)}` : null), hiddenIf: (c) => c.rates.hardbound == null },
    ],
  },
  {
    kind: 'choice',
    key: 'fileHandover',
    label: 'How will you share the file?',
    summaryLabel: 'File',
    required: true,
    options: [
      { value: 'PDF attached', label: 'Attach the PDF' },
      { value: 'Photo attached', label: 'Attach a photo' },
      { value: 'Pen drive at pickup', label: 'Pen drive at pickup' },
      { value: 'Will send it when the partner calls', label: 'Send it when the partner calls' },
    ],
  },
];

const PRINT_PHOTO = { label: 'Photo of the page', helper: 'For a one-page print, or a page you want copied.', showIf: (a: Answers) => a.fileHandover === 'Photo attached' };
const PRINT_DOC = { label: 'PDF file', helper: 'Up to 5 MB. For a larger file, use a pen drive or send it when the print shop calls.', showIf: (a: Answers) => a.fileHandover === 'PDF attached' };

// ── The forms ───────────────────────────────────────────────────────────────────────────────

const FORMS: ServiceForm[] = [
  // Repairs ─────────────────────────────────────────────────────────────────────────────────
  {
    id: 'repairs.laptopScreen',
    category: 'repairs',
    match: /laptop.*(screen|display|panel)|(screen|display|panel).*laptop/i,
    serviceType: 'LAPTOP_REPAIR',
    fixed: [{ key: 'device', label: 'Device', value: 'Laptop' }],
    fields: [
      brandModel('e.g. HP Pavilion 15 eg1000', 'The exact model is on the sticker under the laptop.'),
      {
        kind: 'choice', key: 'screenIssue', label: 'What is wrong with the screen?', summaryLabel: 'Screen', required: true,
        options: [
          { value: 'Cracked', label: 'Cracked' },
          { value: 'Lines or flicker', label: 'Lines or flicker' },
          { value: 'Black screen', label: 'Black screen' },
          otherOption('Describe the problem', 'e.g. Dark patch in one corner'),
        ],
      },
    ],
    photo: { label: 'Photo of the screen (optional)', helper: 'Helps the technician bring the right panel.' },
    pricing: { kind: 'fixed' },
    priceLabel: 'Starting price',
    howItWorks: REPAIR_HOW,
    slot: REPAIR_SLOT,
    visitNoun: 'visit',
    whereLabel: 'Where should the technician collect the device?',
    notes: REPAIR_NOTES,
    notice: REPAIR_NOTICE,
  },
  {
    id: 'repairs.phoneScreen',
    category: 'repairs',
    match: /mobile|phone|iphone|display|glass/i,
    serviceType: 'PHONE_REPAIR',
    fixed: [{ key: 'device', label: 'Device', value: 'Phone' }],
    fields: [
      brandModel('e.g. iPhone 13 or Redmi Note 12 Pro', 'Find it in Settings, About phone.'),
      {
        kind: 'choice', key: 'problems', label: 'What is wrong?', summaryLabel: 'Problem', required: true, multiple: true,
        options: [
          { value: 'Glass cracked', label: 'Glass cracked' },
          { value: 'Display not working', label: 'Display not working' },
          { value: 'Touch not working', label: 'Touch not working' },
          { value: 'Lines or spots', label: 'Lines or spots' },
        ],
      },
    ],
    photo: { label: 'Photo of the screen (optional)', helper: 'Helps the technician bring the right part.' },
    pricing: { kind: 'fixed' },
    priceLabel: 'Starting price',
    howItWorks: REPAIR_HOW,
    slot: REPAIR_SLOT,
    visitNoun: 'visit',
    whereLabel: 'Where should the technician collect the device?',
    notes: REPAIR_NOTES,
    notice: REPAIR_NOTICE,
  },
  {
    id: 'repairs.keyboard',
    category: 'repairs',
    match: /keyboard|trackpad|touchpad/i,
    serviceType: 'LAPTOP_REPAIR',
    fixed: [{ key: 'device', label: 'Device', value: 'Laptop' }],
    fields: [
      brandModel('e.g. Lenovo IdeaPad Slim 3'),
      {
        kind: 'choice', key: 'problems', label: 'What is wrong?', summaryLabel: 'Problem', required: true, multiple: true,
        options: [
          { value: 'Some keys do not work', label: 'Some keys do not work' },
          { value: 'Keys are sticky', label: 'Keys are sticky' },
          { value: 'Trackpad does not work', label: 'Trackpad does not work' },
          { value: 'Liquid spilled', label: 'Liquid spilled' },
        ],
      },
      { kind: 'text', key: 'keys', label: 'Which keys? (optional)', placeholder: 'e.g. Space bar and the A key', maxLength: 120 },
    ],
    photo: { label: 'Photo of the keyboard (optional)', helper: 'Useful after a spill or for broken keycaps.' },
    pricing: { kind: 'fixed' },
    priceLabel: 'Starting price',
    howItWorks: REPAIR_HOW,
    slot: REPAIR_SLOT,
    visitNoun: 'visit',
    whereLabel: 'Where should the technician collect the device?',
    notes: REPAIR_NOTES,
    notice: REPAIR_NOTICE,
  },
  {
    id: 'repairs.cleaning',
    category: 'repairs',
    match: /clean|thermal|overheat|fan/i,
    serviceType: 'LAPTOP_REPAIR',
    fixed: [{ key: 'device', label: 'Device', value: 'Laptop' }],
    fields: [
      brandModel('e.g. ASUS TUF Gaming F15'),
      {
        kind: 'choice', key: 'symptoms', label: 'What do you notice? (optional)', summaryLabel: 'Symptoms', multiple: true,
        options: [
          { value: 'Gets very hot', label: 'Gets very hot' },
          { value: 'Fan is loud', label: 'Fan is loud' },
          { value: 'Slow', label: 'Slow' },
          { value: 'Shuts down by itself', label: 'Shuts down by itself' },
        ],
      },
    ],
    photo: null,
    pricing: { kind: 'fixed' },
    priceLabel: 'Starting price',
    howItWorks: REPAIR_HOW,
    slot: REPAIR_SLOT,
    visitNoun: 'visit',
    whereLabel: 'Where should the technician collect the device?',
    notes: REPAIR_NOTES,
    notice: REPAIR_NOTICE,
  },
  {
    id: 'repairs.storage',
    category: 'repairs',
    match: /ssd|hdd|storage|upgrade|migration/i,
    serviceType: 'LAPTOP_REPAIR',
    fixed: [{ key: 'device', label: 'Device', value: 'Laptop' }],
    fields: [
      brandModel('e.g. Dell Inspiron 15 3520'),
      {
        kind: 'choice', key: 'currentDrive', label: 'Current storage (optional)', summaryLabel: 'Current storage',
        options: [
          { value: 'Hard disk (HDD)', label: 'Hard disk (HDD)' },
          { value: 'SSD', label: 'SSD' },
          { value: 'Not sure', label: 'Not sure' },
        ],
      },
      {
        kind: 'choice', key: 'files', label: 'Your files and apps', summaryLabel: 'Files', required: true,
        options: [
          { value: 'Move them to the new SSD', label: 'Move them to the new SSD' },
          { value: 'Fresh start, no files', label: 'Fresh start, no files' },
        ],
      },
    ],
    photo: null,
    pricing: { kind: 'fixed' },
    priceLabel: 'Starting price',
    howItWorks: REPAIR_HOW,
    slot: REPAIR_SLOT,
    visitNoun: 'visit',
    whereLabel: 'Where should the technician collect the device?',
    notes: REPAIR_NOTES,
    notice: REPAIR_NOTICE,
  },
  {
    // Diagnosis visit, and the fallback for any other repair item.
    id: 'repairs.diagnosis',
    category: 'repairs',
    serviceType: (a) => deviceServiceType(String(a.device || '')),
    fields: [
      {
        kind: 'choice', key: 'device', label: 'Device', required: true,
        options: [
          { value: 'Laptop', label: 'Laptop' },
          { value: 'Phone', label: 'Phone' },
          { value: 'Tablet', label: 'Tablet' },
          otherOption('Which device?', 'e.g. Earbuds, smartwatch, monitor'),
        ],
      },
      brandModel('e.g. HP Pavilion 15 or Redmi Note 12'),
      {
        kind: 'choice', key: 'problems', label: 'What is wrong?', summaryLabel: 'Problem', required: true, multiple: true,
        options: [
          { value: 'Screen', label: 'Screen' },
          { value: 'Battery', label: 'Battery' },
          { value: 'Charging', label: 'Charging' },
          { value: 'Keyboard or trackpad', label: 'Keyboard or trackpad' },
          { value: 'Slow or software issue', label: 'Slow or software issue' },
          { value: 'Water damage', label: 'Water damage' },
          { value: 'Overheating', label: 'Overheating' },
          { value: 'Other', label: 'Other' },
        ],
      },
      {
        kind: 'text', key: 'issue', label: 'Describe the problem', summaryLabel: 'Details', multiline: true, maxLength: 300,
        placeholder: 'e.g. Turns off at 20% battery since last week',
        helper: 'Required when you pick Other.',
      },
    ],
    photo: { label: 'Photo of the damage or error screen (optional)', helper: 'Useful for a cracked screen, an error message, dents or liquid marks.' },
    pricing: { kind: 'fixed' },
    priceLabel: 'Inspection charge',
    howItWorks: 'The technician checks the device in your room and quotes the repair before doing any work.',
    slot: REPAIR_SLOT,
    visitNoun: 'visit',
    whereLabel: 'Where should the technician collect the device?',
    notes: REPAIR_NOTES,
    notice: REPAIR_NOTICE,
  },

  // Tailoring ───────────────────────────────────────────────────────────────────────────────
  {
    id: 'tailoring.labCoat',
    category: 'tailoring',
    match: /lab\s*coat|name\s*tag|badge/i,
    serviceType: 'TAILORING',
    fixed: [{ key: 'garment', label: 'Garment', value: 'Lab coat' }],
    fields: [
      {
        kind: 'choice', key: 'work', label: 'What do you need?', summaryLabel: 'Work', required: true, multiple: true,
        options: [
          { value: 'Shorten sleeves', label: 'Shorten sleeves' },
          { value: 'Resize the fit', label: 'Resize the fit' },
          { value: 'Stitch a name tag', label: 'Stitch a name tag' },
        ],
      },
      {
        kind: 'text', key: 'tagText', label: 'Name and department for the tag', summaryLabel: 'Name tag', required: true, errorText: 'Enter the name for the tag.',
        placeholder: 'e.g. A. Sharma, ECE', maxLength: 60, autoCapitalize: 'words',
        showIf: (a) => Array.isArray(a.work) && a.work.includes('Stitch a name tag'),
      },
      pieces('Number of lab coats'),
      neededBy,
    ],
    photo: null,
    pricing: { kind: 'perUnit', key: 'pieces' },
    priceLabel: 'Estimate',
    howItWorks: TAILOR_HOW,
    slot: TAILOR_SLOT,
    visitNoun: 'pickup',
    whereLabel: 'Pickup address',
    notes: TAILOR_NOTES,
  },
  {
    id: 'tailoring.measurement',
    category: 'tailoring',
    match: /measure/i,
    serviceType: 'TAILORING',
    fields: [
      {
        kind: 'text', key: 'garments', label: 'What do you want stitched or altered?', summaryLabel: 'Clothes', required: true, multiline: true, errorText: 'List the clothes.',
        placeholder: 'e.g. 2 formal shirts, 1 kurti', maxLength: 200,
      },
      neededBy,
    ],
    photo: { label: 'Reference photo (optional)', helper: 'A design you like, so the tailor can plan the fitting.' },
    pricing: { kind: 'fixed' },
    priceLabel: 'Visit charge',
    howItWorks: 'The tailor takes your measurements, collects the clothes and confirms the price.',
    slot: { label: 'Measurement time', helper: 'The tailor meets you at your hostel in this slot.' },
    visitNoun: 'visit',
    whereLabel: 'Where should the tailor meet you?',
    notes: TAILOR_NOTES,
  },
  {
    id: 'tailoring.length',
    category: 'tailoring',
    match: /length|jeans|trouser|\bpants?\b|\bhem/i,
    serviceType: 'TAILORING',
    fields: [
      {
        kind: 'choice', key: 'garment', label: 'Garment', required: true,
        options: [
          { value: 'Jeans', label: 'Jeans' },
          { value: 'Formal trousers', label: 'Formal trousers' },
          otherOption('Which garment?', 'e.g. Track pants'),
        ],
      },
      {
        kind: 'choice', key: 'lengthHow', label: 'How should the tailor get the length?', summaryLabel: 'Length', required: true,
        options: [
          { value: 'Mark it at pickup', label: 'Mark it at pickup' },
          { value: 'Match a pair that fits me', label: 'Match a pair that fits me' },
          { value: 'I will give the length', label: 'I will give the length', withText: { label: 'Length', placeholder: 'e.g. Shorten by 2 inches, or inseam 30 in', errorText: 'Enter the length.' } },
        ],
      },
      pieces('Number of pairs'),
      neededBy,
    ],
    photo: null,
    pricing: { kind: 'perUnit', key: 'pieces' },
    priceLabel: 'Estimate',
    howItWorks: TAILOR_HOW,
    slot: TAILOR_SLOT,
    visitNoun: 'pickup',
    whereLabel: 'Pickup address',
    notes: TAILOR_NOTES,
  },
  {
    id: 'tailoring.zipper',
    category: 'tailoring',
    match: /zip/i,
    serviceType: 'TAILORING',
    fields: [
      {
        kind: 'choice', key: 'garment', label: 'Garment', required: true,
        options: [
          { value: 'Hoodie', label: 'Hoodie' },
          { value: 'Jacket', label: 'Jacket' },
          { value: 'Jeans or trousers', label: 'Jeans or trousers' },
          { value: 'Bag', label: 'Bag' },
          otherOption('Which item?', 'e.g. Pencil pouch'),
        ],
      },
      pieces(),
      neededBy,
    ],
    photo: { label: 'Photo of the zipper (optional)', helper: 'Helps the tailor bring a zipper of the right size.' },
    pricing: { kind: 'perUnit', key: 'pieces' },
    priceLabel: 'Estimate',
    howItWorks: TAILOR_HOW,
    slot: TAILOR_SLOT,
    visitNoun: 'pickup',
    whereLabel: 'Pickup address',
    notes: TAILOR_NOTES,
  },
  {
    id: 'tailoring.stitchNew',
    category: 'tailoring',
    match: /stitching|custom|tailor[- ]?made/i,
    serviceType: 'TAILORING',
    fields: [
      {
        kind: 'choice', key: 'garment', label: 'Garment', required: true,
        options: [
          { value: 'Kurti', label: 'Kurti' },
          { value: 'Blouse', label: 'Blouse' },
          otherOption('Which garment?', 'e.g. Salwar'),
        ],
      },
      {
        kind: 'choice', key: 'fabric', label: 'Fabric', required: true,
        helper: 'If the tailor provides the fabric, they confirm its price when they call.',
        options: [
          { value: 'I have the fabric', label: 'I have the fabric' },
          { value: 'Tailor provides fabric', label: 'Tailor provides fabric' },
          { value: 'Discuss with the tailor', label: 'Discuss with the tailor' },
        ],
      },
      {
        kind: 'choice', key: 'measurements', label: 'Measurements', required: true,
        options: [
          { value: 'Measure me at pickup', label: 'Measure me at pickup' },
          { value: 'Copy a garment that fits me', label: 'Copy a garment that fits me' },
          { value: 'I will type them', label: 'I will type them', withText: { label: 'Your measurements', placeholder: 'e.g. Bust 34, waist 30, length 40 (inches)', multiline: true, errorText: 'Enter your measurements.' } },
        ],
      },
      { kind: 'text', key: 'design', label: 'Design details (optional)', summaryLabel: 'Design', multiline: true, maxLength: 200, placeholder: 'e.g. Boat neck, elbow sleeves, side zip' },
      pieces(),
      neededBy,
    ],
    photo: { label: 'Reference photo of the design (optional)', helper: 'A photo of a design you like helps the tailor match it.' },
    pricing: { kind: 'perUnit', key: 'pieces' },
    priceLabel: 'Estimate',
    howItWorks: TAILOR_HOW,
    slot: TAILOR_SLOT,
    visitNoun: 'pickup',
    whereLabel: 'Pickup address',
    notes: TAILOR_NOTES,
  },
  {
    id: 'tailoring.fitting',
    category: 'tailoring',
    match: /fit|alter|taper|resiz/i,
    serviceType: 'TAILORING',
    fields: [
      {
        kind: 'choice', key: 'garment', label: 'Garment', required: true,
        options: [
          { value: 'Shirt', label: 'Shirt' },
          { value: 'Kurti', label: 'Kurti' },
          otherOption('Which garment?', 'e.g. Blazer'),
        ],
      },
      {
        kind: 'choice', key: 'changes', label: 'What should change?', summaryLabel: 'Changes', required: true, multiple: true,
        options: [
          { value: 'Take in the sides', label: 'Take in the sides' },
          { value: 'Chest', label: 'Chest' },
          { value: 'Sleeve length', label: 'Sleeve length' },
          { value: 'Overall length', label: 'Overall length' },
        ],
      },
      {
        kind: 'choice', key: 'fitting', label: 'Fitting', required: true,
        options: [
          { value: 'Measure me at pickup', label: 'Measure me at pickup' },
          { value: 'Match a garment that fits me', label: 'Match a garment that fits me' },
        ],
      },
      pieces(),
      neededBy,
    ],
    photo: null,
    pricing: { kind: 'perUnit', key: 'pieces' },
    priceLabel: 'Estimate',
    howItWorks: TAILOR_HOW,
    slot: TAILOR_SLOT,
    visitNoun: 'pickup',
    whereLabel: 'Pickup address',
    notes: TAILOR_NOTES,
  },
  {
    id: 'tailoring.repair',
    category: 'tailoring',
    match: /button|seam|repair|tear|patch/i,
    serviceType: 'TAILORING',
    fields: [
      {
        kind: 'choice', key: 'garment', label: 'Garment', required: true,
        options: [
          { value: 'Shirt', label: 'Shirt' },
          { value: 'Trousers or jeans', label: 'Trousers or jeans' },
          { value: 'Kurti', label: 'Kurti' },
          otherOption('Which garment?', 'e.g. Blazer'),
        ],
      },
      {
        kind: 'choice', key: 'fix', label: 'What needs fixing?', summaryLabel: 'Fix', required: true, multiple: true,
        options: [
          { value: 'Button', label: 'Button' },
          { value: 'Seam or tear', label: 'Seam or tear' },
          { value: 'Pocket', label: 'Pocket' },
          { value: 'Belt loop', label: 'Belt loop' },
        ],
      },
      pieces(),
      neededBy,
    ],
    photo: { label: 'Photo of the tear or missing button (optional)', helper: 'Helps the tailor bring matching thread or buttons.' },
    pricing: { kind: 'perUnit', key: 'pieces' },
    priceLabel: 'Estimate',
    howItWorks: TAILOR_HOW,
    slot: TAILOR_SLOT,
    visitNoun: 'pickup',
    whereLabel: 'Pickup address',
    notes: TAILOR_NOTES,
  },
  {
    id: 'tailoring.general',
    category: 'tailoring',
    serviceType: 'TAILORING',
    fields: [
      { kind: 'text', key: 'garment', label: 'Garment', required: true, errorText: 'Enter the garment.', placeholder: 'e.g. Shirt, kurti, jacket', maxLength: 80 },
      { kind: 'text', key: 'work', label: 'What should the tailor do?', summaryLabel: 'Work', required: true, errorText: 'Describe what the tailor should do.', multiline: true, maxLength: 300, placeholder: 'e.g. Shorten the sleeves by 1 inch' },
      pieces(),
      neededBy,
    ],
    photo: { label: 'Reference photo (optional)', helper: 'Shows the tailor what you need.' },
    pricing: { kind: 'perUnit', key: 'pieces' },
    priceLabel: 'Estimate',
    howItWorks: TAILOR_HOW,
    slot: TAILOR_SLOT,
    visitNoun: 'pickup',
    whereLabel: 'Pickup address',
    notes: TAILOR_NOTES,
  },

  // Print ───────────────────────────────────────────────────────────────────────────────────
  {
    id: 'print.a3',
    category: 'print',
    match: /\ba3\b|engineering|drawing|cad|blueprint/i,
    serviceType: 'PRINTOUT',
    fixed: [{ key: 'paper', label: 'Paper', value: 'A3' }],
    fields: printFields({ colour: false }),
    photo: PRINT_PHOTO,
    document: PRINT_DOC,
    pricing: { kind: 'print', ownRate: true },
    priceLabel: 'Estimate',
    howItWorks: PRINT_HOW,
    slot: PRINT_SLOT,
    visitNoun: 'delivery',
    whereLabel: 'Where should we deliver the printouts?',
    notes: PRINT_NOTES,
  },
  {
    id: 'print.document',
    category: 'print',
    serviceType: 'PRINTOUT',
    fields: printFields({ colour: true }),
    photo: PRINT_PHOTO,
    document: PRINT_DOC,
    pricing: { kind: 'print' },
    priceLabel: 'Estimate',
    howItWorks: PRINT_HOW,
    slot: PRINT_SLOT,
    visitNoun: 'delivery',
    whereLabel: 'Where should we deliver the printouts?',
    notes: PRINT_NOTES,
  },

  // Laundry ─────────────────────────────────────────────────────────────────────────────────
  {
    id: 'laundry.dryClean',
    category: 'laundry',
    match: /dry\s*clean/i,
    serviceType: 'LAUNDRY',
    fields: [
      quantityField(),
      {
        kind: 'choice', key: 'garments', label: 'Garments', required: true, multiple: true,
        options: [
          { value: 'Suit or blazer', label: 'Suit or blazer' },
          { value: 'Jacket or coat', label: 'Jacket or coat' },
          { value: 'Saree', label: 'Saree' },
          { value: 'Sweater', label: 'Sweater' },
          otherOption('Which garments?', 'e.g. Silk kurta'),
        ],
      },
      { kind: 'text', key: 'stains', label: 'Stains to point out (optional)', summaryLabel: 'Stains', maxLength: 150, placeholder: 'e.g. Ink on the left cuff' },
    ],
    photo: { label: 'Photo of the stain (optional)', helper: 'Lets the partner check the stain before pickup.' },
    pricing: { kind: 'perUnit', key: 'quantity' },
    priceLabel: 'Estimate',
    howItWorks: LAUNDRY_HOW,
    slot: LAUNDRY_SLOT,
    visitNoun: 'pickup',
    whereLabel: 'Pickup address',
    notes: { label: 'Anything else (optional)', placeholder: 'e.g. Hang the blazer, do not fold' },
  },
  {
    id: 'laundry.shoes',
    category: 'laundry',
    match: /shoe|sneaker/i,
    serviceType: 'LAUNDRY',
    fields: [
      quantityField(),
      {
        kind: 'choice', key: 'shoeType', label: 'Type of shoes (optional)', summaryLabel: 'Shoes',
        options: [
          { value: 'Sneakers', label: 'Sneakers' },
          { value: 'Sports shoes', label: 'Sports shoes' },
          { value: 'Canvas shoes', label: 'Canvas shoes' },
          { value: 'Formal shoes', label: 'Formal shoes' },
        ],
      },
    ],
    photo: { label: 'Photo of the shoes (optional)', helper: 'Shows the partner the stains before pickup.' },
    pricing: { kind: 'perUnit', key: 'quantity' },
    priceLabel: 'Estimate',
    howItWorks: LAUNDRY_HOW,
    slot: LAUNDRY_SLOT,
    visitNoun: 'pickup',
    whereLabel: 'Pickup address',
    notes: { label: 'Anything else (optional)', placeholder: 'e.g. White soles, suede on the sides' },
  },
  {
    id: 'laundry.blanket',
    category: 'laundry',
    match: /blanket|quilt|comforter|duvet/i,
    serviceType: 'LAUNDRY',
    fields: [
      quantityField(),
      {
        kind: 'choice', key: 'beddingType', label: 'Item', required: true,
        options: [
          { value: 'Blanket', label: 'Blanket' },
          { value: 'Quilt', label: 'Quilt' },
          { value: 'Comforter', label: 'Comforter' },
        ],
      },
      {
        kind: 'choice', key: 'size', label: 'Size (optional)', summaryLabel: 'Size',
        options: [
          { value: 'Single', label: 'Single' },
          { value: 'Double', label: 'Double' },
        ],
      },
    ],
    photo: null,
    pricing: { kind: 'perUnit', key: 'quantity' },
    priceLabel: 'Estimate',
    howItWorks: LAUNDRY_HOW,
    slot: LAUNDRY_SLOT,
    visitNoun: 'pickup',
    whereLabel: 'Pickup address',
    notes: { label: 'Anything else (optional)', placeholder: 'e.g. Mild detergent only' },
  },
  {
    id: 'laundry.wash',
    category: 'laundry',
    serviceType: 'LAUNDRY',
    fields: [
      quantityField(),
      {
        kind: 'number', key: 'clothesCount', label: 'Number of clothes (optional)', summaryLabel: 'Clothes', placeholder: 'e.g. 12', min: 1, max: 200,
        helper: 'Helps the partner check the count at pickup.',
      },
    ],
    photo: null,
    pricing: { kind: 'perUnit', key: 'quantity' },
    priceLabel: 'Estimate',
    howItWorks: LAUNDRY_HOW,
    slot: LAUNDRY_SLOT,
    visitNoun: 'pickup',
    whereLabel: 'Pickup address',
    notes: { label: 'Anything else (optional)', placeholder: 'e.g. Wash the white shirts separately' },
  },

  // Any other booking-only item (outside the four service shelves) ──────────────────────────
  {
    id: 'general',
    category: 'general',
    serviceType: 'GENERAL',
    fields: [
      { kind: 'text', key: 'request', label: 'What do you need?', summaryLabel: 'Request', required: true, errorText: 'Describe what you need.', multiline: true, maxLength: 300, placeholder: 'Describe the job in a line or two' },
    ],
    photo: { label: 'Photo (optional)', helper: 'Add one if it helps the partner understand the job.' },
    pricing: { kind: 'fixed' },
    priceLabel: 'Starting price',
    howItWorks: 'The partner calls you and confirms the price before starting. Pay in cash when the job is done.',
    slot: { label: 'Preferred time', helper: 'The partner comes to you in this slot.' },
    visitNoun: 'visit',
    whereLabel: 'Where should the partner come?',
    notes: { label: 'Anything else (optional)', placeholder: 'e.g. Call before coming' },
  },
];

export const SERVICE_FORMS: readonly ServiceForm[] = FORMS;

const SHELF_CATEGORY: Record<string, ServiceCategory> = { repairs: 'repairs', tailoring: 'tailoring', print: 'print', laundry: 'laundry' };

/**
 * The form for one catalogue item on one shelf. Laundry forms get their quantity label from the
 * item ("per kg" -> weight in kg, "(3kg)" -> loads, "(pair)" -> pairs).
 */
export const resolveServiceForm = (shelfId: string, itemName: string): ServiceForm => {
  const category = SHELF_CATEGORY[shelfId] || 'general';
  const candidates = FORMS.filter((f) => f.category === category);
  const form = candidates.find((f) => f.match && f.match.test(itemName))
    || candidates.find((f) => !f.match)
    || FORMS[FORMS.length - 1];
  if (form.pricing.kind !== 'perUnit' || form.category !== 'laundry') return form;
  const m = laundryMeasure(itemName);
  return {
    ...form,
    fields: form.fields.map((f) => (f.key === QUANTITY_KEY && f.kind === 'count'
      ? { ...f, label: m.label, helper: m.helper, unitLabel: m.word }
      : f)),
  };
};

/** First answers when the sheet opens (print colour / binding follow the item that was tapped). */
export const initialAnswers = (form: ServiceForm, itemName: string): Answers => {
  const a: Answers = {};
  for (const f of form.fields) {
    if (f.kind === 'count') a[f.key] = f.min;
  }
  if (form.pricing.kind === 'print') {
    a.pageCount = ''; // the student must enter it; the estimate uses 1 page until then
    a.copies = '1';
    a.printSides = 'single';
    a.printColor = /colou?r/i.test(itemName) ? 'color' : 'bw';
    a.bindingType = /spiral/i.test(itemName) ? 'spiral' : /thesis|hard\s*bound/i.test(itemName) ? 'hardbound' : 'none';
  }
  return a;
};

export const textKey = (fieldKey: string) => `${fieldKey}Text`;

export const isFieldVisible = (f: FormField, a: Answers) => !f.showIf || f.showIf(a);

const asList = (v: AnswerValue | undefined): string[] => (Array.isArray(v) ? v : v === undefined || v === '' ? [] : [String(v)]);

const intOf = (v: AnswerValue | undefined): number | null => {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : null;
};

/** Error message per field key ('' / missing = fine). `photoAttached` checks the print "photo" choice. */
export interface AttachedFiles { photo: boolean; pdf: boolean }

export const validateAnswers = (form: ServiceForm, a: Answers, ctx: FormContext, attached: AttachedFiles): Record<string, string> => {
  const errors: Record<string, string> = {};
  for (const f of form.fields) {
    if (!isFieldVisible(f, a)) continue;
    const v = a[f.key];
    if (f.kind === 'choice') {
      const visibleValues = f.options.filter((o) => !(o.hiddenIf && o.hiddenIf(ctx))).map((o) => o.value);
      const picked = asList(v).filter((x) => visibleValues.includes(x));
      if (f.required && picked.length === 0) {
        errors[f.key] = f.errorText || (f.multiple ? 'Pick at least one.' : 'Pick one.');
        continue;
      }
      const withText = f.options.find((o) => o.withText && picked.includes(o.value));
      if (withText && !String(a[textKey(f.key)] || '').trim()) {
        errors[textKey(f.key)] = withText.withText!.errorText || 'Fill this in.';
      }
      if (f.key === 'fileHandover' && picked.includes('Photo attached') && !attached.photo) {
        errors[f.key] = 'Add the photo below, or pick another way to share the file.';
      }
      if (f.key === 'fileHandover' && picked.includes('PDF attached') && !attached.pdf) {
        errors[f.key] = 'Add the PDF below, or pick another way to share the file.';
      }
    } else if (f.kind === 'text') {
      const t = String(v ?? '').trim();
      const otherNeedsText = form.id === 'repairs.diagnosis' && f.key === 'issue' && asList(a.problems).includes('Other');
      if ((f.required || otherNeedsText) && t.length < 2) {
        errors[f.key] = otherNeedsText ? 'Describe the problem, since you picked Other.' : (f.errorText || 'Fill this in.');
      }
    } else if (f.kind === 'number') {
      const raw = String(v ?? '').trim();
      if (!raw) {
        if (f.required) errors[f.key] = f.errorText || 'Enter a number.';
        continue;
      }
      const n = intOf(v);
      if (n === null || n < f.min || n > f.max) errors[f.key] = `Enter a number from ${f.min} to ${f.max}.`;
    }
  }
  return errors;
};

/** Catalogue rows that set the print shop's rates (same regexes as backend priceServiceBooking and the shelf). */
export const PRINT_RATE_RES: readonly RegExp[] = [/black|b\s*&\s*w|b\/w/i, /colou?r/i, /spiral/i, /hard\s*bound|thesis/i];

/** The count a per-unit service is multiplied by (laundry quantity, tailoring pieces); 1 otherwise. */
export const unitCount = (form: ServiceForm, a: Answers): number => (form.pricing.kind === 'perUnit'
  ? Math.min(MAX_SERVICE_QTY, Math.max(1, intOf(a[form.pricing.key]) || 1))
  : 1);

/** Mirrors backend priceServiceBooking so the sheet shows the same estimate the server will store. */
export const estimatePrice = (form: ServiceForm, a: Answers, ctx: FormContext): number => {
  const price = ctx.itemPrice || 0;
  if (form.pricing.kind === 'perUnit') {
    return Math.round(price * unitCount(form, a) * 100) / 100;
  }
  if (form.pricing.kind !== 'print') return price;
  const pages = Math.min(5000, Math.max(1, intOf(a.pageCount) || 1));
  const copies = Math.min(500, Math.max(1, intOf(a.copies) || 1));
  // Same rule as the server: an item that is not a rate row (B&W / colour / spiral / hardbound) is its own page price.
  const ownRate = form.pricing.ownRate || !PRINT_RATE_RES.some((re) => re.test(ctx.itemName));
  const perPage = ownRate ? price : ((a.printColor === 'color' ? ctx.rates.color : ctx.rates.bw) ?? price);
  const binding = a.bindingType === 'spiral' ? (ctx.rates.spiral ?? 0) : a.bindingType === 'hardbound' ? (ctx.rates.hardbound ?? 0) : 0;
  return Math.round((pages * perPage * copies + binding) * 100) / 100;
};

export interface BookingDetail { key: string; label: string; value: string }

const optionLabel = (f: ChoiceField, value: string) => f.options.find((o) => o.value === value)?.label || value;

/** The answers as labelled lines (for the description and specifications.details). */
export const buildDetails = (form: ServiceForm, a: Answers): BookingDetail[] => {
  const out: BookingDetail[] = [...(form.fixed || [])];
  for (const f of form.fields) {
    if (!isFieldVisible(f, a)) continue;
    const label = f.summaryLabel || f.label.replace(/ \(optional\)$/, '').replace(/\?$/, '');
    const v = a[f.key];
    let value = '';
    if (f.kind === 'choice') {
      const picked = asList(v);
      if (!picked.length) continue;
      value = picked.map((p) => {
        const opt = f.options.find((o) => o.value === p);
        const extra = opt?.withText ? String(a[textKey(f.key)] || '').trim() : '';
        // "Other" shows only what was typed; "By a date" keeps its label: "By a date: 25 Oct"
        if (extra) return p === 'Other' ? extra : `${optionLabel(f, p)}: ${extra}`;
        return optionLabel(f, p);
      }).join(', ');
    } else if (f.kind === 'count') {
      const n = intOf(v) || f.min;
      if (f.key === QUANTITY_KEY) continue; // laundry quantity has its own line (see bookingSummary)
      if (f.key === 'pieces' && n === 1) continue;
      value = `${n}${f.unitLabel ? ` ${f.unitLabel(n)}` : ''}`;
    } else {
      value = String(v ?? '').trim();
    }
    if (value) out.push({ key: f.key, label, value: value.slice(0, 500) });
  }
  return out;
};

/** Readable text for ServiceBooking.description (max 2000 characters on the server). */
export const bookingSummary = (form: ServiceForm, a: Answers, itemName: string, notes: string): { description: string; details: BookingDetail[] } => {
  const details = buildDetails(form, a);
  if (form.pricing.kind === 'perUnit' && form.category === 'laundry') {
    details.unshift({ key: QUANTITY_KEY, label: 'Quantity', value: laundryMeasure(itemName).summary(unitCount(form, a)) });
  }
  const note = notes.trim();
  if (note) details.push({ key: 'notes', label: 'Note', value: note.slice(0, 500) });
  const description = details.map((d) => `${d.label}: ${d.value}`).join('\n').slice(0, 2000);
  return { description, details };
};

/** "₹1,24,999" / "₹2.50": the app's shared en-IN formatter (utils/format.ts). */
export const formatRupees = (amount: number): string => formatINR(amount);
