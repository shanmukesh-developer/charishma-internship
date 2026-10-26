/**
 * Event cards (reference "Upcoming Events"): big photo with a scrim, the date block top-left, the price pill
 * top-right, the title in bold, venue and time rows with thin icons, tag chips and the
 * violet arrow button. `EventCardV2` is the carousel card; `EventRowCard` the full-width card of the listing.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { capacityLine, fmtClock, fmtWhen, REG_STATE_META, REG_STATUS_META } from '../campusEvents/campusEventsApi';
import { NIGHT, W, shadow } from './eventsV2Theme';
import { Press, SampleTag, Tag, FadeInUp } from './EventsV2Kit';
import { DateBlock, EventPhoto, PricePill } from './EventsV2Media';
import { IArrowRight, IBadgeCheck, IClock, IPin, IArmchair } from './EventsV2Icons';
import type { EvCard } from './eventsV2Data';

const a11y = (e: EvCard) => [e.title, e.isDemoContent ? 'Sample' : null, e.categoryLabel, fmtWhen(e.startAt), e.venue, e.price.isFree ? 'Free' : e.price.label, capacityLine(e)].filter(Boolean).join(', ');

function ArrowBtn({ size = 34 }: { size?: number }) {
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, shadow(1, '#5B2FD6')]}>
      <LinearGradient colors={[NIGHT.go[0], NIGHT.go[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(255,255,255,0.35)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '50%' }]} />
      <View><IArrowRight size={size * 0.47} color="#FFFFFF" strokeWidth={2} /></View>
    </View>
  );
}

function Rows({ e }: { e: EvCard }) {
  return (
    <>
      {e.venue ? (
        <View style={s.row}><IPin size={13} color={NIGHT.violet} strokeWidth={1.8} /><Text style={s.rowText} numberOfLines={1}>{e.venue}</Text></View>
      ) : null}
      <View style={s.row}><IClock size={13} color={NIGHT.violet} strokeWidth={1.8} /><Text style={s.rowText} numberOfLines={1}>{e.startAt ? `${fmtClock(e.startAt)}${e.endAt ? ` – ${fmtClock(e.endAt)}` : ''}` : 'Time to be announced'}</Text></View>
    </>
  );
}

function Chips({ e, max = 2 }: { e: EvCard; max?: number }) {
  const tags = (e.tags && e.tags.length ? e.tags : [e.categoryLabel]).slice(0, max);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 }}>
      {tags.map((t) => <View key={t} style={s.chip}><Text style={s.chipText} numberOfLines={1}>{t}</Text></View>)}
    </View>
  );
}

export function EventCardV2({ e, width, onPress, index = 0 }: { e: EvCard; width: number; onPress: () => void; index?: number }) {
  return (
    <FadeInUp index={index}>
      <Press onPress={onPress} label={a11y(e)} hint="Opens event details" style={[s.card, { width }, shadow(2)]} scaleTo={0.975}>
        <View style={{ height: Math.round(width * 0.56) }}>
          <EventPhoto e={e} top />
          <DateBlock iso={e.startAt} style={{ position: 'absolute', top: 10, left: 10 }} />
          <View style={{ position: 'absolute', top: 10, right: 10, alignItems: 'flex-end', gap: 6 }}>
            <PricePill isFree={e.price.isFree} label={e.price.label} />
            {e.isDemoContent ? <SampleTag /> : null}
          </View>
          {e.myStatus ? <View style={{ position: 'absolute', left: 10, bottom: 8 }}><Tag label={REG_STATUS_META[e.myStatus].label} color={NIGHT.green} solid /></View> : null}
        </View>
        <View style={{ padding: 13, paddingTop: 10 }}>
          <Text style={s.title} numberOfLines={2}>{e.title}</Text>
          <View style={{ gap: 5, marginTop: 7 }}><Rows e={e} /></View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 }}>
            <Chips e={e} />
            <ArrowBtn />
          </View>
        </View>
        <View style={s.rim} pointerEvents="none" />
      </Press>
    </FadeInUp>
  );
}

export function EventRowCard({ e, onPress, index = 0 }: { e: EvCard; onPress: () => void; index?: number }) {
  const cap = capacityLine(e);
  const st = REG_STATE_META[e.registrationState];
  const c = e.capacity;
  const pct = c?.capacity && c.remaining != null ? Math.max(0.04, Math.min(1, 1 - c.remaining / c.capacity)) : null;
  return (
    <FadeInUp index={index} style={{ marginHorizontal: 16, marginBottom: 14 }}>
      <Press onPress={onPress} label={a11y(e)} hint="Opens event details" style={[s.card, shadow(2)]} scaleTo={0.98}>
        <View style={{ height: 168 }}>
          <EventPhoto e={e} top />
          <DateBlock iso={e.startAt} style={{ position: 'absolute', top: 10, left: 10 }} />
          <View style={{ position: 'absolute', top: 10, right: 10, alignItems: 'flex-end', gap: 6 }}>
            <PricePill isFree={e.price.isFree} label={e.price.label} />
            {e.isDemoContent ? <SampleTag /> : null}
          </View>
          <Text style={[s.title, s.onPhoto]} numberOfLines={2}>{e.title}</Text>
        </View>
        <View style={{ padding: 13, paddingTop: 10, gap: 5 }}>
          <View style={s.row}>
            {e.organizer?.club?.verified ? <IBadgeCheck size={13} color={NIGHT.sky} strokeWidth={1.8} /> : null}
            <Text style={[s.rowText, { color: NIGHT.ink }]} numberOfLines={1}>{e.organizer?.name || 'Campus organiser'}</Text>
          </View>
          <Rows e={e} />
          {cap ? (
            <View style={{ marginTop: 4 }}>
              <View style={s.row}><IArmchair size={13} color={e.registrationState === 'FULL' ? NIGHT.red : NIGHT.green} strokeWidth={1.8} /><Text style={s.rowText}>{cap}</Text></View>
              {pct != null ? <View style={s.track}><LinearGradient colors={[NIGHT.violet, NIGHT.pink]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${Math.round(pct * 100)}%`, height: '100%', borderRadius: 3 }} /></View> : null}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 }}>
            {e.myStatus ? <Tag label={REG_STATUS_META[e.myStatus].label} color={NIGHT.green} /> : e.registrationState !== 'OPEN' ? <Tag label={st.label} color={e.registrationState === 'FULL' ? NIGHT.red : '#CFCBEA'} /> : <Chips e={e} max={3} />}
            {e.myStatus || e.registrationState !== 'OPEN' ? <View style={{ flex: 1 }} /> : null}
            <ArrowBtn />
          </View>
        </View>
        <View style={s.rim} pointerEvents="none" />
      </Press>
    </FadeInUp>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 22, backgroundColor: NIGHT.card, overflow: 'hidden' },
  rim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' },
  title: { fontSize: 17, lineHeight: 21, color: NIGHT.ink, fontWeight: W.display, letterSpacing: -0.2 },
  onPhoto: { position: 'absolute', left: 13, right: 13, bottom: 10, textShadowColor: 'rgba(10,8,40,0.6)', textShadowRadius: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  rowText: { fontSize: 12.5, color: NIGHT.sub, flexShrink: 1 },
  chip: { paddingHorizontal: 9, height: 24, borderRadius: 12, backgroundColor: 'rgba(167,139,250,0.16)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(167,139,250,0.42)', justifyContent: 'center' },
  chipText: { fontSize: 11.5, color: '#DCD2FF', fontWeight: W.label },
  track: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)', marginTop: 6, overflow: 'hidden' },
});
