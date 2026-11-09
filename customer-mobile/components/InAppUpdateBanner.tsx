import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useDietLight } from './local/dietLightTheme';
import { LIGHT_SURFACE, TYPE } from '../constants/theme';
import {
  completeInAppUpdate,
  hideInAppUpdateBanner,
  startFlexibleUpdate,
  useInAppUpdate,
} from '../utils/inAppUpdate';

// Screens where nothing may interrupt the student (paying / placing an order). The banner waits.
const QUIET_PATHS = ['/checkout', '/campus-booking/pay'];

/**
 * In-app update banner (utils/inAppUpdate.ts): "A new version of ZenWe is ready" [Update] [Later] ->
 * download progress -> "Update downloaded" [Restart]. Shows only when Google Play's in-app update API works
 * on this install; otherwise it renders nothing (UpdateGate's store-link banner stays the fallback).
 */
export default function InAppUpdateBanner() {
  const s = useInAppUpdate();
  const pathname = usePathname() || '/';
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  // Owner, 10 Nov 2026: the diet accent (was the brand red in Veg mode too).
  const d = useDietLight();

  const quiet = QUIET_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const visible =
    s.supported === true && !s.hidden && !quiet &&
    (s.phase === 'available' || s.phase === 'starting' || s.phase === 'downloading' || s.phase === 'downloaded' ||
      s.phase === 'installing' || s.phase === 'failed');
  if (!visible) return null;

  const pct = s.progress !== null ? Math.round(s.progress * 100) : null;
  let title = 'A new version of ZenWe is ready';
  let sub = 'Update in the app. It downloads in the background while you keep ordering.';
  if (s.phase === 'downloading' || s.phase === 'starting') {
    title = s.phase === 'starting' ? 'Starting the update…' : `Downloading update${pct !== null ? ` · ${pct}%` : '…'}`;
    sub = 'You can keep using ZenWe.';
  } else if (s.phase === 'downloaded') {
    title = 'Update downloaded';
    sub = 'Restart ZenWe to finish. It takes a few seconds.';
  } else if (s.phase === 'installing') {
    title = 'Installing update…';
    sub = 'ZenWe will reopen by itself.';
  } else if (s.phase === 'failed') {
    title = 'The update did not finish';
    sub = 'Check your connection and try again.';
  }

  const busy = s.phase === 'starting' || s.phase === 'installing';
  const showPrimary = s.phase === 'available' || s.phase === 'downloaded' || s.phase === 'failed';
  const primaryLabel = s.phase === 'downloaded' ? 'Restart' : s.phase === 'failed' ? 'Try again' : 'Update';
  const onPrimary = s.phase === 'downloaded' ? completeInAppUpdate : startFlexibleUpdate;
  const showLater = s.phase !== 'installing' && s.phase !== 'starting';

  return (
    <View pointerEvents="box-none" style={[st.wrap, { top: insets.top + 8 }]}>
      <View
        style={[
          st.card,
          { backgroundColor: colors.card, borderColor: isDark ? colors.cardBorder : 'transparent' },
          !isDark && LIGHT_SURFACE,
        ]}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
      >
        <View style={st.row}>
          <View style={[st.icon, { backgroundColor: d.soft }]}>
            {busy ? (
              <ActivityIndicator size="small" color={d.acc} />
            ) : (
              <Ionicons
                name={s.phase === 'downloaded' ? 'checkmark-circle' : s.phase === 'failed' ? 'alert-circle' : 'arrow-down-circle'}
                size={22}
                color={d.acc}
              />
            )}
          </View>
          <View style={st.texts}>
            <Text style={[st.title, { color: colors.text }]} maxFontSizeMultiplier={1.4}>{title}</Text>
            <Text style={[st.sub, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.4}>{sub}</Text>
          </View>
        </View>

        {s.phase === 'downloading' && (
          <View
            style={[st.track, { backgroundColor: d.soft }]}
            accessibilityRole="progressbar"
            accessibilityValue={pct !== null ? { min: 0, max: 100, now: pct } : undefined}
          >
            <View style={[st.fill, { backgroundColor: d.acc, width: `${pct !== null ? Math.max(4, pct) : 12}%` }]} />
          </View>
        )}

        {(showPrimary || showLater) && (
          <View style={st.actions}>
            {showLater && (
              <Pressable
                onPress={hideInAppUpdateBanner}
                style={({ pressed }) => [st.later, pressed && st.pressed]}
                accessibilityRole="button"
                accessibilityLabel={s.phase === 'downloading' ? 'Hide' : 'Later'}
                hitSlop={6}
              >
                <Text style={[st.laterText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.4}>
                  {s.phase === 'downloading' ? 'Hide' : 'Later'}
                </Text>
              </Pressable>
            )}
            {showPrimary && (
              <Pressable
                onPress={() => { onPrimary(); }}
                style={({ pressed }) => [st.primary, { backgroundColor: d.acc }, pressed && st.pressed]}
                accessibilityRole="button"
                accessibilityLabel={primaryLabel === 'Restart' ? 'Restart ZenWe to install the update' : `${primaryLabel} ZenWe`}
              >
                <Text style={[st.primaryText, { color: d.onAcc }]} maxFontSizeMultiplier={1.4}>{primaryLabel}</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 999990, elevation: 10 },
  card: { borderRadius: 18, borderWidth: 1, padding: 14 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, minWidth: 0 },
  title: { ...TYPE.heading, fontSize: 15 },
  sub: { fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 12 },
  fill: { height: 6, borderRadius: 3 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  later: { paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: 12 },
  laterText: { fontSize: 14, fontWeight: '600' },
  primary: { paddingHorizontal: 18, minHeight: 40, justifyContent: 'center', borderRadius: 12 },
  primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.85 },
});
