/**
 * Delivery time shown on store cards and the store page.
 *
 * Only a time the server measured from real delivered orders (`etaMins`) is shown. The stored
 * `deliveryTime` / `time` fields are seed or admin numbers nobody has checked, so they never show
 * as fact. A server that does not send `etaMins` yet simply hides the chip.
 */
export function storeEtaMins(r: any): number | null {
  const n = Number(r?.etaMins);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function storeEtaText(r: any): string | null {
  const n = storeEtaMins(r);
  return n ? `${n} min` : null;
}
