// Server clock for countdowns that compare server times ("pay within", "hold expires", "ready in"): a phone clock
// a few minutes off made those timers show minutes the server no longer allows (or "time is up" too early).
// Every API response carries the server's Date header (whole seconds); utils/auth apiFetchRaw notes it here and
// serverNow() is the phone's clock corrected by the measured offset. Until a response arrives it is Date.now().

let offsetMs = 0;
let sampled = false;

/** Record the server time from a response's Date header. `sentAt` / `receivedAt` are phone times (Date.now()). */
export function noteServerDate(dateHeader: string | null | undefined, sentAt: number, receivedAt: number): void {
  if (!dateHeader) return;
  const server = Date.parse(dateHeader);
  if (!Number.isFinite(server)) return;
  const rtt = receivedAt - sentAt;
  // A slow round trip (cold start, retry) says little about when the header was written: keep the older sample.
  if (rtt < 0 || (sampled && rtt > 5000)) return;
  // The header is truncated to the second (+500 ms on average) and was written about half-way through the trip.
  offsetMs = server + 500 - (sentAt + rtt / 2);
  sampled = true;
}

/** Current time on the server's clock (ms since epoch). */
export function serverNow(): number {
  return Date.now() + offsetMs;
}
