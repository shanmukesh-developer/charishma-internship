// SOS: one tap opens a confirm sheet; "Send SOS" pages the Zenvy team (POST /delivery/sos) with the rider's
// location and an optional short note (a quick-pick chip or typed text). A real emergency number is always
// one tap away in the same sheet.
import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { C, R, S, T } from '../theme';
import { Btn, IconBtn } from './kit';
import { Sheet } from './Sheet';
import { useRider } from '../state/RiderStore';
import * as links from '../services/links';

const QUICK_NOTES = ['Accident', 'Vehicle broke down', 'Feeling unsafe', 'Problem with customer', 'Medical help'];
const NOTE_MAX = 200;

export function SosButton() {
  const r = useRider();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const show = () => {
    setNote('');
    setOpen(true);
  };

  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await r.sendSos(note)) setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <IconBtn icon="alarm-light" label="SOS. Ask ZenWe for help" color={C.white} bg={C.red} onPress={show} />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Need help?">
        <Text style={[T.body, { color: C.ink2 }]}>
          Send SOS to alert the ZenWe team with your location. They will call you. If you are in danger, call 112 first.
        </Text>
        <View style={{ gap: S.sm }}>
          <Text style={[T.label, { color: C.ink2 }]}>WHAT HAPPENED? (OPTIONAL)</Text>
          <View style={styles.chips}>
            {QUICK_NOTES.map((q) => (
              <Btn
                key={q}
                title={q}
                size="small"
                variant={note === q ? 'red' : 'outline'}
                onPress={() => setNote((cur) => (cur === q ? '' : q))}
                accessibilityLabel={`${q}${note === q ? ', selected' : ''}`}
              />
            ))}
          </View>
          <TextInput
            value={note}
            onChangeText={(v) => setNote(v.slice(0, NOTE_MAX))}
            placeholder="Or type a short note"
            placeholderTextColor={C.muted}
            maxLength={NOTE_MAX}
            multiline
            style={[T.body, styles.input]}
            accessibilityLabel="SOS note for the ZenWe team"
          />
        </View>
        <View style={{ gap: S.md }}>
          <Btn
            title={r.connected ? 'Send SOS' : 'No internet: call 112'}
            icon="alarm-light"
            variant="red"
            loading={busy}
            disabled={!r.connected}
            onPress={send}
          />
          <Btn title="Call 112" icon="phone" variant="outline" size="mid" textColor={C.red} onPress={() => links.callNumber('112')} />
          <Btn title="Cancel" variant="soft" size="mid" onPress={() => setOpen(false)} />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  input: {
    minHeight: 64,
    maxHeight: 120,
    textAlignVertical: 'top',
    borderRadius: R.md,
    borderWidth: 2,
    borderColor: C.line,
    padding: S.md,
    color: C.ink,
    backgroundColor: C.card,
  },
});
