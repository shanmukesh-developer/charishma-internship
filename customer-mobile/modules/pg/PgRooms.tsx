/**
 * Rooms section: one card per room type (selectable; the bottom bar requests the selected one), photos
 * linked to that type, and a Compare view: a side-by-side table of every room type (rent, deposit,
 * sharing, AC, bathroom, balcony, furnishing, beds available). The compare view is a Modal, so Android back
 * closes it. Room tour videos follow the cards.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { inr, sharingLabel, plural, type PgDetail, type PgPhoto, type PgRoomType } from './pgApi';
import { usePgPalette, Press, SectionHeading, PgImage, Divider, ICON, TYPE, IconCheck, IconX, IconColumns, s as ui } from './ui';
import { PgVideoSection } from './PgVideos';

export const rentText = (t: PgRoomType) => (t.rentFrom === null ? '' : t.rentTo !== null && t.rentTo !== t.rentFrom ? `${inr(t.rentFrom)}–${inr(t.rentTo).slice(1)}` : inr(t.rentFrom));
const furnishingText = (f: string | null) => (f ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : '');
export const roomFacts = (t: PgRoomType) => [
  t.hasAC ? 'AC' : 'Non-AC',
  t.hasAttachedBathroom ? 'Attached bath' : 'Shared bath',
  t.hasBalcony ? 'Balcony' : '',
  furnishingText(t.furnishing),
].filter(Boolean).join(' · ');
export const roomTitle = (t: PgRoomType) => (t.label && !/^\d+-sharing( AC)?$/.test(t.label) ? t.label : sharingLabel(t.sharingType));

export function RoomsSection({ pg, selectedKey, onSelect, onOpenPhotos, roomTypeLabels }: {
  pg: PgDetail; selectedKey: string | null; onSelect: (key: string) => void;
  onOpenPhotos: (list: PgPhoto[], index: number) => void; roomTypeLabels: Record<string, string>;
}) {
  const p = usePgPalette();
  const [comparing, setComparing] = useState(false);
  const types = pg.roomTypes;
  const photosByType: Record<string, PgPhoto[]> = {};
  pg.photos.forEach((ph) => { if (ph.roomType) (photosByType[ph.roomType] = photosByType[ph.roomType] || []).push(ph); });

  return (
    <View>
      <SectionHeading title="Rooms" detail="Rent per bed, per month" />
      {types.map((t) => {
        const on = selectedKey === t.key;
        const full = !t.bookRoomId;
        const photos = photosByType[t.key] || [];
        return (
          <Press
            key={t.key}
            onPress={full ? undefined : () => onSelect(t.key)}
            disabled={full}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: full }}
            accessibilityLabel={`${roomTitle(t)}. ${roomFacts(t)}. ${rentText(t)} a month. ${full ? 'Full' : `${plural(t.availableBeds, 'bed')} available`}`}
            style={[st.card, { backgroundColor: on ? p.accentSoft : p.card, borderColor: on ? p.accentFill : 'transparent', borderWidth: 1.5 }, !on && p.shadow, full && { opacity: 0.6 }]}
          >
            <View style={st.top}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[st.title, { color: p.text }]} numberOfLines={1}>{roomTitle(t)}</Text>
                <Text style={[ui.small, { color: p.sub, marginTop: 4 }]} numberOfLines={2}>{roomFacts(t)}</Text>
              </View>
              <View style={[st.radio, { borderColor: on ? p.accentFill : p.line, backgroundColor: on ? p.accentFill : 'transparent' }]}>
                {on ? <IconCheck size={14} color="#fff" strokeWidth={2.5} /> : null}
              </View>
            </View>
            {photos.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginTop: 12 }}>
                {photos.slice(0, 8).map((ph, i) => (
                  <Press key={ph.id} onPress={() => onOpenPhotos(photos, i)} accessibilityRole="imagebutton" accessibilityLabel={`${roomTitle(t)} photo ${i + 1}`} style={{ width: 88, height: 66 }}>
                    <PgImage uri={ph.url} style={{ width: 88, height: 66, borderRadius: 8 }} recyclingKey={`rt-${ph.id}`} priority="low" />
                  </Press>
                ))}
              </ScrollView>
            ) : null}
            <View style={st.bottom}>
              <Text style={[st.price, { color: p.text }]}>{rentText(t)}<Text style={[ui.small, { color: p.sub, fontWeight: '400' }]}>/month</Text></Text>
              <Text style={[ui.small, { color: full ? p.muted : p.success, fontWeight: '600' }]}>
                {full ? 'Full' : `${t.availableBeds} of ${plural(t.totalBeds, 'bed')} available`}
              </Text>
            </View>
            {t.deposit && t.deposit !== pg.securityDeposit ? <Text style={[ui.small, { color: p.muted, marginTop: 4 }]}>Deposit {inr(t.deposit)}</Text> : null}
          </Press>
        );
      })}
      {types.length > 1 ? (
        <Press onPress={() => setComparing(true)} accessibilityLabel={`Compare ${types.length} room types side by side`} style={[ui.secondaryBtn, st.rowBtn, { borderColor: p.line }]}>
          <IconColumns size={16} color={p.text} strokeWidth={ICON.stroke} />
          <Text style={[ui.btnLabel, { color: p.text }]}>Compare room types</Text>
        </Press>
      ) : null}
      {pg.videos.length ? <View style={{ marginTop: 32 }}><PgVideoSection videos={pg.videos} roomTypeLabels={roomTypeLabels} /></View> : null}
      {comparing ? (
        <CompareRooms types={types} pgDeposit={pg.securityDeposit} selectedKey={selectedKey} onClose={() => setComparing(false)} onChoose={(k) => { onSelect(k); setComparing(false); }} />
      ) : null}
    </View>
  );
}

// ── Compare view ───────────────────────────────────────────────────────────────────────────────
const LABEL_W = 112;
const COL_W = 144;
const ROW_H = 52;
function CompareRooms({ types, pgDeposit, selectedKey, onClose, onChoose }: {
  types: PgRoomType[]; pgDeposit: number; selectedKey: string | null; onClose: () => void; onChoose: (key: string) => void;
}) {
  const p = usePgPalette();
  const insets = useSafeAreaInsets();
  const yesNo = (v: boolean) => (v ? 'Yes' : 'No');
  const rows: { label: string; value: (t: PgRoomType) => string; strong?: boolean }[] = [
    { label: 'Rent', value: (t) => (t.rentFrom === null ? '—' : `${rentText(t)}/month`), strong: true },
    { label: 'Deposit', value: (t) => { const d = t.deposit ?? pgDeposit; return Number(d) > 0 ? inr(d) : 'None'; } },
    { label: 'Sharing', value: (t) => (t.sharingType === 1 ? 'Single' : `${t.sharingType} per room`) },
    { label: 'AC', value: (t) => yesNo(t.hasAC) },
    { label: 'Bathroom', value: (t) => (t.hasAttachedBathroom ? 'Attached' : 'Shared') },
    { label: 'Balcony', value: (t) => yesNo(t.hasBalcony) },
    { label: 'Furnishing', value: (t) => furnishingText(t.furnishing) || '—' },
    { label: 'Beds available', value: (t) => (t.bookRoomId ? `${t.availableBeds} of ${t.totalBeds}` : 'Full') },
  ];
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: p.bg, paddingTop: insets.top }}>
        <View style={[st.modalHead, { borderBottomColor: p.line }]}>
          <Text style={[st.modalTitle, { color: p.text }]} accessibilityRole="header">Compare room types</Text>
          <Press onPress={onClose} accessibilityLabel="Close comparison" style={st.close}>
            <IconX size={22} color={p.text} strokeWidth={ICON.stroke} />
          </Press>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          <View style={{ flexDirection: 'row' }}>
            {/* Fixed label column */}
            <View style={{ width: LABEL_W, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: p.line }}>
              <View style={[st.headCell, { height: 72 }]} />
              {rows.map((r) => (
                <View key={r.label}>
                  <Divider />
                  <View style={[st.cell, { height: ROW_H, paddingLeft: 16 }]}><Text style={[ui.small, { color: p.muted }]}>{r.label}</Text></View>
                </View>
              ))}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {types.map((t) => {
                const on = selectedKey === t.key;
                return (
                  <View key={t.key} style={{ width: COL_W, backgroundColor: on ? p.accentSoft : 'transparent' }} accessible accessibilityLabel={`${roomTitle(t)}: ${rows.map((r) => `${r.label} ${r.value(t)}`).join(', ')}`}>
                    <View style={[st.headCell, { height: 72 }]}>
                      <Text style={[ui.body, { color: p.text, fontWeight: '600' }]} numberOfLines={2}>{roomTitle(t)}</Text>
                    </View>
                    {rows.map((r) => (
                      <View key={r.label}>
                        <Divider />
                        <View style={[st.cell, { height: ROW_H }]}>
                          <Text style={[ui.body, { color: r.label === 'Beds available' && !t.bookRoomId ? p.muted : p.text, fontWeight: r.strong ? '600' : '400' }]} numberOfLines={2}>{r.value(t)}</Text>
                        </View>
                      </View>
                    ))}
                    <Divider />
                    <View style={[st.cell, { height: 68 }]}>
                      {t.bookRoomId ? (
                        <Press onPress={() => onChoose(t.key)} accessibilityState={{ selected: on }} accessibilityLabel={`Choose ${roomTitle(t)}`} style={[st.choose, { borderColor: on ? p.accentFill : p.line, backgroundColor: on ? p.accentFill : 'transparent' }]}>
                          <Text style={[ui.small, { color: on ? '#fff' : p.text, fontWeight: '600' }]}>{on ? 'Selected' : 'Choose'}</Text>
                        </Press>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
          <Text style={[ui.small, { color: p.muted, marginTop: 16, paddingHorizontal: 16 }]}>Rent is per bed, per month. See Policies for deposit refunds.</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  card: { borderRadius: 16, padding: 16, marginBottom: 12 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { fontSize: TYPE.heading, fontWeight: '600' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  bottom: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 12 },
  price: { fontSize: TYPE.heading, fontWeight: '700' },
  rowBtn: { flexDirection: 'row', gap: 8 },
  modalHead: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 4, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth },
  modalTitle: { flex: 1, fontSize: TYPE.heading, fontWeight: '700' },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  headCell: { justifyContent: 'flex-end', paddingHorizontal: 12, paddingBottom: 12 },
  cell: { justifyContent: 'center', paddingHorizontal: 12 },
  choose: { minHeight: 44, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
