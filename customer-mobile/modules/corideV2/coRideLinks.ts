/**
 * Where a Co-Ride push / in-app notification opens (backend: routes/bikePoolRoutes.js, services/coRideTemplates.js):
 *   CORIDE_TEMPLATE_LIVE / CORIDE_RIDE_REMINDER with data.path '/coride/regular'  → Regular rides
 *   CORIDE_RIDE_REMINDER / CORIDE_RIDE_CANCELLED with data.poolId                 → that ride
 *   CORIDE_SOS (support side)                                                      → My rides
 * Only /coride/* paths are followed (never an arbitrary URL from a payload).
 */
const ID_RE = /^[0-9a-f-]{36}$/i;
const PATH_RE = /^\/coride\/(regular|my-rides|find|auto|post)(\?[\w=&%.-]*)?$/;

export const corideHrefForNotification = (type?: string | null, rawData?: any): string | null => {
  let data: any = rawData;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { data = null; }
  }
  const t = typeof type === 'string' ? type : String(data?.type || '');
  const isCoRide = t.startsWith('CORIDE_') || (data && (data.screen === 'coride' || data.screen === 'coride_regular'));
  if (!isCoRide) return null;
  const path = data && typeof data.path === 'string' ? data.path : '';
  if (PATH_RE.test(path)) return path;
  const poolId = data && typeof data.poolId === 'string' && ID_RE.test(data.poolId) ? data.poolId : null;
  if (poolId && t !== 'CORIDE_RIDE_CANCELLED') return `/coride/ride/${poolId}`;
  return '/coride/my-rides';
};
