// Vehicles list (status from Zenvy, approved capacity + seat layout set by the admin) and the add / edit
// form (GET/POST/PATCH /api/auto-ride/driver/vehicles). Drivers never set the approved capacity.
import React, { useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { color, font, space } from '../theme';
import { Badge, Button, Card, Chip, EmptyState, ErrorStrip, SkeletonCard } from '../ui/kit';
import { Banner, Field, KeyValue, Screen, SectionTitle } from '../ui/Screen';
import { DocSlot } from '../ui/DocSlot';
import { Stepper } from '../ui/Stepper';
import SeatMap from '../ui/SeatMap';
import { useToast } from '../ui/Toast';
import { useSession } from '../state/SessionProvider';
import { useLoad } from '../state/useLoad';
import { driverApi } from '../api/driverApi';
import { ApiError, errorMessage } from '../lib/http';
import { DOC_LABEL, ymdInput } from '../lib/format';
import { LIMITS } from '../config';
import { FUELS, REQUIRED_VEHICLE_DOCS, VEHICLE_DOC_KEYS, type SeatLayout, type Vehicle, type VehicleDocKey, type VehicleInput } from '../types';
import { VEHICLE_BADGE } from './Onboarding';
import type { ScreenProps } from '../nav';

const REG_RE = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/;
const normReg = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);

export function LayoutPreview({ layout }: { layout: SeatLayout }) {
  const states: Record<number, 'AVAILABLE'> = {};
  layout.rows.flat().forEach((c) => { if (typeof c === 'number') states[c] = 'AVAILABLE'; });
  return <SeatMap rows={layout.rows} maleOnlySeats={layout.maleOnlySeats} states={states} />;
}

export function VehiclesScreen({ navigation }: ScreenProps<'Vehicles'>) {
  const { refreshMe } = useSession();
  const q = useLoad(() => driverApi.vehicles(), []);
  const vehicles = q.data?.vehicles || [];
  const live = vehicles.filter((v) => v.status !== 'REJECTED').length;
  return (
    <Screen
      title="Your autos"
      onBack={() => navigation.goBack()}
      refreshing={q.refreshing}
      onRefresh={() => { q.refresh(); refreshMe(); }}
      footer={live < LIMITS.MAX_VEHICLES ? <Button label="Add an auto" icon="add-circle" onPress={() => navigation.navigate('VehicleForm')} /> : null}
    >
      {q.loading ? <SkeletonCard /> : q.error && !q.data ? <ErrorStrip text={q.error} onRetry={q.refresh} busy={q.refreshing} /> : null}
      {!q.loading && q.data && !vehicles.length ? <EmptyState icon="car" title="No auto added yet" body="Add your auto with its RC seating capacity and papers. ZENV checks them and sets how many passengers it may carry." /> : null}
      {vehicles.map((v) => <VehicleCard key={v.id} v={v} onEdit={() => navigation.navigate('VehicleForm', { vehicleId: v.id })} />)}
    </Screen>
  );
}

function VehicleCard({ v, onEdit }: { v: Vehicle; onEdit: () => void }) {
  const b = VEHICLE_BADGE[v.status];
  return (
    <Card style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <Text style={[font.h2, { color: color.text, flex: 1 }]}>{v.registration || v.registrationNumber}</Text>
        <Badge text={b.text} fg={b.fg} bg={b.bg} />
      </View>
      <Text style={[font.body, { color: color.textSecondary }]}>{[v.make, v.model, v.fuel, v.colour].filter(Boolean).join(' · ') || 'Auto'}</Text>
      <KeyValue k="RC seating capacity" v={String(v.rcSeatingCapacity)} />
      <KeyValue k="You asked for" v={`${v.requestedCapacity} passengers`} />
      <KeyValue k="Approved by ZENV" v={v.approvedCapacity ? `${v.approvedCapacity} passengers` : 'Not yet'} strong />
      {v.rejectionReason ? <Banner tone="error" text={`Reason: ${v.rejectionReason}`} /> : null}
      {v.status === 'APPROVED' && v.seatLayout ? (
        <>
          <SectionTitle text="Seat layout (set by ZENV)" />
          <LayoutPreview layout={v.seatLayout} />
        </>
      ) : null}
      {v.status !== 'SUSPENDED' ? <Button label={v.status === 'REJECTED' ? 'Fix and send again' : 'Edit details'} icon="create" variant="secondary" size="secondary" onPress={onEdit} /> : null}
    </Card>
  );
}

const DATE_FIELDS = [
  ['permitExpiresOn', 'Permit valid until', true],
  ['insuranceExpiresOn', 'Insurance valid until', true],
  ['fitnessExpiresOn', 'Fitness certificate valid until', false],
  ['pucExpiresOn', 'PUC valid until', false],
] as const;
type DateKey = typeof DATE_FIELDS[number][0];

export function VehicleFormScreen({ navigation, route }: ScreenProps<'VehicleForm'>) {
  const id = route.params?.vehicleId;
  const toast = useToast();
  const { refreshMe } = useSession();
  const q = useLoad(() => (id ? driverApi.vehicles() : Promise.resolve({ vehicles: [] as Vehicle[] })), [id]);
  const current = useMemo(() => (id ? q.data?.vehicles.find((v) => v.id === id) || null : null), [q.data, id]);
  if (id && q.loading) return <Screen title="Edit auto" onBack={() => navigation.goBack()}><SkeletonCard lines={5} /></Screen>;
  if (id && !current) return <Screen title="Edit auto" onBack={() => navigation.goBack()}><ErrorStrip text={q.error || 'Auto not found.'} onRetry={q.refresh} busy={q.refreshing} /></Screen>;
  return <VehicleForm key={current?.id || 'new'} current={current} onDone={() => { refreshMe(); navigation.goBack(); }} onBack={() => navigation.goBack()} toast={toast} />;
}

function VehicleForm({ current, onDone, onBack, toast }: { current: Vehicle | null; onDone: () => void; onBack: () => void; toast: ReturnType<typeof useToast> }) {
  const [reg, setReg] = useState(current?.registrationNumber || '');
  const [make, setMake] = useState(current?.make || '');
  const [model, setModel] = useState(current?.model || '');
  const [colour, setColour] = useState(current?.colour || '');
  const [year, setYear] = useState(current?.year ? String(current.year) : '');
  const [fuel, setFuel] = useState<string | null>(current?.fuel || null);
  const [rc, setRc] = useState(current?.rcSeatingCapacity || 3);
  const [requested, setRequested] = useState(current?.requestedCapacity || current?.rcSeatingCapacity || 3);
  const [permitNumber, setPermitNumber] = useState(current?.permitNumber || '');
  const [dates, setDates] = useState<Record<DateKey, string>>({
    permitExpiresOn: current?.permitExpiresOn || '', insuranceExpiresOn: current?.insuranceExpiresOn || '',
    fitnessExpiresOn: current?.fitnessExpiresOn || '', pucExpiresOn: current?.pucExpiresOn || '',
  });
  const [docs, setDocs] = useState<Partial<Record<VehicleDocKey, string>>>(current?.documents || {});
  const [previews, setPreviews] = useState<Partial<Record<VehicleDocKey, string | null>>>(current?.documentPreviews || {});
  const [photos, setPhotos] = useState<{ path: string; preview: string | null }[]>((current?.photos || []).map((p, i) => ({ path: p, preview: current?.photoPreviews[i] || null })));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const yearNow = new Date().getFullYear();
  const check = () => {
    const e: Record<string, string> = {};
    if (!REG_RE.test(normReg(reg))) e.registrationNumber = 'Enter the number as on the RC, e.g. AP 07 TA 1234.';
    if (year && (!/^\d{4}$/.test(year) || Number(year) < 1990 || Number(year) > yearNow + 1)) e.year = `Year must be 1990 to ${yearNow + 1}.`;
    for (const [k, , req] of DATE_FIELDS) {
      const v = ymdInput(dates[k]);
      if (v === false) e[k] = 'Use the format YYYY-MM-DD, e.g. 2027-03-31.';
      else if (req && !v) e[k] = 'Needed for approval.';
    }
    for (const k of REQUIRED_VEHICLE_DOCS) if (!docs[k]) e[`doc_${k}`] = 'Needed for approval.';
    return e;
  };

  const save = async () => {
    const e = check();
    setErrors(e);
    if (Object.keys(e).length) { toast.show('Please fix the marked fields.', 'error'); return; }
    const body: VehicleInput = {
      registrationNumber: normReg(reg), make: make.trim() || null, model: model.trim() || null, colour: colour.trim() || null,
      year: year ? Number(year) : null, fuel, rcSeatingCapacity: rc, requestedCapacity: Math.min(requested, rc),
      permitNumber: permitNumber.trim() || null,
      permitExpiresOn: (ymdInput(dates.permitExpiresOn) || null) as string | null,
      insuranceExpiresOn: (ymdInput(dates.insuranceExpiresOn) || null) as string | null,
      fitnessExpiresOn: (ymdInput(dates.fitnessExpiresOn) || null) as string | null,
      pucExpiresOn: (ymdInput(dates.pucExpiresOn) || null) as string | null,
      documents: docs, photos: photos.map((p) => p.path),
    };
    const run = async () => {
      setBusy(true);
      try {
        if (current) await driverApi.updateVehicle(current.id, body);
        else await driverApi.createVehicle(body);
        toast.show('Saved. ZENV will check your auto.', 'success');
        onDone();
      } catch (err) {
        if (err instanceof ApiError && err.data?.field) setErrors({ [String(err.data.field).replace('documents.', 'doc_')]: err.message });
        toast.show(errorMessage(err), 'error');
      } finally {
        setBusy(false);
      }
    };
    if (current && current.status === 'APPROVED') {
      Alert.alert('Send for checking again?', 'Any change sends this auto back to ZENV for checking. You cannot publish trips with it until it is approved again.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save and send', onPress: run },
      ]);
    } else run();
  };

  return (
    <Screen title={current ? 'Edit auto' : 'Add your auto'} onBack={onBack} keyboard
      footer={<Button label={current ? 'Save and send for checking' : 'Save auto'} icon="checkmark-circle" variant="accept" onPress={save} loading={busy} />}>
      <Banner tone="info" text="ZENV checks the RC and decides how many passengers this auto may carry. That number is never more than the RC seating capacity." />
      <Field label="Registration number" value={reg} onChangeText={(v) => setReg(v.toUpperCase().slice(0, 16))} autoCapitalize="characters" placeholder="AP 07 TA 1234" error={errors.registrationNumber} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Field label="Make" value={make} onChangeText={(v) => setMake(v.slice(0, 40))} placeholder="Bajaj" style={{ flex: 1 }} />
        <Field label="Model" value={model} onChangeText={(v) => setModel(v.slice(0, 60))} placeholder="RE Compact" style={{ flex: 1 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Field label="Colour" value={colour} onChangeText={(v) => setColour(v.slice(0, 30))} placeholder="Yellow-green" style={{ flex: 1 }} />
        <Field label="Year" value={year} onChangeText={(v) => setYear(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" placeholder="2022" style={{ flex: 1 }} error={errors.year} />
      </View>
      <SectionTitle text="Fuel" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {FUELS.map((f) => <Chip key={f} label={f} selected={fuel === f} onPress={() => setFuel(fuel === f ? null : f)} style={{ minWidth: 90 }} />)}
      </View>
      <Stepper label="RC seating capacity (passengers)" value={rc} min={1} max={LIMITS.ABSOLUTE_MAX_CAPACITY} onChange={(v) => { setRc(v); if (requested > v) setRequested(v); }} hint="Exactly as printed on the RC, without the driver." />
      <Stepper label="Passengers you want to carry" value={Math.min(requested, rc)} min={1} max={rc} onChange={setRequested} hint="ZENV approves the final number." />
      <Field label="Permit number" value={permitNumber} onChangeText={(v) => setPermitNumber(v.slice(0, 40))} autoCapitalize="characters" placeholder="Optional" />
      {DATE_FIELDS.map(([k, label, req]) => (
        <Field key={k} label={`${label}${req ? '' : ' (optional)'}`} value={dates[k]} onChangeText={(v) => setDates((d) => ({ ...d, [k]: v.replace(/[^\d-]/g, '').slice(0, 10) }))}
          keyboardType="numbers-and-punctuation" placeholder="YYYY-MM-DD" error={errors[k]} />
      ))}
      <SectionTitle text="Papers" />
      {VEHICLE_DOC_KEYS.map((k) => (
        <View key={k} style={{ gap: 4 }}>
          <DocSlot label={DOC_LABEL[k]} required={REQUIRED_VEHICLE_DOCS.includes(k)} hasDoc={!!docs[k]} previewUrl={previews[k]}
            onUploaded={async (path, preview) => { setDocs((d) => ({ ...d, [k]: path })); setPreviews((p) => ({ ...p, [k]: preview })); }} />
          {errors[`doc_${k}`] ? <Text style={[font.small, { color: color.alertDark, fontWeight: '700' }]}>{errors[`doc_${k}`]}</Text> : null}
        </View>
      ))}
      <SectionTitle text={`Photos of your auto (up to ${LIMITS.MAX_VEHICLE_PHOTOS})`} />
      {photos.map((p, i) => (
        <View key={p.path} style={{ gap: 4 }}>
          <DocSlot label={`Auto photo ${i + 1}`} hasDoc previewUrl={p.preview}
            onUploaded={async (path, preview) => setPhotos((list) => list.map((x, j) => (j === i ? { path, preview } : x)))} />
          <Button label="Remove photo" icon="trash" variant="rejectOutline" size="secondary" onPress={() => setPhotos((list) => list.filter((_, j) => j !== i))} />
        </View>
      ))}
      {photos.length < LIMITS.MAX_VEHICLE_PHOTOS ? (
        <DocSlot label="Add a photo of your auto" hasDoc={false} onUploaded={async (path, preview) => setPhotos((list) => [...list, { path, preview }].slice(0, LIMITS.MAX_VEHICLE_PHOTOS))} />
      ) : null}
      {current ? (
        <Card style={{ gap: 4 }}>
          <KeyValue k="Status" v={VEHICLE_BADGE[current.status].text} />
          <KeyValue k="Approved capacity" v={current.approvedCapacity ? String(current.approvedCapacity) : 'Not yet'} />
        </Card>
      ) : null}
    </Screen>
  );
}
