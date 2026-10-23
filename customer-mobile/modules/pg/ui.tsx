/**
 * Zenvy PG UI kit: palette (ThemeContext light / dark, one accent used sparingly), icons (deep lucide
 * imports, same set and stroke as the rest of the app), header, section headings, pressable rows,
 * image with a fixed frame and a quiet placeholder, skeleton blocks and calm empty / error states.
 * PG-only: nothing here is shared with other sections.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Animated, ActivityIndicator, type StyleProp, type ViewStyle } from 'react-native';
import { PressScale } from '../others/motion';
import { useConnectionState } from '../../utils/offlineStatus';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { ACCENTS } from '../others/othersTheme';

export { default as IconArrowLeft } from 'lucide-react-native/icons/arrow-left';
export { default as IconBadgeCheck } from 'lucide-react-native/icons/badge-check';
export { default as IconMapPin } from 'lucide-react-native/icons/map-pin';
export { default as IconNavigation } from 'lucide-react-native/icons/navigation';
export { default as IconClock } from 'lucide-react-native/icons/clock';
export { default as IconUsers } from 'lucide-react-native/icons/users';
export { default as IconPlay } from 'lucide-react-native/icons/play';
export { default as IconX } from 'lucide-react-native/icons/x';
export { default as IconImages } from 'lucide-react-native/icons/images';
export { default as IconImageOff } from 'lucide-react-native/icons/image-off';
export { default as IconDoorOpen } from 'lucide-react-native/icons/door-open';
export { default as IconMoon } from 'lucide-react-native/icons/moon';
export { default as IconInfo } from 'lucide-react-native/icons/info';
export { default as IconChevronRight } from 'lucide-react-native/icons/chevron-right';
export { default as IconExternalLink } from 'lucide-react-native/icons/external-link';
export { default as IconPhone } from 'lucide-react-native/icons/phone';
export { default as IconMessage } from 'lucide-react-native/icons/message-circle';
export { default as IconBed } from 'lucide-react-native/icons/bed-double';
export { default as IconBath } from 'lucide-react-native/icons/bath';
export { default as IconSnowflake } from 'lucide-react-native/icons/snowflake';
export { default as IconWind } from 'lucide-react-native/icons/wind';
export { default as IconUtensils } from 'lucide-react-native/icons/utensils';
export { default as IconCalendarClock } from 'lucide-react-native/icons/calendar-clock';
export { default as IconCheck } from 'lucide-react-native/icons/check';
export { default as IconAlert } from 'lucide-react-native/icons/circle-alert';
export { default as IconBuilding } from 'lucide-react-native/icons/building';
export { default as IconRefresh } from 'lucide-react-native/icons/refresh-cw';
export { default as IconShare } from 'lucide-react-native/icons/share-2';
export { default as IconStar } from 'lucide-react-native/icons/star';
export { default as IconChevronDown } from 'lucide-react-native/icons/chevron-down';
export { default as IconChevronUp } from 'lucide-react-native/icons/chevron-up';
export { default as IconShieldCheck } from 'lucide-react-native/icons/shield-check';
export { default as IconCctvCam } from 'lucide-react-native/icons/cctv';
export { default as IconFingerprint } from 'lucide-react-native/icons/fingerprint-pattern';
export { default as IconFireExtinguisher } from 'lucide-react-native/icons/fire-extinguisher';
export { default as IconFirstAid } from 'lucide-react-native/icons/briefcase-medical';
export { default as IconUserRound } from 'lucide-react-native/icons/user-round';
export { default as IconClipboard } from 'lucide-react-native/icons/clipboard-list';
export { default as IconFileText } from 'lucide-react-native/icons/file-text';
export { default as IconWallet } from 'lucide-react-native/icons/wallet';
export { default as IconCalendarDays } from 'lucide-react-native/icons/calendar-days';
export { default as IconBan } from 'lucide-react-native/icons/ban';
export { default as IconWrench } from 'lucide-react-native/icons/wrench';
export { default as IconHospital } from 'lucide-react-native/icons/hospital';
export { default as IconPill } from 'lucide-react-native/icons/pill';
export { default as IconLandmark } from 'lucide-react-native/icons/landmark';
export { default as IconBus } from 'lucide-react-native/icons/bus';
export { default as IconCart } from 'lucide-react-native/icons/shopping-cart';
export { default as IconUtensilsCrossed } from 'lucide-react-native/icons/utensils-crossed';
export { default as IconDumbbellPlace } from 'lucide-react-native/icons/dumbbell';
export { default as IconGraduation } from 'lucide-react-native/icons/graduation-cap';
export { default as IconFlag } from 'lucide-react-native/icons/flag';
export { default as IconCigaretteOff } from 'lucide-react-native/icons/cigarette-off';
export { default as IconVolumeX } from 'lucide-react-native/icons/volume-x';
export { default as IconPaw } from 'lucide-react-native/icons/paw-print';
export { default as IconSparklesRule } from 'lucide-react-native/icons/sparkles';
export { default as IconWasher } from 'lucide-react-native/icons/washing-machine';
export { default as IconPlug } from 'lucide-react-native/icons/plug-zap';
export { default as IconMore } from 'lucide-react-native/icons/ellipsis';
export { default as IconSliders } from 'lucide-react-native/icons/sliders-horizontal';
export { default as IconCircleCheck } from 'lucide-react-native/icons/circle-check';
export { default as IconCircleMinus } from 'lucide-react-native/icons/circle-minus';
export { default as IconKey } from 'lucide-react-native/icons/key-round';
export { default as IconIdCard } from 'lucide-react-native/icons/id-card';
export { default as IconListChecks } from 'lucide-react-native/icons/list-checks';
export { default as IconPackage } from 'lucide-react-native/icons/package';
export { default as IconColumns } from 'lucide-react-native/icons/columns-3';
export { default as IconSiren } from 'lucide-react-native/icons/siren';
export { default as IconMap } from 'lucide-react-native/icons/map';
export { default as IconSearch } from 'lucide-react-native/icons/search';
export { default as IconSort } from 'lucide-react-native/icons/arrow-up-down';
export { default as IconHousePlus } from 'lucide-react-native/icons/house-plus';
export { default as IconBadgePercent } from 'lucide-react-native/icons/badge-indian-rupee';
import IconWifi from 'lucide-react-native/icons/wifi';
import IconSnow from 'lucide-react-native/icons/snowflake';
import IconShirt from 'lucide-react-native/icons/washing-machine';
import IconShield from 'lucide-react-native/icons/shield-check';
import IconZap from 'lucide-react-native/icons/zap';
import IconDumbbell from 'lucide-react-native/icons/dumbbell';
import IconDroplets from 'lucide-react-native/icons/shower-head';
import IconFood from 'lucide-react-native/icons/cooking-pot';
import IconCctv from 'lucide-react-native/icons/cctv';
import IconLock from 'lucide-react-native/icons/lock';
import IconSparkles from 'lucide-react-native/icons/sparkles';
import IconParking from 'lucide-react-native/icons/square-parking';
import IconTv from 'lucide-react-native/icons/tv';
import IconBook from 'lucide-react-native/icons/book-open';
import IconSofa from 'lucide-react-native/icons/sofa';
import IconMedical from 'lucide-react-native/icons/stethoscope';
import IconFridge from 'lucide-react-native/icons/refrigerator';
import IconBedSingle from 'lucide-react-native/icons/bed';
import IconBathAmenity from 'lucide-react-native/icons/bath';
import IconCheckCircle from 'lucide-react-native/icons/circle-check';
import type { LucideIcon } from 'lucide-react-native';
import IconBuildingFallback from 'lucide-react-native/icons/building';
import IconArrowLeftRaw from 'lucide-react-native/icons/arrow-left';

export const ICON = { size: 18, stroke: 1.75 } as const;
/**
 * Type scale for every PG screen: one title, one heading size, body and small. Nothing else.
 * Spacing follows a 4 / 8 grid: 16 page gutter, 32 between sections, 12 / 8 inside cards.
 */
export const TYPE = { title: 20, heading: 16, body: 14, small: 12 } as const;

export const usePgPalette = () => {
  const { isDark, colors } = useTheme();
  return useMemo(() => ({
    isDark,
    bg: colors.bg,
    card: colors.card,
    sunken: isDark ? '#141417' : '#F1F3F5',
    text: colors.text,
    sub: colors.textSecondary,
    muted: colors.textMuted,
    line: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)',
    // One accent for PG: blue. accentFill keeps white text readable on buttons in both themes.
    accent: isDark ? ACCENTS.pg.ink.dark : ACCENTS.pg.ink.light,
    accentFill: ACCENTS.pg.solid,
    accentSoft: isDark ? 'rgba(96,165,250,0.14)' : 'rgba(37,99,235,0.08)',
    accentLine: isDark ? 'rgba(96,165,250,0.45)' : 'rgba(37,99,235,0.35)',
    success: isDark ? '#34D399' : '#047857',
    successSoft: isDark ? 'rgba(52,211,153,0.12)' : 'rgba(4,120,87,0.08)',
    skeleton: isDark ? '#1F1F23' : '#E9ECEF',
    overlay: 'rgba(0,0,0,0.55)',
    star: '#F59E0B',
    // Clean white cards: a soft shadow in light mode, a hairline border in dark mode.
    shadow: isDark
      ? { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)' }
      : { shadowColor: '#0F172A', shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  }), [isDark, colors]);
};
export type PgPalette = ReturnType<typeof usePgPalette>;

export const PG_HOME = '/(tabs)/others?tab=pg';

/** Amenity name -> icon (matching on words the housing team uses). */
export const amenityIcon = (name: string): LucideIcon => {
  const v = String(name || '').toLowerCase();
  if (v.includes('wifi') || v.includes('wi-fi') || v.includes('internet')) return IconWifi;
  if (/\bac\b/.test(v) || v.includes('air con')) return IconSnow;
  if (v.includes('laundry') || v.includes('washing')) return IconShirt;
  if (v.includes('cctv') || v.includes('camera')) return IconCctv;
  if (v.includes('security') || v.includes('guard')) return IconShield;
  if (v.includes('biometric') || v.includes('lock')) return IconLock;
  if (v.includes('power') || v.includes('backup') || v.includes('inverter')) return IconZap;
  if (v.includes('gym') || v.includes('fitness')) return IconDumbbell;
  if (v.includes('hot water') || v.includes('geyser')) return IconDroplets;
  if (v.includes('food') || v.includes('mess') || v.includes('meal') || v.includes('kitchen')) return IconFood;
  if (v.includes('clean') || v.includes('housekeeping')) return IconSparkles;
  if (v.includes('parking')) return IconParking;
  if (v.includes('tv')) return IconTv;
  if (v.includes('study') || v.includes('library') || v.includes('co-working')) return IconBook;
  if (v.includes('lounge') || v.includes('common')) return IconSofa;
  if (v.includes('medical') || v.includes('nurse') || v.includes('first aid')) return IconMedical;
  if (v.includes('fridge') || v.includes('refrigerator')) return IconFridge;
  if (v.includes('bed') || v.includes('mattress')) return IconBedSingle;
  if (v.includes('bath') || v.includes('washroom')) return IconBathAmenity;
  return IconCheckCircle;
};
/** Amenity labels from the admin's list without decorative emoji ("WiFi ⚡" -> "WiFi"). */
export const amenityLabel = (name: string) => String(name || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();

/** One key per amenity, so "AC" twice, "WiFi" + "High Speed WiFi" or "Food/Mess" + "Unlimited Food" count once. */
const amenityKey = (label: string) => {
  const v = label.toLowerCase();
  if (/wi-?fi|internet/.test(v)) return 'wifi';
  if (/\bac\b|air con/.test(v)) return 'ac';
  if (/food|mess|meal/.test(v)) return 'food';
  if (/gym|fitness/.test(v)) return 'gym';
  if (/\blift\b|elevator/.test(v)) return 'lift';
  if (/hot water|geyser/.test(v)) return 'hotwater';
  if (/cctv|camera/.test(v)) return 'cctv';
  if (/power|backup|inverter/.test(v)) return 'power';
  return v.replace(/[^a-z0-9]/g, '');
};
/**
 * The amenity list as students should read it: emoji removed, each amenity once (the more descriptive
 * label wins, in the place it first appears). Housing-team lists often repeat an amenity in two words.
 */
export const cleanAmenities = (list: unknown): string[] => {
  const out: { key: string; label: string }[] = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const label = amenityLabel(String(raw ?? ''));
    if (!label) continue;
    const key = amenityKey(label);
    const at = out.findIndex((x) => x.key === key);
    if (at < 0) out.push({ key, label });
    else if (label.length > out[at].label.length) out[at] = { key, label };
  }
  return out.map((x) => x.label);
};

/**
 * Back button + optional title. `titleOpacity` (an Animated value) lets a screen fade the title in once
 * its own heading has scrolled away, so the name is never shown twice at once.
 */
export function PgHeader({ title, onBack, titleOpacity, right }: { title?: string; onBack?: () => void; titleOpacity?: Animated.AnimatedInterpolation<number> | Animated.Value; right?: React.ReactNode }) {
  const p = usePgPalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const back = onBack || (() => (router.canGoBack() ? router.back() : router.replace(PG_HOME as any)));
  return (
    <View style={[s.header, { paddingTop: insets.top, backgroundColor: p.bg, borderBottomColor: p.line }]}>
      <Press onPress={back} accessibilityLabel="Back" style={s.headerBtn}>
        <IconArrowLeftLocal color={p.text} />
      </Press>
      {title ? (
        <Animated.Text style={[s.headerTitle, { color: p.text, opacity: titleOpacity ?? 1 }]} numberOfLines={1} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>{title}</Animated.Text>
      ) : <View style={{ flex: 1 }} />}
      {right || <View style={s.headerBtn} />}
    </View>
  );
}
const IconArrowLeftLocal = ({ color }: { color: string }) => <IconArrowLeftRaw size={22} color={color} strokeWidth={ICON.stroke} />;

/** Pressable with a quiet pressed state (opacity) and a 44 px minimum target. */
export function Press({ children, onPress, style, disabled, accessibilityLabel, accessibilityHint, accessibilityRole = 'button', accessibilityState, hitSlop }: {
  children: React.ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; disabled?: boolean;
  accessibilityLabel?: string; accessibilityHint?: string; accessibilityRole?: 'button' | 'tab' | 'link' | 'imagebutton';
  accessibilityState?: { selected?: boolean; disabled?: boolean; busy?: boolean }; hitSlop?: number;
}) {
  return (
    <PressScale
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
      style={[{ minHeight: 44, minWidth: 44, opacity: disabled ? 0.45 : 1 }, style]}
    >
      {children}
    </PressScale>
  );
}

export function SectionHeading({ title, detail, style }: { title: string; detail?: string; style?: StyleProp<ViewStyle> }) {
  const p = usePgPalette();
  return (
    <View style={[s.sectionHead, style]}>
      <Text style={[s.sectionTitle, { color: p.text }]} accessibilityRole="header">{title}</Text>
      {detail ? <Text style={[s.small, { color: p.muted }]} numberOfLines={1}>{detail}</Text> : null}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const p = usePgPalette();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.line, marginHorizontal: inset }} />;
}

/** Image in a fixed frame (no layout jump); a quiet icon while loading or when the image fails. */
export function PgImage({ uri, style, recyclingKey, accessibilityLabel, priority = 'normal' }: {
  uri?: string | null; style: StyleProp<ViewStyle>; recyclingKey?: string; accessibilityLabel?: string; priority?: 'low' | 'normal' | 'high';
}) {
  const p = usePgPalette();
  const [failed, setFailed] = React.useState(false);
  useEffect(() => { setFailed(false); }, [uri]);
  return (
    <View style={[{ backgroundColor: p.sunken, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, style]} accessibilityLabel={accessibilityLabel} accessible={!!accessibilityLabel} accessibilityRole={accessibilityLabel ? 'image' : undefined}>
      <IconBuildingFallback size={22} color={p.muted} strokeWidth={ICON.stroke} />
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          recyclingKey={recyclingKey || uri}
          cachePolicy="memory-disk"
          priority={priority}
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
}

/** Skeleton block with a slow opacity pulse (no shimmer sweep). */
export function Skeleton({ style }: { style: StyleProp<ViewStyle> }) {
  const p = usePgPalette();
  const v = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.6, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[{ backgroundColor: p.skeleton, borderRadius: 8, opacity: v }, style]} />;
}

export function StateMessage({ title, body, actionLabel, onAction, busy, icon }: {
  title: string; body?: string; actionLabel?: string; onAction?: () => void; busy?: boolean; icon?: React.ReactNode;
}) {
  const p = usePgPalette();
  // Designed state card (Others kit look): icon on a soft blue disc, one title, one line, one action.
  // Load failures read the app-wide connection state (offline banner, server wake-up).
  const conn = useConnectionState();
  const failure = /couldn.t|could not/i.test(title);
  const offline = failure && conn === 'offline';
  const waking = failure && conn === 'waking';
  const shownTitle = offline ? 'You are offline' : waking ? 'Waking the server up' : title;
  const shownBody = offline ? 'Check your internet connection and try again.' : waking ? 'This takes a few seconds the first time. Try again in a moment.' : body;
  return (
    <View style={[s.stateCard, { backgroundColor: p.card }, p.shadow]} accessibilityLiveRegion="polite">
      {icon ? <View style={[s.stateIcon, { backgroundColor: p.accentSoft }]}>{icon}</View> : null}
      <Text style={[s.stateTitle, { color: p.text }]}>{shownTitle}</Text>
      {shownBody ? <Text style={[s.body, { color: p.sub, textAlign: 'center', marginTop: 4 }]}>{shownBody}</Text> : null}
      {actionLabel && onAction ? (
        <Press onPress={onAction} disabled={busy} style={[s.secondaryBtn, { borderColor: p.accentFill, backgroundColor: offline || waking ? 'transparent' : p.accentFill, borderWidth: offline || waking ? 1.5 : 0, marginTop: 16, minWidth: 150 }]} accessibilityLabel={actionLabel}>
          {busy ? <ActivityIndicator color={offline || waking ? p.accent : '#FFFFFF'} /> : <Text style={[s.btnLabel, { color: offline || waking ? p.accent : '#FFFFFF', fontWeight: '700' }]}>{actionLabel}</Text>}
        </Press>
      ) : null}
    </View>
  );
}

export const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  headerBtn: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', letterSpacing: -0.1 },
  body: { fontSize: 14, lineHeight: 20 },
  small: { fontSize: 12, lineHeight: 16 },
  state: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 32 },
  stateCard: { alignItems: 'center', borderRadius: 16, paddingVertical: 28, paddingHorizontal: 24, marginVertical: 8 },
  stateIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  stateTitle: { fontSize: 16, fontWeight: '700', marginTop: 12, textAlign: 'center' },
  secondaryBtn: { minHeight: 44, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  btnLabel: { fontSize: 14, fontWeight: '600' },
});
