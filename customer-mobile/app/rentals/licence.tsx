// Driving licence for renting or borrowing: uploaded once (private photos), verified by Zenvy.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import { useRouter } from 'expo-router';
import { pickAndUploadImage, alertUploadError } from '../../utils/imageUpload';
import { rentalsApi, type Licence, LICENCE_CLASSES, istDate, fmtDateOnly } from '../../modules/rentals/rentalsApi';
import { RHeader, usePalette, Card, Btn, Field, Chips, Notice, StateView, Badge, useRentalLive } from '../../modules/rentals/ui';

type Img = { ref: string; preview: string };
const STATUS = { PENDING: { label: 'Being verified', color: '#F59E0B' }, VERIFIED: { label: 'Verified', color: '#10B981' }, REJECTED: { label: 'Not accepted', color: '#EF4444' } } as const;

export default function LicenceScreen() {
  const router = useRouter();
  const p = usePalette();
  const [lic, setLic] = useState<Licence | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState('');
  const [classes, setClasses] = useState<string[]>([]);
  const [expiry, setExpiry] = useState('');
  const [front, setFront] = useState<Img | null>(null);
  const [back, setBack] = useState<Img | null>(null);
  const [uploading, setUploading] = useState<'front' | 'back' | null>(null);
  const [saving, setSaving] = useState(false);

  // A live refresh (socket reconnect / licence event) must not throw away an edit in progress.
  const editingRef = useRef(false);
  editingRef.current = editing;
  const load = useCallback(async () => {
    try {
      const res = await rentalsApi.licence();
      setLic(res.licence);
      if (!editingRef.current) {
        setEditing(!res.licence);
        if (res.licence) { setClasses(res.licence.classes); setExpiry(res.licence.expiresOn || ''); }
      }
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load your licence.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useRentalLive((e) => { if (e.kind === 'licence' || e.kind === 'reconnect') load(); });

  const pick = async (side: 'front' | 'back') => {
    if (uploading) return;
    setUploading(side);
    try {
      const up = await pickAndUploadImage('rental_licence', { maxEdge: 1600, quality: 0.8 });
      if (up) (side === 'front' ? setFront : setBack)({ ref: up.url, preview: up.previewUrl || up.localUri });
    } catch (e) {
      alertUploadError(e, () => pick(side));
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    const n = number.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z]{2}[0-9A-Z]{8,18}$/.test(n)) return Alert.alert('Licence number', 'Enter the number exactly as printed, e.g. AP07 20190012345.');
    if (!classes.length) return Alert.alert('Vehicle classes', 'Pick the classes printed on your licence (e.g. MCWG, LMV).');
    // C7: the expiry ("valid till") date is required, and an expired licence cannot be used.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || Number.isNaN(Date.parse(expiry))) return Alert.alert('Valid till date', 'Enter the expiry date printed on your licence as YYYY-MM-DD, e.g. 2034-05-31.');
    if (expiry < istDate(0)) return Alert.alert('Licence expired', 'This licence has already expired. Upload your renewed licence.');
    const frontRef = front?.ref || null;
    if (!frontRef) return Alert.alert('Photo needed', 'Add a clear photo of the front of your licence.');
    setSaving(true);
    try {
      const res = await rentalsApi.saveLicence({ licenceNumber: n, classes, frontImage: frontRef, backImage: back?.ref || null, expiresOn: expiry });
      setLic(res.licence);
      setEditing(false);
      Alert.alert('Licence sent', res.message, [{ text: 'OK', onPress: () => (router.canGoBack() ? router.back() : null) }]);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const photo = (side: 'front' | 'back', img: Img | null, label: string) => (
    <TouchableOpacity onPress={() => pick(side)} accessibilityRole="button" accessibilityLabel={`Upload ${label}`}
      style={{ flex: 1, height: 120, borderRadius: 14, borderWidth: 1.5, borderStyle: img ? 'solid' : 'dashed', borderColor: img ? p.success : p.accent, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: p.card2 }}>
      {uploading === side ? <ActivityIndicator color={p.accent} /> : img ? <Image source={{ uri: img.preview }} style={{ width: '100%', height: '100%' }} /> : <><Ionicons name="card-outline" size={28} color={p.accent} /><Text style={{ fontSize: 12, fontWeight: '800', color: p.accent, marginTop: 4 }}>{label}</Text></>}
    </TouchableOpacity>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <RHeader title="Driving licence" subtitle="Needed once to rent or borrow vehicles" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {lic === undefined && !error ? <StateView kind="loading" /> : null}
        {error && lic === undefined ? <StateView kind="error" title="Could not load" message={error} actionLabel="Retry" onAction={load} /> : null}

        {lic && !editing ? (
          <>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 15, fontWeight: '900', color: p.text }}>{lic.licenceNumberMasked || 'Your licence'}</Text>
                <Badge label={(STATUS[lic.status] || STATUS.PENDING).label} color={(STATUS[lic.status] || STATUS.PENDING).color} />
              </View>
              <Text style={{ fontSize: 12.5, color: p.sub, marginTop: 8 }}>Classes: {(lic.verifiedClasses || lic.classes).join(', ')}{lic.status === 'VERIFIED' && lic.verifiedClasses ? ' (verified)' : ''}</Text>
              {lic.expiresOn ? <Text style={{ fontSize: 12.5, color: lic.expiresOn < istDate(0) ? p.danger : p.sub, marginTop: 2 }}>Valid till {fmtDateOnly(lic.expiresOn) || lic.expiresOn}{lic.expiresOn < istDate(0) ? ' (expired)' : ''}</Text> : null}
              {lic.frontImage ? <Image source={{ uri: lic.frontImage }} style={{ width: '100%', height: 160, borderRadius: 12, marginTop: 12 }} resizeMode="cover" accessibilityLabel="Your licence photo" /> : null}
            </Card>
            {!lic.expiresOn ? <Notice tone="warn">Add your licence's "valid till" date to keep booking: tap Update licence and save it again.</Notice> : lic.expiresOn < istDate(0) ? <Notice tone="danger">Your licence has expired. Upload your renewed licence to book vehicles.</Notice> : null}
            {lic.status === 'PENDING' ? <Notice tone="info">Zenvy is checking your licence. You can already send booking requests; owners and lenders can accept once it is verified.</Notice> : null}
            {lic.status === 'REJECTED' ? <Notice tone="danger">Not accepted{lic.rejectionReason ? `: ${lic.rejectionReason}` : ''}. Upload it again.</Notice> : null}
            {lic.status === 'VERIFIED' ? <Notice tone="success">You can rent or borrow {[(lic.verifiedClasses || []).some((c) => c.startsWith('MC')) ? 'bikes / scooters' : null, (lic.verifiedClasses || []).some((c) => c.startsWith('LMV') || c === 'TRANS') ? 'cars' : null].filter(Boolean).join(' and ') || 'vehicles'}.</Notice> : null}
            <Btn label={lic.status === 'REJECTED' ? 'Upload again' : 'Update licence'} kind={lic.status === 'REJECTED' ? 'primary' : 'secondary'} onPress={() => setEditing(true)} />
          </>
        ) : null}

        {editing && lic !== undefined ? (
          <>
            <Notice tone="info">Your licence is private: only you and the Zenvy team see it. Owners and lenders only see that it is verified. One licence can be linked to one Zenvy account.</Notice>
            <Field label="Licence number" value={number} onChangeText={(t) => setNumber(t.toUpperCase().slice(0, 24))} autoCapitalize="characters" placeholder="AP07 20190012345" />
            <Text style={{ fontSize: 12, fontWeight: '800', color: p.sub, marginBottom: 6 }}>Classes on your licence</Text>
            <Chips<string> multi options={LICENCE_CLASSES} value={classes} onChange={setClasses} />
            <Text style={{ fontSize: 12, color: p.muted, marginTop: 6, marginBottom: 14 }}>Geared bikes need MCWG. Scooters and gearless bikes need MCWOG or MCWG. Cars need LMV.</Text>
            <Field label="Valid till (required)" value={expiry} onChangeText={(t) => setExpiry(t.replace(/[^\d-]/g, '').slice(0, 10))} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
            <Text style={{ fontSize: 12, fontWeight: '800', color: p.sub, marginBottom: 6 }}>Photos</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
              {photo('front', front, 'Front (required)')}
              {photo('back', back, 'Back (optional)')}
            </View>
            <Btn label="Send for verification" loading={saving} onPress={save} />
            {lic ? <Btn label="Cancel" kind="ghost" onPress={() => setEditing(false)} style={{ marginTop: 10 }} /> : null}
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
