/**
 * The campus store ("others") basket for Room essentials and Chargers & gadgets: the same CartContext rules the old
 * category page used (basket 'store', one store per basket with the "Replace basket?" prompt, closed store / sold out
 * alerts, a Mega Basket shopping request is ordered on its own).
 */
import { useCallback } from 'react';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useCart, isCustomRequest } from '../../context/CartContext';
import { formatClock } from '../../utils/format';
import type { ShelfItem, ShelfStore } from './servicesV2Data';

const opensAtText = (hhmm: string | null) => (hhmm && /^\d{1,2}:\d{2}$/.test(hhmm) ? formatClock(hhmm) : null);

export function useStoreBasket() {
  const { addToCart, baskets, basketCounts, basketTotals, updateQuantity, clearBasket } = useCart();
  const lines = baskets.store;

  const lineFor = useCallback((id: string) => lines.find((l) => l.cartKey === id || (l.id === id && !l.customizations)), [lines]);

  const add = useCallback((item: ShelfItem, store: ShelfStore | undefined, fallbackName: string) => {
    if (!item.inStock) {
      Alert.alert('Sold out', `${item.name} is out of stock right now. Please check back soon.`);
      return;
    }
    if (store && !store.isOpen) {
      const opens = opensAtText(store.opensAt);
      Alert.alert(`${store.name || 'This store'} is closed`, store.closedReason || (opens ? `It opens at ${opens}. You can browse now and add items once it opens.` : 'You can browse now and add items once it opens again.'));
      return;
    }
    if (!item.orderable) {
      Alert.alert('Not available right now', `${item.name} cannot be ordered right now. Check back later.`);
      return;
    }
    const doAdd = () => {
      const ok = addToCart({
        id: item.id,
        name: item.name,
        price: item.price,
        image: item.image || '',
        quantity: 1,
        restaurantId: item.restaurantId,
        restaurantName: item.storeName || fallbackName,
        basket: 'store',
      });
      if (ok) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    };
    if (lines.some((l) => isCustomRequest(l))) {
      Alert.alert('Start a new basket?', 'Your basket has a shopping request, which is ordered separately. Clear it and add this item?', [
        { text: 'Keep basket', style: 'cancel' },
        { text: 'Clear & add', style: 'destructive', onPress: () => { clearBasket('store'); doAdd(); } },
      ]);
      return;
    }
    doAdd();
  }, [addToCart, lines, clearBasket]);

  return {
    lineFor,
    add,
    setQty: updateQuantity,
    count: basketCounts.store,
    total: basketTotals.store,
  };
}
