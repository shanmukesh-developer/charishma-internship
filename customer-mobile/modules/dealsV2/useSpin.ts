/**
 * The real spin (POST /api/rewards/use-spin), moved from app/(tabs)/others.tsx unchanged in behaviour: the server
 * picks the prize; the wheel animates to the slice it returned (segment i is centred at i × 360/n from the top, so
 * the wheel turns to 360 - i × 360/n plus five full turns, ease-out cubic, 4 s). Runs only on the student's tap.
 */
import { useRef, useState } from 'react';
import { Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../../context/AuthContext';
import { API_URL } from '../../constants/api';
import { apiFetch, readJson, NETWORK_ERROR_MESSAGE, SERVER_BUSY_MESSAGE } from '../../utils/auth';
import { patchAfterSpin, refreshRewards, type DealsData } from './dealsV2Data';
import type { SpinResult } from './dealsV2Nav';

export function useSpin(d: DealsData, onResult: (r: SpinResult) => void, onError: (msg: string) => void) {
  const { setUser } = useAuth();
  const rot = useRef(new Animated.Value(0)).current;
  const at = useRef(0);
  const lock = useRef(false);
  const [spinning, setSpinning] = useState(false);

  const spin = async () => {
    if (lock.current || spinning || d.spinsLeft <= 0) return;
    lock.current = true;
    setSpinning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    let data: any = null;
    try {
      const res = await apiFetch(`${API_URL}/api/rewards/use-spin`, { method: 'POST', body: JSON.stringify({}) });
      data = await readJson(res);
      if (!res.ok || !data || !Number.isInteger(data.prizeIndex)) {
        if (Number.isFinite(Number(data?.spinsAvailable))) patchAfterSpin({ spinsAvailable: Number(data.spinsAvailable) });
        if (res.status === 400) refreshRewards();
        onError(data?.message || (res.status >= 500 ? SERVER_BUSY_MESSAGE : 'Please try again in a moment.'));
        lock.current = false;
        setSpinning(false);
        return;
      }
    } catch {
      onError(NETWORK_ERROR_MESSAGE);
      lock.current = false;
      setSpinning(false);
      return;
    }
    const n = Math.max(1, d.prizes.length);
    const sector = 360 / n;
    const idx = ((data.prizeIndex % n) + n) % n;
    const norm = ((at.current % 360) + 360) % 360;
    const target = at.current - norm + 1800 + ((360 - idx * sector) % 360);
    Animated.timing(rot, { toValue: target, duration: 4000, useNativeDriver: true, easing: (t) => 1 - Math.pow(1 - t, 3) }).start(() => {
      at.current = target;
      lock.current = false;
      setSpinning(false);
      patchAfterSpin({ spinsAvailable: data.spinsAvailable, spinsUsed: data.spinsUsed });
      if (Number.isFinite(Number(data.zenPoints))) setUser({ zenPoints: Number(data.zenPoints) } as any);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onResult({ display: data.prize?.display || data.message || 'A reward', type: data.prize?.type || 'points', coupon: data.coupon || null, zenPoints: data.zenPoints, spinsAvailable: data.spinsAvailable });
      refreshRewards();
    });
  };
  return { rot, spin, spinning };
}
