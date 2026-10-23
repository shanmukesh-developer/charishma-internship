/**
 * Booking flow for one campus service (repairs, tailoring, print, laundry, other booking-only items),
 * shown full screen as steps:
 *   repairs    device -> issue -> device details -> booking -> booked
 *   tailoring  (category tile) -> service -> service details -> measurement and booking -> booked
 *   print / laundry  (service) -> details -> booking -> booked
 * The questions come from serviceForms.ts and the step plan from serviceFlow.ts. Validation runs per
 * step, next to each field. POST /api/services/book gets the same payload as before; the server
 * prices the booking from the catalogue.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
  Image,
} from 'react-native';
import { PressScale, ProgressBar, SlideIn } from '../others/motion';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from '../../components/KeyboardAvoidingView';
import SafeImage from '../../components/SafeImage';
import { useAuth } from '../../context/AuthContext';
import { newIdempotencyKey } from '../../context/CartContext';
import { API_URL } from '../../constants/api';
import { apiFetch, SERVER_BUSY_MESSAGE } from '../../utils/auth';
import { compressImage } from '../../utils/imageUpload';
import { uploadServicePdf } from './uploadServicePdf';
import {
  type Answers,
  type BookingDetail,
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
  unitCount,
  validateAnswers,
} from './serviceForms';
import {
  DEVICES,
  MEASURE_KEYS,
  type DayChip,
  type DeviceKind,
  type IconName,
  type RepairIssue,
  dayChips,
  deviceOfForm,
  diagnosisItem,
  handoverFor,
  isBookingStepField,
  itemIcon,
  repairIssues,
  servicePriceLabel,
  shortBookingRef,
  slotText,
  timeSlotsFor,
} from './serviceFlow';
import { familyOf, hexAlpha, useServicePalette, type ServicePalette } from './serviceTheme';

// The server stores booking photos up to 5 MB (backend utils/imageStore DEFAULT_MAX_BYTES) and print
// PDFs up to 5 MB (backend utils/serviceDocuments MAX_PDF_BYTES). One file per booking keeps the
// request under the 10 MB upload body limit.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export interface BookableItem {
  id: string;
  name: string;
  price: number;
  desc: string;
  image?: string | null;
  inStock?: boolean;
  storeName?: string;
}

/** Where the flow opens: the repairs device picker, or a list of services to choose from. */
export type FlowStart =
  | { kind: 'device' }
  | { kind: 'list'; title: string; subtitle?: string; itemIds: string[] };

interface Props {
  visible: boolean;
  /** Open straight at this service's details (ignored when `start` is set). */
  item: BookableItem | null;
  /** Shelf id: repairs / tailoring / print / laundry, or any other shelf for booking-only items. */
  shelfId: string;
  /** Shelf name, e.g. "Laptop & Tech Repairs". */
  shelfTitle: string;
  /** Print per-page / binding rates from the same catalogue rows the shelf shows. */
  rates: PrintRates;
  onClose: () => void;
  /** The server says the service was paused or removed: refresh the shelf. */
  onServiceUnavailable: () => void;
  /** All services on the shelf (the device / issue / list steps pick from these). */
  catalogue?: BookableItem[];
  start?: FlowStart;
}

type Step = 'device' | 'issue' | 'list' | 'details' | 'booking' | 'success';

const cleanRoom = (room: unknown) => String(room || '').replace(/^\s*room\s*/i, '').trim();

const SERVICE_TYPE_FALLBACK: Record<string, string> = { tailoring: 'TAILORING', repairs: 'LAPTOP_REPAIR', print: 'PRINTOUT', laundry: 'LAUNDRY' };

const DETAILS_TITLE: Record<string, string> = {
  repairs: 'Device details', tailoring: 'Service details', print: 'Your print job', laundry: 'Your laundry', general: 'Details',
};
const BOOKING_TITLE: Record<string, string> = {
  repairs: 'Book your repair', tailoring: 'Measurement & booking', print: 'Delivery & booking', laundry: 'Pickup & booking', general: 'Booking',
};
const SUCCESS_TITLE: Record<string, string> = {
  repairs: 'Repair booked successfully!', tailoring: 'Booking confirmed!', print: 'Print job booked!', laundry: 'Pickup booked!', general: 'Booking sent!',
};
const PARTNER_NOUN: Record<string, string> = {
  repairs: 'technician', tailoring: 'tailor', print: 'print shop', laundry: 'laundry partner', general: 'partner',
};

const fitIcon = (v: string): IconName => (/measure/i.test(v) ? 'body-outline' : /copy|match/i.test(v) ? 'shirt-outline' : /type|give/i.test(v) ? 'create-outline' : /mark/i.test(v) ? 'pencil-outline' : 'ellipse-outline');
const fabricIcon = (v: string): IconName => (/have/i.test(v) ? 'bag-handle-outline' : /provide/i.test(v) ? 'color-palette-outline' : 'chatbubbles-outline');
const handoverFileIcon = (v: string): IconName => (/pdf/i.test(v) ? 'document-attach-outline' : /photo/i.test(v) ? 'image-outline' : /pen/i.test(v) ? 'save-outline' : 'call-outline');

export default function ServiceBookingSheet({ visible, item, shelfId, shelfTitle, rates, onClose, onServiceUnavailable, catalogue = [], start }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const u: any = user;
  const family = familyOf(shelfId);
  const p = useServicePalette(family);
  const handover = handoverFor(family);

  // ── Flow position ─────────────────────────────────────────────────────────────────────────
  const [stack, setStack] = useState<Step[]>(['details']);
  const step = stack[stack.length - 1];
  // Forward steps slide in from the right, Back from the left.
  const prevDepthRef = useRef(stack.length);
  const stepDir: 1 | -1 = stack.length >= prevDepthRef.current ? 1 : -1;
  useEffect(() => { prevDepthRef.current = stack.length; }, [stack.length]);
  const [cur, setCur] = useState<BookableItem | null>(item);
  const [device, setDevice] = useState<DeviceKind | null>(null);
  const [issue, setIssue] = useState<RepairIssue | null>(null);
  const [locked, setLocked] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const scrollRef = useRef<ScrollView>(null);
  // Y of each question card (inside the step), so a failed Continue can scroll to the first error.
  const fieldY = useRef<Record<string, number>>({});
  const at = (key: string) => (e: LayoutChangeEvent) => { fieldY.current[key] = e.nativeEvent.layout.y; };
  const scrollToFirstError = (errs: Record<string, string>) => {
    const ys = Object.keys(errs)
      .map((k) => fieldY.current[k] ?? fieldY.current[k.replace(/Text$/, '')])
      .filter((y): y is number => typeof y === 'number');
    if (ys.length) scrollRef.current?.scrollTo({ y: Math.max(0, Math.min(...ys) - 12), animated: true });
  };

  const form = useMemo(() => resolveServiceForm(shelfId, cur?.name || ''), [shelfId, cur?.name]);
  const ctx: FormContext = useMemo(() => ({ itemName: cur?.name || '', itemPrice: cur?.price || 0, rates }), [cur?.name, cur?.price, rates]);

  // ── Answers ───────────────────────────────────────────────────────────────────────────────
  const [answers, setAnswers] = useState<Answers>({});
  const [tried, setTried] = useState<{ details: boolean; booking: boolean }>({ details: false, booking: false });
  const [notes, setNotes] = useState('');
  const [handoverValue, setHandoverValue] = useState(handover.options[0].value);
  const [days, setDays] = useState<DayChip[]>(() => dayChips());
  const [dayKey, setDayKey] = useState<string>(() => dayChips()[0]?.key || '1');
  const [timeKey, setTimeKey] = useState<string>('');
  const [hostelBlock, setHostelBlock] = useState<string>(u?.hostelBlock || '');
  const [roomNumber, setRoomNumber] = useState<string>(cleanRoom(u?.roomNumber || u?.roomNo));
  const [contactPhone, setContactPhone] = useState<string>(u?.phone || '');
  const [photo, setPhoto] = useState<{ name: string; size?: string; uri: string; dataUrl: string } | null>(null);
  // Native: the PDF uploads first (POST /api/services/documents) and the booking sends its id. Web keeps
  // the older inline data URL (the server accepts both).
  const [pdf, setPdf] = useState<{
    name: string; size?: string; uri?: string; dataUrl?: string;
    status: 'uploading' | 'done' | 'failed' | 'inline'; progress: number; documentId?: string; error?: string;
  } | null>(null);
  const pdfUploadRef = useRef(0); // the newest upload wins (a removed / re-picked file never overwrites)
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  // One key per booking attempt (made when the flow opens, kept across retries until the server
  // answers) so a timed-out request the server did process is not booked twice on retry.
  const bookingKeyRef = useRef<string>(newIdempotencyKey());
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const day = days.find((d) => d.key === dayKey) || days[0];
  const times = useMemo(() => (day ? timeSlotsFor(day.offset) : []), [day]);
  const time = times.find((t) => t.key === timeKey) || times[0];

  const resetAnswers = (next: BookableItem | null, prefill: Answers = {}) => {
    const f = resolveServiceForm(shelfId, next?.name || '');
    setAnswers({ ...initialAnswers(f, next?.name || ''), ...prefill });
    setTried({ details: false, booking: false });
    setNotes('');
    setPhoto(null);
    pdfUploadRef.current += 1;
    setPdf(null);
  };

  // A fresh flow each time it opens.
  useEffect(() => {
    if (!visible) return;
    const firstStep: Step = start?.kind === 'device' ? 'device' : start?.kind === 'list' ? 'list' : 'details';
    setStack([firstStep]);
    setResult(null);
    setIssue(null);
    setLocked([]);
    const startItem = firstStep === 'details' ? item : null;
    setCur(startItem);
    setDevice(startItem ? deviceOfForm(resolveServiceForm(shelfId, startItem.name)) : null);
    resetAnswers(startItem);
    setHandoverValue(handover.options[0].value);
    const d = dayChips();
    setDays(d);
    setDayKey(d[0]?.key || '1');
    setTimeKey('');
    bookingKeyRef.current = newIdempotencyKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, item?.id, start]);

  useEffect(() => {
    if (u?.hostelBlock) setHostelBlock((prev) => prev || u.hostelBlock);
    if (u?.roomNumber || u?.roomNo) setRoomNumber((prev) => prev || cleanRoom(u.roomNumber || u.roomNo));
    if (u?.phone) setContactPhone((prev) => prev || u.phone);
  }, [u]);

  useEffect(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); }, [step]);

  const push = (s: Step) => setStack((prev) => [...prev, s]);
  const back = () => {
    if (step === 'success' || stack.length <= 1) { onClose(); return; }
    setStack((prev) => prev.slice(0, -1));
  };

  const chooseItem = (next: BookableItem, prefill: Answers = {}, lockedKeys: string[] = []) => {
    if (next.inStock === false) {
      Alert.alert('Not taking bookings right now', `${next.name} is paused. Pick another service or check back later.`);
      return;
    }
    setCur(next);
    setLocked(lockedKeys);
    resetAnswers(next, prefill);
    push('details');
  };

  // ── Derived ───────────────────────────────────────────────────────────────────────────────
  const amount = useMemo(() => estimatePrice(form, answers, ctx), [form, answers, ctx]);
  const photoShown = !!form.photo && (!form.photo.showIf || form.photo.showIf(answers));
  const pdfShown = !!form.document && (!form.document.showIf || form.document.showIf(answers));
  const attached = { photo: photoShown && !!photo, pdf: pdfShown && !!pdf };

  const detailFields = form.fields.filter((f) => !locked.includes(f.key) && !isBookingStepField(family, f.key));
  const bookingFields = form.fields.filter((f) => !locked.includes(f.key) && isBookingStepField(family, f.key));
  const keysOf = (fields: FormField[]) => new Set(fields.flatMap((f) => [f.key, textKey(f.key)]));
  const detailKeys = keysOf(detailFields);
  const bookingKeys = keysOf(bookingFields);
  // Tailoring jobs that take your size (fit / measurements / length fields, or the measurement visit)
  // say "measurement"; a button, zip or seam repair does not.
  const takesMeasurements = family === 'tailoring'
    && (form.id === 'tailoring.measurement' || form.fields.some((f) => MEASURE_KEYS.includes(f.key)));

  const locationErrors = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!hostelBlock.trim()) e.hostelBlock = 'Enter your hostel block.';
    if (!cleanRoom(roomNumber)) e.roomNumber = 'Enter your room number.';
    if (String(contactPhone || '').replace(/\D/g, '').length < 10) e.contactPhone = 'Enter a 10-digit mobile number.';
    return e;
  };
  const pick = (all: Record<string, string>, keys: Set<string>) => Object.fromEntries(Object.entries(all).filter(([k]) => keys.has(k)));
  const fieldErrors = cur ? validateAnswers(form, answers, ctx, attached) : {};
  const detailErrors = pick(fieldErrors, detailKeys);
  // Anything validateAnswers reports that is not on a visible step (a locked key) belongs to details.
  for (const [k, v] of Object.entries(fieldErrors)) if (!detailKeys.has(k) && !bookingKeys.has(k)) detailErrors[k] = v;
  const bookingErrors = { ...pick(fieldErrors, bookingKeys), ...locationErrors() };
  const errors: Record<string, string> = {
    ...(tried.details ? detailErrors : {}),
    ...(tried.booking ? bookingErrors : {}),
  };

  const setAnswer = (key: string, value: Answers[string]) => setAnswers((prev) => ({ ...prev, [key]: value }));

  // ── Files ─────────────────────────────────────────────────────────────────────────────────
  const pickPhoto = async () => {
    try {
      // Android uses the system photo picker (no permission); only iOS asks for library access.
      const perm = Platform.OS === 'ios' ? await ImagePicker.requestMediaLibraryPermissionsAsync() : { granted: true };
      if (!perm.granted) {
        Alert.alert('Allow photo access', 'To attach a photo, allow the app to access your photos in Settings.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1, base64: false });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const asset = res.assets[0];
      // Resized to a 1600 px long edge (a 3-5 MB camera photo becomes a few hundred KB) before it is sent.
      const small = await compressImage(asset.uri, { width: asset.width, height: asset.height, maxEdge: 1600, quality: 0.7 });
      if (!small.base64) {
        Alert.alert('Could not read that photo', 'Try a different photo.');
        return;
      }
      const bytes = Math.round(small.base64.length * 0.75);
      if (bytes > MAX_ATTACHMENT_BYTES) {
        Alert.alert('That photo is too large', 'Pick a photo under 5 MB, or crop it and try again.');
        return;
      }
      setPhoto({
        name: asset.fileName || 'Photo.jpg',
        size: `${(bytes / (1024 * 1024)).toFixed(1)} MB`,
        uri: small.uri || asset.uri,
        dataUrl: `data:image/jpeg;base64,${small.base64}`,
      });
    } catch {
      Alert.alert('Could not attach the photo', 'Something went wrong while picking the photo. Try again.');
    }
  };

  const pickPdf = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const asset = res.assets[0];
      if (asset.mimeType && asset.mimeType !== 'application/pdf') {
        Alert.alert('Pick a PDF file', 'Only PDF files can be attached here. For other files, use a pen drive or send them when the print shop calls.');
        return;
      }
      if (asset.size && asset.size > MAX_PDF_BYTES) {
        Alert.alert('That PDF is too large', 'Pick a PDF under 5 MB, or share it on a pen drive or when the print shop calls.');
        return;
      }
      const name = asset.name || 'Document.pdf';
      if (Platform.OS === 'web') {
        // Web hands back a data URL: sent inline with the booking, as before.
        const raw = asset.base64 || (asset.uri.startsWith('data:') ? asset.uri : '');
        const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
        if (!base64) {
          Alert.alert('Could not read that PDF', 'Try picking it again, or share it on a pen drive.');
          return;
        }
        const bytes = asset.size || Math.round(base64.length * 0.75);
        if (bytes > MAX_PDF_BYTES) {
          Alert.alert('That PDF is too large', 'Pick a PDF under 5 MB, or share it on a pen drive or when the print shop calls.');
          return;
        }
        setPdf({ name, size: mb(bytes), dataUrl: `data:application/pdf;base64,${base64}`, status: 'inline', progress: 1 });
        return;
      }
      startPdfUpload({ name, uri: asset.uri, size: asset.size ? mb(asset.size) : undefined });
    } catch {
      Alert.alert('Could not attach the PDF', 'Something went wrong while picking the file. Try again.');
    }
  };

  // Upload the picked PDF now (progress + Retry on the step); the booking later sends only its id.
  const startPdfUpload = async (file: { name: string; uri: string; size?: string }) => {
    const run = ++pdfUploadRef.current;
    setPdf({ ...file, status: 'uploading', progress: 0 });
    try {
      const doc = await uploadServicePdf({ uri: file.uri, name: file.name }, (fraction) => {
        if (mountedRef.current && pdfUploadRef.current === run) setPdf((c) => (c && c.status === 'uploading' ? { ...c, progress: fraction } : c));
      });
      if (!mountedRef.current || pdfUploadRef.current !== run) return;
      setPdf({ ...file, name: doc.name || file.name, status: 'done', progress: 1, documentId: doc.id });
    } catch (e: any) {
      if (!mountedRef.current || pdfUploadRef.current !== run) return;
      setPdf({ ...file, status: 'failed', progress: 0, error: e?.message || 'The PDF did not upload. Tap Retry.' });
    }
  };
  const removePdf = () => { pdfUploadRef.current += 1; setPdf(null); };

  // ── Step actions ──────────────────────────────────────────────────────────────────────────
  const continueFromDetails = () => {
    setTried((t) => ({ ...t, details: true }));
    if (Object.keys(detailErrors).length) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      scrollToFirstError(detailErrors);
      return;
    }
    push('booking');
  };

  const submit = async () => {
    if (!cur || submittingRef.current) return;
    // Browsing and filling the steps needs no account; booking does (the partner needs whom to call).
    if (!user) {
      Alert.alert('Sign in to book', 'Sign in so the partner knows where to come and whom to call.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Sign in', onPress: () => { onClose(); router.push('/login' as any); } },
      ]);
      return;
    }
    if (attached.pdf && pdf && pdf.status === 'uploading') {
      Alert.alert('The PDF is still uploading', 'Wait a moment for it to finish, then send the booking.');
      return;
    }
    if (attached.pdf && pdf && pdf.status === 'failed') {
      Alert.alert("The PDF didn't upload", 'Tap Retry next to the file, or remove it and share it when the print shop calls.');
      return;
    }
    setTried({ details: true, booking: true });
    if (Object.keys(detailErrors).length) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setStack((prev) => prev.slice(0, prev.lastIndexOf('details') + 1));
      return;
    }
    if (Object.keys(bookingErrors).length) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      scrollToFirstError(bookingErrors);
      return;
    }
    // The chosen slot may have passed while the screen was open.
    const freshTimes = day ? timeSlotsFor(day.offset) : [];
    if (!day || !time || !freshTimes.some((t) => t.key === time.key)) {
      const d = dayChips();
      setDays(d);
      setDayKey(d[0]?.key || '1');
      setTimeKey('');
      Alert.alert('Pick another time', 'That time slot has just passed. Choose a new day and time.');
      return;
    }
    const pickupSlot = slotText(day, time);
    const block = hostelBlock.trim();
    const room = cleanRoom(roomNumber);
    const extra: BookingDetail[] = [{ key: 'handover', label: handover.label, value: handoverValue }];
    const { description, details } = bookingSummary(form, answers, cur.name, notes, extra);
    const serviceType = (typeof form.serviceType === 'function' ? form.serviceType(answers) : form.serviceType) || SERVICE_TYPE_FALLBACK[shelfId] || 'GENERAL';
    const isPrint = form.pricing.kind === 'print';
    const isPerUnit = form.pricing.kind === 'perUnit';
    const isLaundry = form.category === 'laundry';
    const qty = isPerUnit ? unitCount(form, answers) : undefined;
    const sendPhoto = attached.photo ? photo : null;
    const sendPdf = attached.pdf ? pdf : null;

    const payload = {
      serviceType,
      title: cur.name.slice(0, 200),
      description,
      specifications: {
        formId: form.id,
        details,
        // Pricing inputs the server multiplies (routes/serviceRoutes.js priceServiceBooking)
        quantity: qty,
        unit: isPerUnit ? (isLaundry ? laundryMeasure(cur.name).unit : 'pcs') : undefined,
        pageCount: isPrint ? String(answers.pageCount ?? '1') : undefined,
        copies: isPrint ? String(answers.copies ?? '1') : undefined,
        printColor: isPrint ? (answers.printColor === 'color' ? 'color' : 'bw') : undefined,
        printSides: isPrint ? answers.printSides : undefined,
        bindingType: isPrint ? answers.bindingType : undefined,
        attachedFileName: sendPhoto?.name || sendPdf?.name || undefined,
        serviceName: cur.name,
        catalogueItemId: cur.id,
        category: shelfId,
        notes: notes.trim(),
        clientRequestId: bookingKeyRef.current,
      },
      attachmentUrl: sendPhoto?.dataUrl || undefined,
      // Uploaded first (native): only its id. Web: the older inline form.
      documentId: sendPdf && sendPdf.documentId ? sendPdf.documentId : undefined,
      documentName: sendPdf && sendPdf.documentId ? sendPdf.name : undefined,
      attachmentDocument: sendPdf && !sendPdf.documentId && sendPdf.dataUrl ? { dataUrl: sendPdf.dataUrl, name: sendPdf.name } : undefined,
      quotedAmount: amount,
      pickupSlot,
      hostelBlock: block,
      roomNumber: room,
      deliveryAddress: `${block}, Room ${room}`,
      contactPhone,
      paymentMethod: 'COD',
    };

    submittingRef.current = true;
    setSubmitting(true);
    try {
      // 90 s per attempt; a thrown error (no answer / timeout) is retried once after 1.5 s with the SAME
      // Idempotency-Key, so the server de-duplicates a booking it already saved.
      const body = JSON.stringify(payload);
      const send = async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 90000);
        try {
          return await apiFetch(`${API_URL}/api/services/book`, {
            method: 'POST',
            headers: { 'Idempotency-Key': bookingKeyRef.current },
            body,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      };
      let res: Response;
      try {
        try {
          res = await send();
        } catch {
          await new Promise((r) => setTimeout(r, 1500));
          res = await send();
        }
      } catch {
        // The booking may have reached the server before the connection dropped: keep the same key
        // for a retry and point the student at their bookings instead of implying nothing was placed.
        Alert.alert(
          'Could not confirm the booking',
          'We could not confirm whether your booking went through. Check Orders, Services before trying again.',
          [
            { text: 'OK', style: 'cancel' },
            { text: 'Check bookings', onPress: () => { onClose(); router.push({ pathname: '/(tabs)/orders', params: { segment: 'services' } } as any); } },
          ],
        );
        return;
      }
      const data = await res.json().catch(() => null);
      // The server answered, so this attempt is settled; a later booking gets a fresh key.
      if (res.status !== 409) bookingKeyRef.current = newIdempotencyKey();

      if (res.ok && data && data.booking) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (!mountedRef.current) return;
        setResult({
          booking: data.booking,
          qtyLine: isPerUnit && qty ? (isLaundry ? laundryMeasure(cur.name).summary(qty) : `${qty} ${qty === 1 ? 'piece' : 'pieces'}`) : '',
          details,
          slot: pickupSlot,
          handover: handoverValue,
          where: `${block}, Room ${room}`,
          phone: contactPhone,
        });
        setStack(['success']);
      } else if (res.status === 502 || res.status === 503 || res.status === 504) {
        Alert.alert('Booking not placed yet', SERVER_BUSY_MESSAGE);
      } else if (res.status === 413) {
        Alert.alert('File too large', 'Attach a smaller file, or remove it and share it when the partner calls.');
      } else if (res.status === 401) {
        Alert.alert('Sign in again', 'Your session has expired. Sign in to finish the booking.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign in', onPress: () => { onClose(); router.push('/login' as any); } },
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

  // ── Small building blocks (plain functions or module components: an inner component type would
  // remount its TextInputs on every keystroke) ────────────────────────────────────────────────
  const fieldError = (id: string) => (errors[id] ? (
    <Text style={[st.error, { color: p.error }]} accessibilityLiveRegion="polite">{errors[id]}</Text>
  ) : null);

  const input = (invalid: boolean, multiline?: boolean) => [
    st.input, multiline && st.multiline, { backgroundColor: p.field, borderColor: invalid ? p.error : p.line, color: p.text },
  ];

  // ── Field renderers ───────────────────────────────────────────────────────────────────────
  const renderChoice = (f: ChoiceField) => {
    const picked = Array.isArray(answers[f.key]) ? (answers[f.key] as string[]) : answers[f.key] ? [String(answers[f.key])] : [];
    const options = f.options.filter((o) => !(o.hiddenIf && o.hiddenIf(ctx)));
    const toggle = (value: string) => {
      if (f.multiple) setAnswer(f.key, picked.includes(value) ? picked.filter((x) => x !== value) : [...picked, value]);
      else setAnswer(f.key, value);
    };
    const withText = options.find((o) => o.withText && picked.includes(o.value));
    const anyHint = options.some((o) => o.hint && o.hint(ctx));
    const longLabels = options.some((o) => o.label.length > 22);
    const mode = f.key === 'fabric' ? 'swatch'
      : family === 'tailoring' && MEASURE_KEYS.includes(f.key) ? 'fit'
        : f.multiple ? 'checks'
          : f.key === 'fileHandover' || longLabels || (anyHint && options.length > 2) ? 'radios'
            : anyHint ? 'cards' : 'chips';

    let body: React.ReactNode;
    if (mode === 'swatch') {
      body = (
        <View style={st.swatchRow} accessibilityRole="radiogroup">
          {options.map((o) => {
            const on = picked.includes(o.value);
            return (
              <PressScale key={o.value} onPress={() => toggle(o.value)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={o.label}
                style={[st.swatch, { borderColor: on ? p.accent : p.line, backgroundColor: on ? p.tint : p.card }]}>
                <View style={[st.swatchArt, { backgroundColor: on ? p.button : p.raised }]}>
                  <Ionicons name={fabricIcon(o.value)} size={24} color={on ? '#FFFFFF' : p.sub} />
                </View>
                <Text style={[st.swatchText, { color: on ? p.accent : p.text }]} numberOfLines={2}>{o.label}</Text>
              </PressScale>
            );
          })}
        </View>
      );
    } else if (mode === 'fit') {
      body = (
        <View style={st.fitRow} accessibilityRole="radiogroup">
          {options.map((o) => {
            const on = picked.includes(o.value);
            return (
              <PressScale key={o.value} onPress={() => toggle(o.value)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={o.label}
                style={[st.fit, { borderColor: on ? p.accent : p.line, backgroundColor: on ? p.tint : p.card }]}>
                <Ionicons name={fitIcon(o.value)} size={26} color={on ? p.accent : p.sub} />
                <Text style={[st.fitText, { color: on ? p.accent : p.text }]} numberOfLines={3}>{o.label}</Text>
                {on ? <View style={[st.fitBadge, { backgroundColor: p.button }]}><Ionicons name="checkmark" size={12} color="#FFFFFF" /></View> : null}
              </PressScale>
            );
          })}
        </View>
      );
    } else if (mode === 'checks' || mode === 'radios') {
      body = (
        <View accessibilityRole={mode === 'radios' ? 'radiogroup' : undefined}>
          {options.map((o, i) => {
            const on = picked.includes(o.value);
            const hint = o.hint ? o.hint(ctx) : null;
            return (
              <PressScale key={o.value} onPress={() => toggle(o.value)}
                accessibilityRole={mode === 'checks' ? 'checkbox' : 'radio'}
                accessibilityState={mode === 'checks' ? { checked: on } : { selected: on }}
                accessibilityLabel={hint ? `${o.label}, ${hint}` : o.label}
                style={[st.optRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }]}>
                {f.key === 'fileHandover' ? <Tile p={p} icon={handoverFileIcon(o.value)} color={on ? (p.isDark ? '#9CA3AF' : '#334155') : '#64748B'} size={36} /> : null}
                <Text style={[st.optText, { color: p.text }]}>{o.label}</Text>
                {hint ? <Text style={[st.optHint, { color: p.sub }]}>{hint}</Text> : null}
                {mode === 'checks' ? <Check p={p} on={on} /> : <Radio p={p} on={on} />}
              </PressScale>
            );
          })}
        </View>
      );
    } else if (mode === 'cards') {
      body = (
        <View style={st.cardsRow} accessibilityRole="radiogroup">
          {options.map((o) => {
            const on = picked.includes(o.value);
            const hint = o.hint ? o.hint(ctx) : null;
            return (
              <PressScale key={o.value} onPress={() => toggle(o.value)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={hint ? `${o.label}, ${hint}` : o.label}
                style={[st.optCard, { borderColor: on ? p.accent : p.line, backgroundColor: on ? p.tint : p.card }]}>
                <Text style={[st.optCardText, { color: on ? p.accent : p.text }]}>{o.label}</Text>
                {hint ? <Text style={[st.optHint, { color: on ? p.accent : p.sub, marginLeft: 0, marginTop: 2 }]}>{hint}</Text> : null}
              </PressScale>
            );
          })}
        </View>
      );
    } else {
      body = (
        <View style={st.chipRow} accessibilityRole="radiogroup">
          {options.map((o) => {
            const on = picked.includes(o.value);
            return (
              <PressScale key={o.value} onPress={() => toggle(o.value)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={o.label}
                style={[st.chip, { backgroundColor: on ? p.tint : p.field, borderColor: on ? p.accent : 'transparent' }]}>
                <Text style={[st.chipText, { color: on ? p.accent : p.text }]}>{o.label}</Text>
              </PressScale>
            );
          })}
        </View>
      );
    }

    const title = family === 'tailoring' && MEASURE_KEYS.includes(f.key) ? (f.key === 'lengthHow' ? 'Length' : 'Select fit type') : f.label;
    const helper = family === 'tailoring' && MEASURE_KEYS.includes(f.key) ? (f.key === 'lengthHow' ? f.label : 'How should the tailor take your size?') : (f.helper ?? (f.multiple ? 'Pick all that apply.' : undefined));
    return (
      <Section p={p} key={f.key} onLayout={at(f.key)} title={title} helper={helper} invalid={!!errors[f.key]}>
        {body}
        {fieldError(f.key)}
        {withText?.withText ? (
          <View style={{ marginTop: 12 }}>
            <Text style={[st.subLabel, { color: p.sub }]}>{withText.withText.label}</Text>
            <TextInput
              value={String(answers[textKey(f.key)] ?? '')}
              onChangeText={(v) => setAnswer(textKey(f.key), v)}
              placeholder={withText.withText.placeholder}
              placeholderTextColor={p.muted}
              multiline={!!withText.withText.multiline}
              maxLength={200}
              accessibilityLabel={withText.withText.label}
              style={input(!!errors[textKey(f.key)], !!withText.withText.multiline)}
            />
            {fieldError(textKey(f.key))}
          </View>
        ) : null}
      </Section>
    );
  };

  const renderText = (f: TextField) => (
    <Section p={p} key={f.key} onLayout={at(f.key)} title={f.label} helper={f.helper} invalid={!!errors[f.key]}>
      <TextInput
        value={String(answers[f.key] ?? '')}
        onChangeText={(v) => setAnswer(f.key, v)}
        placeholder={f.placeholder}
        placeholderTextColor={p.muted}
        multiline={!!f.multiline}
        maxLength={f.maxLength || 200}
        autoCapitalize={f.autoCapitalize || 'sentences'}
        accessibilityLabel={f.label}
        style={input(!!errors[f.key], !!f.multiline)}
      />
      {fieldError(f.key)}
    </Section>
  );

  const renderNumbers = (fields: NumberField[]) => (
    <Section p={p} key={`n-${fields[0].key}`} onLayout={(e) => fields.forEach((f) => { fieldY.current[f.key] = e.nativeEvent.layout.y; })}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {fields.map((f) => (
          <View key={f.key} style={{ flex: 1 }}>
            <Text style={[st.cardTitle, { color: p.text, marginBottom: 8 }]}>{f.label}</Text>
            <TextInput
              value={String(answers[f.key] ?? '')}
              onChangeText={(v) => setAnswer(f.key, v.replace(/[^0-9]/g, ''))}
              placeholder={f.placeholder}
              placeholderTextColor={p.muted}
              keyboardType="number-pad"
              maxLength={String(f.max).length}
              accessibilityLabel={f.label}
              style={input(!!errors[f.key])}
            />
            {f.helper ? <Text style={[st.helper, { color: p.sub, marginTop: 6 }]}>{f.helper}</Text> : null}
            {fieldError(f.key)}
          </View>
        ))}
      </View>
    </Section>
  );

  const renderCount = (f: CountField) => {
    const n = Math.min(f.max, Math.max(f.min, parseInt(String(answers[f.key] ?? f.min), 10) || f.min));
    const unit = f.unitLabel ? f.unitLabel(n) : '';
    const stepBy = (d: number) => setAnswer(f.key, Math.min(f.max, Math.max(f.min, n + d)));
    return (
      <Section p={p} key={f.key} onLayout={at(f.key)} title={f.label} helper={f.helper} invalid={!!errors[f.key]}>
        <View style={st.stepperRow}>
          <PressScale onPress={() => stepBy(-1)} disabled={n <= f.min} accessibilityRole="button" accessibilityLabel={`Decrease ${f.label.toLowerCase()}`}
            style={[st.stepBtn, { backgroundColor: p.field, opacity: n <= f.min ? 0.4 : 1 }]}>
            <Ionicons name="remove" size={20} color={p.text} />
          </PressScale>
          <Text style={[st.stepValue, { color: p.text }]} accessibilityLiveRegion="polite" accessibilityLabel={`${n} ${unit}`}>
            {n}{unit ? <Text style={{ color: p.sub, fontWeight: '600', fontSize: 14 }}> {unit}</Text> : null}
          </Text>
          <PressScale onPress={() => stepBy(1)} disabled={n >= f.max} accessibilityRole="button" accessibilityLabel={`Increase ${f.label.toLowerCase()}`}
            style={[st.stepBtn, { backgroundColor: p.tint, opacity: n >= f.max ? 0.4 : 1 }]}>
            <Ionicons name="add" size={20} color={p.accent} />
          </PressScale>
          {form.pricing.kind === 'perUnit' && f.key === form.pricing.key && cur ? (
            <Text style={[st.helper, { color: p.sub, flex: 1, textAlign: 'right' }]}>{formatRupees(cur.price)} × {n}</Text>
          ) : null}
        </View>
        {fieldError(f.key)}
      </Section>
    );
  };

  const renderFields = (fields: FormField[]) => {
    const blocks: React.ReactNode[] = [];
    let pendingNumbers: NumberField[] = [];
    const flush = () => {
      if (pendingNumbers.length) blocks.push(renderNumbers(pendingNumbers));
      pendingNumbers = [];
    };
    for (const f of fields) {
      if (!isFieldVisible(f, answers)) continue;
      if (f.kind === 'number') { pendingNumbers.push(f); continue; }
      flush();
      if (f.kind === 'choice') blocks.push(renderChoice(f));
      else if (f.kind === 'text') blocks.push(renderText(f));
      else if (f.kind === 'count') blocks.push(renderCount(f));
    }
    flush();
    return blocks;
  };

  // ── Steps ─────────────────────────────────────────────────────────────────────────────────
  const plan: Step[] = start?.kind === 'device' ? ['device', 'issue', 'details', 'booking'] : start?.kind === 'list' ? ['list', 'details', 'booking'] : ['details', 'booking'];
  const stepIndex = plan.indexOf(step);
  const listItems = start?.kind === 'list' ? start.itemIds.map((id) => catalogue.find((c) => c.id === id)).filter(Boolean) as BookableItem[] : [];

  const heading = (title: string, sub?: string) => (
    <View style={{ marginBottom: 16 }}>
      <Text style={[st.h1, { color: p.text }]} accessibilityRole="header">{title}</Text>
      {sub ? <Text style={[st.h1Sub, { color: p.sub }]}>{sub}</Text> : null}
    </View>
  );

  const renderDevice = () => {
    const diag = diagnosisItem(catalogue);
    const devices = DEVICES.filter((d) => repairIssues(d.kind, catalogue).length > 0 && (d.kind !== 'Other' || !!diag));
    return (
      <View>
        {heading("Select your device type", "We will show the repairs for it.")}
        {devices.map((d) => (
          <PressScale key={d.kind} onPress={() => { setDevice(d.kind); push('issue'); }}
            accessibilityRole="button" accessibilityLabel={`${d.title}, ${d.sub}`}
            style={[st.deviceCard, { backgroundColor: p.card }, p.shadow]}>
            <View style={[st.deviceArt, { backgroundColor: p.tint }]}>
              <Ionicons name={d.icon} size={40} color={p.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[st.deviceTitle, { color: p.text }]}>{d.title}</Text>
              <Text style={[st.rowSub, { color: p.sub }]}>{d.sub}</Text>
            </View>
            <View style={[st.chevCircle, { backgroundColor: p.raised }]}>
              <Ionicons name="chevron-forward" size={18} color={p.sub} />
            </View>
          </PressScale>
        ))}
        <View style={[st.trust, { backgroundColor: p.tint }]}>
          <Ionicons name="shield-checkmark-outline" size={20} color={p.accent} />
          <Text style={[st.trustText, { color: p.text }]}>The technician checks your device and confirms the price before any work. Pay after the repair.</Text>
        </View>
      </View>
    );
  };

  const renderIssue = () => {
    const issues = device ? repairIssues(device, catalogue) : [];
    const noun = device === 'Phone' ? 'phone' : device === 'Laptop' ? 'laptop' : 'device';
    return (
      <View>
        {heading(`What's the issue with your ${noun}?`, 'Pick the closest match. The technician checks everything on the visit.')}
        <View style={[st.listCard, { backgroundColor: p.card }, p.shadow]}>
          {issues.map((it, i) => {
            const price = servicePriceLabel(shelfId, it.item);
            const viaDiagnosis = it.locked.length > 0 || it.prefill.problems !== undefined;
            return (
              <PressScale key={it.id}
                onPress={() => { setIssue(it); chooseItem(it.item, it.prefill, it.locked); }}
                accessibilityRole="button"
                accessibilityLabel={`${it.title}, ${it.sub}. ${viaDiagnosis ? `Inspection ${price.main}` : price.main}`}
                style={[st.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }]}>
                <Tile p={p} icon={it.icon} />
                <View style={{ flex: 1 }}>
                  <Text style={[st.rowTitle, { color: p.text }]}>{it.title}</Text>
                  <Text style={[st.rowSub, { color: p.sub }]} numberOfLines={2}>{it.sub}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[st.rowPrice, { color: p.text }]}>{price.main.replace(/^From /, '')}</Text>
                  <Text style={[st.rowPriceNote, { color: p.sub }]}>{viaDiagnosis ? 'inspection' : 'starting'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={p.muted} />
              </PressScale>
            );
          })}
        </View>
        <Text style={[st.footnote, { color: p.sub }]}>
          Issues marked inspection start with a doorstep check. The technician quotes the repair and you approve it in the app before any work.
        </Text>
      </View>
    );
  };

  const renderList = () => {
    if (start?.kind !== 'list') return null;
    // Group by store when the list spans more than one partner (laundry).
    const stores = Array.from(new Set(listItems.map((i) => i.storeName || '')));
    const groups = stores.length > 1 ? stores.map((s) => ({ store: s, items: listItems.filter((i) => (i.storeName || '') === s) })) : [{ store: '', items: listItems }];
    return (
      <View>
        {heading(start.title, start.subtitle || 'Choose a service to continue.')}
        {groups.map((g) => (
          <View key={g.store || 'all'} style={{ marginBottom: 14 }}>
            {g.store ? <Text style={[st.groupLabel, { color: p.sub }]}>{g.store}</Text> : null}
            <View style={[st.listCard, { backgroundColor: p.card }, p.shadow]}>
              {g.items.map((it, i) => {
                const ic = itemIcon(shelfId, it.name);
                const price = servicePriceLabel(shelfId, it);
                const paused = it.inStock === false;
                return (
                  <PressScale key={it.id} disabled={paused} onPress={() => chooseItem(it)}
                    accessibilityRole="button" accessibilityState={{ disabled: paused }}
                    accessibilityLabel={`${it.name}, ${price.main}${price.note ? ` ${price.note}` : ''}${paused ? ', paused' : ''}`}
                    style={[st.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }, paused && { opacity: 0.5 }]}>
                    <Tile p={p} icon={ic.icon} />
                    <View style={{ flex: 1 }}>
                      <Text style={[st.rowTitle, { color: p.text }]} numberOfLines={2}>{it.name}</Text>
                      {it.desc ? <Text style={[st.rowSub, { color: p.sub }]} numberOfLines={2} ellipsizeMode="tail">{it.desc}</Text> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[st.rowPrice, { color: p.text }]}>{paused ? 'Paused' : price.main}</Text>
                      {!paused && price.note ? <Text style={[st.rowPriceNote, { color: p.sub }]}>{price.note}</Text> : null}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={p.muted} />
                  </PressScale>
                );
              })}
            </View>
          </View>
        ))}
      </View>
    );
  };

  const priceInfo = cur ? servicePriceLabel(shelfId, cur) : { main: '', note: null };

  const serviceSummary = (compact?: boolean) => {
    if (!cur) return null;
    const ic = issue ? { icon: issue.icon, color: issue.color } : itemIcon(shelfId, cur.name);
    const deviceLabel = device === 'Phone' ? 'Mobile phone' : device === 'Laptop' ? 'Laptop' : device === 'Other' ? 'Tablet or other device' : null;
    const issueViaInspection = !!issue && (issue.locked.length > 0 || issue.prefill.problems !== undefined);
    const kicker = family === 'repairs' ? [deviceLabel, issueViaInspection ? issue?.title : null].filter(Boolean).join(' · ') : (cur.storeName || shelfTitle);
    const canChange = stack.length > 1 && (step === 'details' ? stack.length >= 2 : true);
    if (!compact && family !== 'repairs' && cur.image) {
      return (
        <View style={[st.card, { backgroundColor: p.card, padding: 0, overflow: 'hidden' }, p.shadow]}>
          <SafeImage source={{ uri: cur.image }} style={st.heroImg} maxWidth={800} placeholderIcon={ic.icon} />
          <View style={{ padding: 16 }}>
            <Text style={[st.kicker, { color: p.accent }]}>{kicker}</Text>
            <Text style={[st.h2, { color: p.text }]}>{cur.name}</Text>
            {cur.desc ? <Text style={[st.rowSub, { color: p.sub, marginTop: 4 }]}>{cur.desc}</Text> : null}
            <View style={st.priceLine}>
              <Text style={[st.bigPrice, { color: p.text }]}>{priceInfo.main}</Text>
              {priceInfo.note ? <Text style={[st.rowSub, { color: p.sub }]}> {priceInfo.note}</Text> : null}
              <View style={{ flex: 1 }} />
              <View style={[st.pill, { backgroundColor: p.tint }]}><Text style={[st.pillText, { color: p.accent }]}>{form.priceLabel}</Text></View>
            </View>
          </View>
        </View>
      );
    }
    return (
      <View style={[st.card, st.summaryRow, { backgroundColor: p.card }, p.shadow]}>
        {family === 'repairs' && device ? (
          <View style={[st.summaryArt, { backgroundColor: p.tint }]}>
            <Ionicons name={device === 'Phone' ? 'phone-portrait-outline' : device === 'Laptop' ? 'laptop-outline' : 'tablet-portrait-outline'} size={30} color={p.accent} />
          </View>
        ) : <Tile p={p} icon={ic.icon} size={56} />}
        <View style={{ flex: 1 }}>
          {kicker ? <Text style={[st.kicker, { color: p.accent }]} numberOfLines={2}>{kicker}</Text> : null}
          <Text style={[st.rowTitle, { color: p.text, fontSize: 16 }]} numberOfLines={2}>{cur.name}</Text>
          <Text style={[st.rowSub, { color: p.sub }]}>
            {compact && amount > 0 ? `${form.pricing.kind === 'fixed' && form.priceLabel === 'Starting price' ? 'From ' : ''}${formatRupees(amount)}${form.pricing.kind !== 'fixed' ? ' estimate' : ''}` : `${priceInfo.main}${priceInfo.note ? ` ${priceInfo.note}` : ''}`}
          </Text>
        </View>
        {canChange ? (
          <PressScale onPress={back} accessibilityRole="button" accessibilityLabel={step === 'booking' ? 'Edit details' : 'Change service'} style={st.textBtn}>
            <Text style={{ color: p.accent, fontWeight: '700', fontSize: 14 }}>{step === 'booking' ? 'Edit' : 'Change'}</Text>
          </PressScale>
        ) : null}
      </View>
    );
  };

  const renderUploads = () => (
    <>
      {form.document && pdfShown ? (
        <Section p={p} title={form.document.label} helper={form.document.helper} invalid={!!errors.fileHandover && !pdf}>
          {pdf ? (
            <View style={[st.fileRow, { backgroundColor: p.raised }]}>
              <View style={[st.thumb, st.docThumb, { backgroundColor: p.tint }]}>
                <Ionicons name="document-text-outline" size={24} color={p.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[st.fileName, { color: p.text }]} numberOfLines={1}>{pdf.name}</Text>
                {pdf.status === 'uploading' ? (
                  <View accessibilityLiveRegion="polite" accessibilityLabel={`Uploading, ${Math.round(pdf.progress * 100)} percent`}>
                    <Text style={[st.helper, { color: p.sub }]}>{`Uploading${pdf.progress > 0 ? ` ${Math.round(pdf.progress * 100)}%` : '…'}`}</Text>
                    <View style={[st.progressTrack, { backgroundColor: p.line }]}>
                      <View style={[st.progressFill, { backgroundColor: p.accent, width: `${Math.max(4, Math.round(pdf.progress * 100))}%` }]} />
                    </View>
                  </View>
                ) : pdf.status === 'failed' ? (
                  <Text style={[st.helper, { color: p.error }]} accessibilityLiveRegion="polite">{pdf.error || "The PDF didn't upload."}</Text>
                ) : (
                  <Text style={[st.helper, { color: p.sub }]}>{pdf.size ? `${pdf.size}, attached` : 'Attached'}</Text>
                )}
              </View>
              {pdf.status === 'failed' && pdf.uri ? (
                <PressScale onPress={() => startPdfUpload({ name: pdf.name, uri: pdf.uri!, size: pdf.size })} accessibilityRole="button" accessibilityLabel="Retry the PDF upload" style={st.textBtn}>
                  <Text style={{ color: p.accent, fontWeight: '700', fontSize: 14 }}>Retry</Text>
                </PressScale>
              ) : null}
              <PressScale onPress={removePdf} accessibilityRole="button" accessibilityLabel="Remove PDF" style={st.textBtn}>
                <Text style={{ color: p.error, fontWeight: '700', fontSize: 14 }}>Remove</Text>
              </PressScale>
            </View>
          ) : (
            <PressScale onPress={pickPdf} accessibilityRole="button" accessibilityLabel="Choose a PDF file"
              style={[st.dropZone, { borderColor: errors.fileHandover ? p.error : p.accent, backgroundColor: p.tint }]}>
              <Ionicons name="cloud-upload-outline" size={24} color={p.accent} />
              <Text style={{ color: p.accent, fontWeight: '700', fontSize: 14, marginTop: 4 }}>Choose a PDF</Text>
              <Text style={[st.helper, { color: p.sub }]}>PDF, up to 5 MB</Text>
            </PressScale>
          )}
        </Section>
      ) : null}
      {form.photo && photoShown ? (
        <Section p={p} title={form.photo.label} helper={form.photo.helper}>
          {photo ? (
            <View style={[st.fileRow, { backgroundColor: p.raised }]}>
              <Image source={{ uri: photo.uri }} style={st.thumb} accessibilityIgnoresInvertColors />
              <View style={{ flex: 1 }}>
                <Text style={[st.fileName, { color: p.text }]} numberOfLines={1}>{photo.name}</Text>
                <Text style={[st.helper, { color: p.sub }]}>{photo.size ? `${photo.size}, attached` : 'Attached'}</Text>
              </View>
              <PressScale onPress={() => setPhoto(null)} accessibilityRole="button" accessibilityLabel="Remove photo" style={st.textBtn}>
                <Text style={{ color: p.error, fontWeight: '700', fontSize: 14 }}>Remove</Text>
              </PressScale>
            </View>
          ) : (
            <PressScale onPress={pickPhoto} accessibilityRole="button"
              accessibilityLabel={`Add ${form.photo.label.replace(/ \(optional\)$/, '').toLowerCase()}`}
              style={[st.dropZone, { borderColor: p.accent, backgroundColor: p.tint }]}>
              <Ionicons name="camera-outline" size={24} color={p.accent} />
              <Text style={{ color: p.accent, fontWeight: '700', fontSize: 14, marginTop: 4 }}>Add a photo</Text>
              <Text style={[st.helper, { color: p.sub }]}>JPG or PNG, up to 5 MB</Text>
            </PressScale>
          )}
        </Section>
      ) : null}
    </>
  );

  const renderDetails = () => (
    <View>
      {serviceSummary()}
      <View style={[st.how, { backgroundColor: p.tint }]}>
        <Ionicons name="information-circle-outline" size={18} color={p.accent} />
        <Text style={[st.howText, { color: p.text }]}>{form.howItWorks}</Text>
      </View>
      {renderFields(detailFields)}
      {renderUploads()}
    </View>
  );

  const renderBooking = () => (
    <View>
      {serviceSummary(true)}
      {renderFields(bookingFields)}

      <Section p={p} title={handover.label}>
        <View style={st.handoverRow} accessibilityRole="radiogroup">
          {handover.options.map((o) => {
            const on = handoverValue === o.value;
            return (
              <PressScale key={o.value} onPress={() => setHandoverValue(o.value)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={o.label}
                style={[st.handover, { borderColor: on ? p.accent : p.line, backgroundColor: on ? p.tint : p.card }]}>
                <Ionicons name={o.icon} size={18} color={on ? p.accent : p.sub} />
                <Text style={[st.handoverText, { color: on ? p.accent : p.text }]} numberOfLines={2}>{o.label}</Text>
              </PressScale>
            );
          })}
        </View>
      </Section>

      <Section p={p} title={family === 'print' ? 'Delivery date and time' : family === 'repairs' ? 'Select date and time' : 'Preferred date and time'} helper={form.slot.helper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }} accessibilityRole="radiogroup">
          {days.map((d) => {
            const on = day?.key === d.key;
            return (
              <PressScale key={d.key} onPress={() => { setDayKey(d.key); setTimeKey(''); }} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${d.top}, ${d.long}`}
                style={[st.dayChip, { borderColor: on ? p.button : p.line, backgroundColor: on ? p.button : p.card }]}>
                <Text style={[st.dayTop, { color: on ? '#FFFFFF' : p.text }]}>{d.top}</Text>
                <Text style={[st.dayBottom, { color: on ? 'rgba(255,255,255,0.85)' : p.sub }]}>{d.bottom}</Text>
              </PressScale>
            );
          })}
        </ScrollView>
        <Text style={[st.subLabel, { color: p.sub, marginTop: 16 }]}>Time slot</Text>
        <View style={st.timeGrid} accessibilityRole="radiogroup">
          {times.map((t) => {
            const on = time?.key === t.key;
            return (
              <PressScale key={t.key} onPress={() => setTimeKey(t.key)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={t.label}
                style={[st.timeChip, { borderColor: on ? p.accent : p.line, backgroundColor: on ? p.tint : p.card }]}>
                <Text style={[st.timeText, { color: on ? p.accent : p.text }]}>{t.label}</Text>
              </PressScale>
            );
          })}
        </View>
      </Section>

      <Section p={p} onLayout={(e) => { const y = e.nativeEvent.layout.y; fieldY.current.hostelBlock = y; fieldY.current.roomNumber = y; fieldY.current.contactPhone = y; }} title={form.whereLabel} invalid={!!(errors.hostelBlock || errors.roomNumber || errors.contactPhone)}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={[st.subLabel, { color: p.sub }]}>Hostel block</Text>
            <TextInput value={hostelBlock} onChangeText={setHostelBlock} placeholder="e.g. Ganga" placeholderTextColor={p.muted} maxLength={60} autoCapitalize="words" accessibilityLabel="Hostel block" style={input(!!errors.hostelBlock)} />
            {fieldError('hostelBlock')}
          </View>
          <View style={{ width: 120 }}>
            <Text style={[st.subLabel, { color: p.sub }]}>Room number</Text>
            <TextInput value={roomNumber} onChangeText={setRoomNumber} placeholder="e.g. 412" placeholderTextColor={p.muted} maxLength={12} accessibilityLabel="Room number" style={input(!!errors.roomNumber)} />
            {fieldError('roomNumber')}
          </View>
        </View>
        <Text style={[st.subLabel, { color: p.sub, marginTop: 12 }]}>Mobile number</Text>
        <TextInput value={contactPhone} onChangeText={(v) => setContactPhone(v.replace(/[^0-9+]/g, ''))} placeholder="10-digit mobile number" placeholderTextColor={p.muted} keyboardType="phone-pad" maxLength={13} accessibilityLabel="Mobile number" style={input(!!errors.contactPhone)} />
        {errors.contactPhone ? fieldError('contactPhone') : (
          <Text style={[st.helper, { color: p.sub, marginTop: 6 }]}>The {PARTNER_NOUN[family]} calls this number before the {form.visitNoun}.</Text>
        )}
      </Section>

      <Section p={p} title={family === 'tailoring' ? 'Any special instructions? (optional)' : family === 'repairs' ? 'Additional details (optional)' : form.notes.label}>
        <TextInput value={notes} onChangeText={setNotes} placeholder={form.notes.placeholder} placeholderTextColor={p.muted} maxLength={300} multiline accessibilityLabel={form.notes.label} style={input(false, true)} />
      </Section>

      <View style={[st.card, { backgroundColor: p.card }, p.shadow]}>
        <View style={st.estimateRow}>
          <View style={[st.estimateIcon, { backgroundColor: p.tint }]}><Ionicons name="receipt-outline" size={18} color={p.accent} /></View>
          <View style={{ flex: 1 }}>
            <Text style={[st.rowSub, { color: p.sub }]}>{form.priceLabel}</Text>
            <Text style={[st.bigPrice, { color: p.text }]}>{amount > 0 ? formatRupees(amount) : 'On quote'}</Text>
          </View>
          <View style={[st.pill, { backgroundColor: p.raised }]}><Text style={[st.pillText, { color: p.sub }]}>{family === 'repairs' ? 'Cash after the job' : 'Cash on delivery'}</Text></View>
        </View>
        <Text style={[st.helper, { color: p.sub, marginTop: 10 }]}>
          {family === 'repairs'
            ? (form.priceLabel === 'Inspection charge'
              ? 'This is the doorstep inspection charge. The technician checks the device, then sends the repair quote in the app. You approve the quote before any work; if you decline, the booking is cancelled.'
              : 'The technician checks the device and confirms the final price and repair time in the app. You approve the quote before any work. If you decline it, the booking is cancelled and you pay nothing.')
            : `The ${PARTNER_NOUN[family]} confirms the final price before starting. Pay in cash when the job is done.`}
        </Text>
      </View>

      {form.notice ? (
        <View style={[st.notice, { backgroundColor: p.warnBg }]}>
          <Ionicons name="alert-circle-outline" size={18} color={p.warn} />
          <Text style={[st.howText, { color: p.text }]}>{form.notice}</Text>
        </View>
      ) : null}
    </View>
  );

  const renderSuccess = () => {
    if (!result) return null;
    const b = result.booking || {};
    const serverAmount = Number(b.quotedAmount);
    const details: BookingDetail[] = Array.isArray(b?.specifications?.details) ? b.specifications.details : result.details || [];
    const val = (k: string) => details.find((d) => d.key === k)?.value || '';
    const thing = family === 'repairs'
      ? [val('device'), val('brandModel')].filter(Boolean).join(' · ')
      : family === 'tailoring' ? [val('garment'), result.qtyLine].filter(Boolean).join(' · ')
        : result.qtyLine || val('pageCount') ? (result.qtyLine || `${val('pageCount')} pages`) : '';
    const rows: [string, string][] = [
      ['Booking ID', `#${shortBookingRef(b.id)}`],
      ['Service', String(b.title || cur?.name || '')],
      ...(thing ? [[family === 'repairs' ? 'Device' : family === 'tailoring' ? 'Garment' : 'Quantity', thing] as [string, string]] : []),
      [handover.label.replace(/^Preferred /, '').replace(/^p/, 'P'), result.handover],
      ['Date and time', String(b.pickupSlot || result.slot)],
      ['Address', result.where],
      ['Estimate', Number.isFinite(serverAmount) && serverAmount > 0 ? formatRupees(serverAmount) : 'Partner will quote'],
      ['Payment', 'Cash when the job is done'],
    ];
    const id = String(b.id || '');
    return (
      <View style={{ alignItems: 'stretch' }}>
        <View style={{ alignItems: 'center', marginTop: 8, marginBottom: 20 }}>
          <View style={[st.successHalo, { backgroundColor: p.tint }]}>
            <View style={[st.successDot, { backgroundColor: p.button }]}>
              <Ionicons name="checkmark" size={40} color="#FFFFFF" />
            </View>
          </View>
          <Text style={[st.h1, { color: p.text, textAlign: 'center', marginTop: 18 }]} accessibilityRole="header">{SUCCESS_TITLE[family]}</Text>
          <Text style={[st.h1Sub, { color: p.sub, textAlign: 'center', maxWidth: 320 }]}>
            The {PARTNER_NOUN[family]} will call you on {result.phone} to confirm the time and the final price.
          </Text>
        </View>
        <View style={[st.card, { backgroundColor: p.card, paddingVertical: 6 }, p.shadow]}>
          {rows.map(([k, v], i) => (
            <View key={k} style={[st.kv, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }]}>
              <Text style={[st.kvKey, { color: p.sub }]}>{k}</Text>
              <Text style={[st.kvVal, { color: k === 'Booking ID' ? p.accent : p.text }]} numberOfLines={2}>{v}</Text>
            </View>
          ))}
        </View>
        <PressScale accessibilityRole="button" accessibilityLabel="Track booking"
          onPress={() => { onClose(); if (id) router.push(`/service-booking/${id}` as any); }}
          style={[st.cta, { backgroundColor: p.button, marginTop: 8 }]}>
          <Ionicons name="navigate-outline" size={18} color="#FFFFFF" />
          <Text style={st.ctaText}>Track booking</Text>
        </PressScale>
        <PressScale accessibilityRole="button" accessibilityLabel="View my orders"
          onPress={() => { onClose(); router.push({ pathname: '/(tabs)/orders', params: { segment: 'services', bookingId: id } } as any); }}
          style={[st.cta, st.ctaOutline, { borderColor: p.accent, marginTop: 10 }]}>
          <Text style={[st.ctaText, { color: p.accent }]}>View my orders</Text>
        </PressScale>
        <PressScale accessibilityRole="button" accessibilityLabel="Back to home"
          onPress={() => { onClose(); router.navigate('/(tabs)' as any); }} style={[st.textBtn, { alignSelf: 'center', marginTop: 6 }]}>
          <Text style={{ color: p.sub, fontWeight: '700', fontSize: 14 }}>Back to home</Text>
        </PressScale>
      </View>
    );
  };

  // ── Header / footer ───────────────────────────────────────────────────────────────────────
  const headerTitle = step === 'success' ? '' : family === 'repairs'
    ? (device === 'Phone' ? 'Phone repair' : device === 'Laptop' ? 'Laptop repair' : device === 'Other' ? 'Device repair' : 'Laptop & phone repair')
    : step === 'list' ? shelfTitle : step === 'details' ? DETAILS_TITLE[family]
      : family === 'tailoring' && !takesMeasurements ? 'Pickup & booking' : BOOKING_TITLE[family];

  const errorCount = step === 'details' ? (tried.details ? Object.keys(detailErrors).length : 0) : step === 'booking' ? (tried.booking ? Object.keys(bookingErrors).length : 0) : 0;
  const ctaLabel = step === 'details' ? (takesMeasurements ? 'Proceed to measurement' : 'Continue') : 'Confirm booking';
  // Print before the page count is typed: show the page rate, not a 1-page total.
  const printNoPages = form.pricing.kind === 'print' && !String(answers.pageCount ?? '').trim() && (answers.bindingType || 'none') === 'none' && String(answers.copies ?? '1') === '1';
  const footerPrice = printNoPages && amount > 0
    ? `${formatRupees(amount)} / page`
    : amount > 0
      ? `${form.pricing.kind === 'fixed' && form.priceLabel === 'Starting price' ? 'From ' : ''}${formatRupees(amount)}`
      : 'On quote';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={back}>
      <View style={[st.screen, { backgroundColor: p.page }]}>
        <View style={[st.header, { paddingTop: Math.max(insets.top, 12) + 4, backgroundColor: p.page }]}>
          <PressScale onPress={back} style={st.iconBtn} accessibilityRole="button"
            accessibilityLabel={step === 'success' ? 'Close' : 'Back'}>
            <Ionicons name={step === 'success' ? 'close' : 'arrow-back'} size={24} color={p.text} />
          </PressScale>
          <Text style={[st.headerTitle, { color: p.text }]} numberOfLines={1}>{headerTitle}</Text>
          {stepIndex >= 0 && step !== 'success' ? (
            <Text style={[st.stepCount, { color: p.sub }]}>{`Step ${stepIndex + 1} of ${plan.length}`}</Text>
          ) : <View style={{ width: 44 }} />}
        </View>
        {stepIndex >= 0 && step !== 'success' ? (
          <ProgressBar progress={(stepIndex + 1) / plan.length} color={p.accent} track={p.line} style={{ marginHorizontal: 16 }} />
        ) : null}

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
            contentContainerStyle={[st.body, { paddingBottom: (step === 'details' || step === 'booking' ? 24 : 32) + (step === 'success' ? insets.bottom : 0) }]}>
            <SlideIn stepKey={step} direction={stepDir}>
              {step === 'device' && renderDevice()}
              {step === 'issue' && renderIssue()}
              {step === 'list' && renderList()}
              {step === 'details' && renderDetails()}
              {step === 'booking' && renderBooking()}
              {step === 'success' && renderSuccess()}
            </SlideIn>
          </ScrollView>

          {step === 'details' || step === 'booking' ? (
            <View style={[st.footer, { backgroundColor: p.card, borderTopColor: p.line, paddingBottom: Math.max(insets.bottom, 12) }]}>
              {errorCount > 0 ? (
                <Text style={[st.error, { color: p.error, textAlign: 'center', marginTop: 0, marginBottom: 8 }]} accessibilityLiveRegion="polite">
                  {errorCount === 1 ? 'Fix the highlighted field to continue.' : `Fix the ${errorCount} highlighted fields to continue.`}
                </Text>
              ) : null}
              <View style={st.footerRow}>
                <View style={{ marginRight: 14 }}>
                  <Text style={[st.footerLabel, { color: p.sub }]}>{form.pricing.kind === 'fixed' && form.priceLabel === 'Starting price' ? 'Price' : form.priceLabel}</Text>
                  <Text style={[st.footerPrice, { color: p.text }]}>{footerPrice}</Text>
                </View>
                <PressScale
                  onPress={step === 'details' ? continueFromDetails : submit}
                  disabled={submitting}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: submitting, busy: submitting }}
                  accessibilityLabel={step === 'booking' ? `Confirm booking, ${footerPrice}` : ctaLabel}
                  style={[st.cta, { flex: 1, backgroundColor: p.button, opacity: submitting ? 0.8 : 1 }]}
                >
                  {submitting ? <ActivityIndicator color="#FFFFFF" size="small" /> : (
                    <>
                      <Text style={st.ctaText}>{ctaLabel}</Text>
                      <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                    </>
                  )}
                </PressScale>
              </View>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ── Module-level pieces (stable component types) ────────────────────────────────────────────

function Section({ p, title, helper, children, invalid, onLayout }: { p: ServicePalette; title?: string; helper?: string; children?: React.ReactNode; invalid?: boolean; onLayout?: (e: LayoutChangeEvent) => void }) {
  return (
    <View onLayout={onLayout} style={[st.card, { backgroundColor: p.card }, p.shadow, invalid && { borderWidth: 1, borderColor: p.error }]}>
      {title ? <Text style={[st.cardTitle, { color: p.text }]}>{title}</Text> : null}
      {helper ? <Text style={[st.helper, { color: p.sub, marginBottom: 2 }]}>{helper}</Text> : null}
      <View style={title || helper ? { marginTop: 12 } : undefined}>{children}</View>
    </View>
  );
}

function Radio({ p, on }: { p: ServicePalette; on: boolean }) {
  return <View style={[st.radio, { borderColor: on ? p.accent : p.line }]}>{on ? <View style={[st.radioDot, { backgroundColor: p.accent }]} /> : null}</View>;
}

function Check({ p, on }: { p: ServicePalette; on: boolean }) {
  return (
    <View style={[st.check, { borderColor: on ? p.button : p.line, backgroundColor: on ? p.button : 'transparent' }]}>
      {on ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
    </View>
  );
}

/** Icon tile. Without `color` it wears the section accent (catalogue rows: one calm colour per section
 * instead of a different colour for every service). */
export function Tile({ p, icon, color, size = 44 }: { p: ServicePalette; icon: IconName; color?: string; size?: number }) {
  const bg = color ? hexAlpha(color, p.isDark ? 0.2 : 0.11) : p.tint;
  const ink = color ? (p.isDark ? lighten(color) : color) : p.accent;
  return (
    <View style={[st.tile, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: bg }]}>
      <Ionicons name={icon} size={size * 0.5} color={ink} />
    </View>
  );
}

/** Lighter tone of an icon colour for dark surfaces. */
const lighten = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.35);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
};

const st = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 10, gap: 4 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  stepCount: { fontSize: 12, fontWeight: '600', minWidth: 44, textAlign: 'right', paddingRight: 10 },
  progress: { height: 3, marginHorizontal: 16, borderRadius: 2, overflow: 'hidden' },
  progressBar: { height: 3, borderRadius: 2 },
  body: { padding: 16, paddingTop: 18, width: '100%', maxWidth: 640, alignSelf: 'center' },
  h1: { fontSize: 22, fontWeight: '800', lineHeight: 28, letterSpacing: -0.2 },
  h1Sub: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  h2: { fontSize: 19, fontWeight: '800', lineHeight: 24, marginTop: 2 },
  kicker: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  card: { borderRadius: 18, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  helper: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  subLabel: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  error: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  // device / issue / list
  deviceCard: { flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 20, padding: 16, marginBottom: 12, minHeight: 112 },
  deviceArt: { width: 80, height: 80, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  deviceTitle: { fontSize: 17, fontWeight: '800' },
  chevCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  trust: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, padding: 14, marginTop: 8 },
  trustText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  listCard: { borderRadius: 18, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, minHeight: 72 },
  tile: { alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  rowSub: { fontSize: 13, lineHeight: 18, marginTop: 1 },
  rowPrice: { fontSize: 14, fontWeight: '800' },
  rowPriceNote: { fontSize: 11, fontWeight: '600', marginTop: 1 },
  groupLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8, marginLeft: 4 },
  footnote: { fontSize: 12, lineHeight: 17, marginTop: 12, marginHorizontal: 4 },
  // summary
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  summaryArt: { width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  heroImg: { width: '100%', height: 180 },
  priceLine: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  bigPrice: { fontSize: 20, fontWeight: '800' },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: '700' },
  textBtn: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  how: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 14, padding: 12, marginBottom: 12 },
  howText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 14, padding: 12, marginBottom: 12 },
  // options
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, borderWidth: 1.5, justifyContent: 'center' },
  chipText: { fontSize: 14, fontWeight: '600' },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 8 },
  optText: { flex: 1, fontSize: 15, fontWeight: '500' },
  optHint: { fontSize: 12, fontWeight: '600', marginLeft: 6 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  cardsRow: { flexDirection: 'row', gap: 10 },
  optCard: { flex: 1, minHeight: 64, borderRadius: 14, borderWidth: 1.5, padding: 12, justifyContent: 'center' },
  optCardText: { fontSize: 15, fontWeight: '700' },
  swatchRow: { flexDirection: 'row', gap: 10 },
  swatch: { flex: 1, borderRadius: 14, borderWidth: 1.5, padding: 10, alignItems: 'center', minHeight: 112 },
  swatchArt: { width: '100%', height: 56, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  swatchText: { fontSize: 12, fontWeight: '700', textAlign: 'center', lineHeight: 16 },
  fitRow: { flexDirection: 'row', gap: 10 },
  fit: { flex: 1, borderRadius: 14, borderWidth: 1.5, paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center', minHeight: 116, gap: 8 },
  fitText: { fontSize: 12, fontWeight: '700', textAlign: 'center', lineHeight: 16 },
  fitBadge: { position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepValue: { fontSize: 20, fontWeight: '800', minWidth: 36, textAlign: 'center' },
  // files
  dropZone: { minHeight: 96, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 10 },
  thumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: '#00000010' },
  docThumb: { alignItems: 'center', justifyContent: 'center' },
  fileName: { fontSize: 14, fontWeight: '600' },
  progressTrack: { height: 4, borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  // booking
  handoverRow: { flexDirection: 'row', gap: 10 },
  handover: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 12 },
  handoverText: { flex: 1, fontSize: 14, fontWeight: '700' },
  dayChip: { minWidth: 88, minHeight: 60, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 14 },
  dayTop: { fontSize: 14, fontWeight: '800' },
  dayBottom: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  timeChip: { width: '48.5%', minHeight: 46, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  timeText: { fontSize: 14, fontWeight: '700' },
  estimateRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  estimateIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  // success
  successHalo: { width: 132, height: 132, borderRadius: 66, alignItems: 'center', justifyContent: 'center' },
  successDot: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  kv: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, gap: 12 },
  kvKey: { width: 112, fontSize: 13, fontWeight: '600' },
  kvVal: { flex: 1, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  // footer
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 12 },
  footerRow: { flexDirection: 'row', alignItems: 'center', width: '100%', maxWidth: 640, alignSelf: 'center' },
  footerLabel: { fontSize: 12, fontWeight: '600' },
  footerPrice: { fontSize: 18, fontWeight: '800' },
  cta: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, flexDirection: 'row', gap: 8 },
  ctaOutline: { backgroundColor: 'transparent', borderWidth: 1.5 },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
