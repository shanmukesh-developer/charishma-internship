/**
 * Food & groceries v2: catalogue types and rules, shelves, tiles, banners, aisles and groups.
 * Others → Food & groceries (modules/foodV2).
 */
import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { FOOD_IMG } from './FoodV2Kit';

export type IonName = React.ComponentProps<typeof Ionicons>['name'];

// ── Catalogue (same shape and rules as app/(tabs)/others.tsx) ─────────────────
export type Item = {
  id: string; name: string; price: number; originalPrice: number | null; discountPercent: number | null;
  weight: string | null; brand: string | null; category: string | null; image: string | null;
  isVegetarian: boolean; isAvailable: boolean; orderable: boolean; bookingOnly: boolean;
  restaurantId: string; storeName: string | null; vendorType: string | null;
};
export const SHOP_TYPES = ['grocery', 'toys', 'seeds', 'electronics'];
export const CATALOGUE_CACHE_KEY = 'others:catalogue';
export const FALLBACK_IMG = 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=400&q=80';
export const MEGA_BASKET_VENDOR = 'mega-basket-vendor';
export const WISHLIST_KEY = 'zenvy_wishlist';

export const toItem = (raw: any): Item | null => {
  if (!raw || !raw.id || !raw.name) return null;
  const price = Number(raw.price);
  if (!Number.isFinite(price) || price < 0) return null;
  const original = Number(raw.originalPrice);
  const discount = Number(raw.discountPercent);
  return {
    id: String(raw.id), name: String(raw.name), price,
    originalPrice: Number.isFinite(original) && original > price ? original : null,
    discountPercent: Number.isFinite(discount) && discount > 0 ? Math.round(discount) : null,
    weight: raw.weight || null, brand: raw.brand || null, category: raw.category || null,
    image: raw.image || raw.imageUrl || null,
    isVegetarian: raw.isVegetarian !== false, isAvailable: raw.isAvailable !== false,
    orderable: raw.orderable !== false, bookingOnly: !!raw.bookingOnly,
    restaurantId: String(raw.restaurantId || raw.storeId || ''), storeName: raw.storeName || null, vendorType: raw.vendorType || null,
  };
};
export const toList = (raws: any[]) => {
  const seen = new Set<string>();
  const out: Item[] = [];
  raws.forEach(r => { const it = toItem(r); if (it && !it.bookingOnly && !seen.has(it.id)) { seen.add(it.id); out.push(it); } });
  return out;
};

export const groupIN = (d: string) => (d.length <= 3 ? d : `${d.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${d.slice(-3)}`);
/** "₹499", "₹40.80": paise only when there are some (float noise like 39.999 shows as ₹40). */
export const fmt = (n: number) => {
  const paise = Math.round(Math.abs(Number(n) || 0) * 100);
  const f = paise % 100;
  return `${Number(n) < 0 && paise ? '-' : ''}₹${groupIN(String(Math.floor(paise / 100)))}${f ? `.${String(f).padStart(2, '0')}` : ''}`;
};
/** MRP (struck-out price): whole rupees only. */
export const fmtMrp = (n: number) => `₹${groupIN(String(Math.round(Math.abs(Number(n) || 0))))}`;
export const sentence = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t);
export const offLabel = (p: Item) => (p.discountPercent ? `${p.discountPercent}% off` : null);
export const fmtShortClock = (hhmm?: string | null) => {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = parseInt(m[1], 10);
  return `${h % 12 === 0 ? 12 : h % 12}${m[2] === '00' ? '' : `:${m[2]}`} ${h < 12 ? 'am' : 'pm'}`;
};
export const squash = (t: string) => t.toLowerCase().replace(/\s+/g, '');

/** exclude: products whose name or category matches never join the shelf (e.g. drinks named 'fruit'). */
export type Shelf = { categories?: string[]; keywords?: string[]; vendorTypes?: string[]; deals?: boolean; exclude?: RegExp };
export const SHELVES: Record<string, Shelf> = {
  'All Groceries': { vendorTypes: ['GROCERY'] },
  Fresh: { categories: ['Fresh', 'Fresh Fruits', 'Fruits', 'Vegetables', 'Leafy Greens'], exclude: /beverage|juice|drink|cup|soda|smoothie|shake|jam|squash/i },
  Grocery: { categories: ['Grocery', 'Staples', 'Atta & Flours', 'Dals & Pulses', 'Rice & Grains', 'Edible Oils & Ghee', 'Oils', 'Masalas & Spices', 'Salt, Sugar & Jaggery', 'Daily Essentials', 'Dairy', 'Dry Fruits'] },
  'Snacks & beverages': { categories: ['Snacks', 'Chips & Namkeens', 'Lays', 'Drinks & Juices', 'Juices & Cups', 'Coca Cola', 'Tea & Coffee', 'Nescafe', 'Cadbury', 'Sweet Indulgences', 'Instant & Frozen Food'] },
  'Bakery & breakfast': { categories: ['Bakery', 'Biscuits & Cakes', 'Breakfast Options'] },
  'Health & care': { categories: ['Health', 'Monsoon Wellness Picks', 'Bath, Body & Hair', 'Beauty & Skincare'] },
  Electronics: { vendorTypes: ['ELECTRONICS'] },
  Organic: { categories: ['Organic'] },
  Health: { categories: ['Health', 'Monsoon Wellness Picks'] },
  Deals: { deals: true },
  Toys: { vendorTypes: ['TOYS'] },
  Seeds: { vendorTypes: ['SEEDS'] },
  'Edible Oils & Ghee': { categories: ['Edible Oils & Ghee'], keywords: ['ghee', ' oil'] },
  'Monsoon Wellness Picks': { categories: ['Monsoon Wellness Picks'] },
  'Fit & active': { categories: ['Fitness ready'] },
  'Atta & Flours': { categories: ['Atta & Flours'], keywords: ['atta'] },
  'Dals & Pulses': { categories: ['Dals & Pulses'], keywords: [' dal'] },
  'Chips & Namkeens': { categories: ['Chips & Namkeens', 'Lays'] },
  'Drinks & Juices': { categories: ['Drinks & Juices', 'Coca Cola'] },
  'Tea & Coffee': { categories: ['Tea & Coffee', 'Nescafe'] },
  'Sweet Indulgences': { categories: ['Sweet Indulgences', 'Cadbury'] },
  'Detergents & Cleaning': { categories: ['Detergents & Cleaning', 'Surf Excel'] },
};
/**
 * One shelf, computed once per catalogue. The home screen alone asks for ~45 shelves on every render
 * (tiles, brands, health, aisles, toys...), each a full pass over the catalogue with lower-casing and
 * regex tests; with this cache a re-render (a tap, the basket, a toast) costs map lookups only.
 * Keyed on the catalogue array itself, so a new catalogue (fetch, store hours) starts a fresh cache.
 * The returned arrays are shared: callers must not mutate them (they all filter / slice / map).
 */
const shelfCache = new WeakMap<Item[], Map<string, Item[]>>();
export const shelfItems = (name: string | null, items: Item[]): Item[] => {
  if (!name) return [];
  let byName = shelfCache.get(items);
  if (!byName) { byName = new Map(); shelfCache.set(items, byName); }
  const hit = byName.get(name);
  if (hit) return hit;
  const out = computeShelf(name, items);
  byName.set(name, out);
  return out;
};
const computeShelf = (name: string, items: Item[]): Item[] => {
  const shelf = SHELVES[name] || { categories: [name], keywords: [name] };
  const cats = (shelf.categories || []).map(c => c.toLowerCase());
  const keys = (shelf.keywords || []).map(k => k.toLowerCase());
  const types = shelf.vendorTypes || [];
  const seen = new Set<string>();
  const out = items.filter(i => {
    if (seen.has(i.id)) return false;
    if (shelf.exclude && shelf.exclude.test(`${i.name} ${i.category || ''}`)) return false;
    const ln = i.name.toLowerCase();
    const lb = (i.brand || '').toLowerCase();
    const hit = (shelf.deals && (i.discountPercent || 0) >= 10)
      || (!!i.vendorType && types.includes(i.vendorType))
      || (!!i.category && cats.includes(i.category.toLowerCase()))
      || keys.some(k => ln.includes(k) || (!!lb && lb === k.trim()));
    if (hit) seen.add(i.id);
    return !!hit;
  });
  return shelf.deals ? out.sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0)) : out;
};

// ── Food & groceries v2 content ───────────────────────────────────────────────
export const SEARCH = '__search';
export const SEARCH_HINTS = ["Search for 'milk'", "Search for 'rice'", "Search for 'chips'", "Search for 'curd'", "Search for 'atta'", "Search for 'ghee'"];

export const TILES: { key: string; label: string; img: string }[] = [
  { key: 'Grocery', label: 'Groceries', img: FOOD_IMG.tileGroceries },
  { key: 'Fresh', label: 'Fruits & vegetables', img: FOOD_IMG.tileFresh },
  { key: 'Snacks & beverages', label: 'Snacks & beverages', img: FOOD_IMG.tileSnacks },
  { key: 'Bakery & breakfast', label: 'Bakery & breakfast', img: FOOD_IMG.tileBakery },
  { key: 'Health & care', label: 'Health & personal care', img: FOOD_IMG.tileHealth },
];

export type Hero = { title: string; sub?: string; img: string; sidebar?: boolean };
export const HEROES: Record<string, Hero> = {
  'All Groceries': { title: 'Everything in the campus store', sub: 'Groceries · Snacks · Essentials', img: FOOD_IMG.heroAll, sidebar: true },
  Grocery: { title: 'Everyday essentials, right here', img: FOOD_IMG.heroGroceries, sidebar: true },
  Fresh: { title: 'Fresh and healthy, always', sub: 'Fruits · Vegetables · Farm fresh', img: FOOD_IMG.heroFresh },
  'Snacks & beverages': { title: 'Snacks time, sorted', sub: 'Chips · Drinks · Biscuits · More', img: FOOD_IMG.heroSnacks },
  'Bakery & breakfast': { title: 'Freshly baked, every day', sub: 'Bread · Biscuits · Breakfast', img: FOOD_IMG.heroBakery },
  'Health & care': { title: 'Stay healthy, stay fresh', sub: 'Wellness · Personal care · Hygiene', img: FOOD_IMG.heroHealth },
  Toys: { title: 'Play time, delivered', sub: 'Games · Plushies · Sports', img: FOOD_IMG.heroToys },
  Deals: { title: 'Best deals', sub: "Today's biggest savings", img: FOOD_IMG.heroDeals },
  Seeds: { title: 'Grow your own greens', sub: 'Seeds for your balcony garden', img: FOOD_IMG.heroSeeds },
  Electronics: { title: 'Chargers and gadgets', sub: 'Cables · Adapters · Study tech', img: FOOD_IMG.heroElectronics },
};
export const LIST_TITLES: Record<string, string> = {
  'All Groceries': 'All groceries', Toys: 'Toys & games', 'Monsoon Wellness Picks': 'Wellness picks',
  'Edible Oils & Ghee': 'Cooking oils & ghee', Health: 'Health & care', Deals: 'Best deals',
};

/** Groceries sidebar aisles (owner reference labels), matched on the product's own category, then its name. */
export const AISLES: { key: string; label: string; re: RegExp }[] = [
  { key: 'rice', label: 'Rice & Grains', re: /rice|grain|poha|oats|rava|suji|millet|basmati/i },
  { key: 'atta', label: 'Atta & Flour', re: /atta|flour|maida|besan/i },
  { key: 'dal', label: 'Pulses & Dal', re: /\bdals?\b|pulse|lentil|chana|rajma|moong|toor/i },
  { key: 'oil', label: 'Oil & Masala', re: /oil|ghee|masala|spice|salt|sugar|jaggery|chilli|turmeric/i },
  { key: 'snacks', label: 'Snacks', re: /snack|chip|namkeen|biscuit|cookie|lays|kurkure/i },
  { key: 'bev', label: 'Beverages', re: /drink|juice|tea|coffee|beverage|cola|soda|nescafe/i },
];
export const aisleOf = (p: Item) => {
  const cat = p.category || '';
  const byCat = AISLES.find(a => a.re.test(cat));
  if (byCat) return byCat.key;
  const byName = AISLES.find(a => a.re.test(p.name));
  return byName ? byName.key : 'other';
};
/** Short chip labels for long store categories ("Masalas & Spices" -> "Spices"). */
export const SHORT_CHIP: Record<string, string> = {
  'Rice & Grains': 'Grains', 'Masalas & Spices': 'Spices', 'Edible Oils & Ghee': 'Cooking', 'Atta & Flours': 'Atta',
  'Dals & Pulses': 'Dals', 'Chips & Namkeens': 'Chips', 'Biscuits & Cakes': 'Biscuits', 'Drinks & Juices': 'Drinks',
  'Juices & Cups': 'Juices', 'Tea & Coffee': 'Tea & coffee', 'Instant & Frozen Food': 'Instant', 'Sweet Indulgences': 'Sweets',
  'Salt, Sugar & Jaggery': 'Salt & sugar', 'Bath, Body & Hair': 'Bath & body', 'Beauty & Skincare': 'Skincare',
};
export const chipLabel = (c: string) => SHORT_CHIP[c] || sentence(c);

export const FRESH_CATS = new Set((SHELVES.Fresh.categories || []).map(c => c.toLowerCase()));
export const GROUP_ORDER = ['Groceries', 'Snacks', 'Beverages', 'Fresh', 'Bakery', 'Personal care', 'Toys', 'Seeds', 'Electronics'];
export const groupOf = (p: Item): string => {
  const cat = (p.category || '').toLowerCase();
  if (p.vendorType === 'TOYS') return 'Toys';
  if (p.vendorType === 'SEEDS') return 'Seeds';
  if (p.vendorType === 'ELECTRONICS') return 'Electronics';
  if (/drink|juice|cup|cola|tea|coffee|nescafe|beverage|soda|water/.test(cat)) return 'Beverages';
  if (/snack|chip|namkeen|lays|sweet|cadbury|chocolate|instant|frozen|noodle/.test(cat)) return 'Snacks';
  if (FRESH_CATS.has(cat)) return 'Fresh';
  if (/bakery|bread|breakfast|biscuit|cake/.test(cat)) return 'Bakery';
  if (/health|wellness|bath|body|hair|beauty|skin|hygiene|detergent|clean/.test(cat)) return 'Personal care';
  return 'Groceries';
};

export const BRANDS = [
  { name: 'Amul', img: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=200&q=80&auto=format&fit=crop' },
  { name: 'Lays', img: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=200&q=80&auto=format&fit=crop' },
  { name: 'Nescafe', img: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=200&q=80&auto=format&fit=crop' },
  { name: 'Cadbury', img: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=200&q=80&auto=format&fit=crop' },
  { name: 'Coca Cola', img: 'https://images.unsplash.com/photo-1554866585-cd94860890b7?w=200&q=80&auto=format&fit=crop' },
  { name: 'Surf Excel', img: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?w=200&q=80&auto=format&fit=crop' },
];
export const TOY_TILES = [
  { title: 'Vehicle toys', img: 'https://images.unsplash.com/photo-1594787318286-3d835c1d207f?w=300&q=80&auto=format&fit=crop' },
  { title: 'Learning & education', img: 'https://images.unsplash.com/photo-1516627145497-ae6968895b74?w=300&q=80&auto=format&fit=crop' },
  { title: 'Sports & games', img: 'https://images.unsplash.com/photo-1531565637446-32307b194362?w=300&q=80&auto=format&fit=crop' },
  { title: 'Games & plushies', img: 'https://images.unsplash.com/photo-1606167668584-78701c57f13d?w=300&q=80&auto=format&fit=crop' },
  { title: 'Baby & toddler toys', img: 'https://images.unsplash.com/photo-1555448248-2571daf6344b?w=300&q=80&auto=format&fit=crop' },
  { title: 'Fitness ready', img: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=300&q=80&auto=format&fit=crop' },
];
export const HEALTH_TILES = [
  { name: 'Fit & active', label: 'Fitness', img: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=300&q=80&auto=format&fit=crop' },
  { name: 'Health', label: 'Health & care', img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&q=80&auto=format&fit=crop' },
  { name: 'Organic', label: 'Organic', img: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=300&q=80&auto=format&fit=crop' },
  { name: 'Monsoon Wellness Picks', label: 'Wellness picks', img: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=300&q=80&auto=format&fit=crop' },
];
export const ESSENTIAL_AISLES = ['Atta & Flours', 'Dals & Pulses', 'Rice & Grains', 'Edible Oils & Ghee', 'Masalas & Spices', 'Chips & Namkeens', 'Biscuits & Cakes', 'Drinks & Juices', 'Tea & Coffee', 'Detergents & Cleaning'];
/** Home hero card colour (sampled #042F20 at the text, a touch lighter to meet the photo). */
export const HERO_BG = '#04341F';
/** Listing banner colour (sampled #226B36 on the Groceries banner). */
export const LHERO_BG = '#1A6234';
export const POPULAR_REQUESTS = ['Protein powder', 'Stationery items', 'Study lamp', "Men's grooming", 'Extra charger', 'Notebook'];

export type Route =
  | { name: 'home' }
  | { name: 'listing'; shelf: string }
  | { name: 'product'; id: string }
  | { name: 'saved' }
  | { name: 'categories' }
  | { name: 'mega' };
export type DemoState = null | 'loading' | 'offline' | 'waking' | 'error' | 'empty';

/** A saved item as stored on the device (zenvy_wishlist, same list the app uses). */
export type Saved = { id: string; title: string; subtitle: string; price: string; image: string; targetRoute: string };
