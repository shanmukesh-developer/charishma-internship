import React, { useMemo } from 'react';
import { Tabs } from 'expo-router';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { useCartState } from '../../context/CartContext';
import { Ionicons } from '@expo/vector-icons';
import { playSound, resumeAudio } from '../../utils/sounds';
import { plural } from '../../utils/format';

/** Basket count bubble: the only part of the tab bar that re-renders when the basket changes. */
const CartBadge = React.memo(function CartBadge({ isDark }: { isDark: boolean }) {
  const { totalItems } = useCartState();
  if (!(totalItems > 0)) return null;
  return (
    <View style={[styles.cartBadge, { borderColor: isDark ? '#09090B' : '#FFFFFF' }]}>
      <Text style={styles.cartBadgeText}>{totalItems > 99 ? '99+' : totalItems}</Text>
    </View>
  );
});

const TabIcon = React.memo(function TabIcon({ name, focused, iconName, isDark, showCartBadge }: { name: string; focused: boolean; iconName: any; isDark: boolean; showCartBadge?: boolean }) {
  const inactiveColor = isDark ? COLORS.textMuted : '#617088';
  const labelColor = isDark ? COLORS.textSecondary : '#617088';

  return (
    <View style={styles.tabIconWrap}>
      {focused && <View style={styles.activeIndicator} />}
      <View style={{ position: 'relative' }}>
        <Ionicons
          name={focused ? iconName : `${iconName}-outline`}
          size={22}
          color={focused ? COLORS.red : inactiveColor}
          style={focused ? styles.tabIconActive : styles.tabIcon}
        />
        {showCartBadge && <CartBadge isDark={isDark} />}
      </View>
      <Text style={[styles.tabLabel, { color: focused ? COLORS.red : labelColor, fontWeight: focused ? '900' : '700' }]}>
        {name}
      </Text>
    </View>
  );
});

// Every tab plays the same click on press (module-level, so its identity never changes).
const TAB_LISTENERS = {
  tabPress: () => {
    resumeAudio();
    playSound('tabSwitch');
  },
};

export default function TabLayout() {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { totalItems } = useCartState();

  // Theme-aware tab bar style, memoized so the navigator's options stay referentially stable.
  const screenOptions = useMemo(() => ({
    headerShown: false,
    tabBarShowLabel: false,
    tabBarStyle: {
      backgroundColor: isDark ? '#09090B' : '#FFFFFF',
      borderTopWidth: 1,
      borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      height: Platform.OS === 'ios' ? 88 : 60 + insets.bottom,
      paddingTop: 8,
      paddingBottom: Platform.OS === 'ios' ? 24 : insets.bottom > 0 ? insets.bottom : 8,
      elevation: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: isDark ? 0.35 : 0.06,
      shadowRadius: 12,
    },
  }), [isDark, insets.bottom]);

  const tabOptions = useMemo(() => {
    const make = (name: string, iconName: string, showCartBadge?: boolean) => ({
      tabBarAccessibilityLabel: name,
      tabBarIcon: ({ focused }: { focused: boolean }) => (
        <TabIcon name={name} focused={focused} iconName={iconName} isDark={isDark} showCartBadge={showCartBadge} />
      ),
    });
    return {
      index: make('Home', 'home'),
      others: make('Others', 'grid'),
      orders: make('Orders', 'receipt'),
      basket: make('Basket', 'cart', true),
      profile: make('Profile', 'person'),
    };
  }, [isDark]);

  // Screen readers hear the basket count ("Basket, 3 items"); only this tab's options change with it.
  const basketOptions = useMemo(() => ({
    ...tabOptions.basket,
    tabBarAccessibilityLabel: totalItems > 0 ? `Basket, ${plural(totalItems, 'item')}` : 'Basket',
  }), [tabOptions, totalItems]);

  return (
    <Tabs screenOptions={screenOptions}>
      {/* Home & Others */}
      <Tabs.Screen name="index" options={tabOptions.index} listeners={TAB_LISTENERS} />
      <Tabs.Screen name="others" options={tabOptions.others} listeners={TAB_LISTENERS} />

      {/* Orders, Basket, Profile — instant switch, no transition */}
      <Tabs.Screen name="orders" options={tabOptions.orders} listeners={TAB_LISTENERS} />
      <Tabs.Screen name="basket" options={basketOptions} listeners={TAB_LISTENERS} />
      <Tabs.Screen name="profile" options={tabOptions.profile} listeners={TAB_LISTENERS} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 60,
    position: 'relative',
  },
  activeIndicator: {
    position: 'absolute',
    top: -12,
    width: 24,
    height: 3,
    borderRadius: 2,
    backgroundColor: COLORS.red,
  },
  tabIcon: {
    opacity: 0.65,
  },
  tabIconActive: {
    opacity: 1,
    transform: [{ scale: 1.15 }],
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginTop: 3,
  },
  cartBadge: {
    position: 'absolute',
    top: -4,
    right: -10,
    backgroundColor: '#EF4444',
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  cartBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
});
