// SOS (adapted from delivery-boy-app/src/ui/Sos.tsx): one tap opens a sheet. "Call 112" is always first.
// "Alert Zenvy" calls POST /api/auto-ride/driver/sos: a HIGH-priority SAFETY incident linked to the current
// trip, shown live in the admin panel and pushed to every admin device. (An older server without /sos gets
// the plain SAFETY incident instead.) This app has no GPS module, so the server adds the last known spot:
// the current trip's pickup stand (admin-entered map point, labelled "not live GPS"), like the rider SOS
// carries the rider's location. The reply's locationSource says what was sent.
import React, { useState } from 'react';
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { color, font, radius, space } from '../theme';
import { Button, Chip, IconButton, Sheet } from './kit';
import { useToast } from './Toast';
import { driverApi } from '../api/driverApi';
import { ApiError, errorMessage } from '../lib/http';
import { EMERGENCY_NUMBER, SUPPORT_PHONE } from '../config';

const QUICK = ['Accident', 'Passenger misbehaving', 'Feeling unsafe', 'Auto broke down', 'Medical help'];

export const call = (num: string) => { Linking.openURL(`tel:${num}`).catch(() => {}); };

export function SosButton({ tripId }: { tripId?: string | null }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let r: { message: string };
      try {
        r = await driverApi.sos({ ...(note.trim() ? { note: note.trim() } : {}), ...(tripId ? { tripId } : {}) });
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404 && !e.code)) throw e;
        const description = `SOS from the driver app${note.trim() ? `: ${note.trim()}` : ''}`;
        r = await driverApi.reportIncident({ category: 'SAFETY', description, ...(tripId ? { tripId } : {}) });
      }
      toast.show(r.message || 'Zenvy has been alerted.', 'success');
      setOpen(false);
    } catch (e) {
      toast.show(`${errorMessage(e)} Call 112 if you are in danger.`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <IconButton icon="warning" label="SOS. Get help" tint={color.textInverse} bg={color.alert} onPress={() => { setNote(''); setOpen(true); }} />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Need help?">
        <View style={{ gap: space.md }}>
          <Button label={`Call ${EMERGENCY_NUMBER} now`} icon="call" variant="reject" size="huge" onPress={() => call(EMERGENCY_NUMBER)} />
          <Text style={[font.body, { color: color.textSecondary }]}>
            Or alert the Zenvy team. They get your name, phone and current trip, with its pickup stand as your last known spot, and will call you back.
          </Text>
          <View style={styles.chips}>
            {QUICK.map((q) => (
              <Chip key={q} label={q} selected={note === q} tone="red" onPress={() => setNote((c) => (c === q ? '' : q))} style={{ flexGrow: 1 }} />
            ))}
          </View>
          <TextInput
            value={note}
            onChangeText={(v) => setNote(v.slice(0, 300))}
            placeholder="Or type a short note"
            placeholderTextColor={color.textMuted}
            multiline
            style={[font.body, styles.input]}
            accessibilityLabel="Note for the Zenvy team"
          />
          <Button label="Alert Zenvy" icon="megaphone" variant="rejectOutline" loading={busy} onPress={send} />
          <Button label="Call Zenvy support" icon="headset" variant="secondary" size="secondary" onPress={() => call(`+${SUPPORT_PHONE}`)} />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  input: { minHeight: 64, maxHeight: 120, textAlignVertical: 'top', borderRadius: radius.md, borderWidth: 2, borderColor: color.border, padding: space.md, color: color.text, backgroundColor: color.surface },
});
