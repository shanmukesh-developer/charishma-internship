// Label on promoted stores (Home cards and the Home carousel). A store shows a label only when the admin
// flagged it as promoted (isFeatured). Paid-ad words ("Sponsored", "Promoted", "Ad", "Paid") are never shown
// as typed, because nothing in Zenvy records a payment for a placement: those become "Featured". Other admin
// badges ("New", "Top rated", ...) are kept. Not featured: no label.
const PAID_WORDS = /sponsor|promot|\bpaid\b|\bads?\b|advert/i;

export function featuredLabel(store: { isFeatured?: unknown; featuredBadge?: unknown } | null | undefined): string | null {
  if (!store || store.isFeatured !== true) return null;
  const badge = typeof store.featuredBadge === 'string' ? store.featuredBadge.trim() : '';
  if (!badge || PAID_WORDS.test(badge)) return 'Featured';
  return badge.slice(0, 24);
}
