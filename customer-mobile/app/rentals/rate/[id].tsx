// Rate the other student after a completed rental (1-5 stars + optional text).
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { KeyboardAvoidingView } from '../../../components/KeyboardAvoidingView';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { rentalsApi, type Booking, wordsOf } from '../../../modules/rentals/rentalsApi';
import { RHeader, usePalette, Card, Btn, Field, Stars, StateView } from '../../../modules/rentals/ui';

const WORDS = ['', 'Bad', 'Not great', 'Okay', 'Good', 'Excellent'];

export default function RateRental() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = String(Array.isArray(params.id) ? params.id[0] : params.id || '');
  const router = useRouter();
  const p = usePalette();
  const [b, setB] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    rentalsApi.booking(id).then((r) => setB(r.booking)).catch((e) => setError(e?.message || 'Could not load the booking.'));
  }, [id]);

  const submit = async () => {
    if (!rating) return Alert.alert('Pick a rating', 'Tap the stars to rate.');
    setSaving(true);
    try {
      const res = await rentalsApi.rate(id, rating, text.trim() || undefined);
      Alert.alert('Thanks', res.message, [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e: any) {
      Alert.alert('Could not save your rating', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const isOwner = b?.role === 'OWNER';
  const w = wordsOf(b);
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.bg }}>
      <RHeader title={isOwner ? `Rate the ${w.taker}` : 'Rate your trip'} subtitle={b?.vehicleTitle} />
      {!b ? (error ? <StateView kind="error" title="Could not load" message={error} /> : <StateView kind="loading" />) : !b.canRate ? (
        <StateView kind="empty" icon="star-outline" title={b.rated ? 'Already rated' : 'Not ready yet'} message={b.rated ? 'You have already rated this trip.' : 'You can rate once the trip is completed.'} actionLabel="Back" onAction={() => router.back()} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          <Card style={{ alignItems: 'center', paddingVertical: 24 }}>
            <Text style={{ fontSize: 14, color: p.sub, marginBottom: 12, textAlign: 'center' }}>{isOwner ? `How was ${b.counterpart?.name || `the ${w.taker}`} as a ${w.taker}?` : `How was ${b.vehicleTitle} and ${b.counterpart?.name || `the ${w.giver}`}?`}</Text>
            <Stars value={rating} size={38} onChange={setRating} />
            <Text style={{ fontSize: 14, fontWeight: '900', color: p.text, marginTop: 10 }}>{WORDS[rating] || ' '}</Text>
          </Card>
          <Field label="Tell others (optional)" value={text} onChangeText={(t) => setText(t.slice(0, 500))} placeholder={isOwner ? 'On time? Took care of the vehicle?' : `Condition of the vehicle, pickup, ${w.giver}…`} multiline />
          <Btn label="Submit rating" loading={saving} onPress={submit} />
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}
