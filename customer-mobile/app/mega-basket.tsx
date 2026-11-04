/**
 * Old shopping list (Mega Basket) link. Shopping lists are no longer available, so deep links and old
 * notifications that still open /mega-basket land on the Groceries tab instead.
 */
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { goHome } from '../utils/goHome';

export default function MegaBasketRedirect() {
  const router = useRouter();
  useEffect(() => {
    goHome(router, '/(tabs)/others');
  }, [router]);
  return null;
}
