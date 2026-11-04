/**
 * Food & groceries v2: the sample sheet. Opens when a sample item (foodV2Demo.ts) is tapped anywhere in the
 * store. It explains that the item is a sample and is never added, saved or sent. Its only action is closing.
 * Others → Food & groceries (modules/foodV2).
 */
import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressScale } from '../../modules/others/motion';
import { FOOD } from './foodV2Theme';
import { fmt, groupOf } from './FoodV2Data';
import { useFoodV2 } from './useFoodV2';
import { SampleTag } from './FoodV2Ui';
import Thumb from './FoodV2Thumb';
import { BUTTON_ROLE } from '../../utils/pressRole';

export default function FoodV2SampleSheet() {
  const { sampleOpen: p, setSampleOpen, isDark, c } = useFoodV2();
  const insets = useSafeAreaInsets();
  const close = () => setSampleOpen(null);
  return (
    <Modal visible={!!p} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={st.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole={BUTTON_ROLE} accessibilityLabel="Close" />
        {!!p && (
          <View style={[st.sheet, { backgroundColor: c.card, paddingBottom: 18 + insets.bottom }]} accessibilityViewIsModal>
            <View style={[st.grab, { backgroundColor: c.line }]} />
            <View style={{ alignItems: 'center' }}>
              <Thumb uri={null} art={p.art} size={168} radius={20} isDark={isDark} group={groupOf(p)} />
              <View style={{ marginTop: 14 }}><SampleTag isDark={isDark} /></View>
              <Text style={[st.title, { color: c.title }]} accessibilityRole="header">{p.name}</Text>
              {!!p.weight && <Text style={[st.meta, { color: c.slate }]}>{p.weight}</Text>}
              <Text style={[st.meta, { color: c.slate }]}>Expected price around {fmt(p.price)}</Text>
              <Text style={[st.body, { color: c.slate }]}>
                This is a sample to show what's coming to the campus store. It can't be ordered yet. New products are added often.
              </Text>
            </View>
            <PressScale style={[st.primary, { backgroundColor: FOOD.primary }]} onPress={close} accessibilityRole={BUTTON_ROLE} accessibilityLabel="Got it">
              <Text style={st.primaryText}>Got it</Text>
            </PressScale>
          </View>
        )}
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { width: '100%', maxWidth: 600, alignSelf: 'center', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 10 },
  grab: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '500', lineHeight: 24, textAlign: 'center', marginTop: 10 },
  meta: { fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 3 },
  body: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 12, paddingHorizontal: 6 },
  primary: { height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '500' },
});
