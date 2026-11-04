// Starting a phone call (3 Nov 2026: SOS, helpline and support buttons did nothing on a phone that cannot dial).
// When the dialler cannot open, the number is shown so the user can call it another way. Same message as the
// tracking screen's call-rider fallback.
import { Alert, Linking } from 'react-native';

export const dial = (number: string, label?: string) => {
  const n = String(number || '').trim();
  if (!n) return;
  Linking.openURL(`tel:${n}`).catch(() => {
    Alert.alert('Could not start the call', label ? `You can call ${label} on ${n}.` : `You can call ${n}.`);
  });
};
