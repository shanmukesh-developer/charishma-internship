// One toast at a time, above the bottom nav. Errors stay longer.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, radius, space } from '../theme';

type Kind = 'info' | 'success' | 'error';
interface ToastMsg { id: number; text: string; kind: Kind }

const Ctx = createContext<{ show: (text: string, kind?: Kind) => void }>({ show: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  const show = useCallback((text: string, kind: Kind = 'info') => {
    setMsg({ id: Date.now(), text, kind });
  }, []);

  useEffect(() => {
    if (!msg) return;
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMsg((m) => (m && m.id === msg.id ? null : m));
      });
    }, msg.kind === 'error' ? 5000 : 3200);
    return () => clearTimeout(t);
  }, [msg, opacity]);

  const ctx = useMemo(() => ({ show }), [show]);
  const bg = msg?.kind === 'error' ? color.alertDark : msg?.kind === 'success' ? color.openDark : color.text;
  return (
    <Ctx.Provider value={ctx}>
      {children}
      {msg ? (
        <Animated.View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + 92, opacity }]} accessibilityLiveRegion="polite">
          <View style={[styles.toast, { backgroundColor: bg }]}>
            <Text style={styles.text}>{msg.text}</Text>
          </View>
        </Animated.View>
      ) : null}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.md, right: space.md, alignItems: 'center', zIndex: 1000, elevation: 20 },
  toast: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, maxWidth: 520, width: '100%' },
  text: { ...font.body, color: color.textInverse, textAlign: 'center', fontWeight: '700' },
});
