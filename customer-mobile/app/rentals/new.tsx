// "Rent out or lend your vehicle": multi-step listing form (create, or edit with ?id=). Saves a draft as you go;
// the last step sends it for admin review. Photos / documents go through the campus media upload
// (documents are private: only you and Zenvy admins can see them).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Platform, ActivityIndicator, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import { formatINR } from '../../utils/format';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { pickAndUploadImage, alertUploadError, type MediaPurpose } from '../../utils/imageUpload';
import {
  rentalsApi, type OwnListing, type VehicleType, type Fuel, type Transmission, type PlateType, type DateRange, type WeeklyHours,
  VEHICLE_META, DAY_NAMES, istDate, istDayLabel, fmtTime, RentalsError,
} from '../../modules/rentals/rentalsApi';
import { RHeader, usePalette, Card, SectionTitle, Btn, Field, Chips, Toggle, Notice, StateView, Row, TIME_SLOTS } from '../../modules/rentals/ui';

type Img = { ref: string; preview: string };
type Form = {
  vehicleType: VehicleType | null; make: string; model: string; year: string; fuel: Fuel | null; transmission: Transmission | null; seats: string;
  registrationNumber: string; plateType: PlateType | null;
  photos: Img[]; docs: { rc?: Img; insurance?: Img; licence?: Img };
  pricePerHour: string; pricePerDay: string; securityDeposit: string; minHours: string; kmLimitPerDay: string; extraPerKm: string; fuelPolicy: string;
  pickupLocation: string; fixedHours: boolean; days: string[]; openAt: string; closeAt: string; blockedDates: DateRange[]; rules: string; helmetIncluded: boolean;
};
const EMPTY: Form = {
  vehicleType: null, make: '', model: '', year: '', fuel: null, transmission: null, seats: '', registrationNumber: '', plateType: null,
  photos: [], docs: {}, pricePerHour: '', pricePerDay: '', securityDeposit: '', minHours: '1', kmLimitPerDay: '', extraPerKm: '', fuelPolicy: 'Return with the same fuel level',
  pickupLocation: '', fixedHours: false, days: ['1', '2', '3', '4', '5', '6'], openAt: '08:00', closeAt: '20:00', blockedDates: [], rules: '', helmetIncluded: false,
};
const STEPS = ['Vehicle', 'Photos', 'Documents', 'Price', 'Pickup', 'Review'];
const REG_RE = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$|^\d{2}BH\d{4}[A-Z]{1,2}$/;
const digits = (t: string, n = 6) => t.replace(/[^\d]/g, '').slice(0, n);
const decimal = (t: string) => t.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 8);
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

const fromListing = (l: OwnListing): Form => {
  const weekly = Object.entries(l.weeklyHours || {}).filter(([, v]) => !!v) as [string, { start: string; end: string }][];
  const docImg = (k: 'rc' | 'insurance' | 'licence') => (l.documentRefs?.[k] ? { ref: l.documentRefs[k] as string, preview: l.documents?.[k] || '' } : undefined);
  return {
    vehicleType: l.vehicleType, make: l.make || '', model: l.model || '', year: l.year ? String(l.year) : '', fuel: l.fuel, transmission: l.transmission,
    seats: l.seats ? String(l.seats) : '', registrationNumber: l.registrationDisplay || l.registrationNumber || '', plateType: l.plateType,
    photos: (l.photoRefs || []).map((ref, i) => ({ ref, preview: l.photos[i] || '' })),
    docs: { rc: docImg('rc'), insurance: docImg('insurance'), licence: docImg('licence') },
    pricePerHour: l.pricePerHour ? String(l.pricePerHour) : '', pricePerDay: l.pricePerDay ? String(l.pricePerDay) : '',
    securityDeposit: l.securityDeposit ? String(l.securityDeposit) : '', minHours: String(l.minHours || 1),
    kmLimitPerDay: l.kmLimitPerDay ? String(l.kmLimitPerDay) : '', extraPerKm: l.extraPerKm ? String(l.extraPerKm) : '', fuelPolicy: l.fuelPolicy || '',
    pickupLocation: l.pickupLocation || '', fixedHours: weekly.length > 0, days: weekly.length ? weekly.map(([d]) => d) : EMPTY.days,
    openAt: weekly[0]?.[1].start || '08:00', closeAt: weekly[0]?.[1].end || '20:00', blockedDates: l.blockedDates || [], rules: l.rules || '', helmetIncluded: !!l.helmetIncluded,
  };
};

const payloadOf = (f: Form) => {
  const weeklyHours: WeeklyHours = {};
  if (f.fixedHours) f.days.forEach((d) => { (weeklyHours as any)[d] = { start: f.openAt, end: f.closeAt }; });
  return {
    vehicleType: f.vehicleType, make: f.make.trim(), model: f.model.trim(), year: numOrNull(f.year), fuel: f.fuel,
    transmission: f.transmission, seats: f.vehicleType === 'CAR' ? numOrNull(f.seats) : null,
    registrationNumber: f.registrationNumber.trim() || null, plateType: f.plateType,
    photos: f.photos.map((x) => x.ref),
    documents: { rc: f.docs.rc?.ref || null, insurance: f.docs.insurance?.ref || null, licence: f.docs.licence?.ref || null },
    pricePerHour: numOrNull(f.pricePerHour), pricePerDay: numOrNull(f.pricePerDay), securityDeposit: numOrNull(f.securityDeposit) || 0,
    minHours: numOrNull(f.minHours) || 1, kmLimitPerDay: numOrNull(f.kmLimitPerDay), extraPerKm: numOrNull(f.extraPerKm), fuelPolicy: f.fuelPolicy.trim(),
    pickupLocation: f.pickupLocation.trim(), weeklyHours, blockedDates: f.blockedDates, rules: f.rules.trim(),
    helmetIncluded: f.vehicleType !== 'CAR' && f.helmetIncluded,
  };
};

/** Client-side checks per step (the server re-validates everything). */
const stepProblem = (step: number, f: Form): string | null => {
  if (step === 0) {
    if (!f.vehicleType) return 'Pick bike, scooter or car.';
    if (!f.make.trim() || !f.model.trim()) return 'Enter the make and model.';
    const y = Number(f.year);
    if (!y || y < 1990 || y > new Date().getFullYear() + 1) return 'Enter the year it was made.';
    if (!f.fuel) return 'Pick the fuel type.';
    if (f.vehicleType === 'CAR' && (!f.transmission || !f.seats)) return 'Pick transmission and seats.';
    if (!REG_RE.test(f.registrationNumber.toUpperCase().replace(/[^A-Z0-9]/g, ''))) return 'Enter the registration number as on the RC, e.g. AP 07 AB 1234.';
    if (!f.plateType) return 'Tell us the number plate type.';
  }
  if (step === 1 && f.photos.length < 1) return 'Add at least one photo of the vehicle.';
  if (step === 2 && (!f.docs.rc || !f.docs.insurance || !f.docs.licence)) return 'Add the RC, insurance and your driving licence.';
  if (step === 3) {
    if (!(Number(f.pricePerHour) > 0) && !(Number(f.pricePerDay) > 0)) return f.plateType === 'PRIVATE' ? 'Set a cost share per hour, per day, or both.' : 'Set the rent per hour, per day, or both.';
    if (Number(f.extraPerKm) > 0 && !(Number(f.kmLimitPerDay) > 0)) return 'Set a km limit per day for the extra-km charge.';
  }
  if (step === 4) {
    if (f.pickupLocation.trim().length < 3) return 'Where do renters or borrowers pick it up?';
    if (f.fixedHours && (!f.days.length || f.openAt >= f.closeAt)) return 'Pick at least one day and an opening time before the closing time.';
  }
  return null;
};

export default function ListVehicle() {
  const params = useLocalSearchParams<{ id?: string }>();
  const editId = typeof params.id === 'string' && params.id ? params.id : null;
  const router = useRouter();
  const p = usePalette();
  const [form, setForm] = useState<Form>(EMPTY);
  const [listingId, setListingId] = useState<string | null>(editId);
  const [status, setStatus] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(!!editId);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const loadExisting = useCallback(async () => {
    if (!editId) return;
    setLoading(true);
    try {
      const res = await rentalsApi.listing(editId);
      const l = res.listing as OwnListing;
      if (!l.isMine) throw new RentalsError('You can only edit your own vehicles.', 403);
      setForm(fromListing(l));
      setStatus(l.status);
      setRejection(l.rejectionReason);
      setLoadErr(null);
    } catch (e: any) {
      setLoadErr(e?.message || 'Could not load this vehicle.');
    } finally {
      setLoading(false);
    }
  }, [editId]);
  useEffect(() => { loadExisting(); }, [loadExisting]);

  // Eligibility gate for new listings.
  const [gate, setGate] = useState<string | null>(null);
  useEffect(() => {
    rentalsApi.eligibility().then((e) => {
      if (!e.enabled) setGate('Student vehicle rentals are paused right now.');
      else if (!e.eligible) setGate(e.message || 'Verify your college to list a vehicle.');
    }).catch(() => {});
  }, []);

  const upload = async (purpose: MediaPurpose, onDone: (img: Img) => void, key: string) => {
    if (uploading) return;
    setUploading(key);
    try {
      const up = await pickAndUploadImage(purpose, { maxEdge: purpose === 'rental_doc' ? 1600 : 1280 });
      if (up) onDone({ ref: up.url, preview: up.previewUrl || up.localUri || up.absoluteUrl });
    } catch (e) {
      alertUploadError(e, () => upload(purpose, onDone, key));
    } finally {
      setUploading(null);
    }
  };

  /** Saves the current form as a draft / edit. Returns the saved listing (or null on error). */
  const save = async (): Promise<OwnListing | null> => {
    setSaving(true);
    try {
      const body = payloadOf(form);
      if (!listingId) {
        const res = await rentalsApi.createListing(body);
        setListingId(res.listing.id);
        setStatus(res.listing.status);
        return res.listing;
      }
      const res = await rentalsApi.updateListing(listingId, body);
      setStatus(res.listing.status);
      if (res.sentToReview) Alert.alert('Sent for review', res.message);
      return res.listing;
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Please try again.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  // A ref lock (state updates are async): two taps in one frame must not create two drafts.
  const busyRef = useRef(false);
  const next = async () => {
    if (busyRef.current) return;
    const problem = stepProblem(step, form);
    if (problem) { Alert.alert('Almost there', problem); return; }
    busyRef.current = true;
    try {
      // First save once the vehicle details are in, then on every step so nothing is lost.
      const saved = await save();
      if (saved) setStep((s) => Math.min(STEPS.length - 1, s + 1));
    } finally {
      busyRef.current = false;
    }
  };

  const finish = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await finishInner();
    } finally {
      busyRef.current = false;
    }
  };

  const finishInner = async () => {
    for (let i = 0; i < STEPS.length - 1; i++) {
      const problem = stepProblem(i, form);
      if (problem) { setStep(i); Alert.alert('Almost there', problem); return; }
    }
    const saved = await save();
    if (!saved) return;
    if (saved.status === 'DRAFT' || saved.status === 'REJECTED') {
      setSaving(true);
      try {
        const res = await rentalsApi.submitListing(saved.id);
        Alert.alert('Sent for review', res.message);
        router.replace('/rentals/my-listings' as any);
      } catch (e: any) {
        Alert.alert('Could not send for review', e?.message || 'Please try again.');
      } finally {
        setSaving(false);
      }
    } else {
      Alert.alert('Saved', saved.status === 'PENDING_REVIEW' ? 'Your vehicle is waiting for review.' : 'Your changes are live.');
      router.replace('/rentals/my-listings' as any);
    }
  };

  // Blocked date picker state
  const [blkStart, setBlkStart] = useState(istDate(1));
  const [blkEnd, setBlkEnd] = useState(istDate(1));
  const dateOptions = useMemo(() => Array.from({ length: 60 }, (_, i) => istDate(i)), []);

  if (loading) return <View style={{ flex: 1, backgroundColor: p.bg }}><RHeader title="Edit vehicle" /><StateView kind="loading" /></View>;
  if (loadErr) return <View style={{ flex: 1, backgroundColor: p.bg }}><RHeader title="Edit vehicle" /><StateView kind="error" title="Could not load" message={loadErr} actionLabel="Retry" onAction={loadExisting} /></View>;
  if (gate && !editId) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg }}>
        <RHeader title="Rent out or lend your vehicle" />
        <StateView kind="empty" icon="school-outline" title="One step first" message={gate} actionLabel="Verify my college" onAction={() => router.push('/friends?screen=verification' as any)} />
      </View>
    );
  }

  const isCar = form.vehicleType === 'CAR';
  const isPrivate = form.plateType === 'PRIVATE';
  // C7 wording: private plate = borrow (cost share), commercial plate = rent; not chosen yet = both.
  const taker = isPrivate ? 'borrower' : form.plateType === 'COMMERCIAL_RENTAL' ? 'renter' : 'renter or borrower';
  const takers = isPrivate ? 'borrowers' : form.plateType === 'COMMERCIAL_RENTAL' ? 'renters' : 'renters or borrowers';
  const Takers = takers.charAt(0).toUpperCase() + takers.slice(1);
  const stepName = (s: string) => (s === 'Price' && isPrivate ? 'Cost share' : s);
  const lbl = { fontSize: 12, fontWeight: '800' as const, color: p.sub, marginBottom: 6 };
  const docTile = (k: 'rc' | 'insurance' | 'licence', label: string, hint: string) => {
    const img = form.docs[k];
    return (
      <TouchableOpacity key={k} accessibilityRole="button" accessibilityLabel={`Upload ${label}`} onPress={() => upload('rental_doc', (i) => setForm((f) => ({ ...f, docs: { ...f.docs, [k]: i } })), k)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: img ? p.success : p.border, backgroundColor: p.card, marginBottom: 10 }}>
        <View style={{ width: 54, height: 54, borderRadius: 10, backgroundColor: p.card2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
          {uploading === k ? <ActivityIndicator color={p.accent} /> : img?.preview ? <Image source={{ uri: img.preview }} style={{ width: 54, height: 54 }} /> : <Ionicons name="document-text-outline" size={24} color={p.muted} />}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 13.5, fontWeight: '900', color: p.text, flexShrink: 1 }}>{label}</Text>
            {img ? <Ionicons name="checkmark-circle" size={16} color={p.success} accessibilityLabel="Added" /> : null}
          </View>
          <Text style={{ fontSize: 12, color: p.sub, marginTop: 2 }}>{hint}</Text>
        </View>
        <Text style={{ color: p.accent, fontWeight: '900', fontSize: 12 }}>{img ? 'Replace' : 'Upload'}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <RHeader title={editId ? 'Edit vehicle' : 'Rent out or lend your vehicle'} subtitle={`Step ${step + 1} of ${STEPS.length} · ${stepName(STEPS[step])}`} />
      <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 16, paddingTop: 10 }}>
        {STEPS.map((s, i) => (
          <TouchableOpacity key={s} style={{ flex: 1 }} onPress={() => (i < step || listingId ? setStep(i) : null)} accessibilityRole="button" accessibilityLabel={`Step ${i + 1}: ${stepName(s)}`}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: i <= step ? p.accent : p.border }} />
            <Text style={{ fontSize: 12, fontWeight: '800', color: i === step ? p.accent : p.muted, marginTop: 4, textAlign: 'center' }}>{stepName(s)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        {rejection && status === 'REJECTED' ? <Notice tone="danger">ZCS asked for changes: {rejection}</Notice> : null}
        {status === 'APPROVED' ? <Notice tone="info">Your vehicle is live. Changing the vehicle details, photos or documents sends it back for a quick review; price and availability changes go live at once.</Notice> : null}

        {step === 0 && (
          <View>
            <SectionTitle>What are you listing?</SectionTitle>
            <Chips<VehicleType> options={(Object.keys(VEHICLE_META) as VehicleType[]).map((k) => ({ key: k, label: VEHICLE_META[k].label }))} value={form.vehicleType} onChange={(v) => set('vehicleType', v)} />
            <View style={{ height: 14 }} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Field label="Make" value={form.make} onChangeText={(t) => set('make', t.slice(0, 40))} placeholder="Honda" style={{ flex: 1 }} />
              <Field label="Model" value={form.model} onChangeText={(t) => set('model', t.slice(0, 60))} placeholder="Activa 6G" style={{ flex: 1 }} />
            </View>
            <Field label="Year" value={form.year} onChangeText={(t) => set('year', digits(t, 4))} keyboardType="number-pad" placeholder="2022" />
            <Text style={lbl}>Fuel</Text>
            <Chips<Fuel> options={[{ key: 'PETROL', label: 'Petrol' }, { key: 'DIESEL', label: 'Diesel' }, { key: 'EV', label: 'Electric' }, { key: 'CNG', label: 'CNG' }]} value={form.fuel} onChange={(v) => set('fuel', v)} />
            <View style={{ height: 14 }} />
            <Text style={lbl}>Transmission{isCar ? '' : ' (optional)'}</Text>
            <Chips<Transmission> options={[{ key: 'MANUAL', label: isCar ? 'Manual' : 'Geared' }, { key: 'AUTOMATIC', label: isCar ? 'Automatic' : 'Gearless' }]} value={form.transmission} onChange={(v) => set('transmission', v)} />
            <View style={{ height: 14 }} />
            {isCar ? <Field label="Seats" value={form.seats} onChangeText={(t) => set('seats', digits(t, 1))} keyboardType="number-pad" placeholder="5" /> : null}
            <Field label="Registration number" value={form.registrationNumber} onChangeText={(t) => set('registrationNumber', t.toUpperCase().slice(0, 16))} autoCapitalize="characters" placeholder="AP 07 AB 1234"
              hint={`Shown to students as AP 07 •• 1234. The full number is shared only with your confirmed ${taker}.`} />
            <Text style={lbl}>Number plate</Text>
            <Chips<PlateType> options={[{ key: 'PRIVATE', label: 'White (private)', hint: 'Students borrow it' }, { key: 'COMMERCIAL_RENTAL', label: 'Black / yellow', hint: 'Students rent it' }]} value={form.plateType} onChange={(v) => set('plateType', v)} />
            <Text style={{ fontSize: 12, color: p.muted, marginTop: 8, lineHeight: 16 }}>
              {form.plateType === 'PRIVATE'
                ? 'Private (white plate): you lend your personal vehicle and students borrow it on a non-commercial basis (sharing costs such as fuel), never as a business. Check that your insurance allows another driver; you are responsible for that.'
                : form.plateType === 'COMMERCIAL_RENTAL'
                  ? 'Commercial (black / yellow plate): students rent it from you. You are responsible for a valid rental permit and insurance.'
                  : 'Be honest: ZCS reviews this. Private vehicles are lent and borrowed between students (not rented for profit); commercial-plate vehicles are rented.'}
            </Text>
          </View>
        )}

        {step === 1 && (
          <View>
            <SectionTitle>Photos ({form.photos.length}/6)</SectionTitle>
            <Text style={{ fontSize: 12, color: p.sub, marginBottom: 12 }}>Clear photos of the front, side and the odometer. The first photo is the cover.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {form.photos.map((img, i) => (
                <View key={img.ref} style={{ width: 100, height: 100, borderRadius: 14, overflow: 'hidden', backgroundColor: p.card2 }}>
                  <Image source={{ uri: img.preview }} style={{ width: '100%', height: '100%' }} />
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove photo ${i + 1}`} onPress={() => set('photos', form.photos.filter((x) => x.ref !== img.ref))}
                    style={{ position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#fff', fontWeight: '900' }}>✕</Text>
                  </TouchableOpacity>
                  {i === 0 ? <View style={{ position: 'absolute', bottom: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 6, paddingHorizontal: 5 }}><Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>Cover</Text></View> : null}
                </View>
              ))}
              {form.photos.length < 6 ? (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add photo" onPress={() => upload('rental_photo', (img) => setForm((f) => ({ ...f, photos: [...f.photos.filter((x) => x.ref !== img.ref), img].slice(0, 6) })), 'photo')}
                  style={{ width: 100, height: 100, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: p.accent, alignItems: 'center', justifyContent: 'center' }}>
                  {uploading === 'photo' ? <ActivityIndicator color={p.accent} /> : <><Text style={{ fontSize: 24, color: p.accent }}>＋</Text><Text style={{ fontSize: 12, color: p.accent, fontWeight: '800' }}>Add photo</Text></>}
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        )}

        {step === 2 && (
          <View>
            <SectionTitle>Documents</SectionTitle>
            <Notice tone="info">Only you and the ZCS team can see these. Renters and borrowers never see them.</Notice>
            {docTile('rc', 'Registration certificate (RC)', 'Front side, number clearly visible')}
            {docTile('insurance', 'Insurance', 'Current policy page with validity dates')}
            {docTile('licence', 'Your driving licence', 'Shows you own the vehicle or may rent it out or lend it')}
          </View>
        )}

        {step === 3 && (
          <View>
            <SectionTitle>{isPrivate ? 'Cost share' : 'Price'}</SectionTitle>
            <Text style={{ fontSize: 12, color: p.sub, marginBottom: 12 }}>{isPrivate ? 'Set an hourly or daily cost share (fuel and wear), or both. Long trips use the daily amount.' : 'Set an hourly price, a daily price, or both. Long trips use the daily price.'}</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Field label="₹ per hour" value={form.pricePerHour} onChangeText={(t) => set('pricePerHour', decimal(t))} keyboardType="decimal-pad" placeholder="50" style={{ flex: 1 }} />
              <Field label="₹ per day" value={form.pricePerDay} onChangeText={(t) => set('pricePerDay', decimal(t))} keyboardType="decimal-pad" placeholder="400" style={{ flex: 1 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Field label="Security deposit ₹" value={form.securityDeposit} onChangeText={(t) => set('securityDeposit', digits(t, 6))} keyboardType="number-pad" placeholder="1000" hint="Returned in cash when the vehicle comes back" style={{ flex: 1 }} />
              <Field label="Minimum hours" value={form.minHours} onChangeText={(t) => set('minHours', digits(t, 2))} keyboardType="number-pad" placeholder="1" style={{ flex: 1 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Field label="Km limit / day" value={form.kmLimitPerDay} onChangeText={(t) => set('kmLimitPerDay', digits(t, 4))} keyboardType="number-pad" placeholder="Optional" style={{ flex: 1 }} />
              <Field label="₹ per extra km" value={form.extraPerKm} onChangeText={(t) => set('extraPerKm', decimal(t))} keyboardType="decimal-pad" placeholder="Optional" style={{ flex: 1 }} />
            </View>
            <Field label="Fuel policy" value={form.fuelPolicy} onChangeText={(t) => set('fuelPolicy', t.slice(0, 300))} placeholder="Return with the same fuel level" />
            <Notice tone="success">{isPrivate ? 'Borrowers pay you the agreed cost share and deposit in cash at pickup.' : 'Renters pay you the rent and deposit in cash at pickup.'} ZCS does not take a cut or hold the money.</Notice>
          </View>
        )}

        {step === 4 && (
          <View>
            <SectionTitle>Pickup & availability</SectionTitle>
            <Field label="Pickup point" value={form.pickupLocation} onChangeText={(t) => set('pickupLocation', t.slice(0, 200))} placeholder="e.g. Hostel B parking, near the main gate" />
            <Toggle label="Only at fixed hours" hint={form.fixedHours ? 'Pickup and return only on these days and hours' : `${Takers} pick any time; you agree the exact time`} value={form.fixedHours} onChange={(v) => set('fixedHours', v)} />
            {form.fixedHours ? (
              <Card>
                <Chips<string> multi options={DAY_NAMES.map((d, i) => ({ key: String(i), label: d }))} value={form.days} onChange={(v) => set('days', v)} />
                <Text style={[lbl, { marginTop: 12 }]}>Opens</Text>
                <Chips<string> wrap={false} options={TIME_SLOTS.filter((t) => t >= '05:00' && t <= '23:00').map((t) => ({ key: t, label: fmtTime(t) }))} value={form.openAt} onChange={(v) => set('openAt', v)} />
                <Text style={[lbl, { marginTop: 12 }]}>Closes</Text>
                <Chips<string> wrap={false} options={TIME_SLOTS.filter((t) => t >= '06:00').map((t) => ({ key: t, label: fmtTime(t) }))} value={form.closeAt} onChange={(v) => set('closeAt', v)} />
              </Card>
            ) : null}
            <SectionTitle>Dates it is not available</SectionTitle>
            <Card>
              <Text style={lbl}>From</Text>
              <Chips<string> wrap={false} options={dateOptions.map((d) => ({ key: d, label: istDayLabel(d) }))} value={blkStart} onChange={(v) => { setBlkStart(v); if (v > blkEnd) setBlkEnd(v); }} />
              <Text style={[lbl, { marginTop: 10 }]}>To</Text>
              <Chips<string> wrap={false} options={dateOptions.filter((d) => d >= blkStart).map((d) => ({ key: d, label: istDayLabel(d) }))} value={blkEnd} onChange={setBlkEnd} />
              <Btn label="Block these dates" kind="secondary" small style={{ marginTop: 10, alignSelf: 'flex-start' }} onPress={() => {
                if (form.blockedDates.length >= 30) return Alert.alert('Limit reached', 'You can block up to 30 date ranges.');
                set('blockedDates', [...form.blockedDates, { start: blkStart, end: blkEnd }]);
              }} />
              {form.blockedDates.map((b, i) => (
                <View key={`${b.start}-${b.end}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                  <Text style={{ color: p.text, fontSize: 12.5 }}>{b.start === b.end ? istDayLabel(b.start) : `${istDayLabel(b.start)} → ${istDayLabel(b.end)}`}</Text>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Remove blocked dates" onPress={() => set('blockedDates', form.blockedDates.filter((_, j) => j !== i))}><Text style={{ color: p.danger, fontWeight: '900' }}>Remove</Text></TouchableOpacity>
                </View>
              ))}
            </Card>
            <Field label={`Rules for ${isPrivate ? 'borrowers' : form.plateType === 'COMMERCIAL_RENTAL' ? 'renters' : 'renters and borrowers'}`} value={form.rules} onChangeText={(t) => set('rules', t.slice(0, 1000))} placeholder="e.g. No triple riding. Park inside campus at night." multiline />
            {form.vehicleType !== 'CAR' ? <Toggle label="Helmet included" value={form.helmetIncluded} onChange={(v) => set('helmetIncluded', v)} /> : null}
          </View>
        )}

        {step === 5 && (
          <View>
            <SectionTitle>Review</SectionTitle>
            <Card>
              <Row label="Vehicle" value={`${form.make} ${form.model} · ${form.year}`} />
              <Row label="Registration" value={form.registrationNumber.toUpperCase()} />
              <Row label="Plate" value={form.plateType === 'COMMERCIAL_RENTAL' ? 'Commercial rental · students rent it' : 'Private · students borrow it'} />
              <Row label="Photos" value={`${form.photos.length}`} />
              <Row label="Documents" value={`${['rc', 'insurance', 'licence'].filter((k) => (form.docs as any)[k]).length}/3`} />
              <Row label={isPrivate ? 'Cost share' : 'Rent'} value={[form.pricePerHour ? `${formatINR(form.pricePerHour)}/hr` : null, form.pricePerDay ? `${formatINR(form.pricePerDay)}/day` : null].filter(Boolean).join(' · ') || '—'} />
              <Row label="Deposit" value={formatINR(form.securityDeposit || 0)} />
              <Row label="Pickup" value={form.pickupLocation || '—'} />
              <Row label="Hours" value={form.fixedHours ? `${form.days.map((d) => DAY_NAMES[Number(d)]).join(', ')} · ${fmtTime(form.openAt)}–${fmtTime(form.closeAt)}` : 'Any time'} />
            </Card>
            <Notice tone="info">ZCS checks your documents before the vehicle goes live (usually within a day). You will get a notification.</Notice>
          </View>
        )}
      </ScrollView>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 26, backgroundColor: p.bg, borderTopWidth: 1, borderTopColor: p.border }}>
        {step > 0 ? <Btn label="Back" kind="secondary" onPress={() => setStep((s) => s - 1)} style={{ flex: 1 }} /> : null}
        {step < STEPS.length - 1
          ? <Btn label={listingId ? 'Save & continue' : 'Continue'} loading={saving} onPress={next} style={{ flex: 2 }} />
          : <Btn label={status === 'APPROVED' || status === 'PAUSED' || status === 'PENDING_REVIEW' ? 'Save changes' : 'Send for review'} loading={saving} onPress={finish} style={{ flex: 2 }} />}
      </View>
    </KeyboardAvoidingView>
  );
}
