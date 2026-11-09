import React, { useState, useEffect, useRef } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Animated, Dimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useDietLight } from './local/dietLightTheme';

export interface AlertButton {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

export let showGlobalAlert: (
  title: string,
  message?: string,
  buttons?: AlertButton[],
  options?: any
) => void = () => {};

export default function ThemedAlert() {
  const { isDark, colors } = useTheme();
  const d = useDietLight();
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [buttons, setButtons] = useState<AlertButton[]>([]);
  // Android back / outside dismissal must run the cancel path (callers reset their state there)
  const onDismissRef = useRef<(() => void) | undefined>(undefined);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [scaleAnim] = useState(new Animated.Value(0.9));
  // Guards against a quick double tap running a button's action twice during the close animation
  const closingRef = useRef(false);

  useEffect(() => {
    showGlobalAlert = (t, msg, btns, options) => {
      closingRef.current = false;
      onDismissRef.current = typeof options?.onDismiss === 'function' ? options.onDismiss : undefined;
      setTitle(t);
      setMessage(msg || '');
      setButtons(btns && btns.length > 0 ? btns : [{ text: 'OK' }]);
      setVisible(true);

      // Trigger premium tactile tick
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});

      // Animated entrance
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 6,
          tension: 80,
          useNativeDriver: true,
        }),
      ]).start();
    };
  }, []);

  const handlePress = (onPress?: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    // Close transition
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.95,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setVisible(false);
      if (onPress) onPress();
    });
  };

  if (!visible) return null;

  const activeBg = isDark ? colors.card : COLORS.bgLightCard;
  const activeText = isDark ? COLORS.textPrimary : COLORS.textDark;
  const activeSubText = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const activeBorder = isDark ? d.edge : COLORS.borderLight;

  // Long labels stack full width instead of wrapping inside two side-by-side buttons.
  const stackButtons = buttons.length > 2 || buttons.some((b) => String(b.text || '').length > 14);

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="none"
      onRequestClose={() => handlePress(buttons.find((b) => b.style === 'cancel')?.onPress || onDismissRef.current)}
    >
      <View style={styles.overlay}>
        <Animated.View style={[styles.overlayBg, { opacity: fadeAnim }]} />
        <Animated.View
          style={[
            styles.alertCard,
            {
              backgroundColor: activeBg,
              borderColor: activeBorder,
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          {/* Header */}
          <Text style={[styles.title, { color: activeText }]}>{title}</Text>

          {/* Message */}
          {message ? <Text style={[styles.message, { color: activeSubText }]}>{message}</Text> : null}

          {/* Buttons Row / Column */}
          <View style={[styles.buttonContainer, stackButtons && styles.buttonContainerVertical]}>
            {buttons.map((btn, idx) => {
              const isCancel = btn.style === 'cancel';
              const isDestructive = btn.style === 'destructive';
              
              let btnBg = 'transparent';
              let borderCol = 'transparent';
              let textCol: string = d.acc;

              if (!isCancel) {
                if (isDestructive) {
                  btnBg = COLORS.red;
                  textCol = '#FFFFFF';
                } else {
                  // Owner, 5 Nov 2026 (QA Q1): one action colour across the app; 10 Nov 2026: the diet accent.
                  btnBg = d.acc;
                  textCol = d.onAcc;
                }
              } else {
                textCol = activeSubText;
                borderCol = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
              }

              return (
                <TouchableOpacity
                  key={idx}
                  onPress={() => handlePress(btn.onPress)}
                  style={[
                    // Stacked buttons carry no flex at all: "flex: 1" in a column let Android shrink the last of
                    // three buttons to nothing ("Yes, a boy" was missing from "Are you booking for a boy?").
                    stackButtons ? styles.buttonVertical : styles.button,
                    {
                      backgroundColor: btnBg,
                      borderColor: borderCol,
                      borderWidth: borderCol !== 'transparent' ? 1 : 0
                    },
                  ]}
                >
                  <Text style={[styles.buttonText, { color: textCol }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                    {btn.text || 'OK'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999999,
  },
  overlayBg: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
  },
  alertCard: {
    width: Dimensions.get('window').width - 48,
    maxWidth: 340,
    borderRadius: 24,
    borderWidth: 1.5,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  // Sentence case, calm weights (owner: no ALL CAPS, fonts not too bold).
  title: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 13.5,
    fontWeight: '400',
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 20,
  },
  buttonContainer: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'center',
    gap: 12,
  },
  buttonContainerVertical: {
    flexDirection: 'column',
    width: '100%',
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  // A full-width stacked button: fixed height, never grown or shrunk (web treated "flex: 0" as basis 0%).
  buttonVertical: {
    height: 48,
    width: '100%',
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonText: {
    fontSize: 14.5,
    fontWeight: '600',
    textAlign: 'center',
  },
});
