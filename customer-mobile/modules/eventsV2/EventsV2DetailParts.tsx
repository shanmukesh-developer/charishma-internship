/**
 * Event detail pieces (diet look): organiser row, the glass info card (when, where + map link, seats left with a
 * fill bar, registration window), the price card (fees + how you can pay), agenda, text blocks and updates.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { fmtRange, fmtWhen, inr, teamSizeLabel, type Announcement, type PaymentMode } from '../campusEvents/campusEventsApi';
import { NIGHT, QUICK, W } from './eventsV2Theme';
import { themedSheet } from '../../utils/themeNow';
import { Glass, IconSquare, Press } from './EventsV2Kit';
import { IArmchair, IBadgeCheck, IBanknote, ICalendar, IClock, IMegaphone, INavigation, IPin, IUsers, IWallet } from './EventsV2Icons';
import type { EvEvent } from './eventsV2Demo';

export const PAY_LABEL: Record<PaymentMode, string> = { NONE: 'Free', VENUE: 'Pay at the venue', WALLET: 'ZenWe Wallet', ONLINE: 'Pay online' };
export const PAY_HINT: Record<PaymentMode, string> = { NONE: '', VENUE: 'Cash or UPI at the desk before entry', WALLET: 'Paid now from your ZenWe Wallet', ONLINE: 'Secure online checkout' };

export function Organiser({ ev }: { ev: EvEvent }) {
  const name = ev.organizer?.name || 'Campus organiser';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  const club = ev.organizer?.club;
  return (
    <View style={s.org}>
      <View style={s.orgAvatar}>
        <LinearGradient colors={[QUICK.regs[0], QUICK.create[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={['rgba(255,255,255,0.4)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '50%' }]} />
        <Text style={s.orgInitials}>{initials}</Text>
      </View>
      <View style={{ flex: 1, marginLeft: 11 }}>
        <Text style={s.orgBy}>Hosted by</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Text style={s.orgName} numberOfLines={1}>{name}</Text>
          {club?.verified ? <IBadgeCheck size={15} color={NIGHT.sky} strokeWidth={1.8} /> : null}
        </View>
        {club && club.name !== name ? <Text style={s.orgSub} numberOfLines={1}>{club.name}</Text> : null}
      </View>
    </View>
  );
}

function InfoRow({ colors, icon, label, value, extra, children }: { colors: readonly [string, string]; icon: React.ReactNode; label: string; value: string; extra?: string | null; children?: React.ReactNode }) {
  return (
    <View style={s.infoRow} accessible accessibilityLabel={`${label}: ${value}${extra ? `. ${extra}` : ''}`}>
      <IconSquare colors={colors} size={38} radius={12}>{icon}</IconSquare>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={s.infoLabel}>{label}</Text>
        <Text style={s.infoValue}>{value}</Text>
        {extra ? <Text style={s.infoExtra}>{extra}</Text> : null}
        {children}
      </View>
    </View>
  );
}

export function InfoCard({ ev, onMap }: { ev: EvEvent; onMap: () => void }) {
  const c = ev.capacity;
  const seats = ev.format !== 'SLOT' && c?.capacity ? c : null;
  const pct = seats && seats.remaining != null ? Math.max(0.04, Math.min(1, 1 - seats.remaining / (seats.capacity || 1))) : null;
  const unit = c?.kind === 'TEAMS' ? 'team places' : 'seats';
  return (
    <Glass style={{ padding: 14, gap: 4 }} index={1}>
      <InfoRow colors={QUICK.regs} icon={<ICalendar size={18} color={NIGHT.onAcc} strokeWidth={1.8} />} label="Date and time" value={fmtRange(ev.startAt, ev.endAt)} />
      <InfoRow colors={QUICK.create} icon={<IPin size={18} color={NIGHT.onAcc} strokeWidth={1.8} />} label="Venue" value={ev.venue || 'Venue to be announced'} extra={ev.venueDirections}>
        {ev.venue ? (
          <Press onPress={onMap} label="Open the venue in maps" style={s.mapBtn} scaleTo={0.95}>
            <INavigation size={13} color={NIGHT.violet} strokeWidth={1.9} />
            <Text style={s.mapText}>Open in maps</Text>
          </Press>
        ) : null}
      </InfoRow>
      {seats ? (
        <InfoRow colors={QUICK.checkin} icon={<IArmchair size={18} color={NIGHT.onAcc} strokeWidth={1.8} />} label="Seats" value={seats.remaining != null ? (seats.remaining > 0 ? `${seats.remaining} of ${seats.capacity} ${unit} left` : `All ${unit} taken`) : `${seats.capacity} ${unit}`} extra={seats.waitlistCount ? `${seats.waitlistCount} on the waitlist` : null}>
          {pct != null ? <View style={s.track}><LinearGradient colors={[NIGHT.violet, NIGHT.pink]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${Math.round(pct * 100)}%`, height: '100%', borderRadius: 3 }} /></View> : null}
        </InfoRow>
      ) : null}
      {ev.format === 'SLOT' ? <InfoRow colors={QUICK.checkin} icon={<IClock size={18} color={NIGHT.onAcc} strokeWidth={1.8} />} label="Time slots" value={`Pick a slot on the next step · up to ${ev.maxBookingsPerStudent} per student`} /> : null}
      {ev.team ? <InfoRow colors={QUICK.tickets} icon={<IUsers size={18} color={NIGHT.onAcc} strokeWidth={1.8} />} label="Team event" value={teamSizeLabel(ev.team.min, ev.team.max)} extra={ev.team.maxTeams ? `${ev.team.maxTeams} teams max` : null} /> : null}
      {ev.regClosesAt || ev.regOpensAt ? (
        <InfoRow colors={QUICK.tickets} icon={<IClock size={18} color={NIGHT.onAcc} strokeWidth={1.8} />} label="Registration" value={`${ev.regOpensAt && new Date(ev.regOpensAt).getTime() > Date.now() ? `Opens ${fmtWhen(ev.regOpensAt)}` : 'Open now'}${ev.regClosesAt ? ` · closes ${fmtWhen(ev.regClosesAt)}` : ''}`} />
      ) : null}
    </Glass>
  );
}

export function PriceCard({ ev, modes }: { ev: EvEvent; modes: PaymentMode[] }) {
  return (
    <Glass style={{ padding: 16 }} index={2}>
      <Text style={s.cardTitle}>{ev.price.isFree ? 'Free entry' : 'Ticket price'}</Text>
      {ev.price.isFree ? (
        <Text style={s.body}>No payment needed.{ev.approvalRequired ? ' The organiser confirms each registration.' : ''}</Text>
      ) : (
        <>
          <Line label={ev.format === 'TEAM' ? 'Team fee' : 'Fee'} value={inr(ev.price.amount)} />
          {ev.price.extraCharges.map((c, i) => <Line key={i} label={c.label} value={inr(c.amount)} />)}
          <View style={s.divider} />
          <Line label="Total" value={inr(ev.price.total)} strong />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {modes.length ? modes.map((m) => (
              <View key={m} style={s.payChip}>
                {m === 'WALLET' ? <IWallet size={13} color={NIGHT.violet} strokeWidth={1.8} /> : <IBanknote size={13} color={NIGHT.violet} strokeWidth={1.8} />}
                <Text style={s.payText}>{PAY_LABEL[m]}</Text>
              </View>
            )) : <Text style={s.body}>Payment options are not available right now.</Text>}
          </View>
        </>
      )}
    </Glass>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.line}>
      <Text style={[s.lineLabel, strong ? { color: NIGHT.ink } : null]}>{label}</Text>
      <Text style={[s.lineValue, strong ? { fontSize: 17, fontWeight: W.title } : null]}>{value}</Text>
    </View>
  );
}

export function Agenda({ items }: { items: { time: string; label: string }[] }) {
  return (
    <Glass style={{ padding: 16 }} index={3}>
      <Text style={s.cardTitle}>Agenda</Text>
      {items.map((a, i) => (
        <View key={`${a.time}-${i}`} style={s.agRow}>
          <View style={{ alignItems: 'center', width: 14 }}>
            <View style={s.agDot} />
            {i < items.length - 1 ? <View style={s.agLine} /> : null}
          </View>
          <View style={{ flex: 1, marginLeft: 10, paddingBottom: 12 }}>
            <Text style={s.agTime}>{a.time}</Text>
            <Text style={s.agLabel}>{a.label}</Text>
          </View>
        </View>
      ))}
    </Glass>
  );
}

export function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={s.blockTitle} accessibilityRole="header">{title}</Text>
      <Text style={s.blockBody}>{children}</Text>
    </View>
  );
}

export function Updates({ list }: { list: Announcement[] }) {
  if (!list.length) return null;
  return (
    <View style={{ marginTop: 18, gap: 10 }}>
      <Text style={s.blockTitle} accessibilityRole="header">Updates for you</Text>
      {list.map((a) => (
        <Glass key={a.id} style={{ padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <IMegaphone size={15} color={a.kind === 'CANCELLATION' ? NIGHT.red : NIGHT.violet} strokeWidth={1.8} />
            <Text style={[s.cardTitle, { marginBottom: 0, flex: 1 }]}>{a.title}</Text>
          </View>
          <Text style={[s.body, { marginTop: 6 }]}>{a.body}</Text>
          <Text style={[s.infoExtra, { marginTop: 6 }]}>{fmtWhen(a.createdAt)}</Text>
        </Glass>
      ))}
    </View>
  );
}

const s = themedSheet(() => ({
  org: { flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 14 },
  orgAvatar: { width: 46, height: 46, borderRadius: 23, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: NIGHT.accLine },
  orgInitials: { color: NIGHT.onAcc, fontSize: 15, fontWeight: W.title },
  orgBy: { color: NIGHT.faint, fontSize: 11.5 },
  orgName: { color: NIGHT.ink, fontSize: 15, fontWeight: W.title, flexShrink: 1 },
  orgSub: { color: NIGHT.sub, fontSize: 12, marginTop: 1 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 7 },
  infoLabel: { color: NIGHT.faint, fontSize: 11.5 },
  infoValue: { color: NIGHT.ink, fontSize: 14, fontWeight: W.label, marginTop: 1, lineHeight: 19 },
  infoExtra: { color: NIGHT.sub, fontSize: 12, marginTop: 2 },
  mapBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 6, height: 30, paddingHorizontal: 11, borderRadius: 15, backgroundColor: NIGHT.accSoft, borderWidth: StyleSheet.hairlineWidth, borderColor: NIGHT.accLine },
  mapText: { color: NIGHT.accInk, fontSize: 12, fontWeight: W.label },
  track: { height: 6, borderRadius: 3, backgroundColor: NIGHT.track, marginTop: 7, overflow: 'hidden' },
  cardTitle: { color: NIGHT.ink, fontSize: 15, fontWeight: W.title, marginBottom: 8 },
  body: { color: NIGHT.sub, fontSize: 13, lineHeight: 19 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  lineLabel: { color: NIGHT.sub, fontSize: 13 },
  lineValue: { color: NIGHT.ink, fontSize: 14, fontWeight: W.label },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: NIGHT.line, marginVertical: 6 },
  payChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 11, borderRadius: 15, backgroundColor: NIGHT.glass, borderWidth: StyleSheet.hairlineWidth, borderColor: NIGHT.line },
  payText: { color: NIGHT.ink, fontSize: 12, fontWeight: W.label },
  agRow: { flexDirection: 'row' },
  agDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: NIGHT.violet, borderWidth: 2, borderColor: NIGHT.accLine, marginTop: 3 },
  agLine: { flex: 1, width: 2, backgroundColor: NIGHT.accLine, marginTop: 2 },
  agTime: { color: NIGHT.accInk, fontSize: 12, fontWeight: W.label },
  agLabel: { color: NIGHT.ink, fontSize: 13.5, marginTop: 1 },
  blockTitle: { color: NIGHT.ink, fontSize: 16, fontWeight: W.title, marginBottom: 6 },
  blockBody: { color: NIGHT.sub, fontSize: 13.5, lineHeight: 21 },
}));
