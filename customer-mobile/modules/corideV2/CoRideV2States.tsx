/**
 * Co-Ride v2 states: skeleton cards while loading, and one calm card for offline, server waking, errors
 * (each with Retry) and empty lists (with the next useful action). Photo art only on empty states.
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { CR, R, W, shadow } from './coRideV2Theme';
import { PrimaryButton, OutlineButton } from './CoRideV2Kit';
import { IWifiOff, IHourglass, ICloudOff, IRefresh, ICarSide, IUsers, STROKE } from './CoRideV2Icons';
import type { ConnectionState } from '../../utils/offlineStatus';
import { themedSheet } from '../../utils/themeNow';

function Pulse({ style }: { style: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.55, duration: 650, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={[{ backgroundColor: CR.lineSoft, borderRadius: 8, opacity: v }, style]} />;
}

/** Ride-card shaped placeholders (avatar, route rail, price). */
export function RideSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View accessibilityLabel="Loading rides" accessibilityRole="progressbar">
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={st.skCard}>
          <View style={{ gap: 10 }}>
            <Pulse style={{ width: 40, height: 40, borderRadius: 20 }} />
            <Pulse style={{ width: 64, height: 18, borderRadius: 9 }} />
          </View>
          <View style={{ flex: 1, gap: 10, paddingLeft: 14 }}>
            <Pulse style={{ width: '70%', height: 13 }} />
            <Pulse style={{ width: '35%', height: 11 }} />
            <Pulse style={{ width: '62%', height: 13, marginTop: 4 }} />
          </View>
          <View style={{ width: 64, alignItems: 'flex-end', gap: 10 }}>
            <Pulse style={{ width: 56, height: 18, borderRadius: 9 }} />
            <Pulse style={{ width: 40, height: 18 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function BoardSkeleton() {
  return (
    <View style={[st.skCard, { flexDirection: 'column', gap: 12 }]} accessibilityLabel="Loading autos" accessibilityRole="progressbar">
      <Pulse style={{ width: '55%', height: 16 }} />
      <Pulse style={{ width: '35%', height: 12 }} />
      <Pulse style={{ width: '100%', height: 120, borderRadius: 14 }} />
      <Pulse style={{ width: '100%', height: 44, borderRadius: 12 }} />
    </View>
  );
}

export function StateCard({ icon: Icon, title, body, action, onAction, secondary, onSecondary, art }: {
  icon?: LucideIcon; title: string; body?: string; action?: string; onAction?: () => void;
  secondary?: string; onSecondary?: () => void; art?: boolean;
}) {
  return (
    <View style={st.card} accessibilityLiveRegion="polite">
      {art ? (
        <View style={st.artTile} accessibilityElementsHidden>
          <ICarSide size={26} color={CR.primary} strokeWidth={STROKE} />
          <IUsers size={18} color={CR.primary} strokeWidth={STROKE} style={{ position: 'absolute', right: 10, bottom: 10 }} />
        </View>
      ) : Icon ? (
        <View style={st.icon}><Icon size={22} color={CR.ink2} strokeWidth={STROKE} /></View>
      ) : null}
      <Text style={st.title}>{title}</Text>
      {body ? <Text style={st.body}>{body}</Text> : null}
      {action && onAction ? <PrimaryButton label={action} onPress={onAction} small style={{ marginTop: 16, alignSelf: 'stretch' }} /> : null}
      {secondary && onSecondary ? <OutlineButton label={secondary} onPress={onSecondary} small style={{ marginTop: 10, alignSelf: 'stretch' }} /> : null}
    </View>
  );
}

/** Offline / waking / error, in that order of truth. Returns null while online with no error. */
export function NetState({ connection, error, onRetry, what = 'rides' }: { connection: ConnectionState; error: string | null; onRetry: () => void; what?: string }) {
  if (connection === 'offline') {
    return <StateCard icon={IWifiOff} title="You are offline" body={`Connect to the internet to see ${what}. Anything you had open stays here.`} action="Try again" onAction={onRetry} />;
  }
  if (connection === 'waking') {
    return <StateCard icon={IHourglass} title="ZenWe is waking up" body="The server is starting. This takes a few seconds the first time." action="Try again" onAction={onRetry} />;
  }
  if (error) return <StateCard icon={ICloudOff} title={`Could not load ${what}`} body={error} action="Try again" onAction={onRetry} />;
  return null;
}

/** Thin banner when we still show the last list but the latest refresh failed. */
export function StaleBanner({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <View style={st.banner}>
      <Text style={st.bannerText} numberOfLines={2}>{text}</Text>
      <OutlineButton label="Retry" icon={IRefresh} onPress={onRetry} small style={{ height: 34, borderRadius: 10 }} />
    </View>
  );
}

const st = themedSheet(() => ({
  skCard: { flexDirection: 'row', backgroundColor: CR.card, borderRadius: R.lg, padding: 14, marginBottom: 12, ...shadow(1) },
  card: { backgroundColor: CR.card, borderRadius: R.xl, paddingVertical: 26, paddingHorizontal: 22, alignItems: 'center', ...shadow(1) },
  artTile: { width: 64, height: 64, borderRadius: 20, backgroundColor: CR.tint, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  icon: { width: 52, height: 52, borderRadius: 26, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: CR.line, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: W.title, color: CR.ink, textAlign: 'center' },
  body: { marginTop: 6, fontSize: 13.5, color: CR.muted, textAlign: 'center', lineHeight: 20 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: CR.amberSoft, borderRadius: 12, paddingVertical: 8, paddingLeft: 12, paddingRight: 8, marginBottom: 12 },
  bannerText: { flex: 1, fontSize: 12.5, color: CR.amber },
}));
