/**
 * Event detail (app/campus-events/:id), night look: hero photo with scrims and the date block, price and title,
 * organiser / club, date + time + venue with a map link, seats left, price and how to pay, agenda, description,
 * rules, cancellation, updates for registrants, and a sticky bar with the server's primary action (event.cta:
 * Register / Buy ticket / Book a slot / Register a team / Join waitlist / View my ticket ...). Samples open the
 * "sample event" sheet instead of registering.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Platform, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { campusEventsApi, CampusEventsError, errorCopy, fmtWhen, inr, REG_STATE_META, REG_STATUS_META, type Announcement } from '../campusEvents/campusEventsApi';
import { useCampusEventsStatus } from '../campusEvents/ui';
import { useCampusEventsLive } from '../campusEvents/useCampusEventsLive';
import { NIGHT, W } from './eventsV2Theme';
import { CTA, HeaderIcon, NightHeader, Press, SampleTag, Tag, usePageW } from './EventsV2Kit';
import { DateBlock, EventPhoto, PricePill } from './EventsV2Media';
import { Notice, StateBlock } from './EventsV2States';
import { IShare, IGraduation } from './EventsV2Icons';
import { Agenda, Block, InfoCard, Organiser, PriceCard, Updates } from './EventsV2DetailParts';
import { useNav } from './eventsV2Nav';
import { demoEvent, isSampleId, type EvEvent } from './eventsV2Demo';

export default function EventsV2Detail() {
  const p = useLocalSearchParams<{ id: string | string[] }>();
  const id = String(Array.isArray(p.id) ? p.id[0] : p.id || '');
  const nav = useNav();
  const w = usePageW();
  const insets = useSafeAreaInsets();
  const status = useCampusEventsStatus();
  const sample = isSampleId(id);
  const [ev, setEv] = useState<EvEvent | null>(sample ? demoEvent(id) : null);
  const [err, setErr] = useState<CampusEventsError | null>(null);
  const [updates, setUpdates] = useState<Announcement[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (sample) return;
    try {
      const r = await campusEventsApi.event(id);
      setEv(r.event); setErr(null);
      if (r.event.myRegistration || r.event.myTeam) campusEventsApi.announcements(id).then((a) => setUpdates(a.announcements)).catch(() => setUpdates([]));
    } catch (e: any) {
      setErr(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load this event.'));
    }
  }, [id, sample]);
  useEffect(() => { load(); }, [load]);
  useCampusEventsLive((e) => { if (!e.id || e.id === id || e.kind === 'reconnect' || e.kind === 'registration' || e.kind === 'team') load(); }, !sample);

  if (!ev) {
    return (
      <View style={{ flex: 1 }}>
        <NightHeader title="Event" />
        {!err ? <StateBlock kind="loading" /> : err.status === 404 || sample
          ? <StateBlock kind="empty" title="Event not found" body="It may have been removed by the organiser." action="Browse events" onAction={() => nav.replace({ name: 'explore' })} />
          : <StateBlock kind={err.isNetwork ? 'offline' : err.code === 'FEATURE_OFF' ? 'soon' : 'error'} body={err.code === 'FEATURE_OFF' ? err.message : undefined} action="Retry" onAction={load} />}
      </View>
    );
  }

  const cta = ev.cta;
  const modes = (ev.paymentModes || []).filter((m) => m !== 'NONE' && (m !== 'ONLINE' || !!status?.onlinePayEnabled) && (m !== 'WALLET' || !!status?.walletEnabled));
  const reasons = ev.eligibilityReasons || [];
  const needsVerify = reasons.some((r) => ['VERIFICATION_REQUIRED', 'CAMPUS_REQUIRED'].includes(r));
  const policy = ev.cancellationPolicy || {};
  const state = REG_STATE_META[ev.registrationState];

  const openTicket = async (regId: string) => {
    setBusy(true);
    try {
      const r = await campusEventsApi.registration(regId);
      const t = r.registration.tickets.find((x) => x.status === 'ACTIVE') || r.registration.tickets[0];
      if (t) nav.push({ name: 'ticket', id: t.id }); else nav.go(`/campus-events/registration/${regId}`);
    } catch (e: any) {
      const c = errorCopy(e); Alert.alert(c.title, c.message);
    } finally { setBusy(false); }
  };

  const runCta = () => {
    if (!cta) return;
    if (ev.isDemoContent) { nav.openSheet({ kind: 'sample', ev }); return; }
    switch (cta.action) {
      case 'REGISTER_NOW': return nav.push({ name: 'register', id: ev.id });
      case 'BOOK_SLOT': return nav.go(`/campus-events/slots/${ev.id}`);
      case 'REGISTER_TEAM': return nav.go(`/campus-events/team/new/${ev.id}`);
      case 'JOIN_TEAM': return nav.go('/campus-events/invitations');
      case 'JOIN_WAITLIST': return ev.format === 'SLOT' ? nav.go(`/campus-events/slots/${ev.id}`) : ev.format === 'TEAM' ? nav.go(`/campus-events/team/new/${ev.id}`) : nav.push({ name: 'register', id: ev.id, waitlist: true });
      case 'MANAGE_TEAM': case 'VIEW_TEAM': return cta.teamId ? nav.go(`/campus-events/team/${cta.teamId}`) : undefined;
      case 'VIEW_TICKET': return cta.registrationId ? openTicket(cta.registrationId) : undefined;
      case 'CONFIRM_BOOKING': return cta.registrationId ? nav.push({ name: 'register', id: ev.id, regId: cta.registrationId }) : undefined;
      case 'COMPLETE_PAYMENT': case 'ACCEPT_OFFER': return cta.registrationId ? nav.go(`/campus-events/registration/${cta.registrationId}`) : undefined;
      default: return undefined;
    }
  };

  const openMap = () => {
    const q = encodeURIComponent(ev.venue || '');
    const url = ev.venueLat != null && ev.venueLon != null
      ? Platform.select({ ios: `maps:0,0?q=${ev.venueLat},${ev.venueLon}`, android: `geo:${ev.venueLat},${ev.venueLon}?q=${ev.venueLat},${ev.venueLon}(${q || 'Venue'})`, default: `https://www.google.com/maps/search/?api=1&query=${ev.venueLat},${ev.venueLon}` })
      : `https://www.google.com/maps/search/?api=1&query=${q}${q ? '+SRM+University+AP' : ''}`;
    Linking.openURL(url as string).catch(() => Alert.alert('Could not open maps'));
  };
  const share = () => Share.share({ message: `${ev.title} · ${fmtWhen(ev.startAt)}${ev.venue ? ` · ${ev.venue}` : ''}. Find it in ZenWe, Services → Campus events.` }).catch(() => {});

  const heroH = Math.round(w * 0.82);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 130 + insets.bottom }} showsVerticalScrollIndicator={false}
        refreshControl={sample ? undefined : <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={NIGHT.violet} />}>
        <View style={{ height: heroH }}>
          <EventPhoto e={ev} top iconSize={110} />
          <View style={s.heroFoot}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
              <DateBlock iso={ev.startAt} />
              <View style={{ flex: 1, gap: 6, alignItems: 'flex-start' }}>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  <PricePill isFree={ev.price.isFree} label={ev.price.label} />
                  {ev.isDemoContent ? <SampleTag style={{ alignSelf: 'center' }} /> : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {(ev.tags.length ? ev.tags : [ev.categoryLabel]).slice(0, 3).map((t) => <View key={t} style={s.chip}><Text style={s.chipText}>{t}</Text></View>)}
                </View>
              </View>
            </View>
            <Text style={s.title} accessibilityRole="header">{ev.title}</Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: 16 }}>
          <Organiser ev={ev} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {ev.myRegistration ? <Tag label={REG_STATUS_META[ev.myRegistration.status].label} color={NIGHT.green} solid /> : null}
            <Tag label={state.label} color={ev.registrationState === 'OPEN' ? NIGHT.green : ev.registrationState === 'FULL' || ev.registrationState === 'CANCELLED' ? NIGHT.red : '#CFCBEA'} />
            {ev.approvalRequired ? <Tag label="Organiser approval" color={NIGHT.amber} /> : null}
            {ev.featured && !ev.isDemoContent ? <Tag label="Featured" color={NIGHT.amber} /> : null}
          </View>
          {ev.status === 'CANCELLED' ? <Notice tone="danger">This event was cancelled by the organiser. Any refund due follows the event policy.</Notice> : null}
          {needsVerify ? (
            <Press onPress={() => nav.go('/friends?screen=verification')} label="Verify your college">
              <Notice tone="warn" icon={<IGraduation size={16} color={NIGHT.amber} strokeWidth={1.8} />}>{cta?.label || 'Verify your college to register.'} <Text style={{ color: NIGHT.violet }}>Verify now</Text></Notice>
            </Press>
          ) : null}
          <InfoCard ev={ev} onMap={openMap} />
          <View style={{ height: 12 }} />
          <PriceCard ev={ev} modes={modes} />
          {ev.agenda?.length ? <><View style={{ height: 12 }} /><Agenda items={ev.agenda} /></> : null}
          {ev.description ? <Block title="About this event">{ev.description}</Block> : null}
          {ev.rules ? <Block title="Rules">{ev.rules}</Block> : null}
          {ev.equipment ? <Block title="What to bring">{ev.equipment}</Block> : null}
          {ev.instructions ? <Block title="Entry">{ev.instructions}</Block> : null}
          <Block title="Cancellation and refunds">
            {[policy.userCancelUntilHours != null ? `You can cancel up to ${policy.userCancelUntilHours} hour${policy.userCancelUntilHours === 1 ? '' : 's'} before the start.` : 'You can cancel until the cut-off set for this event.',
              !ev.price.isFree && policy.refundPct != null ? `Refund on cancellation: ${policy.refundPct}% of what you paid.` : null, policy.text || null].filter(Boolean).join(' ')}
          </Block>
          {ev.contactText ? <Block title="Contact">{ev.contactText}</Block> : null}
          <Updates list={updates} />
        </View>
      </ScrollView>

      <View style={s.floatHead} pointerEvents="box-none">
        <NightHeader transparent right={<HeaderIcon onPress={share} label="Share event"><IShare size={17} color="#FFFFFF" strokeWidth={1.8} /></HeaderIcon>} />
      </View>

      {cta ? (
        <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 10) + 10 }]}>
          <View style={{ marginRight: 12 }}>
            <Text style={s.barLabel}>{ev.price.isFree ? 'Entry' : 'Total'}</Text>
            <Text style={s.barPrice}>{ev.price.isFree ? 'Free' : inr(ev.price.total)}</Text>
          </View>
          <CTA label={ev.isDemoContent ? (ev.price.isFree ? 'Register' : 'Buy ticket') : cta.label} onPress={runCta} disabled={!cta.enabled && !ev.isDemoContent} busy={busy} tone={cta.enabled || ev.isDemoContent ? 'violet' : 'glass'} style={{ flex: 1 }}
            sub={cta.action === 'NOT_OPEN' && cta.opensAt ? `Opens ${fmtWhen(cta.opensAt)}` : undefined} />
        </View>
      ) : null}
      {!cta?.enabled && cta?.registrationId ? (
        <Press onPress={() => nav.go(`/campus-events/registration/${cta.registrationId}`)} label="View my registration" style={[s.regLink, { bottom: 92 + Math.max(insets.bottom, 10) }]}>
          <Text style={{ color: NIGHT.violet, fontSize: 13, fontWeight: W.label }}>View my registration</Text>
        </Press>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  heroFoot: { position: 'absolute', left: 16, right: 16, bottom: 14 },
  title: { color: '#FFFFFF', fontSize: 26, lineHeight: 31, fontWeight: W.display, letterSpacing: -0.4, marginTop: 12, textShadowColor: 'rgba(10,8,40,0.6)', textShadowRadius: 10 },
  chip: { paddingHorizontal: 9, height: 24, borderRadius: 12, backgroundColor: 'rgba(19,18,58,0.55)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.35)', justifyContent: 'center' },
  chipText: { color: '#FFFFFF', fontSize: 11.5, fontWeight: W.label },
  floatHead: { position: 'absolute', left: 0, right: 0, top: 0 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, backgroundColor: 'rgba(19,18,58,0.96)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: NIGHT.line },
  barLabel: { color: NIGHT.faint, fontSize: 11.5 },
  barPrice: { color: NIGHT.ink, fontSize: 19, fontWeight: W.title },
  regLink: { position: 'absolute', alignSelf: 'center', left: 0, right: 0, alignItems: 'center', minHeight: 36, justifyContent: 'center' },
});
