/**
 * Plain bill labels. Older servers (and orders placed before 21 Oct) name member discounts after the
 * badge nicknames ("Gold Grafter delivery perk"); the bill shows "Gold member: delivery discount".
 */
const NICKNAME_TIER: Record<string, string> = {
  'elite sovereign': 'Elite',
  'diamond dignitary': 'Diamond',
  'platinum pro': 'Platinum',
  'gold grafter': 'Gold',
  'silver scaler': 'Silver',
  'bronze beginner': 'Bronze',
};

export function plainDiscountLabel(label: any): string {
  const raw = String(label || '').trim();
  if (!raw) return 'Discount';
  if (raw === 'Perk discount') return 'Member discount';
  const m = raw.match(/^(.+?) (delivery )?perk$/i);
  if (!m) return raw;
  const who = m[1].toLowerCase();
  if (who === 'zen champion') return m[2] ? '200+ ZCS Points: free delivery' : 'Member: order discount';
  const tier = NICKNAME_TIER[who];
  const name = tier ? `${tier} member` : 'Member';
  return `${name}: ${m[2] ? 'delivery' : 'order'} discount`;
}
