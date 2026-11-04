// Opening hours editor (same sheet and endpoint as the vendor app's "Shop hours":
// PUT /api/restaurants/:id/hours). Same open and close time = open all day.
import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatHHMM } from '../lib/model';
import { useStore } from '../state/StoreProvider';
import { color, font, radius, space, touch } from '../theme';
import { Button, Sheet } from '../ui/kit';

/** "7", "7:30", "7.30 pm", "19:30" → "19:30"; null when it is not a time. */
export function parseTime(input: string): string | null {
  const m = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*$/i.exec(input);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3] ? m[3].toLowerCase()[0] : null;
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'p' && h !== 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
  } else if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const PRESETS: { label: string; start: string; end: string }[] = [
  { label: '9 AM – 10 PM', start: '09:00', end: '22:00' },
  { label: '11 AM – 11 PM', start: '11:00', end: '23:00' },
  { label: '6 PM – 2 AM', start: '18:00', end: '02:00' },
  { label: 'All day', start: '00:00', end: '00:00' },
];

export function HoursSheet({ visible, onClose, start, end, weekly }: { visible: boolean; onClose: () => void; start?: string; end?: string; weekly?: boolean }) {
  const { setHours } = useStore();
  const [s, setS] = useState(start ? formatHHMM(start) : '');
  const [e, setE] = useState(end ? formatHHMM(end) : '');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // State updates are async: two quick taps would both pass a `saving` check and send two saves.
  const savingRef = useRef(false);

  const save = async () => {
    if (savingRef.current) return;
    const ps = parseTime(s);
    const pe = parseTime(e);
    if (!ps || !pe) { setErr('Type times like 9:00 AM and 10:30 PM.'); return; }
    savingRef.current = true;
    setSaving(true);
    setErr(null);
    try {
      const res = await setHours({ start: ps, end: pe });
      if (res.ok) onClose();
      else if (res.error) setErr(res.error);
    } catch {
      setErr("Couldn't save the hours.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Opening hours">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.sm }}>
        <View style={styles.presets}>
          {PRESETS.map((p) => (
            <Pressable
              key={p.label}
              onPress={() => { setS(formatHHMM(p.start)); setE(formatHHMM(p.end)); setErr(null); }}
              accessibilityRole="button"
              style={styles.preset}
            >
              <Text style={[font.small, { color: color.text, fontWeight: '800' }]}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[font.label, { color: color.textMuted }]}>OPENS</Text>
            <TextInput value={s} onChangeText={(t) => { setS(t); setErr(null); }} placeholder="9:00 AM" placeholderTextColor={color.textMuted} style={styles.input} accessibilityLabel="Opening time" />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[font.label, { color: color.textMuted }]}>CLOSES</Text>
            <TextInput value={e} onChangeText={(t) => { setE(t); setErr(null); }} placeholder="10:30 PM" placeholderTextColor={color.textMuted} style={styles.input} accessibilityLabel="Closing time" />
          </View>
        </View>
        <Text style={[font.small, { color: color.textMuted }]}>
          Same open and close time means open all day. A closing time after midnight (like 2 AM) is fine. Outside these hours customers cannot order, even with the store switched on. Times are India time (IST).
        </Text>
        {weekly ? (
          <Text style={[font.small, { color: color.warning, fontWeight: '700' }]}>
            ZenWe set different hours for some days. Saving here uses these same hours every day.
          </Text>
        ) : null}
        {err ? <Text style={[font.body, { color: color.alertDark, fontWeight: '700' }]}>{err}</Text> : null}
        <Button label="Save hours" onPress={save} loading={saving} />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  preset: {
    minHeight: touch.min, paddingHorizontal: space.sm, borderRadius: radius.pill, borderWidth: 2, borderColor: color.border,
    backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center',
  },
  input: {
    ...font.h3, color: color.text, backgroundColor: color.surface, borderWidth: 2, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.sm, minHeight: touch.secondary + 4,
  },
});
