import React, { useMemo } from 'react';
import { Tabs } from 'expo-router';
import { View, Text, StyleSheet, Platform, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { useCartTotalItems } from '../../context/CartContext';
import { Ionicons } from '@expo/vector-icons';
import { playSound, resumeAudio } from '../../utils/sounds';
import { useTabBarTones } from '../../utils/tabBarTone';
import LocalStoreIcon from '../../components/LocalStoreIcon';
import { useNavAccent } from '../../components/local/dietLightTheme';

// Ionicons has no shop-with-a-pin glyph: the Local tab draws its own (components/LocalStoreIcon).
const LOCAL_STORE_ICON = 'local-store';

/** Basket count bubble: the only part of the tab bar that re-renders when the basket changes. */
const CartBadge = React.memo(function CartBadge({ isDark }: { isDark: boolean }) {
  const totalItems = useCartTotalItems();
  if (!(totalItems > 0)) return null;
  return (
    <View style={[styles.cartBadge, { borderColor: isDark ? '#09090B' : '#FFFFFF' }]}>
      <Text style={styles.cartBadgeText} maxFontSizeMultiplier={1.3}>{totalItems > 99 ? '99+' : totalItems}</Text>
    </View>
  );
});

// The bar and inactive inks of a light and a dark bar. The navigator hands every icon the FOCUSED tab's ink
// (tabBarInactiveTintColor below), so all icons follow the bar of the page in front; a dark bar's labels sit a step
// lighter than its icons.
const INK = {
  light: { bar: '#FFFFFF', icon: '#617088', label: '#617088' },
  dark: { bar: '#09090B', icon: COLORS.textMuted, label: COLORS.textSecondary },
};

const TabIcon = React.memo(function TabIcon({ name, focused, iconName, color, showCartBadge }: { name: string; focused: boolean; iconName: any; color: ColorValue; showCartBadge?: boolean }) {
  const accent = useNavAccent();
  const onDark = color === INK.dark.icon;
  const labelColor = onDark ? INK.dark.label : color;

  return (
    <View style={styles.tabIconWrap}>
      {/* In the layout (not absolute) with a fixed gap, so it can never touch the icon (owner, 10 Nov 2026);
          an invisible one on other tabs keeps every icon at the same height. */}
      <View style={[styles.activeIndicator, { backgroundColor: focused ? accent : 'transparent' }]} />
      <View style={{ position: 'relative' }}>
        {iconName === LOCAL_STORE_ICON ? (
          <LocalStoreIcon size={22} color={focused ? accent : color} filled={focused} style={focused ? styles.tabIconActive : styles.tabIcon} />
        ) : (
          <Ionicons
            name={focused ? iconName : `${iconName}-outline`}
            size={22}
            color={focused ? accent : color}
            style={focused ? styles.tabIconActive : styles.tabIcon}
          />
        )}
        {showCartBadge && <CartBadge isDark={onDark} />}
      </View>
      <Text style={[styles.tabLabel, { color: focused ? accent : labelColor, fontWeight: focused ? '900' : '700' }]}
        // QA 5 Nov 2026: at 130% system font "Groceries" / "Services" were cut. Capped growth, one line, and the
        // label shrinks to fit its slot rather than clipping (5 tabs on a 360dp screen).
        maxFontSizeMultiplier={1.15}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
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
  const tones = useTabBarTones();
  const navAccent = useNavAccent();

  // Each tab's bar options: the theme's bar, or the page tone the tab set (utils/tabBarTone); the navigator draws the
  // focused tab's. Built once per change, so every tab's options stay referentially stable between renders.
  const screenOptions = useMemo(() => {
    const make = (dark: boolean, bar: string) => ({
      headerShown: false,
      // Hidden tabs stop re-rendering (react-native-screens freeze): less JS work, smoother taps on the visible tab.
      freezeOnBlur: true,
      tabBarShowLabel: false,
      tabBarActiveTintColor: navAccent,
      tabBarInactiveTintColor: dark ? INK.dark.icon : INK.light.icon,
      tabBarStyle: {
        backgroundColor: bar,
        borderTopWidth: 1,
        // Light bar: it lifts off the page with a soft shadow, no top outline
        borderTopColor: dark ? 'rgba(255,255,255,0.08)' : 'transparent',
        // 66: room for the active line above the icon (owner, 10 Nov 2026: the line was merging with the icons)
        height: Platform.OS === 'ios' ? 92 : 66 + insets.bottom,
        paddingTop: 8,
        paddingBottom: Platform.OS === 'ios' ? 24 : insets.bottom > 0 ? insets.bottom : 8,
        elevation: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: dark ? 0.35 : 0.08,
        shadowRadius: 12,
      },
    });
    const themed = make(isDark, isDark ? INK.dark.bar : INK.light.bar);
    const toned: Record<string, ReturnType<typeof make>> = {};
    Object.entries(tones).forEach(([tab, tone]) => { if (tone) toned[tab] = make(tone.dark, tone.bg); });
    return ({ route }: { route: { name: string } }) => toned[route.name] || themed;
  }, [isDark, insets.bottom, tones, navAccent]);

  const tabOptions = useMemo(() => {
    const make = (name: string, iconName: string, showCartBadge?: boolean) => ({
      tabBarAccessibilityLabel: name,
      tabBarIcon: ({ focused, color }: { focused: boolean; color: ColorValue }) => (
        <TabIcon name={name} focused={focused} iconName={iconName} color={color} showCartBadge={showCartBadge} />
      ),
    });
    return {
      index: make('Home', 'home'),
      // Local (owner, 3 Nov 2026): In-Campus Booking and the stalls near campus (app/(tabs)/local.tsx).
      local: make('Local', LOCAL_STORE_ICON),
      others: make('Groceries', 'storefront'),
      orders: make('Orders', 'receipt'),
      // Services replaced the Basket tab (owner, 28 Oct 2026); the basket opens from the floating button on Home and Local.
      services: make('Services', 'construct'),
    };
  }, []);

  // Profile (opened from the avatar at the top of Home; owner, 3 Nov 2026: no Profile button in the bar) and the basket
  // stay tab routes, so every link to them keeps working, but have no button in the bar. A plain object on purpose:
  // expo-router reads `href` only from options that are not a function.
  const hiddenOptions = useMemo(() => ({ href: null }), []);

  return (
    <Tabs screenOptions={screenOptions}>
      {/* The bar, left to right: instant switch, no transition */}
      <Tabs.Screen name="index" options={tabOptions.index} listeners={TAB_LISTENERS} />
      <Tabs.Screen name="local" options={tabOptions.local} listeners={TAB_LISTENERS} />
      <Tabs.Screen name="others" options={tabOptions.others} listeners={TAB_LISTENERS} />
      <Tabs.Screen name="orders" options={tabOptions.orders} listeners={TAB_LISTENERS} />
      <Tabs.Screen name="services" options={tabOptions.services} listeners={TAB_LISTENERS} />

      {/* No button in the bar */}
      <Tabs.Screen name="profile" options={hiddenOptions} listeners={TAB_LISTENERS} />
      <Tabs.Screen name="basket" options={hiddenOptions} listeners={TAB_LISTENERS} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // The navigator centres this block on a 28 px icon box, so anything placed above the block can leave the bar
  // (2 Nov 2026: the active line crossed the page, e.g. "My tickets", where the bar has no system-bar inset). The
  // line's room is part of the block (paddingTop, on every tab so icons stay level), so it always sits in the bar.
  tabIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    // 68: five slots fit a 360dp screen (72 each) and "Groceries" fits without shrinking at normal font size.
    width: 68,
    paddingTop: 0,
    position: 'relative',
  },
  activeIndicator: {
    width: 26,
    height: 3,
    borderRadius: 2,
    marginBottom: 7,
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
    alignSelf: 'stretch',
    textAlign: 'center',
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
