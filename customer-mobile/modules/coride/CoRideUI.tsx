/**
 * Co-Ride (student bike pool) UI: palette, segmented control, sub-tabs, filters, ride cards, My rides
 * cards, skeleton and state views. Presentation only: every action is a handler passed in by
 * app/(tabs)/others.tsx, which keeps the API calls, confirmations and state.
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import ShimmerLoader from '../../components/ShimmerLoader';
import {
  fmtRideWhen, browseShare, inr, firstName, initialOf, vehicleLabel, vibeLabel, genderLabel, costWord,
  myRideInfo, type Tone,
} from './coRideFormat';

export const useCoRidePalette = () => {
  const { isDark, colors } = useTheme();
  return useMemo(() => ({
    isDark,
    surface: isDark ? '#17171A' : '#FFFFFF',
    surfaceAlt: isDark ? '#222226' : '#F2F3F5',
    segOn: isDark ? '#34343A' : '#FFFFFF',
    border: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.09)',
    divider: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.06)',
    text: colors.text,
    sub: colors.textSecondary,
    muted: colors.textMuted,
    accent: COLORS.red,
    accentSoft: isDark ? 'rgba(239,79,95,0.14)' : '#FDEDEF',
    success: isDark ? '#34D399' : '#047857',
    successSoft: isDark ? 'rgba(16,185,129,0.14)' : '#E8F6EF',
    warning: isDark ? '#FBBF24' : '#B45309',
    warningSoft: isDark ? 'rgba(245,158,11,0.14)' : '#FDF4E3',
    neutralSoft: isDark ? 'rgba(255,255,255,0.07)' : '#F1F3F5',
    whatsapp: '#25D366',
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
    <View style={[st.segTrack, { backgroundColor: p.surfaceAlt }, style]} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map(o => {
        const on = o.key === value;
        const color = on ? p.text : p.sub;
        return (
          <TouchableOpacity
            key={o.key}
            style={[st.segBtn, on && { backgroundColor: p.segOn, borderColor: p.border, borderWidth: StyleSheet.hairlineWidth * 2 }]}
            onPress={() => onChange(o.key)}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
          >
            {o.icon ? (o.iconSet === 'mci'
              ? <MaterialCommunityIcons name={o.icon as any} size={17} color={color} />
              : <Ionicons name={o.icon as any} size={16} color={color} />) : null}
            <Text style={[st.segText, { color, fontWeight: on ? '600' : '500' }]} numberOfLines={1}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const p = useCoRidePalette();
  const bg = tone === 'success' ? p.successSoft : tone === 'warning' ? p.warningSoft : p.neutralSoft;
  const fg = tone === 'success' ? p.success : tone === 'warning' ? p.warning : p.sub;
  return (
    <View style={[st.badge, { backgroundColor: bg }]}>
      <Text style={[st.badgeText, { color: fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

type BtnKind = 'primary' | 'secondary' | 'ghost' | 'success';
export function CoBtn({ label, onPress, kind = 'primary', icon, iconColor, loading, disabled, style, a11y }: {
  label: string; onPress: () => void; kind?: BtnKind; icon?: string; iconColor?: string;
  loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; a11y?: string;
}) {
  const p = useCoRidePalette();
  const bg = kind === 'primary' ? p.accent : kind === 'success' ? p.successSoft : kind === 'secondary' ? p.surface : 'transparent';
  const fg = kind === 'primary' ? '#FFFFFF' : kind === 'success' ? p.success : p.text;
  const off = disabled || loading;
  return (
    <TouchableOpacity
      style={[st.btn, { backgroundColor: bg, borderColor: kind === 'secondary' ? p.border : 'transparent', opacity: disabled ? 0.5 : 1 }, style]}
      onPress={onPress}
      disabled={off}
      activeOpacity={0.8}
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
    </TouchableOpacity>
  );
}

function RouteLine({ from, to, compact }: { from: string; to: string; compact?: boolean }) {
  const p = useCoRidePalette();
  return (
    <View style={st.route} accessibilityLabel={`From ${from} to ${to}`}>
      <View style={st.routeRail}>
        <View style={[st.dotFrom, { borderColor: p.sub }]} />
        <View style={[st.railLine, { backgroundColor: p.border }]} />
        <View style={[st.dotTo, { backgroundColor: p.text }]} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[st.place, { color: p.text, fontSize: compact ? 14 : 15 }]} numberOfLines={1}>{from}</Text>
        <Text style={[st.place, { color: p.text, fontSize: compact ? 14 : 15, marginTop: compact ? 10 : 12 }]} numberOfLines={1}>{to}</Text>
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

// ── Header pieces ────────────────────────────────────────────────────────────

export function KarmaLine({ points }: { points: number }) {
  const p = useCoRidePalette();
  return (
    <View style={st.karma} accessibilityLabel={`Karma ${points}. Plus 50 for each completed ride`}>
      <Ionicons name="ribbon-outline" size={16} color={p.sub} />
      <Text style={{ fontSize: 13, color: p.sub }}>
        <Text style={{ color: p.text, fontWeight: '600' }}>Karma {points}</Text>
        {'  ·  +50 for each completed ride'}
      </Text>
    </View>
  );
}

export function PoolTabs({ value, onChange, myRidesCount, onPost }: {
  value: 'browse' | 'my-rides'; onChange: (v: 'browse' | 'my-rides') => void; myRidesCount: number; onPost: () => void;
}) {
  const p = useCoRidePalette();
  const tab = (key: 'browse' | 'my-rides', label: string) => {
    const on = value === key;
    return (
      <TouchableOpacity
        key={key}
        style={st.tab}
        onPress={() => onChange(key)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={label}
        activeOpacity={0.7}
      >
        <Text style={[st.tabText, { color: on ? p.text : p.sub, fontWeight: on ? '600' : '500' }]}>{label}</Text>
        <View style={[st.tabBar, { backgroundColor: on ? p.text : 'transparent' }]} />
      </TouchableOpacity>
    );
  };
  return (
    <View style={[st.tabsRow, { borderBottomColor: p.divider }]}>
      <View style={{ flexDirection: 'row', gap: 20 }} accessibilityRole="tablist">
        {tab('browse', 'Find a ride')}
        {tab('my-rides', myRidesCount > 0 ? `My rides (${myRidesCount})` : 'My rides')}
      </View>
      <TouchableOpacity
        style={[st.postBtn, { backgroundColor: p.accent }]}
        onPress={onPost}
        activeOpacity={0.85}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        accessibilityRole="button"
        accessibilityLabel="Post a ride"
      >
        <Ionicons name="add" size={18} color="#FFFFFF" />
        <Text style={st.postBtnText}>Post a ride</Text>
      </TouchableOpacity>
    </View>
  );
}

export function RideFilters({ vehicle, onVehicle, destinations, goingTo, onGoingTo }: {
  vehicle: string; onVehicle: (v: 'All' | 'Bike' | 'Car') => void;
  destinations: string[]; goingTo: string | null; onGoingTo: (d: string | null) => void;
}) {
  const p = useCoRidePalette();
  const chip = (label: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity
      key={label}
      style={[st.chip, { backgroundColor: on ? p.text : p.surface, borderColor: on ? p.text : p.border }]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label === 'Anywhere' ? 'Going anywhere' : `Going to ${label}`}
      hitSlop={{ top: 6, bottom: 6 }}
    >
      <Text style={[st.chipText, { color: on ? p.surface : p.text }]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
  const veh = vehicle === 'Bike' || vehicle === 'Car' ? vehicle : 'All';
  return (
    <View style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Vehicle">
        {(['All', 'Bike', 'Car'] as const).map(v => {
          const on = veh === v;
          return (
            <TouchableOpacity
              key={v}
              style={[st.chip, st.vehChip, { backgroundColor: on ? p.text : p.surface, borderColor: on ? p.text : p.border }]}
              onPress={() => onVehicle(v)}
              activeOpacity={0.8}
              hitSlop={{ top: 6, bottom: 6 }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={v === 'All' ? 'All vehicles' : `${v} rides`}
            >
              {v !== 'All' ? <MaterialCommunityIcons name={VEHICLE_ICON[v]} size={16} color={on ? p.surface : p.sub} /> : null}
              <Text style={[st.chipText, { color: on ? p.surface : p.text }]}>{v === 'All' ? 'All vehicles' : v}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {destinations.length >= 2 && (
        <View style={{ marginTop: 14 }}>
          <Text style={[st.fieldLabel, { color: p.sub }]}>Going to</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 16 }}>
            {chip('Anywhere', !goingTo, () => onGoingTo(null))}
            {destinations.map(d => chip(d, goingTo === d, () => onGoingTo(goingTo === d ? null : d)))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// ── Find a ride: one card per post ───────────────────────────────────────────

export function RideCard({ ride, joinStatus, busy, onJoin, onOpenMyRides }: {
  ride: any; joinStatus?: string; busy: boolean; onJoin: () => void; onOpenMyRides: () => void;
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
        : { label: needsRide ? 'Ride together' : ride.autoApprove ? 'Join ride' : 'Request to join', kind: 'primary' as const, icon: undefined, go: onJoin };

  return (
    <View style={[st.card, { backgroundColor: p.surface, borderColor: p.border, opacity: busy ? 0.7 : 1 }]}>
      <View style={st.cardHead}>
        <View style={[st.avatar, { backgroundColor: p.surfaceAlt }]}>
          <Text style={[st.avatarText, { color: p.text }]}>{initialOf(ride.creator?.name)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[st.hostName, { color: p.text }]} numberOfLines={1}>{name}</Text>
          <Text style={[st.hostMeta, { color: p.sub }]} numberOfLines={1}>{metaBits || 'Campus student'}</Text>
        </View>
        {needsRide ? <Badge label="Needs a ride" tone="warning" /> : null}
      </View>

      <RouteLine from={ride.origin} to={ride.destination} />

      <View style={[st.metaRow, { borderTopColor: p.divider }]}>
        <MetaItem icon="time-outline" text={when.relative ? `${when.label} · ${when.relative}` : when.label} strong />
      </View>
      <View style={st.metaRow2}>
        <MetaItem icon={VEHICLE_ICON[vehicle] || 'motorbike'} mci text={ride.vehicleInfo ? `${vehicle} · ${ride.vehicleInfo}` : vehicle} />
        <MetaItem icon="person-outline" text={needsRide ? `${seats} seat${seats === 1 ? '' : 's'} needed` : `${seats} seat${seats === 1 ? '' : 's'} left`} />
      </View>

      {!!ride.notes && (
        <View style={[st.notes, { backgroundColor: p.surfaceAlt }]}>
          <Ionicons name="chatbubble-outline" size={14} color={p.sub} style={{ marginTop: 2 }} />
          <Text style={[st.notesText, { color: p.sub }]} numberOfLines={2}>{ride.notes}</Text>
        </View>
      )}

      <View style={[st.cardFoot, { borderTopColor: p.divider }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[st.price, { color: p.text }]} numberOfLines={1}>{share.each || 'Free'}</Text>
          <Text style={[st.priceMeta, { color: p.sub }]} numberOfLines={1}>{share.total ? `${costWord(ride)} · ${share.total}` : 'No fuel split'}</Text>
        </View>
        {busy ? (
          <View style={[st.btn, { minWidth: 132 }]}><ActivityIndicator size="small" color={p.accent} /></View>
        ) : action ? (
          <CoBtn
            label={action.label}
            kind={action.kind}
            icon={action.icon}
            onPress={action.go}
            style={{ minWidth: 132 }}
            a11y={action.go === onJoin ? `${action.label}: ${ride.origin} to ${ride.destination}, ${when.label}` : `${action.label}. Open My rides`}
          />
        ) : null}
      </View>
    </View>
  );
}

// ── My rides ─────────────────────────────────────────────────────────────────

export function SectionLabel({ title, count }: { title: string; count: number }) {
  const p = useCoRidePalette();
  return (
    <Text style={[st.sectionLabel, { color: p.sub }]} accessibilityRole="header">
      {title}<Text style={{ color: p.muted }}>{`  ${count}`}</Text>
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
    <View style={[st.card, { backgroundColor: p.surface, borderColor: p.border }]}>
      <View style={st.myHead}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <View style={[st.rolePill, { borderColor: p.border }]}>
            <Text style={[st.roleText, { color: p.text }]}>{isCreator ? 'Host' : 'Rider'}</Text>
          </View>
          <Text style={[st.hostMeta, { color: p.sub, marginTop: 0, flexShrink: 1 }]} numberOfLines={1}>
            {isCreator ? (ride.creatorRole === 'passenger' ? 'You need a ride' : 'Your ride') : `Hosted by ${firstName(ride.creator?.name)}`}
          </Text>
        </View>
        <Badge label={info.badge.label} tone={info.badge.tone} />
      </View>

      <RouteLine from={ride.origin} to={ride.destination} compact />

      <View style={st.metaRow}>
        <MetaItem icon="time-outline" text={showWhen} strong />
      </View>
      <View style={st.metaRow2}>
        <MetaItem icon={VEHICLE_ICON[vehicle] || 'motorbike'} mci text={vehicle} />
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
            <Text style={[st.panelText, { color: p.text, fontWeight: '600' }]}>{inr(Math.ceil(fuel / riders))}</Text>
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
              <View style={[st.avatarSm, { backgroundColor: p.surface }]}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: p.text }}>{initialOf(r.passenger?.name)}</Text>
              </View>
              <Text style={[st.personName, { color: p.text, flex: 1 }]} numberOfLines={1}>{r.passenger?.name || 'Campus student'}</Text>
              {isOpenRide && (
                <TouchableOpacity
                  style={[st.iconBtn, { borderColor: p.border, backgroundColor: p.surface }]}
                  onPress={() => onWhatsApp(r.passenger?.phone)}
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${r.passenger?.name || 'rider'} on WhatsApp`}
                >
                  <Ionicons name="logo-whatsapp" size={19} color={p.whatsapp} />
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Actions */}
      {isOpenRide && !isCreator && myStatus === 'Approved' && (
        <View style={st.actions}>
          <View style={st.actionRow}>
            <CoBtn label="WhatsApp" kind="secondary" icon="logo-whatsapp" iconColor={p.whatsapp} onPress={() => onWhatsApp(ride.creator?.phone)} style={{ flex: 1 }} a11y={`Message ${firstName(ride.creator?.name, "the host")} on WhatsApp`} />
            <CoBtn label="Safety" kind="secondary" icon="shield-checkmark-outline" onPress={onSafety} style={{ flex: 1 }} a11y="Safety: call 112 or Zenvy support" />
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
              <CoBtn label="Safety" kind="secondary" icon="shield-checkmark-outline" onPress={onSafety} style={{ flex: 1 }} a11y="Safety: call 112 or Zenvy support" />
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
        <View key={i} style={[st.card, { backgroundColor: p.surface, borderColor: p.border }]}>
          <View style={st.cardHead}>
            <ShimmerLoader width={40} height={40} borderRadius={20} />
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
            <ShimmerLoader width={132} height={44} borderRadius={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function CoRideState({ icon, mci, title, message, actionLabel, onAction, secondary }: {
  icon: string; mci?: boolean; title: string; message: string; actionLabel?: string; onAction?: () => void; secondary?: boolean;
}) {
  const p = useCoRidePalette();
  return (
    <View style={[st.state, { backgroundColor: p.surface, borderColor: p.border }]}>
      <View style={[st.stateIcon, { backgroundColor: p.surfaceAlt }]}>
        {mci ? <MaterialCommunityIcons name={icon as any} size={24} color={p.sub} /> : <Ionicons name={icon as any} size={22} color={p.sub} />}
      </View>
      <Text style={[st.stateTitle, { color: p.text }]} accessibilityRole="header">{title}</Text>
      <Text style={[st.stateMsg, { color: p.sub }]}>{message}</Text>
      {actionLabel && onAction ? (
        <CoBtn label={actionLabel} kind={secondary ? 'secondary' : 'primary'} onPress={onAction} style={{ marginTop: 16, minWidth: 160 }} />
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  segTrack: { flexDirection: 'row', borderRadius: 12, padding: 3, gap: 3 },
  segBtn: { flex: 1, minHeight: 40, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8, borderColor: 'transparent', borderWidth: StyleSheet.hairlineWidth * 2 },
  segText: { fontSize: 14 },

  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '600' },

  btn: { minHeight: 44, borderRadius: 10, borderWidth: 1, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  btnText: { fontSize: 14, fontWeight: '600' },
  smallBtn: { minHeight: 44, paddingHorizontal: 12 },

  karma: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },

  tabsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth * 2, marginTop: 12, marginBottom: 16 },
  tab: { minHeight: 48, justifyContent: 'flex-end' },
  tabText: { fontSize: 15, paddingBottom: 10 },
  tabBar: { height: 2, borderRadius: 1 },
  postBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: 14, borderRadius: 20, marginBottom: 4 },
  postBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },

  fieldLabel: { fontSize: 13, fontWeight: '500', marginBottom: 8 },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, justifyContent: 'center', maxWidth: 200 },
  vehChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontSize: 13, fontWeight: '500' },

  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '600' },
  avatarSm: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  hostName: { fontSize: 15, fontWeight: '600' },
  hostMeta: { fontSize: 12, marginTop: 2 },

  route: { flexDirection: 'row', gap: 12 },
  routeRail: { width: 12, alignItems: 'center', paddingTop: 6, paddingBottom: 6 },
  dotFrom: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  railLine: { width: 2, flex: 1, marginVertical: 3, borderRadius: 1 },
  dotTo: { width: 10, height: 10, borderRadius: 2 },
  place: { fontWeight: '600', lineHeight: 20 },

  metaRow: { marginTop: 14 },
  metaRow2: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6, marginTop: 8 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  metaText: { fontSize: 13, flexShrink: 1 },

  notes: { flexDirection: 'row', gap: 8, padding: 10, borderRadius: 10, marginTop: 12 },
  notesText: { flex: 1, fontSize: 13, lineHeight: 18 },

  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth * 2 },
  price: { fontSize: 16, fontWeight: '700' },
  priceMeta: { fontSize: 12, marginTop: 2 },

  sectionLabel: { fontSize: 13, fontWeight: '600', marginTop: 4, marginBottom: 10 },
  myHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 },
  rolePill: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  roleText: { fontSize: 12, fontWeight: '600' },

  panel: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 14 },
  panelTitle: { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  panelRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  panelText: { fontSize: 13 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  personName: { fontSize: 14, fontWeight: '500' },
  iconBtn: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

  actions: { marginTop: 14, gap: 8 },
  actionRow: { flexDirection: 'row', gap: 8 },

  state: { alignItems: 'center', borderRadius: 16, borderWidth: 1, paddingVertical: 28, paddingHorizontal: 24, marginBottom: 12 },
  stateIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  stateTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  stateMsg: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6 },
});
