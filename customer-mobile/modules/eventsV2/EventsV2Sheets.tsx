/**
 * Campus Events v2 sheets. "Sample event": a polite note when Register / Buy ticket is tapped on a sample; it never
 * calls a registration endpoint and books or charges nothing.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NIGHT, W, shadow, tileOf } from './eventsV2Theme';
import { CTA, Press } from './EventsV2Kit';
import GlossyIcon from './EventsV2Glossy';
import { useNav } from './eventsV2Nav';

export default function EventsV2Sheets() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const sh = nav.sheet;
  return (
    <Modal visible={!!sh} transparent animationType="slide" onRequestClose={nav.closeSheet} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={nav.closeSheet} accessibilityLabel="Close" />
      {sh?.kind === 'sample' ? (
        <View style={[s.sheet, shadow(3), { paddingBottom: Math.max(insets.bottom, 12) + 14 }]} accessibilityViewIsModal>
          <LinearGradient colors={['#2A2668', '#1A1848']} style={StyleSheet.absoluteFill} />
          <View style={s.grab} />
          <View style={{ alignSelf: 'center', marginTop: 6 }}>
            <GlossyIcon kind={tileOf(sh.ev.category)} size={74} />
          </View>
          <Text style={s.title} accessibilityRole="header">This is a sample event</Text>
          <Text style={s.body}>
            {`"${sh.ev.title}" shows how Campus Events works. Registration and tickets open for real events as soon as your clubs publish them. Nothing was booked and nothing was charged.`}
          </Text>
          <CTA label="Got it" onPress={nav.closeSheet} style={{ marginTop: 18 }} />
          <Press onPress={() => { nav.closeSheet(); nav.push({ name: 'explore' }); }} label="Browse all events" style={s.link}>
            <Text style={s.linkText}>Browse all events</Text>
          </Press>
        </View>
      ) : null}
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(8,6,30,0.6)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)', maxWidth: 560, alignSelf: 'center', width: '100%' },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', marginBottom: 8 },
  title: { color: NIGHT.ink, fontSize: 19, fontWeight: W.title, textAlign: 'center', marginTop: 10 },
  body: { color: NIGHT.sub, fontSize: 13.5, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  link: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, marginTop: 4 },
  linkText: { color: NIGHT.violet, fontSize: 14, fontWeight: W.label },
});
