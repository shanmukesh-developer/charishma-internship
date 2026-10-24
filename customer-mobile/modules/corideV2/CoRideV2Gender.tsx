/**
 * Women-only option for posting (rides and regular rides). The server lets only hosts whose profile gender
 * is Female post women-only rides (403 WOMEN_ONLY_HOST), so: Female → the toggle; not set → ask inline and
 * save it (PUT /api/users/profile { gender }); anything else → a quiet note, no toggle.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { CR, W } from './coRideV2Theme';
import { Chip } from './CoRideV2Kit';
import { coRideApi } from './coRideV2Api';
import { useCoRide } from './coRideV2Data';

const GENDERS = ['Female', 'Male', 'Other', 'Prefer not to say'] as const;

export function WomenOnlyOption({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const d = useCoRide();
  const { refreshUser } = useAuth();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const g = d.gender;

  if (g === 'Female') {
    return (
      <View style={st.row}>
        <View style={{ flex: 1 }}>
          <Text style={st.title}>Women only</Text>
          <Text style={st.meta}>Only women can see and join this ride.</Text>
        </View>
        <Switch value={value} onValueChange={onChange} trackColor={{ true: CR.primary, false: CR.line }} thumbColor="#FFFFFF" {...({ activeThumbColor: '#FFFFFF' } as any)} accessibilityLabel="Women only" />
      </View>
    );
  }
  if (g && g !== 'Prefer not to say') {
    return <Text style={[st.meta, { marginTop: 4 }]}>Women-only rides can be posted by hosts whose profile gender is Female.</Text>;
  }
  const save = async (gender: (typeof GENDERS)[number]) => {
    setSaving(gender); setError(null);
    const r = await coRideApi.setGender(gender);
    setSaving(null);
    if (!r.ok) { setError(r.message); return; }
    await refreshUser().catch(() => {});
  };
  return (
    <View>
      <Text style={st.title}>Women-only ride?</Text>
      <Text style={st.meta}>To offer a women-only ride, set your gender. It is saved to your profile and used for ride safety.</Text>
      <View style={st.chips}>
        {GENDERS.map((x) => <Chip key={x} label={saving === x ? 'Saving…' : x} on={false} onPress={() => { if (!saving) save(x); }} />)}
      </View>
      {error ? <Text style={[st.meta, { color: CR.red }]}>{error}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 14, color: CR.ink, fontWeight: W.label },
  meta: { fontSize: 12.5, color: CR.muted, lineHeight: 17, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
});
