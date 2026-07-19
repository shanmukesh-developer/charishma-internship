import React, { useState, useEffect } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Animated, Dimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

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
  const { isDark } = useTheme();
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [buttons, setButtons] = useState<AlertButton[]>([]);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [scaleAnim] = useState(new Animated.Value(0.9));

  useEffect(() => {
    showGlobalAlert = (t, msg, btns) => {
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

  const activeBg = isDark ? '#141416' : '#FFFFFF';
  const activeText = isDark ? '#FFFFFF' : '#111827';
  const activeSubText = isDark ? '#9CA3AF' : '#6B7280';
  const activeBorder = isDark ? 'rgba(201, 168, 76, 0.3)' : 'rgba(0, 0, 0, 0.08)';

  return (
    <Modal visible={visible} transparent={true} animationType="none" onRequestClose={() => handlePress()}>
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
          <View style={[styles.buttonContainer, buttons.length > 2 && styles.buttonContainerVertical]}>
            {buttons.map((btn, idx) => {
              const isCancel = btn.style === 'cancel';
              const isDestructive = btn.style === 'destructive';
              
              let btnBg = 'transparent';
              let borderCol = 'transparent';
              let textCol: string = COLORS.gold;

              if (!isCancel) {
                if (isDestructive) {
                  btnBg = COLORS.red;
                  textCol = '#FFFFFF';
                } else {
                  btnBg = COLORS.gold;
                  textCol = '#000000';
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
                    styles.button,
                    { 
                      backgroundColor: btnBg, 
                      borderColor: borderCol, 
                      borderWidth: borderCol !== 'transparent' ? 1 : 0 
                    },
                    buttons.length > 2 && styles.buttonVertical,
                  ]}
                >
                  <Text style={[styles.buttonText, { color: textCol }]}>
                    {btn.text?.toUpperCase() || 'OK'}
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
  title: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.5,
    textAlign: 'center',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  message: {
    fontSize: 11,
    fontWeight: '600',
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
  buttonVertical: {
    flex: 0,
    width: '100%',
  },
  buttonText: {
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
});
