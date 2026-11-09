/**
 * Rentals v2 bottom sheet: dimmed backdrop (tap to close), white sheet with a grab handle that slides up
 * (instant with reduce motion), title row with a close button, scrollable body and an optional footer.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from '../others/motion';
import { DAY, W } from './rentalsV2Theme';
import { Press } from './RentalsV2Kit';
import { IX } from './RentalsV2Icons';
import { themedSheet } from '../../utils/themeNow';

export function Sheet({ visible, onClose, title, children, footer, maxH = 0.86 }: {
  visible: boolean; onClose: () => void; title?: string; children: React.ReactNode; footer?: React.ReactNode; maxH?: number;
}) {
  const reduce = useReducedMotion();
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) { v.setValue(0); return; }
    if (reduce) { v.setValue(1); return; }
    Animated.timing(v, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [visible, reduce, v]);
  const sheetW = Math.min(width, 560);
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(16,12,48,0.48)', opacity: v }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center' }} pointerEvents="box-none">
        <Animated.View style={[sh.sheet, { width: sheetW, maxHeight: height * maxH, paddingBottom: Math.max(insets.bottom, 12), transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [height * 0.5, 0] }) }] }]}>
          <View style={sh.handle} />
          {title ? (
            <View style={sh.titleRow}>
              <Text style={sh.title} accessibilityRole="header">{title}</Text>
              <Press onPress={onClose} label="Close" style={sh.close}><IX size={18} color={DAY.ink2} strokeWidth={1.8} /></Press>
            </View>
          ) : null}
          <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: 18, paddingTop: 8 }}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function SheetLabel({ children }: { children: React.ReactNode }) {
  return <Text style={sh.label}>{children}</Text>;
}

/** Wrapping option pills (filters). */
export function Options<T extends string>({ items, value, onChange }: { items: { key: T; label: string }[]; value: T; onChange: (k: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {items.map((o) => {
        const on = o.key === value;
        return (
          <Press key={o.key} onPress={() => onChange(o.key)} label={o.label} style={[sh.opt, on ? sh.optOn : null]} scaleTo={0.95}>
            <Text style={[sh.optText, on ? { color: DAY.accent } : null]}>{o.label}</Text>
          </Press>
        );
      })}
    </View>
  );
}

const sh = themedSheet(() => ({
  sheet: { backgroundColor: DAY.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 8 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: DAY.line, marginBottom: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 8 },
  title: { flex: 1, fontSize: 18, fontWeight: W.title, color: DAY.ink },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: DAY.lineSoft, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13.5, color: DAY.ink, fontWeight: W.label, marginTop: 16, marginBottom: 10 },
  opt: { height: 38, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: DAY.line, backgroundColor: DAY.card, justifyContent: 'center' },
  optOn: { borderColor: DAY.accent, backgroundColor: DAY.accentSoft },
  optText: { fontSize: 13, color: DAY.ink2, fontWeight: W.label },
}));
