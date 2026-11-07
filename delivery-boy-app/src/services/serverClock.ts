// Server clock minus phone clock (ms), from the HTTP Date header of the latest API answer (apiClient notes it).
// Order times (createdAt, acceptedAt...) are server times, so "x min ago" labels use serverNow(), not a phone
// clock that may be minutes off. 0 until the first answer. Same approach as the restaurant / vendor apps.
let clockOffsetMs = 0;

export const serverNow = (): number => Date.now() + clockOffsetMs;

/** Call with each API response and the phone time the request was sent. Never throws. */
export function noteServerDate(res: { headers: { get(name: string): string | null } }, sentAt: number): void {
  try {
    const d = Date.parse(res.headers.get('date') || '');
    if (!Number.isFinite(d)) return;
    const local = (sentAt + Date.now()) / 2; // the header was stamped somewhere between send and receive
    const off = d - local;
    // The header has 1 s resolution: ignore sub-second noise.
    clockOffsetMs = Math.abs(off) < 1500 ? 0 : off;
  } catch {
    /* keep the last offset */
  }
}
