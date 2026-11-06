/**
 * "About ZenWe" sheet (opened from Profile). Owner design, 6 Nov 2026 ("I want this section as it is"):
 * a dark, premium sheet with gold accents in both themes - the ZenWe badge, the "Zen" + gold "We" wordmark over a
 * gold rule, the tagline, an info card (Version, Platform, College) with gold icons and chevrons, a gold Done
 * button with an arrow, and the founder card (gold frame, gold wave lines, name in gold serif).
 * Every chevron row does something real: Version opens the Play listing (check for updates), Platform opens the
 * app's settings, College lets the student pick their campus (same key as checkout / onboarding).
 * Android back closes it.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Platform, Pressable, Linking, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { appVersionText } from './ProfileSettingsSection';
import ZenvBadge from './ZenvBadge';

// Same key and names as checkout.tsx / onboarding.tsx.
const CHECKOUT_CAMPUS_KEY = 'zenvy_checkout_campus';
const CAMPUS_LABEL: Record<string, string> = { srmap: 'SRM AP', vitap: 'VIT AP', amrita: 'Amrita' };

const GOLD = '#E3B45A';
const GOLD_LIGHT = '#F6D58C';
const GOLD_DEEP = '#B9832F';
const INK = '#F5EFE6';
const MUTED = 'rgba(245,239,230,0.66)';
const LINE = 'rgba(227,180,90,0.22)';
const SERIF = Platform.select({ android: 'serif', ios: 'Georgia', default: 'Georgia, "Times New Roman", serif' });

const platformName = () => (Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : 'Web');
const PACKAGE = (Constants.expoConfig as any)?.android?.package || 'com.srm.hostelbites';

export default function AboutZcsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [campus, setCampus] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem(CHECKOUT_CAMPUS_KEY).then((v) => setCampus(v && CAMPUS_LABEL[v] ? v : null)).catch(() => {});
  }, [visible]);

  const openPlay = () => {
    Linking.openURL(`market://details?id=${PACKAGE}`)
      .catch(() => Linking.openURL(`https://play.google.com/store/apps/details?id=${PACKAGE}`).catch(() => {}));
  };
  const openSettings = () => { Linking.openSettings().catch(() => {}); };
  const pickCampus = () => {
    const pick = (key: string) => {
      AsyncStorage.setItem(CHECKOUT_CAMPUS_KEY, key).catch(() => {});
      setCampus(key);
    };
    Alert.alert('Your college', 'Used to show delivery points at checkout.', [
      ...Object.entries(CAMPUS_LABEL).map(([key, label]) => ({ text: label, onPress: () => pick(key) })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const rows: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; onPress: () => void; hint: string }[] = [
    { icon: 'pricetag-outline', label: 'Version', value: appVersionText(), onPress: openPlay, hint: 'Opens ZenWe on Google Play to check for updates' },
    { icon: 'phone-portrait-outline', label: 'Platform', value: platformName(), onPress: openSettings, hint: 'Opens the app settings on this phone' },
    { icon: 'school-outline', label: 'College', value: campus ? CAMPUS_LABEL[campus] : 'Not chosen yet', onPress: pickCampus, hint: 'Choose your college' },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={st.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close About" />
        <View style={st.sheetWrap} accessibilityViewIsModal>
          <LinearGradient
            colors={['#2A2018', '#16110D', '#0E0B09']}
            locations={[0, 0.45, 1]}
            style={[st.sheet, { paddingBottom: insets.bottom + 18 }]}
          >
            {/* soft gold glow at the top edge */}
            <LinearGradient pointerEvents="none" colors={['rgba(227,180,90,0.16)', 'rgba(227,180,90,0)']} style={st.topGlow} />
            <View style={st.grabber} />
            <TouchableOpacity onPress={onClose} style={st.close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={20} color={INK} />
            </TouchableOpacity>

            {/* Brand */}
            <View style={st.brand} accessible accessibilityRole="header" accessibilityLabel="ZenWe">
              <View style={st.badgeRing}>
                <ZenvBadge size={72} />
              </View>
              <Text allowFontScaling={false} style={st.wordmark}>
                Zen<Text style={{ color: GOLD }}>We</Text>
              </Text>
              <LinearGradient colors={['rgba(227,180,90,0)', GOLD, 'rgba(227,180,90,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={st.rule} />
            </View>
            <Text style={st.tagline} maxFontSizeMultiplier={1.3}>Food, groceries and campus services,{'\n'}delivered to your hostel.</Text>

            {/* Info */}
            <View style={st.card}>
              {rows.map((r, i) => (
                <TouchableOpacity
                  key={r.label}
                  onPress={r.onPress}
                  activeOpacity={0.7}
                  style={[st.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: LINE }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.label}: ${r.value}`}
                  accessibilityHint={r.hint}
                >
                  <Ionicons name={r.icon} size={18} color={GOLD} />
                  <Text style={st.rowLabel} maxFontSizeMultiplier={1.3}>{r.label}</Text>
                  <Text style={st.rowValue} numberOfLines={1} maxFontSizeMultiplier={1.3}>{r.value}</Text>
                  <Ionicons name="chevron-forward" size={16} color={MUTED} />
                </TouchableOpacity>
              ))}
            </View>

            {/* Done */}
            <TouchableOpacity onPress={onClose} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Done" style={st.doneWrap}>
              <LinearGradient colors={[GOLD_LIGHT, GOLD, GOLD_DEEP]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.done}>
                <Text style={st.doneText} maxFontSizeMultiplier={1.3}>Done</Text>
                <Ionicons name="arrow-forward" size={18} color="#2A1C0A" style={st.doneArrow} />
              </LinearGradient>
            </TouchableOpacity>

            <FounderCard />
          </LinearGradient>
        </View>
      </View>
    </Modal>
  );
}

/** Founder credit: dark card, gold frame, gold wave lines, name in gold serif (owner design, 6 Nov 2026). */
function FounderCard() {
  return (
    <View style={st.founderWrap} accessible accessibilityLabel="Founder, designed and built by Shanmukesh Kunjam">
      <LinearGradient colors={[GOLD_LIGHT, GOLD_DEEP, GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.founderFrame}>
        <View style={st.founderInner}>
          {/* gold wave lines, left and right */}
          {/* waves in fixed strips along the bottom edge and the top corners, never crossing the name */}
          <Svg pointerEvents="none" width="100%" height={18} viewBox="0 0 340 18" preserveAspectRatio="none" style={st.waveBottom}>
            <Defs>
              <SvgGradient id="fw" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={GOLD} stopOpacity="0.9" />
                <Stop offset="0.35" stopColor={GOLD} stopOpacity="0" />
                <Stop offset="0.65" stopColor={GOLD} stopOpacity="0" />
                <Stop offset="1" stopColor={GOLD} stopOpacity="0.9" />
              </SvgGradient>
            </Defs>
            <Path d="M0 9 C 40 1, 80 17, 120 8 S 220 2, 260 9 S 320 15, 340 6" stroke="url(#fw)" strokeWidth="1.1" fill="none" />
            <Path d="M0 14 C 50 8, 90 18, 140 12 S 230 8, 280 13 S 330 16, 340 12" stroke="url(#fw)" strokeWidth="0.7" fill="none" />
          </Svg>
          <Svg pointerEvents="none" width="100%" height={12} viewBox="0 0 340 12" preserveAspectRatio="none" style={st.waveTop}>
            <Defs>
              <SvgGradient id="fwt" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={GOLD} stopOpacity="0.8" />
                <Stop offset="0.3" stopColor={GOLD} stopOpacity="0" />
                <Stop offset="0.7" stopColor={GOLD} stopOpacity="0" />
                <Stop offset="1" stopColor={GOLD} stopOpacity="0.8" />
              </SvgGradient>
            </Defs>
            <Path d="M0 4 C 30 10, 60 1, 100 6 M 240 6 C 280 1, 310 10, 340 4" stroke="url(#fwt)" strokeWidth="0.8" fill="none" />
          </Svg>
          <Text style={st.founderKicker} maxFontSizeMultiplier={1.2}>FOUNDER  ·  DESIGNED & BUILT BY</Text>
          <Text style={st.founderName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={1.25}>
            Shanmukesh Kunjam
          </Text>
          <View style={st.flourish}>
            <LinearGradient colors={['rgba(227,180,90,0)', GOLD]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={st.flourishLine} />
            <View style={st.flourishDot} />
            <LinearGradient colors={[GOLD, 'rgba(227,180,90,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={st.flourishLine} />
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

const st = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheetWrap: { borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden', borderWidth: 1, borderBottomWidth: 0, borderColor: 'rgba(227,180,90,0.18)' },
  sheet: { paddingHorizontal: 20, paddingTop: 8 },
  topGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 140 },
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginBottom: 8, backgroundColor: 'rgba(245,239,230,0.28)' },
  close: {
    position: 'absolute', top: 16, right: 16, width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', zIndex: 2,
    backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: 1, borderColor: 'rgba(227,180,90,0.45)',
  },
  brand: { alignItems: 'center', marginTop: 14 },
  badgeRing: { borderRadius: 48, padding: 3, borderWidth: 1, borderColor: 'rgba(227,180,90,0.45)' },
  wordmark: { fontFamily: SERIF, fontSize: 34, fontWeight: '600', letterSpacing: 0.5, color: INK, marginTop: 12 },
  rule: { width: 64, height: 1.5, marginTop: 8, borderRadius: 1 },
  tagline: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 14, marginHorizontal: 8, color: MUTED },
  card: { borderRadius: 18, borderWidth: 1, borderColor: LINE, marginTop: 20, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.03)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingHorizontal: 14 },
  rowLabel: { fontSize: 14, flex: 1, color: MUTED },
  rowValue: { fontSize: 14, fontWeight: '700', flexShrink: 1, textAlign: 'right', color: INK },
  doneWrap: { marginTop: 18, borderRadius: 999, overflow: 'hidden' },
  done: { minHeight: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  doneText: { fontSize: 16, fontWeight: '800', color: '#2A1C0A', letterSpacing: 0.3 },
  doneArrow: { position: 'absolute', right: 20 },
  founderWrap: { marginTop: 16, alignSelf: 'stretch' },
  founderFrame: { borderRadius: 18, padding: 1.5 },
  founderInner: { borderRadius: 17, paddingVertical: 14, paddingHorizontal: 14, alignItems: 'center', overflow: 'hidden', backgroundColor: '#120E0B' },
  waveBottom: { position: 'absolute', left: 0, right: 0, bottom: 2 },
  waveTop: { position: 'absolute', left: 0, right: 0, top: 4 },
  founderKicker: { fontSize: 10.5, fontWeight: '700', letterSpacing: 2, color: 'rgba(245,239,230,0.7)' },
  founderName: { fontFamily: SERIF, fontSize: 24, fontWeight: '600', letterSpacing: 0.4, color: GOLD_LIGHT, marginTop: 5, textShadowColor: 'rgba(227,180,90,0.45)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10 },
  flourish: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  flourishLine: { width: 56, height: 1 },
  flourishDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: GOLD, transform: [{ rotate: '45deg' }] },
});
