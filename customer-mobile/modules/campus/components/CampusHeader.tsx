import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ShieldCheck, Plus, ArrowLeft, Sparkles, X } from '../../../components/lucide';
import * as Haptics from 'expo-haptics';
import { CampusColors, CampusLayout } from '../../../constants/campusTheme';
import { CampusProfileData } from '../../../types/campus';
import { FriendsChrome } from '../friends/friendsTheme';
import { BrandFill } from '../friends/shared/FriendsUi';

interface CampusHeaderProps {
  profile: CampusProfileData | null;
  title: string;
  onBack?: () => void;
  /** Header "+": start a chat, create a group, join with a code, add a friend. */
  onPlus?: () => void;
  onOpenVerify?: () => void;
  /** Show the one dismissible verification banner (signed-in, unverified students only). */
  showVerifyBanner?: boolean;
  onDismissVerifyBanner?: () => void;
  /** 'dark' while the Friends tab is open (Zenvy Friends dark theme). */
  tone?: 'light' | 'dark';
}

export const CampusHeader: React.FC<CampusHeaderProps> = ({
  profile,
  title,
  onBack,
  onPlus,
  onOpenVerify,
  showVerifyBanner,
  onDismissVerifyBanner,
  tone = 'light',
}) => {
  const dark = tone === 'dark';
  const isVerified = profile?.verificationStatus === 'verified';
  const isPending = profile?.verificationStatus === 'pending';
  const isRejected = profile?.verificationStatus === 'rejected';
  const campusCode = profile?.campus?.code || null;

  return (
    <View style={[styles.header, dark && styles.headerDark]}>
      <View style={styles.topRow}>
        {onBack && (
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              onBack();
            }}
            accessibilityLabel="Back"
            activeOpacity={0.7}
          >
            <ArrowLeft size={22} color={dark ? FriendsChrome.ink : CampusColors.ink} strokeWidth={2.2} />
          </TouchableOpacity>
        )}
        <View style={styles.titleContainer}>
          <Text style={[styles.title, dark && { color: FriendsChrome.ink }]} numberOfLines={1} accessibilityRole="header">{title}</Text>
          {campusCode && (
            <View style={[styles.campusBadge, dark && { backgroundColor: FriendsChrome.accentSoft }]}>
              <Text style={[styles.campusBadgeText, dark && { color: FriendsChrome.accent }]}>{campusCode}</Text>
              {isVerified && <ShieldCheck size={11} color={dark ? FriendsChrome.accent : CampusColors.accentDeep} strokeWidth={2.4} />}
            </View>
          )}
        </View>

        {onPlus && (
          <TouchableOpacity
            style={[styles.iconButton, styles.primaryButton, dark && { backgroundColor: FriendsChrome.accent }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              onPlus();
            }}
            accessibilityLabel="New chat, group or join"
          >
            {dark ? <BrandFill radius={22} /> : null}
            <Plus size={20} color={dark ? FriendsChrome.accentInk : '#FFFFFF'} strokeWidth={2.4} />
          </TouchableOpacity>
        )}
      </View>

      {showVerifyBanner && profile && !isVerified && (
        <View style={[styles.banner, isRejected && { backgroundColor: '#FDECEB' }]}>
          <TouchableOpacity style={styles.bannerMain} onPress={onOpenVerify} activeOpacity={0.85}>
            <Sparkles size={16} color={isRejected ? '#A3321A' : CampusColors.warm} strokeWidth={2} />
            <Text style={[styles.bannerText, isRejected && { color: '#A3321A' }]} numberOfLines={2}>
              {isPending
                ? 'Your ID card is being reviewed. Tap to check status.'
                : isRejected
                ? 'Verification was not approved. Tap to see why and retry.'
                : 'Verify you are a student with your college email or ID card (+150 pts).'}
            </Text>
          </TouchableOpacity>
          {onDismissVerifyBanner && (
            <TouchableOpacity onPress={onDismissVerifyBanner} hitSlop={10} accessibilityLabel="Hide">
              <X size={16} color={CampusColors.muted} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    backgroundColor: CampusColors.paper,
    paddingHorizontal: CampusLayout.spacing.lg,
    paddingTop: CampusLayout.spacing.sm,
    paddingBottom: CampusLayout.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: CampusColors.line,
  },
  headerDark: { backgroundColor: FriendsChrome.bg, borderBottomColor: 'transparent' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: CampusLayout.spacing.sm, minHeight: 48 },
  titleContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800', color: CampusColors.ink, letterSpacing: -0.3, flexShrink: 1 },
  campusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: CampusColors.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: CampusLayout.radius.pill,
  },
  campusBadgeText: { fontSize: 12, fontWeight: '800', color: CampusColors.accentDeep, letterSpacing: 0.4 },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  primaryButton: { backgroundColor: CampusColors.accent },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: CampusLayout.spacing.sm,
    backgroundColor: CampusColors.warmSoft,
    borderRadius: CampusLayout.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bannerMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  bannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: CampusColors.warmDeep, lineHeight: 18 },
});
