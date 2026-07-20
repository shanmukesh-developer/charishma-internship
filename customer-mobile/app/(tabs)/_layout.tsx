import React from 'react';
import { Tabs } from 'expo-router';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../../constants/theme';
import { useWorldTransition } from '../../context/WorldTransitionContext';
import { useTheme } from '../../context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { playSound, resumeAudio } from '../../utils/sounds';

function TabIcon({ name, focused, iconName, isDark }: { name: string; focused: boolean; iconName: any; isDark: boolean }) {
  const inactiveColor = isDark ? '#666' : '#999';
  const labelColor = isDark ? COLORS.textMuted : '#9CA3AF';

  return (
    <View style={styles.tabIconWrap}>
      {focused && <View style={styles.activeIndicator} />}
      <Ionicons 
        name={focused ? iconName : `${iconName}-outline`} 
        size={22} 
        color={focused ? COLORS.red : inactiveColor} 
        style={focused ? styles.tabIconActive : styles.tabIcon}
      />
      <Text style={[styles.tabLabel, { color: focused ? COLORS.red : labelColor }]}>
        {name}
      </Text>
    </View>
  );
}

export default function TabLayout() {
  const { triggerTransition } = useWorldTransition();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  // Only Home and Others get the cinematic world transition.
  // Orders, Basket, Profile switch instantly — no overlay needed.
  const makeTransitionListener = (path: string, world: any) => ({
    tabPress: (e: any) => {
      e.preventDefault();
      triggerTransition(path, world);
    }
  });

  // Theme-aware tab bar style
  const tabBarStyle = {
    backgroundColor: isDark ? COLORS.bgDark : '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: isDark ? COLORS.borderDark : 'rgba(0,0,0,0.06)',
    height: Platform.OS === 'ios' ? 88 : 60 + insets.bottom,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : insets.bottom > 0 ? insets.bottom : 8,
    elevation: 20,
    shadowColor: isDark ? '#000' : 'rgba(0,0,0,0.1)',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: isDark ? 0.3 : 0.08,
    shadowRadius: 12,
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: tabBarStyle,
        tabBarShowLabel: false,
      }}
    >
      {/* Home & Others — cinematic world transition */}
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="Home" focused={focused} iconName="home" isDark={isDark} />,
        }}
        listeners={{
          tabPress: () => {
            resumeAudio();
            playSound('tabSwitch');
          }
        }}
      />
      <Tabs.Screen
        name="others"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="Others" focused={focused} iconName="grid" isDark={isDark} />,
        }}
        listeners={{
          tabPress: () => {
            resumeAudio();
            playSound('tabSwitch');
          }
        }}
      />

      {/* Orders, Basket, Profile — instant switch, no transition */}
      <Tabs.Screen
        name="orders"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="Orders" focused={focused} iconName="receipt" isDark={isDark} />,
        }}
        listeners={{
          tabPress: () => {
            resumeAudio();
            playSound('tabSwitch');
          }
        }}
      />
      <Tabs.Screen
        name="basket"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="Basket" focused={focused} iconName="cart" isDark={isDark} />,
        }}
        listeners={{
          tabPress: () => {
            resumeAudio();
            playSound('tabSwitch');
          }
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="Profile" focused={focused} iconName="person" isDark={isDark} />,
        }}
        listeners={{
          tabPress: () => {
            resumeAudio();
            playSound('tabSwitch');
          }
        }}
      />
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
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 3,
    textTransform: 'uppercase',
  },
});
