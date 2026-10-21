import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MessageSquare, Users, School, User } from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors, CampusLayout } from '../../../constants/campusTheme';
import { CampusTab } from '../../../types/campus';
import { FriendsChrome } from '../friends/friendsTheme';

interface CampusBottomNavProps {
  activeTab: CampusTab;
  onSelectTab: (tab: CampusTab) => void;
  unreadCount?: number;
  /** Pending friend requests (shown on Me). */
  meBadge?: number;
  /** 'dark' while the Friends tab is open. */
  tone?: 'light' | 'dark';
}

export const CampusBottomNav: React.FC<CampusBottomNavProps> = ({
  activeTab,
  onSelectTab,
  unreadCount = 0,
  meBadge = 0,
  tone = 'light',
}) => {
  const dark = tone === 'dark';
  const activeColor = dark ? FriendsChrome.accent : CampusColors.accent;
  const idleColor = dark ? FriendsChrome.muted : CampusColors.muted;
  // Friends is the app's dark "night campus"; the chrome follows it so the switch reads as intentional.
  const tabs: { key: CampusTab; label: string; icon: typeof MessageSquare }[] = [
    { key: 'chats', label: 'Chats', icon: MessageSquare },
    { key: 'friends', label: 'Friends', icon: Users },
    { key: 'campus', label: 'Around campus', icon: School },
    { key: 'me', label: 'Me', icon: User },
  ];

  return (
    <View style={[styles.container, dark && styles.containerDark]} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.key;
        const IconComponent = tab.icon;

        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tabButton}
            onPress={() => {
              if (!isActive) {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onSelectTab(tab.key);
              }
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${tab.label} tab`}
            activeOpacity={0.7}
          >
            <View style={[styles.iconWrapper, isActive && styles.activeIconWrapper, isActive && dark && { backgroundColor: FriendsChrome.accentSoft }]}>
              <IconComponent
                size={22}
                color={isActive ? activeColor : idleColor}
                strokeWidth={isActive ? 2.2 : 1.8}
              />
              {(() => {
                const n = tab.key === 'chats' ? unreadCount : tab.key === 'me' ? meBadge : 0;
                return n > 0 ? (
                  <View style={[styles.badge, dark && { borderColor: FriendsChrome.bg, backgroundColor: FriendsChrome.accent }]}>
                    <Text style={[styles.badgeText, dark && { color: FriendsChrome.accentInk }]}>{n > 99 ? '99+' : n}</Text>
                  </View>
                ) : null;
              })()}
            </View>
            <Text
              style={[styles.tabLabel, { color: idleColor }, isActive && styles.activeTabLabel, isActive && { color: activeColor }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: CampusColors.card,
    borderTopWidth: 1,
    borderTopColor: CampusColors.line,
    paddingVertical: 8,
    paddingBottom: 8, // the shell's SafeAreaView already pads for the home indicator
    justifyContent: 'space-around',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 8,
  },
  containerDark: { backgroundColor: FriendsChrome.bg, borderTopColor: FriendsChrome.line, borderTopWidth: StyleSheet.hairlineWidth * 2, shadowOpacity: 0, elevation: 0 },
  tabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
    minHeight: CampusLayout.touchTargetMin,
  },
  iconWrapper: {
    position: 'relative',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: CampusLayout.radius.pill,
  },
  activeIconWrapper: {
    backgroundColor: CampusColors.accentSoft,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: CampusColors.muted,
    marginTop: 2,
  },
  activeTabLabel: {
    color: CampusColors.accent,
    fontWeight: '700',
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 4,
    backgroundColor: CampusColors.accent,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: CampusColors.card,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
