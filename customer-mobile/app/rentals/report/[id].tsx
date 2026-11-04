// Report a problem with a rental (damage, no-show, late return, safety…). Goes to the Zenvy admin team.
import React, { useState } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity, Image, ActivityIndicator, Platform } from 'react-native';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { pickAndUploadImage, alertUploadError } from '../../../utils/imageUpload';
import { rentalsApi, REPORT_CATEGORIES } from '../../../modules/rentals/rentalsApi';
import { RHeader, usePalette, Btn, Field, Chips, Notice } from '../../../modules/rentals/ui';
import SymbolIcon from '../../../components/SymbolIcon';

export default function ReportRental() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = String(Array.isArray(params.id) ? params.id[0] : params.id || '');
  const router = useRouter();
  const p = usePalette();
  const [category, setCategory] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<{ ref: string; preview: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const addPhoto = async () => {
    if (uploading || photos.length >= 4) return;
    setUploading(true);
    try {
      const up = await pickAndUploadImage('rental_report', { maxEdge: 1600 });
      if (up) setPhotos((cur) => [...cur, { ref: up.url, preview: up.previewUrl || up.localUri }].slice(0, 4));
    } catch (e) {
      alertUploadError(e, addPhoto);
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!category) return Alert.alert('What happened?', 'Pick a category.');
    if (text.trim().length < 10) return Alert.alert('Add details', 'Describe what happened (at least 10 characters).');
    setSaving(true);
    try {
      const res = await rentalsApi.report(id, { category, description: text.trim(), photos: photos.map((x) => x.ref) });
      Alert.alert('Reported', res.message, [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e: any) {
      Alert.alert('Could not send the report', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <RHeader title="Report a problem" subtitle="Goes to the ZenWe team" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Notice tone="warn">In an emergency or accident, call 112 first. Then tell us here so we can help and act on the account.</Notice>
        <Text style={{ fontSize: 12, fontWeight: '800', color: p.sub, marginBottom: 6 }}>What happened?</Text>
        <Chips<string> options={REPORT_CATEGORIES.map((c) => ({ key: c.key, label: c.label }))} value={category} onChange={setCategory} />
        <View style={{ height: 14 }} />
        <Field label="Details" value={text} onChangeText={(t) => setText(t.slice(0, 2000))} placeholder="When, where, what was damaged or said…" multiline />
        <Text style={{ fontSize: 12, fontWeight: '800', color: p.sub, marginBottom: 6 }}>Photos (optional, private)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          {photos.map((ph) => (
            <TouchableOpacity key={ph.ref} onPress={() => setPhotos((cur) => cur.filter((x) => x.ref !== ph.ref))} accessibilityRole="button" accessibilityLabel="Remove photo"
              style={{ width: 80, height: 80, borderRadius: 12, overflow: 'hidden' }}>
              <Image source={{ uri: ph.preview }} style={{ width: '100%', height: '100%' }} />
            </TouchableOpacity>
          ))}
          {photos.length < 4 ? (
            <TouchableOpacity onPress={addPhoto} accessibilityRole="button" accessibilityLabel="Add photo" style={{ width: 80, height: 80, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: p.accent, alignItems: 'center', justifyContent: 'center' }}>
              {uploading ? <ActivityIndicator color={p.accent} /> : <SymbolIcon name="add" style={{ color: p.accent, fontSize: 22 }} />}
            </TouchableOpacity>
          ) : null}
        </View>
        <Btn label="Send report" kind="danger" loading={saving} onPress={submit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
