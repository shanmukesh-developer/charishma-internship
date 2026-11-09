/**
 * In-Campus Booking sample parts (campusBookingDemo.ts), in the same look as the other sample sheets
 * (FoodV2SampleSheet, the Rentals sample sheet):
 *   CbSampleTag    the soft amber "Sample" tag; with onPress it stands where the Add button would be
 *   CbSampleSheet  the polite sheet a sample opens: photo, Sample tag, name, guide price and one plain line.
 * Its only action is "Got it". It never books, adds to a cart, calls an endpoint or shows any UPI detail.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SafeImage from '../../components/SafeImage';
import { BUTTON_ROLE } from '../../utils/pressRole';
import { COLORS, inr, useCbTheme } from './cbTheme';

export interface CbSampleNote {
  name: string;
  art: ImageSourcePropType | null;
  /** Menu item: its guide price. Stall: null. */
  price?: number | null;
  /** Stall name for an item, or the stall's menu line. */
  meta?: string | null;
}

export function CbSampleTag({ onPress, label }: { onPress?: () => void; label?: string }) {
  const p = useCbTheme();
  const tag = (
    <View style={[s.tag, p.isDark ? { backgroundColor: 'rgba(255,214,128,0.12)', borderColor: 'rgba(255,214,128,0.28)' } : null]}>
      <Text style={[s.tagText, p.isDark ? { color: '#F3D38A' } : null]}>Sample</Text>
    </View>
  );
  if (!onPress) return <View accessibilityLabel="Sample">{tag}</View>;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole={BUTTON_ROLE} accessibilityLabel={label || 'Sample. Opens a note'}>
      {tag}
    </TouchableOpacity>
  );
}

export default function CbSampleSheet({ note, onClose }: { note: CbSampleNote | null; onClose: () => void }) {
  const p = useCbTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!note} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole={BUTTON_ROLE} accessibilityLabel="Close" />
        {note ? (
          <View style={[s.sheet, { backgroundColor: p.card, paddingBottom: 18 + insets.bottom }]} accessibilityViewIsModal>
            <View style={[s.grab, { backgroundColor: p.border }]} />
            <View style={{ alignItems: 'center' }}>
              {note.art ? <SafeImage source={note.art} style={s.photo} placeholderIcon="storefront-outline" /> : null}
              <View style={{ marginTop: 14 }}><CbSampleTag /></View>
              <Text style={[s.title, { color: p.txt }]} accessibilityRole="header">{note.name}</Text>
              {note.meta ? <Text style={[s.meta, { color: p.txtSec }]}>{note.meta}</Text> : null}
              {typeof note.price === 'number' ? <Text style={[s.meta, { color: p.txtSec }]}>Expected price around {inr(note.price)}</Text> : null}
              <Text style={[s.body, { color: p.txtSec }]}>This is a sample to show what's coming. You can't book it yet.</Text>
            </View>
            <TouchableOpacity style={[s.primary, { backgroundColor: p.accent }]} onPress={onClose} activeOpacity={0.88} accessibilityRole={BUTTON_ROLE} accessibilityLabel="Got it">
              <Text style={[s.primaryText, { color: p.onAccent }]}>Got it</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, backgroundColor: '#FFF6DF', borderWidth: StyleSheet.hairlineWidth, borderColor: '#EED9A4', alignSelf: 'flex-start' },
  tagText: { fontSize: 11, lineHeight: 14, color: '#8A6A1E', fontWeight: '500' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { width: '100%', maxWidth: 600, alignSelf: 'center', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 10 },
  grab: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  photo: { width: 168, height: 168, borderRadius: 20 },
  title: { fontSize: 18, fontWeight: '600', lineHeight: 24, textAlign: 'center', marginTop: 10 },
  meta: { fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 3 },
  body: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 12, paddingHorizontal: 6 },
  primary: { height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 20, backgroundColor: COLORS.red },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
