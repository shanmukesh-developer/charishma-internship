// Zenvy Campus Events: event detail (spec §2). Poster / gallery, organizer + club, date and time, venue with
// directions, eligibility, registration window, price breakdown, capacity, team rules, rules, equipment,
// contact, cancellation policy, instructions, updates for registrants. The single primary action comes
// from the server (event.cta: Register now / Book a slot / Register a team / Join a team / Join waitlist /
// Registration closed / Event full / View my ticket ...); the app only routes it.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Linking, Alert, Platform, TouchableOpacity, Dimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  campusEventsApi, CampusEventsError, errorCopy, fmtRange, fmtWhen, inr, capacityLine, teamSizeLabel, FORMAT_LABEL, REG_STATE_META, PAYMENT_MODE_LABEL,
  type EventDetail, type Announcement,
} from '../../modules/campusEvents/campusEventsApi';
import { EHeader, usePalette, Card, Btn, Pill, PricePill, RegStatusPill, ErrorState, StateView, Notice, Row, Poster, SectionTitle, CE_HOME, useCampusEventsStatus, type CeIconName } from '../../modules/campusEvents/ui';
import { Ionicons } from '@expo/vector-icons';
import SafeImage from '../../components/SafeImage';
import { useCampusEventsLive } from '../../modules/campusEvents/useCampusEventsLive';

const { width: SW } = Dimensions.get('window');

export default function CampusEventDetail() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = String(Array.isArray(params.id) ? params.id[0] : params.id || '');
  const router = useRouter();
  const p = usePalette();
  const [ev, setEv] = useState<EventDetail | null>(null);
  const [error, setError] = useState<CampusEventsError | null>(null);
  const [updates, setUpdates] = useState<Announcement[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  // Online pay is shown only while the server switch is on (off in production for now).
  const status = useCampusEventsStatus();

  const load = useCallback(async () => {
    try {
      const r = await campusEventsApi.event(id);
      setEv(r.event);
      setError(null);
      if (r.event.myRegistration || r.event.myTeam) {
        campusEventsApi.announcements(id).then((a) => setUpdates(a.announcements)).catch(() => setUpdates([]));
      }
    } catch (e: any) {
      setError(e instanceof CampusEventsError ? e : new CampusEventsError(e?.message || 'Could not load this event.'));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useCampusEventsLive((e) => { if (!e.id || e.id === id || e.kind === 'reconnect' || e.kind === 'registration' || e.kind === 'team') load(); });

  if (!ev) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <EHeader title="Event" />
        {error ? <ErrorState error={error} onRetry={load} notFoundTitle="Event not found" onNotFound={() => router.replace(CE_HOME as any)} /> : <StateView kind="loading" message="Loading event…" />}
      </View>
    );
  }

  const state = REG_STATE_META[ev.registrationState];
  const cta = ev.cta;
  const cap = capacityLine(ev);
  const reasons = ev.eligibilityReasons || [];
  const needsVerify = reasons.some((r) => ['VERIFICATION_REQUIRED', 'CAMPUS_REQUIRED'].includes(r));
  const policy = ev.cancellationPolicy || {};
  const payModes = (ev.paymentModes || []).filter((m) => m !== 'ONLINE' || !!status?.onlinePayEnabled);
  const teamSize = ev.team ? teamSizeLabel(ev.team.min, ev.team.max) : '';

  const openTicket = async (regId: string) => {
    setBusy(true);
    try {
      const r = await campusEventsApi.registration(regId);
      const active = r.registration.tickets.find((t) => t.status === 'ACTIVE') || r.registration.tickets[0];
      router.push((active ? `/campus-events/ticket/${active.id}` : `/campus-events/registration/${regId}`) as any);
    } catch (e: any) {
      const c = errorCopy(e);
      Alert.alert(c.title, c.message);
    } finally {
      setBusy(false);
    }
  };

  const runCta = () => {
    if (!cta) return;
    switch (cta.action) {
      case 'REGISTER_NOW': return router.push(`/campus-events/register/${ev.id}` as any);
      case 'BOOK_SLOT': return router.push(`/campus-events/slots/${ev.id}` as any);
      case 'REGISTER_TEAM': return router.push(`/campus-events/team/new/${ev.id}` as any);
      case 'JOIN_TEAM': return router.push('/campus-events/invitations' as any);
      case 'JOIN_WAITLIST': return router.push((ev.format === 'SLOT' ? `/campus-events/slots/${ev.id}` : ev.format === 'TEAM' ? `/campus-events/team/new/${ev.id}` : `/campus-events/register/${ev.id}?waitlist=1`) as any);
      case 'MANAGE_TEAM':
      case 'VIEW_TEAM': return cta.teamId ? router.push(`/campus-events/team/${cta.teamId}` as any) : undefined;
      case 'VIEW_TICKET': return cta.registrationId ? openTicket(cta.registrationId) : undefined;
      case 'CONFIRM_BOOKING': return cta.registrationId ? router.push(`/campus-events/register/${ev.id}?regId=${cta.registrationId}` as any) : undefined;
      case 'COMPLETE_PAYMENT':
      case 'ACCEPT_OFFER': return cta.registrationId ? router.push(`/campus-events/registration/${cta.registrationId}` as any) : undefined;
      default: return undefined;
    }
  };

  const directions = () => {
    const url = ev.venueLat != null && ev.venueLon != null
      ? Platform.select({ ios: `maps:0,0?q=${ev.venueLat},${ev.venueLon}`, default: `geo:${ev.venueLat},${ev.venueLon}?q=${ev.venueLat},${ev.venueLon}(${encodeURIComponent(ev.venue || 'Venue')})` })
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.venue || '')}`;
    Linking.openURL(url as string).catch(() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.venue || '')}`).catch(() => Alert.alert('Could not open maps')));
  };

  const elig = ev.eligibility || {};
  const eligLines = [
    elig.years && elig.years.length ? `Year ${elig.years.join(', ')}` : null,
    elig.branches && elig.branches.length ? `Branches: ${elig.branches.join(', ')}` : null,
    elig.adultOnly ? '18+ only' : null,
  ].filter(Boolean) as string[];

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <EHeader title={ev.title} subtitle={`${ev.categoryLabel} · ${FORMAT_LABEL[ev.format]}`} />
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={p.accent} />}>
        <Poster uri={ev.posterUrl} category={ev.category} height={Math.round(SW * 0.62)} radius={0}>
          <View style={{ position: 'absolute', right: 12, bottom: 12 }}><PricePill label={ev.price.label} isFree={ev.price.isFree} /></View>
        </Poster>
        {ev.gallery.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, padding: 12 }} accessibilityLabel="Gallery">
            {ev.gallery.map((g, i) => <SafeImage key={`${g}-${i}`} source={{ uri: g }} style={{ width: 120, height: 80, borderRadius: 12 }} contentFit="cover" />)}
          </ScrollView>
        ) : null}

        <View style={{ padding: 16 }}>
          <Text style={{ fontSize: 22, fontWeight: '900', color: p.text, letterSpacing: -0.4 }} accessibilityRole="header">{ev.title}</Text>
          <Text style={{ fontSize: 13, color: p.sub, marginTop: 4, fontWeight: '700' }}>
            {ev.organizer?.club?.verified ? <><Ionicons name="checkmark-circle" size={13} color={p.accent} />{' '}</> : null}{ev.organizer?.name || 'Campus organizer'}{ev.organizer?.club && ev.organizer.club.name !== ev.organizer.name ? ` · ${ev.organizer.club.name}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {ev.myRegistration ? <RegStatusPill status={ev.myRegistration.status} /> : null}
            <Pill label={state.label} color={state.color} icon={state.icon} />
            {cap ? <Pill label={cap} color={ev.registrationState === 'FULL' ? '#DC2626' : '#0EA5E9'} /> : null}
            {ev.approvalRequired ? <Pill label="Organizer approval" color="#D97706" icon="shield-checkmark-outline" /> : null}
            {ev.featured ? <Pill label="Featured" color="#D97706" icon="star" /> : null}
          </View>

          {ev.status === 'CANCELLED' ? <View style={{ marginTop: 12 }}><Notice tone="danger" icon="close-circle-outline">This event was cancelled by the organizer. Any refund due follows the event policy.</Notice></View> : null}
          {needsVerify ? (
            <TouchableOpacity onPress={() => router.push('/friends?screen=verification' as any)} accessibilityRole="button" style={{ marginTop: 12 }}>
              <Notice tone="warn" icon="school-outline">{cta?.label || 'Verify your college to register.'} <Text style={{ color: p.accent, fontWeight: '900' }}>Verify now ›</Text></Notice>
            </TouchableOpacity>
          ) : null}

          <Card style={{ marginTop: 14 }}>
            <InfoLine icon="calendar-outline" label="When" value={fmtRange(ev.startAt, ev.endAt)} />
            <InfoLine icon="location-outline" label="Where" value={ev.venue || 'Venue to be announced'} extra={ev.venueDirections || undefined} />
            {ev.venue ? <Btn label="Directions" icon="navigate-outline" kind="ghost" small onPress={directions} style={{ alignSelf: 'flex-start', marginTop: 4, marginLeft: 30 }} /> : null}
            <InfoLine icon="create-outline" label="Registration" value={`${ev.regOpensAt ? `Opens ${fmtWhen(ev.regOpensAt)}` : 'Open now'}${ev.regClosesAt ? ` · closes ${fmtWhen(ev.regClosesAt)}` : ''}`} />
            {ev.format !== 'SLOT' && ev.capacity.capacity ? (
              <InfoLine icon="people-outline" label="Capacity" value={`${ev.capacity.capacity} ${ev.capacity.kind === 'TEAMS' ? 'teams' : 'seats'}${ev.capacity.remaining != null ? ` · ${ev.capacity.remaining} left` : ''}${ev.capacity.waitlistCount ? ` · ${ev.capacity.waitlistCount} on waitlist` : ''}`} />
            ) : null}
            {ev.format === 'SLOT' ? <InfoLine icon="timer-outline" label="Slots" value={`${cap || 'Pick a time slot'} · up to ${ev.maxBookingsPerStudent} booking${ev.maxBookingsPerStudent === 1 ? '' : 's'} per student`} /> : null}
          </Card>

          <Card>
            <Text style={{ fontSize: 13, fontWeight: '900', color: p.text, marginBottom: 6 }}>{ev.price.isFree ? 'Free event' : 'Fees'}</Text>
            {ev.price.isFree ? (
              <Text style={{ color: p.sub, fontSize: 12.5 }}>No payment needed.{ev.approvalRequired ? ' The organizer confirms each registration.' : ''}</Text>
            ) : (
              <>
                <Row label={ev.format === 'TEAM' ? 'Team fee' : 'Fee'} value={inr(ev.price.amount)} />
                {ev.price.extraCharges.map((c, i) => <Row key={i} label={c.label} value={inr(c.amount)} />)}
                <Row label="Total" value={inr(ev.price.total)} strong />
                <Text style={{ color: p.sub, fontSize: 12, marginTop: 6 }}>
                  {payModes.length ? `Payment: ${payModes.map((m) => PAYMENT_MODE_LABEL[m]).join(' · ')}` : 'Payment options are not available right now.'}
                </Text>
              </>
            )}
          </Card>

          {ev.team ? (
            <Card>
              <Text style={{ fontSize: 13, fontWeight: '900', color: p.text, marginBottom: 6 }}>Team rules</Text>
              <Row label="Team size" value={teamSize} />
              {ev.team.maxTeams ? <Row label="Teams" value={`${ev.team.maxTeams} max`} /> : null}
              <Row label="Substitutions" value={ev.team.allowSubstitutions ? 'Allowed' : 'Roster locks at registration'} />
              <Row label="Teams per student" value={ev.team.multiTeamAllowed ? 'More than one' : 'One'} />
              <Text style={{ color: p.sub, fontSize: 12, marginTop: 6 }}>All players must be verified students of this campus and accept the captain's invitation.</Text>
            </Card>
          ) : null}

          {ev.description ? <Block title="About">{ev.description}</Block> : null}
          {eligLines.length ? <Block title="Who can join">{eligLines.join('\n')}</Block> : null}
          {ev.rules ? <Block title="Rules">{ev.rules}</Block> : null}
          {ev.equipment ? <Block title="Bring along">{ev.equipment}</Block> : null}
          {ev.instructions ? <Block title="Instructions">{ev.instructions}</Block> : null}
          <Block title="Cancellation & refunds">
            {[
              policy.userCancelUntilHours != null ? `You can cancel up to ${policy.userCancelUntilHours} hour${policy.userCancelUntilHours === 1 ? '' : 's'} before the start.` : 'You can cancel until the cut-off set by Zenvy.',
              !ev.price.isFree && policy.refundPct != null ? `Refund on cancellation: ${policy.refundPct}% of what you paid.` : null,
              policy.text || null,
            ].filter(Boolean).join('\n')}
          </Block>
          {ev.contactText ? <Block title="Contact">{ev.contactText}</Block> : null}

          {updates.length ? (
            <>
              <SectionTitle kicker="For registrants">Event updates</SectionTitle>
              {updates.map((a) => (
                <Card key={a.id}>
                  <Text style={{ fontSize: 13.5, fontWeight: '900', color: p.text }}><Ionicons name={a.kind === 'VENUE_CHANGE' ? 'location-outline' : a.kind === 'SCHEDULE_CHANGE' ? 'time-outline' : a.kind === 'CANCELLATION' ? 'close-circle-outline' : 'megaphone-outline'} size={14} color={a.kind === 'CANCELLATION' ? p.danger : p.accent} />{' '}{a.title}</Text>
                  <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 4, lineHeight: 18 }}>{a.body}</Text>
                  <Text style={{ fontSize: 12, color: p.muted, marginTop: 6 }}>{fmtWhen(a.createdAt)}</Text>
                </Card>
              ))}
            </>
          ) : null}
        </View>
      </ScrollView>

      {cta ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 24, backgroundColor: p.bg, borderTopWidth: 1, borderTopColor: p.border, gap: 8 }}>
          {cta.action === 'NOT_OPEN' && cta.opensAt ? <Text style={{ color: p.sub, fontSize: 12, textAlign: 'center' }}>Opens {fmtWhen(cta.opensAt)}</Text> : null}
          <Btn label={cta.label} onPress={runCta} disabled={!cta.enabled} loading={busy} kind={cta.enabled ? 'primary' : 'secondary'} />
          {!cta.enabled && cta.registrationId ? (
            <Btn label="View my registration" kind="ghost" small onPress={() => router.push(`/campus-events/registration/${cta.registrationId}` as any)} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function InfoLine({ icon, label, value, extra }: { icon: CeIconName; label: string; value: string; extra?: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', gap: 10, paddingVertical: 6 }} accessible accessibilityLabel={`${label}: ${value}${extra ? `. ${extra}` : ''}`}>
      <Ionicons name={icon} size={18} color={p.accent} style={{ width: 20, marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 12, fontWeight: '800', color: p.muted, letterSpacing: 0.2 }}>{label}</Text>
        <Text style={{ fontSize: 13.5, fontWeight: '700', color: p.text, marginTop: 1 }}>{value}</Text>
        {extra ? <Text style={{ fontSize: 12, color: p.sub, marginTop: 2 }}>{extra}</Text> : null}
      </View>
    </View>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 15, fontWeight: '900', color: p.text, marginBottom: 6 }} accessibilityRole="header">{title}</Text>
      <Text style={{ fontSize: 13.5, color: p.sub, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}
