/**
 * Booking sheet for one campus service (repairs, tailoring, print, laundry, other booking-only items).
 * The questions come from serviceForms.ts; this component renders them, validates next to each
 * field, and posts POST /api/services/book. The server prices the booking from the catalogue.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { newIdempotencyKey } from '../../context/CartContext';
import { API_URL } from '../../constants/api';
import { apiFetch } from '../../utils/auth';
import {
  type Answers,
  type ChoiceField,
  type CountField,
  type FormContext,
  type FormField,
  type NumberField,
  type PrintRates,
  type TextField,
  bookingSummary,
  estimatePrice,
  formatRupees,
  initialAnswers,
  isFieldVisible,
  laundryMeasure,
  resolveServiceForm,
  textKey,
  validateAnswers,
} from './serviceForms';

// The server stores booking photos up to 5 MB (backend utils/imageStore DEFAULT_MAX_BYTES).
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export interface BookableItem {
  id: string;
  name: string;
  price: number;
  desc: string;
}

interface Props {
  visible: boolean;
  item: BookableItem | null;
  /** Shelf id: repairs / tailoring / print / laundry, or any other shelf for booking-only items. */
  shelfId: string;
  /** Shelf name shown above the service name, e.g. "Laptop & Tech Repairs". */
  shelfTitle: string;
  /** Print per-page / binding rates from the same catalogue rows the shelf shows. */
  rates: PrintRates;
  onClose: () => void;
  /** The server says the service was paused or removed: refresh the shelf. */
  onServiceUnavailable: () => void;
}

/** Pickup slots still ahead of us (a 4–6 PM slot is not offered at 8 PM). */
const upcomingSlots = (now = new Date()): string[] => {
  const h = now.getHours();
  const slots: string[] = [];
  if (h < 16) slots.push('Today, 4 PM to 6 PM');
  if (h < 19) slots.push('Today, 7 PM to 9 PM');
  slots.push('Tomorrow, 10 AM');
  if (h >= 8 && h < 20) slots.push('Urgent, within 2 hours');
  return slots;
};

const cleanRoom = (room: unknown) => String(room || '').replace(/^\s*room\s*/i, '').trim();

const SERVICE_TYPE_FALLBACK: Record<string, string> = { tailoring: 'TAILORING', repairs: 'LAPTOP_REPAIR', print: 'PRINTOUT', laundry: 'LAUNDRY' };

export default function ServiceBookingSheet({ visible, item, shelfId, shelfTitle, rates, onClose, onServiceUnavailable }: Props) {
  const router = useRouter();
  const { isDark, colors } = useTheme();
  const { user } = useAuth();
  const u: any = user;

  const form = useMemo(() => resolveServiceForm(shelfId, item?.name || ''), [shelfId, item?.name]);
  const ctx: FormContext = useMemo(() => ({ itemName: item?.name || '', itemPrice: item?.price || 0, rates }), [item?.name, item?.price, rates]);

  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [notes, setNotes] = useState('');
  const [slots, setSlots] = useState<string[]>(() => upcomingSlots());
  const [slot, setSlot] = useState<string>(() => upcomingSlots()[0]);
  const [hostelBlock, setHostelBlock] = useState<string>(u?.hostelBlock || '');
  const [roomNumber, setRoomNumber] = useState<string>(cleanRoom(u?.roomNumber || u?.roomNo));
  const [contactPhone, setContactPhone] = useState<string>(u?.phone || '');
  const [photo, setPhoto] = useState<{ name: string; size?: string; uri: string; dataUrl: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  // One key per booking attempt (made when the sheet opens, kept across retries until the server
  // answers) so a timed-out request the server did process is not booked twice on retry.
  const bookingKeyRef = useRef<string>(newIdempotencyKey());
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Fresh form each time the sheet opens for an item.
  useEffect(() => {
    if (!visible || !item) return;
    setAnswers(initialAnswers(form, item.name));
    setErrors({});
    setTriedSubmit(false);
    setNotes('');
    setPhoto(null);
    const s = upcomingSlots();
    setSlots(s);
    setSlot((prev) => (s.includes(prev) ? prev : s[0]));
    bookingKeyRef.current = newIdempotencyKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, item?.id]);

  useEffect(() => {
    if (u?.hostelBlock) setHostelBlock((prev) => prev || u.hostelBlock);
    if (u?.roomNumber || u?.roomNo) setRoomNumber((prev) => prev || cleanRoom(u.roomNumber || u.roomNo));
    if (u?.phone) setContactPhone((prev) => prev || u.phone);
  }, [u]);

  const amount = useMemo(() => estimatePrice(form, answers, ctx), [form, answers, ctx]);

  const locationErrors = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!hostelBlock.trim()) e.hostelBlock = 'Enter your hostel block.';
    if (!cleanRoom(roomNumber)) e.roomNumber = 'Enter your room number.';
    if (String(contactPhone || '').replace(/\D/g, '').length < 10) e.contactPhone = 'Enter a 10-digit mobile number.';
    return e;
  };

  // After the first submit attempt, errors update live as the student fixes them.
  useEffect(() => {
    if (!triedSubmit) return;
    setErrors({ ...validateAnswers(form, answers, ctx, !!photo), ...locationErrors() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triedSubmit, answers, photo, hostelBlock, roomNumber, contactPhone, form, ctx]);

  const setAnswer = (key: string, value: Answers[string]) => setAnswers((prev) => ({ ...prev, [key]: value }));

  const pickPhoto = async () => {
    try {
      // Android uses the system photo picker (no permission); only iOS asks for library access.
      const perm = Platform.OS === 'ios' ? await ImagePicker.requestMediaLibraryPermissionsAsync() : { granted: true };
      if (!perm.granted) {
        Alert.alert('Allow photo access', 'To attach a photo, allow Zenvy to access your photos in Settings.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.5, base64: true });
      if (result.canceled || !result.assets || !result.assets[0]) return;
      const asset = result.assets[0];
      const bytes = asset.fileSize || (asset.base64 ? Math.round(asset.base64.length * 0.75) : 0);
      if (bytes > MAX_ATTACHMENT_BYTES) {
        Alert.alert('That photo is too large', 'Pick a photo under 5 MB, or crop it and try again.');
        return;
      }
      if (!asset.base64) {
        Alert.alert('Could not read that photo', 'Try a different photo.');
        return;
      }
      setPhoto({
        name: asset.fileName || 'Photo.jpg',
        size: bytes ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : undefined,
        uri: asset.uri,
        dataUrl: `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`,
      });
    } catch {
      Alert.alert('Could not attach the photo', 'Something went wrong while picking the photo. Try again.');
    }
  };

  const submit = async () => {
    if (!item || submittingRef.current) return;
    setTriedSubmit(true);
    const allErrors = { ...validateAnswers(form, answers, ctx, !!photo), ...locationErrors() };
    setErrors(allErrors);
    if (Object.keys(allErrors).length) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    const block = hostelBlock.trim();
    const room = cleanRoom(roomNumber);
    const { description, details } = bookingSummary(form, answers, item.name, notes);
    const serviceType = (typeof form.serviceType === 'function' ? form.serviceType(answers) : form.serviceType) || SERVICE_TYPE_FALLBACK[shelfId] || 'GENERAL';
    const isPrint = form.pricing.kind === 'print';
    const isPerUnit = form.pricing.kind === 'perUnit';
    const qty = isPerUnit ? Math.max(1, parseInt(String(answers.quantity ?? 1), 10) || 1) : undefined;

    const payload = {
      serviceType,
      title: item.name.slice(0, 200),
      description,
      specifications: {
        formId: form.id,
        details,
        // Pricing inputs the server multiplies (routes/serviceRoutes.js priceServiceBooking)
        quantity: qty,
        unit: isPerUnit ? laundryMeasure(item.name).unit : undefined,
        pageCount: isPrint ? String(answers.pageCount ?? '1') : undefined,
        copies: isPrint ? String(answers.copies ?? '1') : undefined,
        printColor: isPrint ? (answers.printColor === 'color' ? 'color' : 'bw') : undefined,
        printSides: isPrint ? answers.printSides : undefined,
        bindingType: isPrint ? answers.bindingType : undefined,
        attachedFileName: photo?.name || undefined,
        serviceName: item.name,
        catalogueItemId: item.id,
        category: shelfId,
        notes: notes.trim(),
        clientRequestId: bookingKeyRef.current,
      },
      attachmentUrl: photo?.dataUrl || undefined,
      quotedAmount: amount,
      pickupSlot: slot,
      hostelBlock: block,
      roomNumber: room,
      deliveryAddress: `${block}, Room ${room}`,
      contactPhone,
      paymentMethod: 'COD',
    };

    submittingRef.current = true;
    setSubmitting(true);
    try {
      let res: Response;
      try {
        res = await apiFetch(`${API_URL}/api/services/book`, {
          method: 'POST',
          headers: { 'Idempotency-Key': bookingKeyRef.current },
          body: JSON.stringify(payload),
        });
      } catch {
        // The booking may have reached the server before the connection dropped: keep the same key
        // for a retry and point the student at their bookings instead of implying nothing was placed.
        Alert.alert(
          'Could not confirm the booking',
          'We could not confirm whether your booking went through. Check Orders, Services before trying again.',
          [
            { text: 'OK', style: 'cancel' },
            { text: 'Check bookings', onPress: () => router.push({ pathname: '/(tabs)/orders', params: { segment: 'services' } } as any) },
          ],
        );
        return;
      }
      const data = await res.json().catch(() => null);
      // The server answered, so this attempt is settled; a later booking gets a fresh key.
      if (res.status !== 409) bookingKeyRef.current = newIdempotencyKey();

      if (res.ok && data && data.booking) {
        if (mountedRef.current) onClose();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        const serverAmount = Number(data.booking.quotedAmount);
        const estimate = Number.isFinite(serverAmount) && serverAmount > 0
          ? `Estimate: ${formatRupees(serverAmount)}, pay in cash when the job is done`
          : 'The partner will call you with a price';
        const qtyLine = isPerUnit && qty ? `\nQuantity: ${laundryMeasure(item.name).summary(qty)}` : '';
        // Same short id as My Orders, Services and the admin dashboard (last 8 characters).
        Alert.alert(
          'Booking placed',
          `Booking #${String(data.booking.id || '').slice(-8).toUpperCase()}\n\n${item.name}${qtyLine}\n${estimate}\n${form.slot.label}: ${slot}\nAt: ${block}, Room ${room}\n\nThe partner will call you on ${contactPhone} before the ${form.visitNoun} to confirm the final price.`,
          [
            { text: 'Done', style: 'cancel' },
            { text: 'View booking', onPress: () => router.push({ pathname: '/(tabs)/orders', params: { segment: 'services' } } as any) },
          ],
        );
      } else if (res.status === 413) {
        Alert.alert('Photo too large', 'Attach a smaller photo, or remove it and show the partner at pickup.');
      } else if (res.status === 401) {
        Alert.alert('Sign in again', 'Your session has expired.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign in', onPress: () => router.push('/login' as any) },
        ]);
      } else {
        if (data && data.code === 'SERVICE_UNAVAILABLE') onServiceUnavailable();
        Alert.alert('Booking not placed', (data && typeof data.message === 'string' && res.status < 500 && data.message) || 'We could not book this service right now. Try again.');
      }
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  // ── Styling (light / dark parity) ─────────────────────────────────────────────────────────
  const t = useMemo(() => ({
    sheet: isDark ? '#17171A' : '#FFFFFF',
    text: colors.text,
    sub: colors.textSecondary,
    muted: colors.textMuted,
    border: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.12)',
    input: isDark ? '#202024' : '#F6F7F9',
    chip: isDark ? '#202024' : '#F6F7F9',
    accent: isDark ? '#60A5FA' : '#1D4ED8',
    accentBg: isDark ? 'rgba(96,165,250,0.16)' : '#EFF4FF',
    button: isDark ? '#3B82F6' : '#1D4ED8',
    error: isDark ? '#F87171' : '#B91C1C',
    panel: isDark ? '#1E1E22' : '#F8FAFC',
  }), [isDark, colors]);

  const FieldError = ({ id }: { id: string }) => (errors[id] ? (
    <Text style={[st.error, { color: t.error }]} accessibilityLiveRegion="polite">{errors[id]}</Text>
  ) : null);

  const Label = ({ text, helper }: { text: string; helper?: string }) => (
    <View style={{ marginBottom: 8 }}>
      <Text style={[st.label, { color: t.text }]}>{text}</Text>
      {helper ? <Text style={[st.helper, { color: t.sub }]}>{helper}</Text> : null}
    </View>
  );

  const renderChoice = (f: ChoiceField) => {
    const picked = Array.isArray(answers[f.key]) ? (answers[f.key] as string[]) : answers[f.key] ? [String(answers[f.key])] : [];
    const options = f.options.filter((o) => !(o.hiddenIf && o.hiddenIf(ctx)));
    const toggle = (value: string) => {
      if (f.multiple) setAnswer(f.key, picked.includes(value) ? picked.filter((p) => p !== value) : [...picked, value]);
      else setAnswer(f.key, value);
    };
    const withText = options.find((o) => o.withText && picked.includes(o.value));
    return (
      <View key={f.key} style={st.field}>
        <Label text={f.label} helper={f.helper ?? (f.multiple ? 'Pick all that apply.' : undefined)} />
        <View style={st.chipRow} accessibilityRole={f.multiple ? undefined : 'radiogroup'}>
          {options.map((o) => {
            const on = picked.includes(o.value);
            const hint = o.hint ? o.hint(ctx) : null;
            return (
              <TouchableOpacity
                key={o.value}
                onPress={() => toggle(o.value)}
                activeOpacity={0.8}
                accessibilityRole={f.multiple ? 'checkbox' : 'radio'}
                accessibilityState={f.multiple ? { checked: on } : { selected: on }}
                accessibilityLabel={hint ? `${o.label}, ${hint}` : o.label}
                style={[st.chip, { backgroundColor: on ? t.accentBg : t.chip, borderColor: on ? t.accent : t.border }]}
              >
                <Text style={[st.chipText, { color: on ? t.accent : t.text }]}>{o.label}</Text>
                {hint ? <Text style={[st.chipHint, { color: on ? t.accent : t.sub }]}>{hint}</Text> : null}
              </TouchableOpacity>
            );
          })}
        </View>
        <FieldError id={f.key} />
        {withText?.withText ? (
          <View style={{ marginTop: 10 }}>
            <Text style={[st.subLabel, { color: t.sub }]}>{withText.withText.label}</Text>
            <TextInput
              value={String(answers[textKey(f.key)] ?? '')}
              onChangeText={(v) => setAnswer(textKey(f.key), v)}
              placeholder={withText.withText.placeholder}
              placeholderTextColor={t.muted}
              multiline={!!withText.withText.multiline}
              maxLength={200}
              accessibilityLabel={withText.withText.label}
              style={[st.input, withText.withText.multiline && st.multiline, { backgroundColor: t.input, borderColor: errors[textKey(f.key)] ? t.error : t.border, color: t.text }]}
            />
            <FieldError id={textKey(f.key)} />
          </View>
        ) : null}
      </View>
    );
  };

  const renderText = (f: TextField) => (
    <View key={f.key} style={st.field}>
      <Label text={f.label} helper={f.helper} />
      <TextInput
        value={String(answers[f.key] ?? '')}
        onChangeText={(v) => setAnswer(f.key, v)}
        placeholder={f.placeholder}
        placeholderTextColor={t.muted}
        multiline={!!f.multiline}
        maxLength={f.maxLength || 200}
        autoCapitalize={f.autoCapitalize || 'sentences'}
        accessibilityLabel={f.label}
        style={[st.input, f.multiline && st.multiline, { backgroundColor: t.input, borderColor: errors[f.key] ? t.error : t.border, color: t.text }]}
      />
      <FieldError id={f.key} />
    </View>
  );

  const renderNumber = (f: NumberField) => (
    <View key={f.key} style={[st.field, st.half]}>
      <Label text={f.label} />
      <TextInput
        value={String(answers[f.key] ?? '')}
        onChangeText={(v) => setAnswer(f.key, v.replace(/[^0-9]/g, ''))}
        placeholder={f.placeholder}
        placeholderTextColor={t.muted}
        keyboardType="number-pad"
        maxLength={String(f.max).length}
        accessibilityLabel={f.label}
        style={[st.input, { backgroundColor: t.input, borderColor: errors[f.key] ? t.error : t.border, color: t.text }]}
      />
      {f.helper ? <Text style={[st.helper, { color: t.sub, marginTop: 6 }]}>{f.helper}</Text> : null}
      <FieldError id={f.key} />
    </View>
  );

  const renderCount = (f: CountField) => {
    const n = Math.min(f.max, Math.max(f.min, parseInt(String(answers[f.key] ?? f.min), 10) || f.min));
    const unit = f.unitLabel ? f.unitLabel(n) : '';
    const step = (d: number) => setAnswer(f.key, Math.min(f.max, Math.max(f.min, n + d)));
    return (
      <View key={f.key} style={st.field}>
        <Label text={f.label} helper={f.helper} />
        <View style={st.stepperRow}>
          <TouchableOpacity
            onPress={() => step(-1)}
            disabled={n <= f.min}
            accessibilityRole="button"
            accessibilityLabel={`Decrease ${f.label.toLowerCase()}`}
            style={[st.stepBtn, { backgroundColor: t.chip, borderColor: t.border, opacity: n <= f.min ? 0.4 : 1 }]}
          >
            <Text style={[st.stepText, { color: t.text }]}>−</Text>
          </TouchableOpacity>
          <Text style={[st.stepValue, { color: t.text }]} accessibilityLiveRegion="polite" accessibilityLabel={`${n} ${unit}`}>
            {n}{unit ? <Text style={{ color: t.sub, fontWeight: '600', fontSize: 14 }}> {unit}</Text> : null}
          </Text>
          <TouchableOpacity
            onPress={() => step(1)}
            disabled={n >= f.max}
            accessibilityRole="button"
            accessibilityLabel={`Increase ${f.label.toLowerCase()}`}
            style={[st.stepBtn, { backgroundColor: t.chip, borderColor: t.border, opacity: n >= f.max ? 0.4 : 1 }]}
          >
            <Text style={[st.stepText, { color: t.text }]}>+</Text>
          </TouchableOpacity>
          {form.pricing.kind === 'perUnit' && f.key === 'quantity' && item ? (
            <Text style={[st.helper, { color: t.sub, flex: 1, textAlign: 'right' }]}>
              {formatRupees(item.price)} × {n}
            </Text>
          ) : null}
        </View>
        <FieldError id={f.key} />
      </View>
    );
  };

  const renderField = (f: FormField) => {
    if (!isFieldVisible(f, answers)) return null;
    if (f.kind === 'choice') return renderChoice(f);
    if (f.kind === 'text') return renderText(f);
    if (f.kind === 'count') return renderCount(f);
    return null; // number fields are rendered in pairs below
  };

  // Number fields (pages + copies) sit side by side; everything else is full width, in config order.
  const blocks: React.ReactNode[] = [];
  let pendingNumbers: NumberField[] = [];
  const flushNumbers = () => {
    if (!pendingNumbers.length) return;
    blocks.push(<View key={`n-${pendingNumbers[0].key}`} style={st.numberRow}>{pendingNumbers.map(renderNumber)}</View>);
    pendingNumbers = [];
  };
  for (const f of form.fields) {
    if (f.kind === 'number' && isFieldVisible(f, answers)) { pendingNumbers.push(f); continue; }
    flushNumbers();
    blocks.push(renderField(f));
  }
  flushNumbers();

  const errorCount = Object.keys(errors).length;
  const showPrice = !!item && amount > 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={st.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[st.sheet, { backgroundColor: t.sheet, borderColor: t.border }]}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
            {/* Header */}
            <View style={st.headerRow}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={[st.kicker, { color: t.sub }]}>{shelfTitle}</Text>
                <Text style={[st.title, { color: t.text }]} accessibilityRole="header">{item?.name}</Text>
              </View>
              <TouchableOpacity
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close booking form"
                style={[st.closeBtn, { backgroundColor: t.chip }]}
              >
                <Text style={{ fontSize: 16, color: t.sub, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={[st.priceCard, { backgroundColor: t.panel, borderColor: t.border }]}>
              <View style={{ marginRight: 14 }}>
                <Text style={[st.priceLabel, { color: t.sub }]}>{form.priceLabel}</Text>
                <Text style={[st.price, { color: t.text }]}>{showPrice ? formatRupees(amount) : 'On quote'}</Text>
              </View>
              <Text style={[st.how, { color: t.sub }]}>{form.howItWorks}</Text>
            </View>

            {/* Service-specific questions */}
            {blocks}

            {/* Photo, only where it helps */}
            {form.photo ? (
              <View style={st.field}>
                <Label text={form.photo.label} helper={form.photo.helper} />
                {photo ? (
                  <View style={[st.photoRow, { backgroundColor: t.panel, borderColor: t.border }]}>
                    <Image source={{ uri: photo.uri }} style={st.thumb} accessibilityIgnoresInvertColors />
                    <View style={{ flex: 1 }}>
                      <Text style={[st.photoName, { color: t.text }]} numberOfLines={1}>{photo.name}</Text>
                      <Text style={[st.helper, { color: t.sub }]}>{photo.size ? `${photo.size}, attached` : 'Attached'}</Text>
                    </View>
                    <TouchableOpacity onPress={() => setPhoto(null)} accessibilityRole="button" accessibilityLabel="Remove photo" style={st.textBtn}>
                      <Text style={{ color: t.error, fontWeight: '700', fontSize: 14 }}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={pickPhoto}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${form.photo.label.replace(/ \(optional\)$/, '').toLowerCase()}`}
                    style={[st.photoBtn, { borderColor: t.accent, backgroundColor: t.accentBg }]}
                  >
                    <Text style={{ color: t.accent, fontWeight: '700', fontSize: 14 }}>Add a photo</Text>
                    <Text style={[st.helper, { color: t.sub }]}>JPG or PNG, up to 5 MB</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}

            {/* Time slot */}
            <View style={st.field}>
              <Label text={form.slot.label} helper={form.slot.helper} />
              <View style={st.chipRow} accessibilityRole="radiogroup">
                {slots.map((s) => {
                  const on = slot === s;
                  return (
                    <TouchableOpacity
                      key={s}
                      onPress={() => setSlot(s)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={s}
                      style={[st.chip, { backgroundColor: on ? t.accentBg : t.chip, borderColor: on ? t.accent : t.border }]}
                    >
                      <Text style={[st.chipText, { color: on ? t.accent : t.text }]}>{s}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Where and whom to call */}
            <View style={st.field}>
              <Label text={form.visitNoun === 'visit' ? 'Your room' : 'Pickup address'} />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[st.subLabel, { color: t.sub }]}>Hostel block</Text>
                  <TextInput
                    value={hostelBlock}
                    onChangeText={setHostelBlock}
                    placeholder="e.g. Ganga"
                    placeholderTextColor={t.muted}
                    maxLength={60}
                    autoCapitalize="words"
                    accessibilityLabel="Hostel block"
                    style={[st.input, { backgroundColor: t.input, borderColor: errors.hostelBlock ? t.error : t.border, color: t.text }]}
                  />
                  <FieldError id="hostelBlock" />
                </View>
                <View style={{ width: 120 }}>
                  <Text style={[st.subLabel, { color: t.sub }]}>Room number</Text>
                  <TextInput
                    value={roomNumber}
                    onChangeText={setRoomNumber}
                    placeholder="e.g. 412"
                    placeholderTextColor={t.muted}
                    maxLength={12}
                    accessibilityLabel="Room number"
                    style={[st.input, { backgroundColor: t.input, borderColor: errors.roomNumber ? t.error : t.border, color: t.text }]}
                  />
                  <FieldError id="roomNumber" />
                </View>
              </View>
              <Text style={[st.subLabel, { color: t.sub, marginTop: 12 }]}>Mobile number</Text>
              <TextInput
                value={contactPhone}
                onChangeText={(v) => setContactPhone(v.replace(/[^0-9+]/g, ''))}
                placeholder="10-digit mobile number"
                placeholderTextColor={t.muted}
                keyboardType="phone-pad"
                maxLength={13}
                accessibilityLabel="Mobile number"
                style={[st.input, { backgroundColor: t.input, borderColor: errors.contactPhone ? t.error : t.border, color: t.text }]}
              />
              {errors.contactPhone ? <FieldError id="contactPhone" /> : (
                <Text style={[st.helper, { color: t.sub, marginTop: 6 }]}>The partner calls this number before the {form.visitNoun}.</Text>
              )}
            </View>

            {/* Notes */}
            <View style={st.field}>
              <Label text={form.notes.label} />
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder={form.notes.placeholder}
                placeholderTextColor={t.muted}
                maxLength={300}
                multiline
                accessibilityLabel={form.notes.label}
                style={[st.input, st.multiline, { backgroundColor: t.input, borderColor: t.border, color: t.text }]}
              />
            </View>

            {form.notice ? (
              <View style={[st.notice, { backgroundColor: t.panel, borderColor: t.border }]}>
                <Text style={[st.helper, { color: t.sub }]}>{form.notice}</Text>
              </View>
            ) : null}

            {errorCount > 0 ? (
              <Text style={[st.error, { color: t.error, textAlign: 'center', marginBottom: 8 }]} accessibilityLiveRegion="polite">
                {errorCount === 1 ? 'Fix the highlighted field to continue.' : `Fix the ${errorCount} highlighted fields to continue.`}
              </Text>
            ) : null}

            <TouchableOpacity
              onPress={submit}
              disabled={submitting}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ disabled: submitting, busy: submitting }}
              accessibilityLabel={showPrice ? `Confirm booking, estimate ${formatRupees(amount)}` : 'Confirm booking'}
              style={[st.cta, { backgroundColor: t.button, opacity: submitting ? 0.8 : 1 }]}
            >
              {submitting ? <ActivityIndicator color="#FFFFFF" size="small" /> : (
                <Text style={st.ctaText}>{showPrice ? `Confirm booking · ${formatRupees(amount)}` : 'Confirm booking'}</Text>
              )}
            </TouchableOpacity>
            <Text style={[st.helper, { color: t.sub, textAlign: 'center', marginTop: 8 }]}>
              Pay in cash when the job is done. The partner confirms the final price first.
            </Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 20, maxHeight: '92%', borderWidth: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  kicker: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
  title: { fontSize: 19, fontWeight: '800', lineHeight: 24 },
  closeBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  priceCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 20 },
  priceLabel: { fontSize: 12, fontWeight: '600' },
  price: { fontSize: 20, fontWeight: '800', marginTop: 2 },
  how: { flex: 1, fontSize: 13, lineHeight: 18 },
  field: { marginBottom: 20 },
  half: { flex: 1, marginBottom: 0 },
  numberRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  label: { fontSize: 15, fontWeight: '700' },
  subLabel: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  helper: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  error: { fontSize: 13, fontWeight: '600', marginTop: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1, justifyContent: 'center' },
  chipText: { fontSize: 14, fontWeight: '600' },
  chipHint: { fontSize: 12, fontWeight: '500', marginTop: 1 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 22, fontWeight: '700' },
  stepValue: { fontSize: 18, fontWeight: '800', minWidth: 32, textAlign: 'center' },
  photoBtn: { minHeight: 64, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 10 },
  thumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: '#00000010' },
  photoName: { fontSize: 14, fontWeight: '600' },
  textBtn: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  notice: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 16 },
  cta: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
