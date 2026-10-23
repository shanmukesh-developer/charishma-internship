/**
 * Co-Ride (student bike and car pool) UI: blue palette, segmented control, tabs, filters, ride cards,
 * My rides cards, skeleton and state views. Presentation only: every action is a handler passed in by
 * app/(tabs)/others.tsx (through CoRideHub), which keeps the API calls, confirmations and state.
 */
import React, { useMemo } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { PressScale, StateCard, SlowLoadHint } from '../others/motion';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { ACCENTS, SURFACE, shadow as othersShadow } from '../others/othersTheme';
import ShimmerLoader from '../../components/ShimmerLoader';
import SafeImage from '../../components/SafeImage';
import {
  fmtRideWhen, browseShare, inr, firstName, initialOf, vehicleLabel, vibeLabel, genderLabel, costWord,
  myRideInfo, type Tone,
} from './coRideFormat';

export const useCoRidePalette = () => {
  const { isDark, colors } = useTheme();
  return useMemo(() => ({
    isDark,
    page: isDark ? SURFACE.dark.page : SURFACE.light.page,
    surface: isDark ? SURFACE.dark.card : SURFACE.light.card,
    surfaceAlt: isDark ? '#1F1F24' : '#F3F5F8',
    segOn: isDark ? '#34343A' : '#FFFFFF',
    border: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.08)',
    divider: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.06)',
    text: colors.text,
    sub: colors.textSecondary,
    muted: colors.textMuted,
    /** Blue: text, icons and selected borders on the current surface. */
    accent: isDark ? ACCENTS.coride.ink.dark : ACCENTS.coride.ink.light,
    /** Solid button / selected fill (white text in both modes). */
    button: ACCENTS.coride.solid,
    accentSoft: isDark ? ACCENTS.coride.tint.dark : ACCENTS.coride.tint.light,
    heroFrom: ACCENTS.coride.deep,
    heroTo: ACCENTS.coride.solid,
    error: isDark ? '#F87171' : '#B91C1C',
    success: isDark ? '#34D399' : '#047857',
    successSoft: isDark ? 'rgba(16,185,129,0.14)' : '#E8F6EF',
    warning: isDark ? '#FBBF24' : '#B45309',
    warningSoft: isDark ? 'rgba(245,158,11,0.14)' : '#FDF4E3',
    neutralSoft: isDark ? 'rgba(255,255,255,0.07)' : '#F1F3F5',
    whatsapp: '#25D366',
    shadow: othersShadow(isDark),
  }), [isDark, colors]);
};
export type CoRidePalette = ReturnType<typeof useCoRidePalette>;

export const VEHICLE_ICON: Record<string, any> = { Bike: 'motorbike', Scooter: 'moped', Car: 'car-side', Auto: 'rickshaw' };

// ── Small pieces ─────────────────────────────────────────────────────────────

export function Segmented<T extends string>({ options, value, onChange, label, style }: {
  options: { key: T; label: string; icon?: string; iconSet?: 'ion' | 'mci' }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const p = useCoRidePalette();
  return (
    <View style={[st.segTrack, { backgroundColor: p.surface, borderColor: p.border }, style]} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map(o => {
        const on = o.key === value;
        const color = on ? '#FFFFFF' : p.sub;
        return (
          <PressScale
            key={o.key}
            style={[st.segBtn, on && { backgroundColor: p.button }]}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
          >
            {o.icon ? (o.iconSet === 'mci'
              ? <MaterialCommunityIcons name={o.icon as any} size={17} color={color} />
              : <Ionicons name={o.icon as any} size={16} color={color} />) : null}
            <Text style={[st.segText, { color, fontWeight: on ? '700' : '600' }]} numberOfLines={1}>{o.label}</Text>
          </PressScale>
        );
      })}
    </View>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone | 'accent' }) {
  const p = useCoRidePalette();
  const bg = tone === 'success' ? p.successSoft : tone === 'warning' ? p.warningSoft : tone === 'accent' ? p.accentSoft : p.neutralSoft;
  const fg = tone === 'success' ? p.success : tone === 'warning' ? p.warning : tone === 'accent' ? p.accent : p.sub;
  return (
    <View style={[st.badge, { backgroundColor: bg }]}>
      <Text style={[st.badgeText, { color: fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

type BtnKind = 'primary' | 'secondary' | 'ghost' | 'success' | 'outline';
export function CoBtn({ label, onPress, kind = 'primary', icon, iconColor, loading, disabled, style, a11y }: {
  label: string; onPress: () => void; kind?: BtnKind; icon?: string; iconColor?: string;
  loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; a11y?: string;
}) {
  const p = useCoRidePalette();
  const bg = kind === 'primary' ? p.button : kind === 'success' ? p.successSoft : kind === 'secondary' ? p.surface : 'transparent';
  const fg = kind === 'primary' ? '#FFFFFF' : kind === 'success' ? p.success : kind === 'outline' ? p.accent : p.text;
  const bc = kind === 'secondary' ? p.border : kind === 'outline' ? p.accent : 'transparent';
  const off = disabled || loading;
  return (
    <PressScale
      style={[st.btn, { backgroundColor: bg, borderColor: bc, opacity: disabled ? 0.5 : 1 }, style]}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={a11y || label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
    >
      {loading ? <ActivityIndicator size="small" color={fg} /> : (
        <>
          {icon ? <Ionicons name={icon as any} size={17} color={iconColor || fg} /> : null}
          <Text style={[st.btnText, { color: fg }]} numberOfLines={1}>{label}</Text>
        </>
      )}
    </PressScale>
  );
}

export function RouteLine({ from, to, compact, fromNote, toNote }: { from: string; to: string; compact?: boolean; fromNote?: string; toNote?: string }) {
  const p = useCoRidePalette();
  return (
    <View style={st.route} accessibilityLabel={`From ${from} to ${to}`}>
      <View style={st.routeRail}>
        <View style={[st.dotFrom, { borderColor: p.accent }]} />
        <View style={[st.railLine, { backgroundColor: p.border }]} />
        <Ionicons name="location" size={14} color={p.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[st.place, { color: p.text, fontSize: compact ? 14 : 15 }]} numberOfLines={1}>{from}</Text>
        {fromNote ? <Text style={[st.placeNote, { color: p.sub }]} numberOfLines={1}>{fromNote}</Text> : null}
        <Text style={[st.place, { color: p.text, fontSize: compact ? 14 : 15, marginTop: compact ? 10 : 12 }]} numberOfLines={1}>{to}</Text>
        {toNote ? <Text style={[st.placeNote, { color: p.sub }]} numberOfLines={1}>{toNote}</Text> : null}
      </View>
    </View>
  );
}

function MetaItem({ icon, mci, text, strong }: { icon: string; mci?: boolean; text: string; strong?: boolean }) {
  const p = useCoRidePalette();
  return (
    <View style={st.metaItem}>
      {mci ? <MaterialCommunityIcons name={icon as any} size={16} color={p.sub} /> : <Ionicons name={icon as any} size={15} color={p.sub} />}
      <Text style={[st.metaText, { color: strong ? p.text : p.sub, fontWeight: strong ? '600' : '400' }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

/** Profile photo, or the first letter on a soft blue disc. */
export function Avatar({ name, image, size = 44 }: { name?: string; image?: string | null; size?: number }) {
  const p = useCoRidePalette();
  const initial = (
    <View style={[st.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: p.accentSoft }]}>
      <Text style={[st.avatarText, { color: p.accent, fontSize: size * 0.4 }]}>{initialOf(name)}</Text>
    </View>
  );
  if (!image) return initial;
  return (
    <SafeImage source={{ uri: image }} style={{ width: size, height: size, borderRadius: size / 2 }} maxWidth={size * 3} fallback={initial} accessibilityIgnoresInvertColors />
  );
}

// ── Header pieces ────────────────────────────────────────────────────────────

export function KarmaLine({ points }: { points: number }) {
  const p = useCoRidePalette();
  return (
    <View style={st.karma} accessibilityLabel={`Karma ${points}. Plus 50 for each completed ride`}>
      <Ionicons name="ribbon-outline" size={16} color={p.accent} />
      <Text style={{ fontSize: 13, color: p.sub }}>
        <Text style={{ color: p.text, fontWeight: '700' }}>Karma {points}</Text>
        {'  ·  +50 for each completed ride'}
      </Text>
    </View>
  );
}

/** Kept for older callers: Find a ride / My rides tabs with a Post button. */
export function PoolTabs({ value, onChange, myRidesCount, onPost }: {
  value: 'browse' | 'my-rides'; onChange: (v: 'browse' | 'my-rides') => void; myRidesCount: number; onPost: () => void;
}) {
  const p = useCoRidePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, marginBottom: 16 }}>
      <Segmented
        label="Co-Ride"
        style={{ flex: 1 }}
        value={value}
        onChange={onChange}
        options={[{ key: 'browse', label: 'Find a ride' }, { key: 'my-rides', label: myRidesCount > 0 ? `My rides (${myRidesCount})` : 'My rides' }]}
      />
      <PressScale style={[st.postBtn, { backgroundColor: p.button }]} onPress={onPost} accessibilityRole="button" accessibilityLabel="Post a ride">
        <Ionicons name="add" size={18} color="#FFFFFF" />
      </PressScale>
    </View>
  );
}

export function RideFilters({ vehicle, onVehicle, destinations, goingTo, onGoingTo }: {
  vehicle: string; onVehicle: (v: 'All' | 'Bike' | 'Car') => void;
  destinations: string[]; goingTo: string | null; onGoingTo: (d: string | null) => void;
}) {
  const p = useCoRidePalette();
  const chip = (label: string, on: boolean, onPress: () => void, a11y: string, icon?: string) => (
    <PressScale
      key={label}
      style={[st.chip, { backgroundColor: on ? p.button : p.surface, borderColor: on ? p.button : p.border }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={a11y}
      hitSlop={{ top: 6, bottom: 6 }}
    >
      {icon ? <MaterialCommunityIcons name={icon as any} size={16} color={on ? '#FFFFFF' : p.sub} /> : null}
      <Text style={[st.chipText, { color: on ? '#FFFFFF' : p.text }]} numberOfLines={1}>{label}</Text>
    </PressScale>
  );
  const veh = vehicle === 'Bike' || vehicle === 'Car' ? vehicle : 'All';
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Vehicle">
        {(['All', 'Bike', 'Car'] as const).map(v => chip(v === 'All' ? 'All' : v, veh === v, () => onVehicle(v), v === 'All' ? 'All vehicles' : `${v} rides`, v === 'All' ? undefined : VEHICLE_ICON[v]))}
      </View>
      {destinations.length >= 2 && (
        <View style={{ marginTop: 12 }}>
          <Text style={[st.fieldLabel, { color: p.sub }]}>Going to</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
            {chip('Anywhere', !goingTo, () => onGoingTo(null), 'Going anywhere')}
            {destinations.map(d => chip(d, goingTo === d, () => onGoingTo(goingTo === d ? null : d), `Going to ${d}`))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// ── Find a ride: one card per post ───────────────────────────────────────────

export function RideCard({ ride, joinStatus, busy, onJoin, onOpenMyRides, onDetails }: {
  ride: any; joinStatus?: string; busy: boolean; onJoin: () => void; onOpenMyRides: () => void;
  /** When set, the main button opens the ride's details instead of joining straight away. */
  onDetails?: () => void;
}) {
  const p = useCoRidePalette();
  const needsRide = ride.creatorRole === 'passenger';
  const when = fmtRideWhen(ride.departureTime);
  const share = browseShare(ride);
  const seats = Number(ride.availableSeats) || 0;
  const name = firstName(ride.creator?.name, 'Student');
  const metaBits = [genderLabel(ride.creator?.gender), vibeLabel(ride.rideVibe)].filter(Boolean).join(' · ');
  const vehicle = vehicleLabel(ride.vehicleType);

  const action = busy ? null
    : joinStatus === 'Approved' ? { label: 'You’re on this ride', kind: 'success' as const, icon: 'checkmark-circle', go: onOpenMyRides }
      : joinStatus ? { label: 'Requested', kind: 'secondary' as const, icon: 'time-outline', go: onOpenMyRides }
        : onDetails ? { label: 'View details', kind: 'primary' as const, icon: undefined, go: onDetails }
          : { label: needsRide ? 'Ride together' : ride.autoApprove ? 'Join ride' : 'Request to join', kind: 'primary' as const, icon: undefined, go: onJoin };

  const Wrapper: any = onDetails ? PressScale : View;
  return (
    <Wrapper
      {...(onDetails ? { onPress: onDetails, scaleTo: 0.98, accessibilityRole: 'button', accessibilityLabel: `${name}, ${ride.origin} to ${ride.destination}, ${when.label}. View details` } : {})}
      style={[st.card, { backgroundColor: p.surface, opacity: busy ? 0.7 : 1 }, p.shadow]}
    >
      <View style={st.cardHead}>
        <Avatar name={ride.creator?.name} image={ride.creator?.profileImage} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[st.hostName, { color: p.text }]} numberOfLines={1}>{name}</Text>
          <Text style={[st.hostMeta, { color: p.sub }]} numberOfLines={1}>{metaBits || 'Campus student'}</Text>
        </View>
        {needsRide ? <Badge label="Asking for a lift" tone="warning" /> : <Badge label={ride.autoApprove ? 'Instant join' : 'Offering a lift'} tone="success" />}
      </View>

      <RouteLine from={ride.origin} to={ride.destination} />

      <View style={st.metaRow2}>
        <MetaItem icon="time-outline" text={when.relative ? `${when.label} · ${when.relative}` : when.label} strong />
      </View>
      <View style={st.metaRow2}>
        <MetaItem icon={VEHICLE_ICON[vehicle] || 'motorbike'} mci text={ride.vehicleInfo ? `${vehicle} · ${ride.vehicleInfo}` : vehicle} />
        <MetaItem icon="person-outline" text={needsRide ? `${seats} seat${seats === 1 ? '' : 's'} needed` : `${seats} seat${seats === 1 ? '' : 's'} left`} />
      </View>

      {!!ride.notes && !onDetails && (
        <View style={[st.notes, { backgroundColor: p.surfaceAlt }]}>
          <Ionicons name="chatbubble-outline" size={14} color={p.sub} style={{ marginTop: 2 }} />
          <Text style={[st.notesText, { color: p.sub }]} numberOfLines={2}>{ride.notes}</Text>
        </View>
      )}

      <View style={[st.cardFoot, { borderTopColor: p.divider }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[st.price, { color: p.text }]} numberOfLines={1}>{share.each || 'Free ride'}</Text>
          <Text style={[st.priceMeta, { color: p.sub }]} numberOfLines={1}>{share.total ? `${costWord(ride)} · ${share.total}` : 'No fuel split'}</Text>
        </View>
        {busy ? (
          <View style={[st.btn, { minWidth: 124, borderColor: 'transparent' }]}><ActivityIndicator size="small" color={p.accent} /></View>
        ) : action ? (
          <CoBtn
            label={action.label}
            kind={action.kind}
            icon={action.icon}
            onPress={action.go}
            style={{ minWidth: 124 }}
            a11y={action.go === onJoin ? `${action.label}: ${ride.origin} to ${ride.destination}, ${when.label}` : action.go === onDetails ? `View details: ${ride.origin} to ${ride.destination}` : `${action.label}. Open My rides`}
          />
        ) : null}
      </View>
    </Wrapper>
  );
}

// ── My rides ─────────────────────────────────────────────────────────────────

export function SectionLabel({ title, count }: { title: string; count: number }) {
  const p = useCoRidePalette();
  return (
    <Text style={[st.sectionLabel, { color: p.text }]} accessibilityRole="header">
      {title}<Text style={{ color: p.muted, fontWeight: '600' }}>{`  ${count}`}</Text>
    </Text>
  );
}

export function MyRideCard({ ride, myId, busy, onApprove, onDecline, onComplete, onCancel, onWhatsApp, onSafety }: {
  ride: any; myId: string; busy: boolean;
  onApprove: (requestId: string) => void; onDecline: (requestId: string) => void;
  onComplete: () => void; onCancel: (kind: 'host' | 'leave' | 'withdraw') => void;
  onWhatsApp: (phone: any) => void; onSafety: () => void;
}) {
  const p = useCoRidePalette();
  const info = myRideInfo(ride, myId);
  const { isCreator, pending, approved, myStatus, isOpenRide } = info;
  const when = fmtRideWhen(ride.departureTime);
  const fuel = Number(ride.estimatedFuelCost) || 0;
  const riders = 1 + approved.length;
  const seatsLeft = Number(ride.availableSeats) || 0;
  const totalSeats = seatsLeft + approved.length;
  const vehicle = vehicleLabel(ride.vehicleType);
  const showWhen = isOpenRide && when.relative ? `${when.label} · ${when.relative}` : when.label;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  // Seats matter while the ride is open: the host sees how many are taken, a pending rider how many are left.
  const seatsText = !isOpenRide ? null
    : isCreator ? (totalSeats > 0 ? `${seatsLeft} of ${plural(totalSeats, 'seat')} left` : null)
      : myStatus === 'Pending' ? `${plural(seatsLeft, 'seat')} left` : null;
  // Per-person share: the completed panel shows the final split, so nothing here once completed.
  const shareText = ride.status === 'Completed' && fuel > 0 ? null
    : fuel <= 0 ? 'No fuel split'
      : isCreator && approved.length === 0 ? `${inr(fuel)} to split`
        : !isCreator && myStatus !== 'Approved' ? `About ${inr(Math.ceil(fuel / (riders + 1)))} each`
          : `${inr(Math.ceil(fuel / riders))} each · ${riders} people`;

  return (
    <View style={[st.card, { backgroundColor: p.surface }, p.shadow]}>
      <View style={st.myHead}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <View style={[st.vehTile, { backgroundColor: p.accentSoft }]}>
            <MaterialCommunityIcons name={VEHICLE_ICON[vehicle] || 'motorbike'} size={20} color={p.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[st.hostName, { color: p.text }]} numberOfLines={1}>{isCreator ? 'Host' : 'Rider'} · {vehicle}</Text>
            <Text style={[st.hostMeta, { color: p.sub }]} numberOfLines={1}>
              {isCreator ? (ride.creatorRole === 'passenger' ? 'You asked for a lift' : 'Your ride') : `Hosted by ${firstName(ride.creator?.name)}`}
            </Text>
          </View>
        </View>
        <Badge label={info.badge.label} tone={info.badge.tone} />
      </View>

      <RouteLine from={ride.origin} to={ride.destination} compact />

      <View style={st.metaRow2}>
        <MetaItem icon="time-outline" text={showWhen} strong />
      </View>
      <View style={st.metaRow2}>
        {seatsText ? <MetaItem icon="person-outline" text={seatsText} /> : null}
        {shareText ? <MetaItem icon="wallet-outline" text={shareText} /> : null}
      </View>

      {ride.status === 'Completed' && fuel > 0 && (
        <View style={[st.panel, { backgroundColor: p.surfaceAlt }]}>
          <Text style={[st.panelTitle, { color: p.text }]}>{costWord(ride)}</Text>
          <View style={st.panelRow}>
            <Text style={[st.panelText, { color: p.sub }]}>Total</Text>
            <Text style={[st.panelText, { color: p.text }]}>{inr(fuel)}</Text>
          </View>
          <View style={st.panelRow}>
            <Text style={[st.panelText, { color: p.sub }]}>Per person ({riders} people)</Text>
            <Text style={[st.panelText, { color: p.text, fontWeight: '700' }]}>{inr(Math.ceil(fuel / riders))}</Text>
          </View>
          <Text style={[st.hostMeta, { color: p.sub, marginTop: 6 }]}>Settle the split directly with your co-riders.</Text>
        </View>
      )}

      {/* Host: join requests */}
      {isCreator && isOpenRide && pending.length > 0 && (
        <View style={[st.panel, { backgroundColor: p.surfaceAlt }]}>
          <Text style={[st.panelTitle, { color: p.text }]}>Requests ({pending.length})</Text>
          {pending.map((r, i) => (
            <View key={r.id} style={[st.personRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.border }]}>
              <Avatar name={r.passenger?.name} image={r.passenger?.profileImage} size={32} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[st.personName, { color: p.text }]} numberOfLines={1}>{r.passenger?.name || 'Campus student'}</Text>
                {!!genderLabel(r.passenger?.gender) && <Text style={[st.hostMeta, { color: p.sub }]}>{genderLabel(r.passenger?.gender)}</Text>}
              </View>
              <CoBtn label="Decline" kind="secondary" disabled={busy} onPress={() => onDecline(r.id)} style={st.smallBtn} a11y={`Decline ${r.passenger?.name || 'this student'}`} />
              <CoBtn label="Approve" kind="primary" disabled={busy} onPress={() => onApprove(r.id)} style={st.smallBtn} a11y={`Approve ${r.passenger?.name || 'this student'}`} />
            </View>
          ))}
        </View>
      )}

      {/* Host: approved riders, WhatsApp each */}
      {isCreator && approved.length > 0 && ride.status !== 'Cancelled' && (
        <View style={[st.panel, { backgroundColor: p.surfaceAlt }]}>
          <Text style={[st.panelTitle, { color: p.text }]}>{isOpenRide ? 'Riding with you' : 'Rode with you'}</Text>
          {approved.map((r, i) => (
            <View key={r.id} style={[st.personRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.border }]}>
              <Avatar name={r.passenger?.name} image={r.passenger?.profileImage} size={32} />
              <Text style={[st.personName, { color: p.text, flex: 1 }]} numberOfLines={1}>{r.passenger?.name || 'Campus student'}</Text>
              {isOpenRide && (
                <PressScale
                  style={[st.iconBtn, { borderColor: p.border, backgroundColor: p.surface }]}
                  onPress={() => onWhatsApp(r.passenger?.phone)}
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${r.passenger?.name || 'rider'} on WhatsApp`}
                >
                  <Ionicons name="logo-whatsapp" size={19} color={p.whatsapp} />
                </PressScale>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Actions */}
      {isOpenRide && !isCreator && myStatus === 'Approved' && (
        <View style={st.actions}>
          <View style={st.actionRow}>
            <CoBtn label="WhatsApp" kind="secondary" icon="logo-whatsapp" iconColor={p.whatsapp} onPress={() => onWhatsApp(ride.creator?.phone)} style={{ flex: 1 }} a11y={`Message ${firstName(ride.creator?.name, 'the host')} on WhatsApp`} />
            <CoBtn label="Safety" kind="secondary" icon="shield-checkmark-outline" onPress={onSafety} style={{ flex: 1 }} a11y="Safety: call 112 or support" />
          </View>
          <CoBtn label="Leave ride" kind="ghost" disabled={busy} onPress={() => onCancel('leave')} />
        </View>
      )}
      {isOpenRide && !isCreator && myStatus === 'Pending' && (
        <View style={st.actions}>
          <CoBtn label="Withdraw request" kind="secondary" disabled={busy} onPress={() => onCancel('withdraw')} />
        </View>
      )}
      {isOpenRide && isCreator && (
        <View style={st.actions}>
          {approved.length > 0 && (
            <CoBtn label="Complete ride" kind="primary" icon="checkmark" loading={busy} onPress={onComplete} />
          )}
          <View style={st.actionRow}>
            {approved.length > 0 && (
              <CoBtn label="Safety" kind="secondary" icon="shield-checkmark-outline" onPress={onSafety} style={{ flex: 1 }} a11y="Safety: call 112 or support" />
            )}
            <CoBtn label="Cancel ride" kind="secondary" disabled={busy} onPress={() => onCancel('host')} style={{ flex: 1 }} />
          </View>
        </View>
      )}
    </View>
  );
}

// ── Loading, empty, error, logged-out ────────────────────────────────────────

export function RideSkeleton({ count = 3 }: { count?: number }) {
  const p = useCoRidePalette();
  return (
    <View accessibilityLabel="Loading rides">
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[st.card, { backgroundColor: p.surface }, p.shadow]}>
          <View style={st.cardHead}>
            <ShimmerLoader width={44} height={44} borderRadius={22} />
            <View style={{ flex: 1, gap: 6 }}>
              <ShimmerLoader width={110} height={14} borderRadius={6} />
              <ShimmerLoader width={150} height={11} borderRadius={6} />
            </View>
          </View>
          <View style={{ gap: 10, marginTop: 4 }}>
            <ShimmerLoader width="70%" height={14} borderRadius={6} />
            <ShimmerLoader width="55%" height={14} borderRadius={6} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18 }}>
            <ShimmerLoader width={90} height={16} borderRadius={6} />
            <ShimmerLoader width={124} height={44} borderRadius={12} />
          </View>
        </View>
      ))}
      <SlowLoadHint />
    </View>
  );
}

export function CoRideState({ icon, mci, title, message, actionLabel, onAction }: {
  icon: string; mci?: boolean; title: string; message: string; actionLabel?: string; onAction?: () => void; secondary?: boolean;
}) {
  const offline = /reach|internet|connection|offline/i.test(message);
  const waking = /waking/i.test(message);
  const kind = waking ? 'waking' : offline ? 'offline' : icon === 'cloud-offline-outline' ? 'error' : icon === 'person-circle-outline' ? 'signin' : 'empty';
  return (
    <StateCard
      section="coride"
      kind={kind}
      icon={kind === 'empty' || kind === 'signin' ? icon : undefined}
      mci={mci}
      title={offline && kind === 'offline' ? 'You are offline' : waking ? 'Waking the server up' : title}
      message={waking ? 'This takes a few seconds the first time. Try again in a moment.' : message}
      actionLabel={actionLabel}
      onAction={onAction}
    />
  );
}

const st = StyleSheet.create({
  segTrack: { flexDirection: 'row', borderRadius: 14, padding: 4, gap: 4, borderWidth: 1 },
  segBtn: { flex: 1, minHeight: 40, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8 },
  segText: { fontSize: 14 },

  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },

  btn: { minHeight: 44, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  btnText: { fontSize: 14, fontWeight: '700' },
  smallBtn: { minHeight: 40, paddingHorizontal: 12 },

  karma: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  postBtn: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },

  fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  chip: { minHeight: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 6, maxWidth: 200 },
  chipText: { fontSize: 13, fontWeight: '600' },

  card: { borderRadius: 18, padding: 16, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '700' },
  hostName: { fontSize: 15, fontWeight: '700' },
  hostMeta: { fontSize: 12, marginTop: 2 },
  vehTile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  route: { flexDirection: 'row', gap: 12 },
  routeRail: { width: 14, alignItems: 'center', paddingTop: 5, paddingBottom: 2 },
  dotFrom: { width: 11, height: 11, borderRadius: 6, borderWidth: 2.5 },
  railLine: { width: 2, flex: 1, marginVertical: 3, borderRadius: 1 },
  place: { fontWeight: '700', lineHeight: 20 },
  placeNote: { fontSize: 12, marginTop: 1 },

  metaRow2: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6, marginTop: 10 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  metaText: { fontSize: 13, flexShrink: 1 },

  notes: { flexDirection: 'row', gap: 8, padding: 10, borderRadius: 10, marginTop: 12 },
  notesText: { flex: 1, fontSize: 13, lineHeight: 18 },

  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth * 2 },
  price: { fontSize: 17, fontWeight: '800' },
  priceMeta: { fontSize: 12, marginTop: 2 },

  sectionLabel: { fontSize: 16, fontWeight: '800', marginTop: 4, marginBottom: 10 },
  myHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 },

  panel: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 14 },
  panelTitle: { fontSize: 13, fontWeight: '700', marginBottom: 4 },
  panelRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  panelText: { fontSize: 13 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  personName: { fontSize: 14, fontWeight: '600' },
  iconBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

  actions: { marginTop: 14, gap: 8 },
  actionRow: { flexDirection: 'row', gap: 8 },

  state: { alignItems: 'center', borderRadius: 18, paddingVertical: 28, paddingHorizontal: 24, marginBottom: 12 },
  stateIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  stateTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  stateMsg: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6 },
});
