/**
 * The campus store ("others") basket for Room essentials and Chargers & gadgets: the same CartContext rules the old
 * category page used (basket 'store' = the Groceries tab, several shops side by side with one order each, closed store / sold out
 * alerts; products with choices open the options sheet).
 */
import { useCallback } from 'react';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useCart } from '../../context/CartContext';
import { productOptions, useAskOptions } from '../../components/ProductOptions';
import { formatClock } from '../../utils/format';
import { storeTakesOrders, type ShelfItem, type ShelfStore } from './servicesV2Data';

const opensAtText = (hhmm: string | null) => (hhmm && /^\d{1,2}:\d{2}$/.test(hhmm) ? formatClock(hhmm) : null);

export function useStoreBasket() {
  const { addToCart, baskets, basketCounts, basketTotals, updateQuantity, clearBasket } = useCart();
  const lines = baskets.store;
  const askOptions = useAskOptions();

  const lineFor = useCallback((id: string) => lines.find((l) => l.cartKey === id || (l.id === id && !l.customizations)), [lines]);

  const add = useCallback((item: ShelfItem, store: ShelfStore | undefined, fallbackName: string) => {
    if (!item.inStock) {
      Alert.alert('Sold out', `${item.name} is out of stock right now. Please check back soon.`);
      return;
    }
    if (store && !storeTakesOrders(store)) {
      const opens = opensAtText(store.opensAt);
      Alert.alert(`${store.name || 'This store'} is closed`, store.closedReason || (opens ? `It opens at ${opens}. You can browse now and add items once it opens.` : 'You can browse now and add items once it opens again.'));
      return;
    }
    if (!item.orderable) {
      Alert.alert('Not available right now', `${item.name} cannot be ordered right now. Check back later.`);
      return;
    }
    // Products with choices (weights with their own prices, flavours): asked in the options sheet first.
    const groups = productOptions(item);
    const doAdd = async () => {
      let extra: { price?: number; basePrice?: number; customizations?: any } = {};
      if (groups.length) {
        const r = await askOptions({ name: item.name, price: item.price, image: item.image || null, groups });
        if (!r) return;
        extra = { price: r.unitPrice, basePrice: item.price, customizations: r.customizations };
      }
      const ok = addToCart({
        id: item.id,
        name: item.name,
        price: item.price,
        image: item.image || '',
        quantity: 1,
        restaurantId: item.restaurantId,
        restaurantName: item.storeName || fallbackName,
        basket: 'store',
        ...extra,
      });
      if (ok) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    };
    doAdd();
  }, [addToCart, askOptions]);

  return {
    lineFor,
    add,
    setQty: updateQuantity,
    count: basketCounts.store,
    total: basketTotals.store,
  };
}
