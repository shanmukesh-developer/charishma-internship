/**
 * "Request sent" success sheet (replaces the old ALL CAPS alert with the gold wrapping button).
 * Violet check illustration, sentence-case title, room type and move-in date, the confirmation note,
 * a primary "View my bookings", a secondary "Done" and a "Message the housing desk" text link.
 */
import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PG2, R, GUTTER, W } from './pgV2Theme';
import { Tap, PrimaryButton, OutlineButton } from './PgV2Kit';
import { ICheck, IBed, ICalendar, STROKE } from './PgV2Icons';

export interface SentInfo { pgName: string; roomType: string; moveIn: string; deskUrl?: string | null }

function CheckArt() {
  return (
    <View style={st.artOuter} accessible={false}>
      <View style={st.artMid}>
        <View style={st.artInner}><ICheck size={30} color="#FFFFFF" strokeWidth={2.5} /></View>
      </View>
      <View style={[st.spark, { top: 6, right: 14 }]} />
      <View style={[st.spark, { bottom: 12, left: 8, width: 6, height: 6 }]} />
      <View style={[st.spark, { top: 22, left: 2, width: 5, height: 5, backgroundColor: '#F5A8D8' }]} />
    </View>
  );
}

export default function PgV2SentSheet({ open, info, onViewBookings, onDone }: { open: boolean; info: SentInfo | null; onViewBookings: () => void; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  if (!info) return null;
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onDone}>
      <Pressable style={st.scrim} onPress={onDone} accessibilityLabel="Close" />
      <View style={[st.sheet, { paddingBottom: insets.bottom + 18 }]} accessibilityViewIsModal>
        <View style={st.grabber} />
        <CheckArt />
        <Text style={st.title} accessibilityRole="header">Request sent</Text>
        <Text style={st.pg} numberOfLines={1}>{info.pgName}</Text>
        <View style={st.facts}>
          <View style={st.fact}><IBed size={15} color={PG2.primary} strokeWidth={STROKE} /><Text style={st.factText} numberOfLines={1}>{info.roomType}</Text></View>
          <View style={st.factSep} />
          <View style={st.fact}><ICalendar size={15} color={PG2.primary} strokeWidth={STROKE} /><Text style={st.factText} numberOfLines={1}>Move-in {info.moveIn}</Text></View>
        </View>
        <Text style={st.body}>The PG owner will confirm your request. We'll notify you.</Text>
        <PrimaryButton label="View my bookings" onPress={onViewBookings} style={{ alignSelf: 'stretch', marginTop: 22 }} />
        <OutlineButton label="Done" onPress={onDone} style={{ alignSelf: 'stretch', marginTop: 10, height: 52 }} />
        {info.deskUrl ? (
          <Tap onPress={() => Linking.openURL(info.deskUrl as string).catch(() => {})} label="Message the housing desk" role="link" style={st.link}>
            <Text style={st.linkText}>Message the housing desk</Text>
          </Tap>
        ) : null}
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(20,16,60,0.42)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: GUTTER + 4, paddingTop: 10, alignItems: 'center' },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: PG2.line, marginBottom: 18 },
  artOuter: { width: 104, height: 104, alignItems: 'center', justifyContent: 'center' },
  artMid: { width: 92, height: 92, borderRadius: 46, backgroundColor: PG2.lavender, alignItems: 'center', justifyContent: 'center' },
  artInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: PG2.primary, alignItems: 'center', justifyContent: 'center' },
  spark: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#B7A6FA' },
  title: { marginTop: 14, fontSize: 21, fontWeight: W.title, color: PG2.ink, letterSpacing: -0.3 },
  pg: { marginTop: 4, fontSize: 13.5, color: PG2.muted },
  facts: { marginTop: 14, flexDirection: 'row', alignItems: 'center', backgroundColor: PG2.page, borderRadius: R.md, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: PG2.lineSoft, maxWidth: '100%' },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  factText: { fontSize: 13, color: PG2.ink, fontWeight: W.label, flexShrink: 1 },
  factSep: { width: 1, height: 16, backgroundColor: PG2.line, marginHorizontal: 12 },
  body: { marginTop: 14, fontSize: 14, lineHeight: 21, color: PG2.ink2, textAlign: 'center', paddingHorizontal: 8 },
  link: { marginTop: 6, minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  linkText: { fontSize: 14, fontWeight: W.label, color: PG2.primary },
});
