import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SHADOWS } from '../constants/theme';
import { useCartState, useCartTotalItems, type BasketKind } from '../context/CartContext';
import BasketFabIcon from './BasketFabIcon';
import DopaminePressable from './DopaminePressable';
import { FloatingPulse } from './AnimatedSection';
import { formatINR, plural } from '../utils/format';

/**
 * The floating basket on the pages that have no basket bar of their own (Home and Local): the round basket button
 * and the "N items added" bar beside it. Moved out of Home (3 Nov 2026) so the Local tab shows the same two.
 */

/**
 * Floating "N items added" bar: reads the basket totals itself so an ADD doesn't re-render the whole page.
 * Owner rule: every page keeps to its own basket. A page shows the bar only for a basket the student added to ON that
 * page during this visit (lastAddedAt after the page gained focus), never items added on a stall, restaurant or store page.
 */
export const FloatingBasketBar = React.memo(function FloatingBasketBar({ isDark, txt, onOpen, focusedAt }: { isDark: boolean; txt: string; onOpen: (kind: BasketKind) => void; focusedAt: number }) {
  const { basketCounts, basketTotals, lastAddedBasket, lastAddedAt } = useCartState();
  const kind = lastAddedBasket;
  if (!kind || !(lastAddedAt >= focusedAt)) return null;
  const totalItems = basketCounts[kind];
  const totalPrice = basketTotals[kind];
  if (!(totalItems > 0)) return null;
  return (
    <View style={s.floatingCartWrap} pointerEvents="box-none">
      <TouchableOpacity
        activeOpacity={0.92}
        style={[s.floatingCartBar, { backgroundColor: isDark ? '#1C1917' : '#FFFFFF', borderColor: isDark ? COLORS.gold : COLORS.red }]}
        onPress={() => onOpen(kind)}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <View style={[s.floatingCartBadge, { backgroundColor: isDark ? COLORS.gold : COLORS.red }]}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: isDark ? '#000' : '#FFF' }}>{totalItems}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.floatingCartLabel, { color: txt }]} numberOfLines={1}>
              {plural(totalItems, 'item')} added
            </Text>
            <Text style={[s.floatingCartSub, { color: isDark ? COLORS.gold : COLORS.red }]}>
              {formatINR(totalPrice)} subtotal
            </Text>
          </View>
        </View>
        <View style={[s.floatingCartCta, { backgroundColor: isDark ? COLORS.gold : COLORS.red }]}>
          <Text style={[s.floatingCartCtaText, { color: isDark ? '#000' : '#FFF' }]}>View basket</Text>
          <Ionicons name="chevron-forward" size={15} color={isDark ? '#000' : '#FFF'} />
        </View>
      </TouchableOpacity>
    </View>
  );
});

/** The floating basket button with the item count (its own component: a basket change re-renders only it). */
const BasketFab = React.memo(function BasketFab({ onPress }: { onPress: () => void }) {
  const totalItems = useCartTotalItems();
  // One small hop each time something is added (never a loop).
  const hop = useRef(new Animated.Value(0)).current;
  const prevItems = useRef(totalItems);
  useEffect(() => {
    if (totalItems > prevItems.current) {
      hop.setValue(0);
      Animated.sequence([
        Animated.timing(hop, { toValue: 1, duration: 140, useNativeDriver: true }),
        Animated.spring(hop, { toValue: 0, friction: 4, tension: 160, useNativeDriver: true }),
      ]).start();
    }
    prevItems.current = totalItems;
  }, [totalItems, hop]);
  const hopStyle = { transform: [{ translateY: hop.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }, { scale: hop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }] };
  return (
    <DopaminePressable
      style={s.fabBtn}
      onPress={onPress}
      sound="click"
      activeScale={0.88}
      accessibilityRole="button"
      accessibilityLabel={totalItems > 0 ? `Open basket, ${totalItems} ${totalItems === 1 ? 'item' : 'items'}` : 'Open basket'}
    >
      <Animated.View style={hopStyle}>
        <BasketFabIcon size={34} bg={COLORS.red} />
      </Animated.View>
      {totalItems > 0 ? (
        <View style={s.fabBadge} pointerEvents="none">
          <Text style={s.fabBadgeText} maxFontSizeMultiplier={1.3}>{totalItems > 99 ? '99+' : totalItems}</Text>
        </View>
      ) : null}
    </DopaminePressable>
  );
});

/**
 * The round basket button, bottom right over the page (owner, 28 Oct 2026: the Basket tab became Services; campus
 * chats stay on the Campus pill in Home's header).
 */
export function FloatingBasketButton({ onPress }: { onPress: () => void }) {
  return (
    <FloatingPulse color={COLORS.red} style={s.fabBtnWrap}>
      <BasketFab onPress={onPress} />
    </FloatingPulse>
  );
}

const s = StyleSheet.create({
  // Owner, 31 Oct 2026: "basket icon is too low, move it up a little" (was bottom 20). The "View basket" bar
  // (floatingCartWrap) moves up by the same 16 so the two stay side by side.
  fabBtnWrap: { position: 'absolute', bottom: 36, right: 20, width: 54, height: 54, zIndex: 999 },
  fabBtn: { width: 54, height: 54, borderRadius: 27, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center', ...SHADOWS.redGlow },
  fabBadge: { position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: COLORS.red, alignItems: 'center', justifyContent: 'center' },
  fabBadgeText: { color: COLORS.red, fontSize: 11, fontWeight: '800' },

  floatingCartWrap: {
    position: 'absolute',
    bottom: 40,
    left: 16,
    right: 76,
    zIndex: 95,
  },
  floatingCartBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1.5,
    ...SHADOWS.card,
    elevation: 8,
  },
  floatingCartBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingCartLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  floatingCartSub: {
    fontSize: 12,
    fontWeight: '600',
  },
  floatingCartCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  floatingCartCtaText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
