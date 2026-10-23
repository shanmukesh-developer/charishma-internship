/**
 * Bottom of the Profile tab, laid out like a phone's Settings screen: grouped cards with icon rows.
 *  Preferences     Dark mode and App sounds (real switches).
 *  Help and legal  Help & FAQ, the policies (same pages as before) and, for guests, About ZCS.
 *  Account         Sign out (signed in only; the caller confirms first).
 * Then a small, muted "Delete account" button (the existing deletion flow) and the app version.
 * Light mode: white grouped cards with the app's soft shadow; dark mode: the existing dark surfaces.
 */
import React from 'react';
import { View, Text, StyleSheet, Switch, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useTheme } from '../context/ThemeContext';
import { COLORS, surfaceLift } from '../constants/theme';
import { openLegal, type LegalPage } from '../utils/legal';

type IconName = keyof typeof Ionicons.glyphMap;

/** "1.0.8 (build 9)" from the app config (native build number when the platform has one). */
export function appVersionText(): string {
  const cfg: any = Constants.expoConfig || {};
  const version = cfg.version || '1.0.0';
  const build = Platform.OS === 'android' ? cfg.android?.versionCode : Platform.OS === 'ios' ? cfg.ios?.buildNumber : null;
  return build ? `${version} (build ${build})` : version;
}

const DANGER = '#E5484D';
// react-native-web paints the "on" thumb teal unless told otherwise (prop exists only on web).
const WEB_THUMB: any = Platform.OS === 'web' ? { activeThumbColor: '#FFFFFF' } : {};

export default function ProfileSettingsSection({
  signedIn, soundsOn, onSoundsChange, onOpenHelp, onOpenAbout, onSignOut, onDeleteAccount,
}: {
  signedIn: boolean;
  soundsOn: boolean;
  onSoundsChange: (on: boolean) => void;
  onOpenHelp: () => void;
  /** Guests have no About tile above, so the row is offered here. */
  onOpenAbout?: () => void;
  onSignOut?: () => void;
  onDeleteAccount?: () => void;
}) {
  const { isDark, toggleTheme, colors } = useTheme();
  const gold = isDark ? COLORS.gold : colors.gold;
  const card = [st.group, { backgroundColor: colors.card, borderColor: colors.border }, surfaceLift(isDark)];
  const tint = isDark ? 'rgba(212,175,122,0.14)' : 'rgba(184,134,11,0.10)';
  const track = { false: isDark ? '#3A3A3C' : '#D1D5DB', true: gold };

  const legal: { key: LegalPage; icon: IconName; title: string }[] = [
    { key: 'privacy', icon: 'lock-closed-outline', title: 'Privacy policy' },
    { key: 'terms', icon: 'document-text-outline', title: 'Terms of service' },
    { key: 'refunds', icon: 'receipt-outline', title: 'Cancellation & refunds' },
    { key: 'grievance', icon: 'chatbox-ellipses-outline', title: 'Grievance redressal' },
    { key: 'community', icon: 'people-outline', title: 'Community guidelines' },
    { key: 'index', icon: 'library-outline', title: 'All policies' },
  ];

  const Icon = ({ name, danger }: { name: IconName; danger?: boolean }) => (
    <View style={[st.icon, { backgroundColor: danger ? 'rgba(229,72,77,0.12)' : tint }]}>
      <Ionicons name={name} size={18} color={danger ? DANGER : gold} />
    </View>
  );
  const Divider = () => <View style={[st.divider, { backgroundColor: colors.border }]} />;
  const Chevron = () => <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />;

  return (
    <View style={st.wrap}>
      {/* Preferences */}
      <Text style={[st.groupLabel, { color: colors.textSecondary }]} accessibilityRole="header">Preferences</Text>
      <View style={card}>
        <View style={st.row}>
          <Icon name={isDark ? 'moon' : 'moon-outline'} />
          <View style={st.rowText}>
            <Text style={[st.title, { color: colors.text }]}>Dark mode</Text>
            <Text style={[st.sub, { color: colors.textSecondary }]} numberOfLines={1}>Easier on the eyes at night</Text>
          </View>
          <Switch value={isDark} onValueChange={() => toggleTheme()} trackColor={track} thumbColor="#FFFFFF" {...WEB_THUMB} accessibilityLabel="Dark mode" />
        </View>
        <Divider />
        <View style={st.row}>
          <Icon name={soundsOn ? 'volume-medium-outline' : 'volume-mute-outline'} />
          <View style={st.rowText}>
            <Text style={[st.title, { color: colors.text }]}>App sounds</Text>
            <Text style={[st.sub, { color: colors.textSecondary }]} numberOfLines={2}>Taps, tabs and add to basket. Never plays when your phone is on silent.</Text>
          </View>
          <Switch value={soundsOn} onValueChange={onSoundsChange} trackColor={track} thumbColor="#FFFFFF" {...WEB_THUMB} accessibilityLabel="App sounds" />
        </View>
      </View>

      {/* Help and legal */}
      <Text style={[st.groupLabel, { color: colors.textSecondary }]} accessibilityRole="header">Help and legal</Text>
      <View style={card}>
        <TouchableOpacity style={st.row} onPress={onOpenHelp} activeOpacity={0.6} accessibilityRole="button" accessibilityLabel="Help and FAQ">
          <Icon name="help-circle-outline" />
          <Text style={[st.title, st.rowText, { color: colors.text }]}>Help & FAQ</Text>
          <Chevron />
        </TouchableOpacity>
        {legal.map((l) => (
          <React.Fragment key={l.key}>
            <Divider />
            <TouchableOpacity style={st.row} onPress={() => openLegal(l.key)} activeOpacity={0.6} accessibilityRole="link" accessibilityLabel={l.title}>
              <Icon name={l.icon} />
              <Text style={[st.title, st.rowText, { color: colors.text }]}>{l.title}</Text>
              <Chevron />
            </TouchableOpacity>
          </React.Fragment>
        ))}
        {onOpenAbout ? (
          <>
            <Divider />
            <TouchableOpacity style={st.row} onPress={onOpenAbout} activeOpacity={0.6} accessibilityRole="button" accessibilityLabel="About ZCS">
              <Icon name="information-circle-outline" />
              <Text style={[st.title, st.rowText, { color: colors.text }]}>About ZCS</Text>
              <Chevron />
            </TouchableOpacity>
          </>
        ) : null}
      </View>

      {/* Account */}
      {signedIn && onSignOut ? (
        <>
          <Text style={[st.groupLabel, { color: colors.textSecondary }]} accessibilityRole="header">Account</Text>
          <View style={card}>
            <TouchableOpacity style={st.row} onPress={onSignOut} activeOpacity={0.6} accessibilityRole="button" accessibilityLabel="Sign out" accessibilityHint="Signs you out on this phone">
              <Icon name="log-out-outline" danger />
              <View style={st.rowText}>
                <Text style={[st.title, { color: DANGER }]}>Sign out</Text>
                <Text style={[st.sub, { color: colors.textSecondary }]} numberOfLines={1}>On this phone only</Text>
              </View>
            </TouchableOpacity>
          </View>
        </>
      ) : null}

      {signedIn && onDeleteAccount ? (
        <TouchableOpacity onPress={onDeleteAccount} style={st.delete} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel="Delete account">
          <Text style={[st.deleteText, { color: colors.textMuted }]}>Delete account</Text>
        </TouchableOpacity>
      ) : null}

      <Text style={[st.version, { color: colors.textMuted }]} accessibilityLabel={`ZCS version ${appVersionText()}`}>ZCS · Version {appVersionText()}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { paddingBottom: 32 },
  groupLabel: { fontSize: 13, fontWeight: '600', marginHorizontal: 28, marginTop: 8, marginBottom: 8 },
  group: { marginHorizontal: 16, marginBottom: 20, borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10 },
  rowText: { flex: 1, minWidth: 0 },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '500' },
  sub: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 60 },
  delete: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 12, marginTop: -4 },
  deleteText: { fontSize: 13, fontWeight: '500' },
  version: { fontSize: 12, textAlign: 'center', marginTop: 8 },
});
