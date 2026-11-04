/**
 * Co-Ride v2 · Shared auto: the ZCS Auto union queue board (GET /api/auto-ride/on-charge, refreshed every
 * 15 s while open), restyled. Stand → destination, the auto on charge (driver first name, verified, auto
 * number as the server masks it, seats left, seat map), autos waiting #2, #3 with their own Book, the fare,
 * and Book seat (CoRideV2AutoBoard: boys-only front seats, riderGender, next-auto offer) → the existing booking
 * screen with the PIN and arrive-by countdown. Scheduled / full auto / bookings / pickups: app/coride/auto-more.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { CR, R, GUTTER, W, shadow } from './coRideV2Theme';
import { ScreenHeader, Chip, Card, Tap } from './CoRideV2Kit';
import { ITicket, IShield, ISeat, ICalendar, IMapPin, IChevronRight, STROKE } from './CoRideV2Icons';
import { BoardSkeleton, StateCard, NetState, StaleBanner } from './CoRideV2States';
import { LineCard } from './CoRideV2AutoBoard';
import { ART, ART_RATIO, AUTO_MAX_W } from './coRideV2Art';
import { useCoRide } from './coRideV2Data';
import { useNav } from './coRideV2Nav';
import { themedSheet } from '../../utils/themeNow';

export default function CoRideV2Auto() {
  const d = useCoRide();
  const router = useRouter();
  const { back, push, route } = useNav();
  const [key, setKey] = useState<string | null>(route.name === 'auto' && route.key ? route.key : null);
  useEffect(() => { const t = setInterval(d.reloadAuto, 15000); return () => clearInterval(t); }, [d.reloadAuto]);
  const lines = d.autoLines || [];
  const line = useMemo(() => lines.find((l) => l.key === key) || lines[0] || null, [lines, key]);
  const artW = Math.min(AUTO_MAX_W, 120);

  const body = () => {
    if (d.autoOn === false) {
      return <StateCard title="ZenWe Auto is opening soon" body="Shared autos on fixed campus routes, run by verified drivers. Book a seat, board with a PIN and pay the driver in cash." action="Find a co-ride instead" onAction={() => push({ name: 'find' })} />;
    }
    if (d.autoOn === null && (d.autoError || d.connection !== 'online')) return <NetState connection={d.connection} error={d.autoError} onRetry={d.reloadAuto} what="the autos" />;
    if (d.autoLines === null) return <BoardSkeleton />;
    if (!lines.length) return <StateCard title="No stands yet" body="ZenWe Auto stands show up here once they are set up." action="Find a co-ride instead" onAction={() => push({ name: 'find' })} />;
    return (
      <>
        {d.autoError ? <StaleBanner text={`${d.autoError} Showing the last update.`} onRetry={d.reloadAuto} /> : null}
        {lines.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chips}>
            {lines.map((l) => <Chip key={l.key} label={`${l.pickup?.name || 'Stand'} → ${l.destination || l.route?.destination || ''}`} on={line?.key === l.key} onPress={() => setKey(l.key)} />)}
          </ScrollView>
        ) : null}
        {line ? <LineCard line={line} /> : null}
      </>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Shared auto" sub="ZenWe Auto · union queue" onBack={back} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        <View style={st.intro}>
          <Image source={ART.auto} style={{ width: artW, height: artW / ART_RATIO.auto }} contentFit="contain" accessibilityElementsHidden />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={st.introTitle}>Autos leave one by one</Text>
            <Text style={st.introBody}>Book the auto on charge, or one waiting behind it. Pay the driver in cash when you board.</Text>
            <View style={[st.row, { gap: 12, marginTop: 8 }]}>
              <View style={[st.row, { gap: 4 }]}><IShield size={14} color={CR.mintInk} strokeWidth={STROKE} /><Text style={st.introMeta}>Verified drivers</Text></View>
              <View style={[st.row, { gap: 4 }]}><ISeat size={14} color={CR.mintInk} strokeWidth={STROKE} /><Text style={st.introMeta}>Live seats</Text></View>
            </View>
          </View>
        </View>
        {body()}
        {/* "My auto bookings" shows even while ZCS Auto is paused: students may still hold seats, PINs or refunds there
            (the server keeps them viewable and cancellable). The booking links show only while it runs. */}
        {d.autoOn !== null ? (
          <Card style={{ paddingHorizontal: 14, paddingVertical: 4, marginTop: 4 }}>
            {[
              { seg: 'bookings', icon: ITicket, t: 'My auto bookings', b: 'Tickets, boarding PINs and past trips' },
              ...(d.autoOn ? [
                { seg: 'shared', icon: ICalendar, t: 'Scheduled autos and full auto', b: 'Book ahead, or the whole auto' },
                { seg: 'pickups', icon: IMapPin, t: 'Pickup points and live queues', b: 'Every stand and the autos waiting there' },
              ] : []),
            ].map((x, i) => (
              <Tap key={x.seg} onPress={() => router.push(`/coride/auto-more?seg=${x.seg}` as any)} label={x.t} style={[st.more, i > 0 && st.moreLine]}>
                <x.icon size={18} color={CR.primary} strokeWidth={STROKE} />
                <View style={{ flex: 1 }}><Text style={st.noneTitle}>{x.t}</Text><Text style={st.meta}>{x.b}</Text></View>
                <IChevronRight size={17} color={CR.muted} strokeWidth={STROKE} />
              </Tap>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

const st = themedSheet(() => ({
  row: { flexDirection: 'row', alignItems: 'center' },
  intro: { flexDirection: 'row', alignItems: 'center', backgroundColor: CR.mint, borderRadius: R.lg, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: CR.mintLine },
  introTitle: { fontSize: 15, fontWeight: W.title, color: CR.ink },
  introBody: { fontSize: 12.5, color: CR.ink2, lineHeight: 17, marginTop: 3 },
  introMeta: { fontSize: 12, color: CR.mintInk, fontWeight: W.label },
  chips: { gap: 8, paddingBottom: 12 },
  meta: { fontSize: 12.5, color: CR.muted, marginTop: 2, lineHeight: 17 },
  noneTitle: { fontSize: 14, fontWeight: W.label, color: CR.ink },
  more: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 8 },
  moreLine: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: CR.lineSoft },
}));
