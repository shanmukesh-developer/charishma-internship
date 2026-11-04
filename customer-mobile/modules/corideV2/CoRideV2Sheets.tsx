/**
 * Co-Ride v2 sheets over any screen: request a seat (confirm), request sent, ride posted,
 * how Karma works, SOS numbers, and a plain info sheet. ZCS Auto tickets open the existing booking screen
 * (app/auto-ride/booking/[id]).
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CR, R, W } from './coRideV2Theme';
import { Sheet, PrimaryButton, OutlineButton, Avatar, Pill, Tap } from './CoRideV2Kit';
import { ICheckCircle, IBadge, IInfo, IPhone, ISiren, STROKE } from './CoRideV2Icons';
import { coRideApi } from './coRideV2Api';
import { ZENVY_SUPPORT_PHONE } from '../../constants/api';
import { RouteRail, whenOf, PriceBlock, poolTag } from './CoRideV2RideCard';
import { useCoRide, KARMA_PER_RIDE, isOffer } from './coRideV2Data';
import { useNav } from './coRideV2Nav';
import { firstName } from '../../modules/coride/coRideFormat';
import { dial } from '../../utils/dial';
import { themedSheet } from '../../utils/themeNow';

function Done({ title, body }: { title: string; body: string }) {
  return (
    <View style={st.doneHead}>
      <View style={st.doneIcon}><ICheckCircle size={28} color={CR.green} strokeWidth={STROKE} /></View>
      <Text style={st.doneTitle}>{title}</Text>
      <Text style={st.doneBody}>{body}</Text>
    </View>
  );
}

function RideSummary({ ride }: { ride: any }) {
  const w = whenOf(ride);
  return (
    <View style={st.summary}>
      <View style={[st.row, { marginBottom: 12 }]}>
        <Avatar name={ride.creator?.name} image={ride.creator?.profileImage} size={38} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={st.name}>{firstName(ride.creator?.name)}</Text>
          <Text style={st.meta}>{w.label} · {poolTag(ride)}</Text>
        </View>
        <PriceBlock ride={ride} />
      </View>
      <RouteRail from={ride.origin} to={ride.destination} />
    </View>
  );
}

/** SOS: Call 112 always; on a ride I am on (host or confirmed rider) also alert ZCS support with the ride
 *  (POST /api/bikepool/posts/:id/sos; no location, expo-location is not installed). */
function SosSheet({ rideId, onClose }: { rideId?: string; onClose: () => void }) {
  const [state, setState] = useState<{ busy: boolean; done: string | null; error: string | null }>({ busy: false, done: null, error: null });
  const call = (n: string, label?: string) => dial(n, label);
  const alertZcs = async () => {
    if (!rideId || state.busy) return;
    setState({ busy: true, done: null, error: null });
    const r = await coRideApi.sos(rideId);
    setState({ busy: false, done: r.ok ? (r.data.message || 'ZENV support has your SOS and will call you now.') : null, error: r.ok ? null : r.message });
  };
  return (
    <Sheet visible onClose={onClose} title="Need help?">
      {rideId ? (
        <View style={{ marginBottom: 6 }}>
          <PrimaryButton label={state.done ? 'SOS sent to ZENV' : 'Alert ZENV support about this ride'} icon={ISiren} onPress={alertZcs} busy={state.busy} disabled={!!state.done} style={{ backgroundColor: CR.red }} />
          {state.done ? <Text style={[st.note, { color: CR.green }]}>{state.done}</Text> : null}
          {state.error ? <Text style={[st.note, { color: CR.red }]}>{state.error}</Text> : null}
        </View>
      ) : null}
      {[
        { n: '112', t: 'Call 112 · Emergency (police, ambulance, fire)', red: true },
        { n: '181', t: 'Women helpline', red: true },
        { n: `+${ZENVY_SUPPORT_PHONE}`, t: 'ZENV support desk', red: false },
      ].map((x) => (
        <Tap key={x.n} onPress={() => call(x.n, x.t)} label={`Call ${x.t}, ${x.n}`} style={st.sosRow}>
          <View style={[st.sosIcon, { backgroundColor: x.red ? CR.redSoft : CR.tint }]}><IPhone size={18} color={x.red ? CR.red : CR.primary} strokeWidth={STROKE} /></View>
          <View style={{ flex: 1 }}>
            <Text style={st.name}>{x.t}</Text>
            <Text style={st.meta}>{x.n}</Text>
          </View>
        </Tap>
      ))}
      <Text style={st.note}>Share your trip with a friend from Ride details before you leave.</Text>
    </Sheet>
  );
}

export default function CoRideV2Sheets() {
  const { sheet, closeSheet, openSheet, push } = useNav();
  const d = useCoRide();
  if (!sheet) return null;

  if (sheet.kind === 'request') {
    const ride = sheet.ride;
    const offer = isOffer(ride);
    const send = async () => {
      const r = await d.act('join', { rideId: String(ride.id) });
      if (r.ok) openSheet({ kind: 'requested', ride, known: r.data?.autoAccepted === 'known' });
      else openSheet({ kind: 'done', title: 'Could not send the request', body: r.message || 'Please try again.' });
    };
    return (
      <Sheet visible onClose={closeSheet} title={offer ? (ride.autoApprove ? 'Join this ride?' : 'Request a seat?') : 'Ride together?'}
        footer={<PrimaryButton label={ride.autoApprove ? 'Join ride' : 'Send request'} onPress={send} busy={d.busy === String(ride.id)} />}>
        <RideSummary ride={ride} />
        <Text style={st.note}>One seat per request. {ride.autoApprove ? 'This host lets riders join straight away.' : 'The host approves who rides with them.'} You settle your fuel share with the host when you meet; ZENV takes no payment for pool rides.</Text>
      </Sheet>
    );
  }

  if (sheet.kind === 'requested') {
    const ride = sheet.ride;
    return (
      <Sheet visible onClose={closeSheet}
        footer={<>
          <PrimaryButton label="Open My rides" onPress={() => { closeSheet(); push({ name: 'mine', as: 'rider' }); }} />
          <OutlineButton label="Back to rides" onPress={closeSheet} style={{ marginTop: 10 }} />
        </>}>
        <Done title={ride.autoApprove || sheet.known ? 'You are on this ride' : 'Request sent'} body={sheet.known ? `You have ridden with ${firstName(ride.creator?.name)} before, so you are in. Their number shows in My rides.` : ride.autoApprove ? `${firstName(ride.creator?.name)}'s number shows in My rides so you can meet at the pickup.` : `${firstName(ride.creator?.name)} will review your request. You can follow it in My rides.`} />
        <RideSummary ride={ride} />
      </Sheet>
    );
  }

  if (sheet.kind === 'posted') {
    const s = sheet.summary;
    return (
      <Sheet visible onClose={closeSheet}
        footer={<>
          <PrimaryButton label="See it in My rides" onPress={() => { closeSheet(); push({ name: 'mine', as: 'driver' }); }} />
          {s.role === 'rider' && sheet.base ? <OutlineButton label="Make this a regular ride" onPress={() => { const b = sheet.base; closeSheet(); push({ name: 'regular', base: b }); }} style={{ marginTop: 10 }} /> : null}
        </>}>
        <Done title={s.role === 'rider' ? 'Ride posted' : 'Lift request posted'} body={s.role === 'rider' ? 'Students heading the same way can now ask for a seat. You approve who rides with you.' : 'Students with a bike or car going your way can offer you the seat.'} />
        <View style={st.summary}>
          <RouteRail from={s.from} to={s.to} />
          <View style={[st.row, { marginTop: 12, gap: 8, flexWrap: 'wrap' }]}>
            <Pill text={s.when} tone="blue" />
            <Pill text={`${s.vehicle} · ${s.seats} seat${s.seats === 1 ? '' : 's'}`} />
            {s.share ? <Pill text={`${s.share} per person`} tone="green" /> : <Pill text="No fuel split" />}
          </View>
        </View>
      </Sheet>
    );
  }

  if (sheet.kind === 'karma') {
    return (
      <Sheet visible onClose={closeSheet} title="Karma" footer={<PrimaryButton label="Got it" onPress={closeSheet} />}>
        <View style={[st.row, { gap: 10, marginBottom: 12 }]}>
          <IBadge size={22} color={CR.primary} strokeWidth={STROKE} />
          <Text style={st.karmaBig}>{d.karma}</Text>
          <Text style={st.meta}>points so far</Text>
        </View>
        {[
          `+${KARMA_PER_RIDE} for the host and for every approved rider when a ride is marked completed.`,
          'The host marks the ride completed once everyone has reached.',
          'Cancelled rides and withdrawn requests earn nothing.',
        ].map((t) => (
          <View key={t} style={[st.row, { alignItems: 'flex-start', gap: 10, marginBottom: 10 }]}>
            <View style={st.bullet} />
            <Text style={[st.note, { flex: 1, marginTop: 0 }]}>{t}</Text>
          </View>
        ))}
      </Sheet>
    );
  }

  if (sheet.kind === 'sos') return <SosSheet rideId={sheet.rideId} onClose={closeSheet} />;

  return (
    <Sheet visible onClose={closeSheet} title={sheet.title} footer={<PrimaryButton label="OK" onPress={closeSheet} />}>
      <View style={[st.row, { alignItems: 'flex-start', gap: 10 }]}>
        <IInfo size={18} color={CR.muted} strokeWidth={STROKE} />
        <Text style={[st.note, { flex: 1, marginTop: 0 }]}>{sheet.body}</Text>
      </View>
    </Sheet>
  );
}

const st = themedSheet(() => ({
  row: { flexDirection: 'row', alignItems: 'center' },
  doneHead: { alignItems: 'center', paddingTop: 10, paddingBottom: 16 },
  doneIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: CR.greenSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  doneTitle: { fontSize: 19, fontWeight: W.title, color: CR.ink },
  doneBody: { marginTop: 6, fontSize: 13.5, color: CR.muted, textAlign: 'center', lineHeight: 20, paddingHorizontal: 8 },
  summary: { backgroundColor: CR.page, borderRadius: R.lg, padding: 14, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: CR.line },
  name: { fontSize: 15, fontWeight: W.title, color: CR.ink },
  meta: { fontSize: 12.5, color: CR.muted, marginTop: 1 },
  note: { marginTop: 14, fontSize: 13, lineHeight: 19, color: CR.ink2 },
  karmaBig: { fontSize: 28, fontWeight: W.title, color: CR.ink },
  sosRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: CR.lineSoft },
  sosIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: CR.primary, marginTop: 7 },
}));
