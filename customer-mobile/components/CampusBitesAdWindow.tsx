import React, { useMemo, useRef } from 'react';
import { Alert } from 'react-native';
import HighClassPromoCarousel, { PromoSlide } from './HighClassPromoCarousel';
import { COLORS } from '../constants/theme';
import { dietNow } from '../utils/themeNow';
import { CAMPUS_BITES_PROMOS, CampusBitesPromo } from '../constants/campusBitesPromos';

/**
 * CampusBites ad window: the stall promo carousel at the top of the Home "Local vendor stalls" section.
 * It is the Home promo carousel itself (same cards, swipe, page dots, auto-advance that slows down for
 * reduce-motion), filled with stall promos in the CampusBites gold:
 *  - "Stall of the day": one listed stall, picked per IST day (featured stalls first, open ones first).
 *  - The cards in constants/campusBitesPromos.ts, each shown only while a listed stall matches it;
 *    tapping opens that stall (or jumps to the stall list). At most 6 category cards a day, rotated
 *    daily so every category gets its turn.
 * Everything on a card comes from real stall data (name, photo, hours, real rating) or the editable
 * promo list. With no stalls listed yet the promo cards show as "coming soon" previews that open nothing.
 */

interface Props {
  /** Active stalls from GET /api/restaurants/local-vendors (already filtered by the section). */
  stalls: any[];
  isOpen: (stall: any) => boolean;
  onOpenStall: (stall: any) => void;
  /** Jump to the stall list, optionally filtered by a search keyword. */
  onShowList: (searchFor?: string) => void;
  /** The section's single accent (gold in dark, the app's primary accent in light). */
  accent?: string;
}

const idOf = (x: any) => String(x?._id || x?.id || '');
const lower = (x: any) => String(x || '').toLowerCase();

/** "21:00" -> "9 PM" / "9:30 PM" */
const shortTime = (hhmm: any): string | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]) % 24;
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${m[2] === '00' ? hr : `${hr}:${m[2]}`} ${h >= 12 ? 'PM' : 'AM'}`;
};

/** Days since epoch in IST: the "stall of the day" changes at midnight campus time. */
const istDay = () => Math.floor((Date.now() + 5.5 * 3600 * 1000) / 86400000);

/** Category cards per day (plus the stall of the day and the "how it works" card): 8 cards at most. */
const MAX_PROMO_CARDS = 6;
/** The list started at today's offset, so the daily cap shows a different set of categories each day. */
const rotate = <T,>(xs: T[]): T[] => {
  if (xs.length < 2) return xs;
  const k = istDay() % xs.length;
  return [...xs.slice(k), ...xs.slice(0, k)];
};

/** How strongly a stall matches a promo's keywords (0 = not at all). Stall tags / name count most. */
const matchScore = (stall: any, words: string[]): number => {
  const tags = (Array.isArray(stall.tags) ? stall.tags : []).map(lower);
  const head = `${lower(stall.name)} ${lower(stall.stallDescription || stall.description)}`;
  const menu = (Array.isArray(stall.menu) ? stall.menu : []).filter((m: any) => m && m.isAvailable !== false);
  let score = 0;
  for (const w of words) {
    if (tags.some((t: string) => t === w || t.includes(w))) score += 3;
    if (head.includes(w)) score += 2;
    if (menu.some((m: any) => lower(m.category).includes(w) || lower(m.name).includes(w))) score += 1;
  }
  return score;
};

/** Real-data chips for a stall card: real rating (from orders), closing time or closed. */
const stallChips = (stall: any, open: boolean) => {
  const ratingCount = Number(stall.ratingCount) || 0;
  const rating = Number(stall.rating);
  const closes = open ? shortTime(stall.closesAt) : null;
  return {
    rating: ratingCount > 0 && Number.isFinite(rating) && rating > 0 ? rating : undefined,
    time: closes ? `Till ${closes}` : undefined,
    closed: !open,
  };
};

export default function CampusBitesAdWindow({ stalls, isOpen, onOpenStall, onShowList, accent = dietNow().acc }: Props) {
  const ACCENT = accent;
  // Callbacks change every render of the section: read them through refs so the slide list stays stable.
  const openRef = useRef(onOpenStall);
  const listRef = useRef(onShowList);
  openRef.current = onOpenStall;
  listRef.current = onShowList;

  const slides: PromoSlide[] = useMemo(() => {
    const list = Array.isArray(stalls) ? stalls.filter((s) => s && idOf(s)) : [];

    // No stalls listed yet: the stall promos as quiet previews (no stall, no ordering, nothing to open).
    if (list.length === 0) {
      return rotate(CAMPUS_BITES_PROMOS.filter((p) => p.target === 'stall')).slice(0, MAX_PROMO_CARDS).map((p) => ({
        id: `cb-soon-${p.id}`,
        type: 'featured_restaurant' as const,
        tagline: 'Coming soon',
        title1: p.title,
        title2: 'Stalls join soon',
        description: p.subtitle,
        buttonText: 'Coming soon',
        imageUrl: p.imageUrl,
        accentColor: ACCENT,
        redirectAction: () => Alert.alert('Coming soon', 'Campus stalls will appear here soon.'),
      }));
    }

    const out: PromoSlide[] = [];

    // Stall of the day: featured stalls first, then open ones, then any; one pick per IST day.
    const featured = list.filter((s) => s.subscriptionTier === 'premium' || s.isFeatured === true);
    const pool = featured.length ? featured : list;
    const openPool = pool.filter(isOpen);
    const daily = (openPool.length ? openPool : pool).slice().sort((a, b) => idOf(a).localeCompare(idOf(b)));
    const pick = daily[istDay() % daily.length];
    if (pick) {
      const open = isOpen(pick);
      const items = (Array.isArray(pick.menu) ? pick.menu : []).filter((m: any) => m && m.isAvailable !== false).length;
      out.push({
        id: `cb-day-${idOf(pick)}`,
        type: 'featured_restaurant',
        tagline: 'Stall of the day',
        title1: String(pick.name || 'Campus stall'),
        title2: typeof pick.promoOffer === 'string' && pick.promoOffer.trim()
          ? pick.promoOffer.trim()
          : items > 0 ? `${items} ${items === 1 ? 'item' : 'items'} on the menu` : 'Pay the stall in cash',
        description: String(pick.stallDescription || pick.description || (pick.location ? `At ${pick.location}` : 'Tap to see the menu.')),
        buttonText: 'View menu',
        imageUrl: pick.imageUrl || pick.logoUrl || pick.image || undefined,
        accentColor: ACCENT,
        ...stallChips(pick, open),
        redirectAction: () => openRef.current(pick),
      });
    }

    // Promo cards: only while a listed stall matches; the best match (open first) is the destination.
    const stallCards: PromoSlide[] = [];
    const listCards: PromoSlide[] = [];
    for (const p of CAMPUS_BITES_PROMOS as CampusBitesPromo[]) {
      if (p.target === 'list') {
        listCards.push({
          id: `cb-${p.id}`,
          type: 'featured_restaurant',
          tagline: p.tag,
          title1: p.title,
          title2: `${list.length} ${list.length === 1 ? 'stall' : 'stalls'} near campus`,
          description: p.subtitle,
          buttonText: p.cta,
          imageUrl: p.imageUrl,
          accentColor: ACCENT,
          redirectAction: () => listRef.current(p.searchFor),
        });
        continue;
      }
      const words = (p.match || []).map(lower).filter(Boolean);
      if (!words.length) continue;
      const ranked = list
        .map((s) => ({ s, score: matchScore(s, words), open: isOpen(s) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => (Number(b.open) - Number(a.open)) || (b.score - a.score));
      const best = ranked[0];
      if (!best) continue;
      stallCards.push({
        id: `cb-${p.id}-${idOf(best.s)}`,
        type: 'featured_restaurant',
        tagline: p.tag,
        title1: p.title,
        title2: String(best.s.name || 'Campus stall'),
        description: p.subtitle,
        buttonText: p.cta,
        // The promo photo (the stall's own photo is on the stall card below).
        imageUrl: p.imageUrl,
        accentColor: ACCENT,
        ...stallChips(best.s, best.open),
        redirectAction: () => openRef.current(best.s),
      });
    }
    // Up to MAX_PROMO_CARDS category cards, rotated daily so every category gets its turn.
    return [...out, ...rotate(stallCards).slice(0, MAX_PROMO_CARDS), ...listCards];
  }, [stalls, isOpen, ACCENT]);

  if (!slides.length) return null;
  return <HighClassPromoCarousel slides={slides} />;
}
