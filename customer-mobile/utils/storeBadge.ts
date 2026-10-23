/**
 * "New" badge: one rule for Home and the store page. A store listed in the last 30 days that has
 * no rating yet is "New"; an older store without ratings shows no badge at all.
 */
export const NEW_STORE_DAYS = 30;

export function isNewStore(r: any, now = Date.now()): boolean {
  const created = r?.createdAt ? new Date(r.createdAt).getTime() : NaN;
  return Number.isFinite(created) && now - created < NEW_STORE_DAYS * 86400000;
}
