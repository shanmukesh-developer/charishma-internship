/**
 * Co-Ride v2 · Find a lift: a sticky route summary (from → to, editable), filter chips (Now / Today /
 * Tomorrow, Bike / Car, 2+ seats, Women only = the ride's womenOnly flag), sort (Soonest / Cheapest), then rich ride cards from the
 * real open posts. "Give a lift" lists students asking for one. Empty: "Ask for a lift" first.
 * "Notify me" is not offered: there is no ride-alert endpoint yet (owner decision).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput } from 'react-native';
import { CR, R, GUTTER, W, shadow } from './coRideV2Theme';
import { ScreenHeader, Chip, Segmented, Tap } from './CoRideV2Kit';
import { IMapPin, IX, ISort, IShield, IUsers, IClock, STROKE } from './CoRideV2Icons';
import { ResultRideCard } from './CoRideV2RideCard';
import { RideSkeleton, StateCard, NetState, StaleBanner } from './CoRideV2States';
import { useCoRide, isOffer, isWomenOnly, shareOf, type Ride } from './coRideV2Data';
import { useNav, type When } from './coRideV2Nav';
import { AutoMatch } from './CoRideV2HomeExtras';
import { themedSheet } from '../../utils/themeNow';

const IST = 330 * 60000;
const istDay = (ms: number) => Math.floor((ms + IST) / 86400000);
const t = (r: Ride) => new Date(r.departureTime).getTime() || 0;
const has = (field: any, q: string) => !q || String(field || '').toLowerCase().includes(q.toLowerCase());

function RouteSummary({ from, to, setFrom, setTo, focus }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void; focus?: boolean }) {
  const input = (value: string, set: (v: string) => void, ph: string, autoFocus?: boolean) => (
    <View style={st.sumField}>
      <TextInput value={value} onChangeText={set} placeholder={ph} placeholderTextColor={CR.faint} style={st.sumInput} maxLength={80} accessibilityLabel={ph} returnKeyType="search" autoFocus={autoFocus} />
      {value ? <Tap onPress={() => set('')} label={`Clear ${ph.toLowerCase()}`} style={st.sumClear}><IX size={15} color={CR.muted} strokeWidth={STROKE} /></Tap> : null}
    </View>
  );
  return (
    <View style={[st.summary, shadow(1)]}>
      <View style={st.sumRail}>
        <View style={st.dotFrom} />
        <View style={st.railLine} />
        <IMapPin size={14} color={CR.primary} strokeWidth={1.8} />
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        {input(from, setFrom, 'Any pickup')}
        {input(to, setTo, 'Any destination', focus)}
      </View>
    </View>
  );
}

export default function CoRideV2Find() {
  const d = useCoRide();
  const { route, back, push, openSheet } = useNav();
  const r0 = route.name === 'find' ? route : { from: '', to: '', kind: 'lift' as const, focus: false, women: false };
  const [kind, setKind] = useState<'lift' | 'give'>(r0.kind || 'lift');
  const [from, setFrom] = useState(r0.from || '');
  const [to, setTo] = useState(r0.to || '');
  const [when, setWhen] = useState<When>('any');
  const [vehicle, setVehicle] = useState<'Bike' | 'Car' | null>(null);
  const [seats2, setSeats2] = useState(false);
  const [sort, setSort] = useState<'soon' | 'cheap'>('soon');
  const [women, setWomen] = useState(!!r0.women);

  const base = useMemo(() => d.rides.filter((r) => (kind === 'give' ? !isOffer(r) : isOffer(r))), [d.rides, kind]);
  const shown = useMemo(() => {
    const now = Date.now();
    const today = istDay(now);
    return base
      .filter((r) => has(r.origin, from.trim()) && has(r.destination, to.trim()))
      .filter((r) => when === 'any' || (when === 'now' ? t(r) - now <= 60 * 60000 : when === 'today' ? istDay(t(r)) === today : istDay(t(r)) === today + 1))
      .filter((r) => !vehicle || (vehicle === 'Car' ? r.vehicleType === 'Car' : r.vehicleType !== 'Car'))
      .filter((r) => !seats2 || (Number(r.availableSeats) || 0) >= 2)
      .filter((r) => !women || isWomenOnly(r))
      .sort((a, b) => (sort === 'soon' ? t(a) - t(b) : (shareOf(a)?.max ?? 0) - (shareOf(b)?.max ?? 0) || t(a) - t(b)));
  }, [base, from, to, when, vehicle, seats2, women, sort]);
  const filtered = when !== 'any' || !!vehicle || seats2 || women || !!from.trim() || !!to.trim();
  const clear = () => { setWhen('any'); setVehicle(null); setSeats2(false); setWomen(false); setFrom(''); setTo(''); };

  const list = () => {
    if (d.ridesLoading) return <RideSkeleton />;
    if (!d.rides.length && (d.connection !== 'online' || d.ridesError)) return <NetState connection={d.connection} error={d.ridesError} onRetry={d.reload} />;
    if (!shown.length) {
      if (filtered && base.length) return <StateCard art title="No rides match" body="Try another time or vehicle, or ask for a lift and let drivers find you." action="Ask for a lift" onAction={() => push({ name: 'post', role: 'passenger' })} secondary="Clear filters" onSecondary={clear} />;
      return kind === 'give'
        ? <StateCard art title="Nobody is asking for a lift" body="When students post that they need a ride, they show up here. Post your ride so they can find you." action="Offer a seat" onAction={() => push({ name: 'post', role: 'rider' })} />
        : <StateCard art title="No rides posted yet" body="Ask for a lift and students with a bike or car going your way can offer you the seat." action="Ask for a lift" onAction={() => push({ name: 'post', role: 'passenger' })} secondary="Offer a seat" onSecondary={() => push({ name: 'post', role: 'rider' })} />;
    }
    return (
      <>
        {d.connection !== 'online' ? <StaleBanner text="Showing the last list. We could not refresh it." onRetry={d.reload} /> : null}
        {shown.map((r) => (
          <ResultRideCard
            key={r.id}
            ride={r}
            status={d.joinStatus[String(r.id)]}
            busy={d.busy === String(r.id)}
            onOpen={() => push({ name: 'ride', id: String(r.id) })}
            onRequest={() => openSheet({ kind: 'request', ride: r })}
            onOpenMine={() => push({ name: 'mine', as: 'rider' })}
          />
        ))}
      </>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title={kind === 'give' ? 'Give a lift' : 'Find a lift'} sub={d.ridesLoading ? 'Looking for rides' : `${shown.length} ride${shown.length === 1 ? '' : 's'}${filtered ? ' match' : ' open'}`} onBack={back} />
      <ScrollView stickyHeaderIndices={[0]} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={st.sticky}>
          <RouteSummary from={from} to={to} setFrom={setFrom} setTo={setTo} focus={!!r0.focus} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chips}>
            {(['now', 'today', 'tomorrow'] as When[]).map((w) => <Chip key={w} label={w === 'now' ? 'Now' : w === 'today' ? 'Today' : 'Tomorrow'} icon={w === 'now' ? IClock : undefined} on={when === w} onPress={() => setWhen(when === w ? 'any' : w)} />)}
            <View style={st.chipGap} />
            {(['Bike', 'Car'] as const).map((v) => <Chip key={v} label={v} on={vehicle === v} onPress={() => setVehicle(vehicle === v ? null : v)} />)}
            <Chip label="2+ seats" icon={IUsers} on={seats2} onPress={() => setSeats2(!seats2)} />
            <Chip label="Women only" icon={IShield} on={women} onPress={() => setWomen(!women)} />
          </ScrollView>
        </View>
        <View style={{ paddingHorizontal: GUTTER }}>
          <View style={st.listHead}>
            <Segmented<'lift' | 'give'> compact value={kind} onChange={setKind} style={{ flex: 1 }} options={[{ key: 'lift', label: 'Offers' }, { key: 'give', label: 'Lift requests' }]} />
            <Tap onPress={() => setSort(sort === 'soon' ? 'cheap' : 'soon')} label={`Sort: ${sort === 'soon' ? 'soonest' : 'cheapest'} first`} style={st.sort}>
              <ISort size={17} color={CR.ink2} strokeWidth={STROKE} />
              <Text style={st.sortText}>{sort === 'soon' ? 'Soonest' : 'Cheapest'}</Text>
            </Tap>
          </View>
          {kind === 'lift' ? <AutoMatch to={to} /> : null}
          {list()}
        </View>
      </ScrollView>
    </View>
  );
}

const st = themedSheet(() => ({
  sticky: { backgroundColor: CR.page, paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 10 },
  summary: { flexDirection: 'row', backgroundColor: CR.card, borderRadius: R.lg, padding: 10, paddingLeft: 12 },
  sumRail: { width: 14, alignItems: 'center', paddingVertical: 14, marginRight: 8 },
  dotFrom: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.6, borderColor: CR.primary },
  railLine: { width: 1.2, flex: 1, backgroundColor: CR.tint2, marginVertical: 3 },
  sumField: { flexDirection: 'row', alignItems: 'center', backgroundColor: CR.field, borderRadius: 10, minHeight: 40, paddingLeft: 10 },
  sumInput: { flex: 1, fontSize: 14, color: CR.ink, fontWeight: W.label, paddingVertical: 6, outlineStyle: 'none' } as any,
  sumClear: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  chips: { gap: 8, paddingTop: 10, alignItems: 'center' },
  chipGap: { width: StyleSheet.hairlineWidth * 2, height: 20, backgroundColor: CR.line, marginHorizontal: 2 },
  listHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  sort: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 46, paddingHorizontal: 12, borderRadius: R.md, backgroundColor: CR.card, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: CR.line },
  sortText: { fontSize: 13.5, color: CR.ink2, fontWeight: W.label },
}));
