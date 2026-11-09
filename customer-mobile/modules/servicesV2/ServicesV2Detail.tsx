/**
 * Tech & repairs v2 · service details (board "Service Details"): the catalogue photo, title, the real price with
 * its caption from the booking form ("Starting price", "Inspection charge", "Estimate"), what happens after booking,
 * the description, three trust points from the current flow, then the device / brand / model the booking form asks
 * for (repairs only), other services from the same partner, and a sticky price + "Book now".
 * Book opens the existing ServiceBookingSheet at this service with the brand, model and device filled in; the
 * server prices the booking. No add-ons: the price list has none (one booking books one catalogue service).
 * Route: app/services/[shelf]/[id].tsx.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatINR } from '../../utils/format';
import { resolveServiceForm, type Answers, type ChoiceField } from '../services/serviceForms';
import { deviceOfForm } from '../services/serviceFlow';
import { TV, RADIUS, W, shadow } from './servicesV2Theme';
import { BarIcon, FadeIn, Press, SkeletonRows, StateBlock, TopBar } from './ServicesV2Kit';
import { ItemPhoto, Thumb } from './ServicesV2Rows';
import { ICash, IChevronRight, IClipboard, IHouse, IInfo, IReceipt, IRuler, IStore, ITag } from './ServicesV2Icons';
import { SHELF_META, SHELF_TRUST, detailPath, priceLine, useShelf, type ServiceShelf, type TrustIcon } from './servicesV2Data';
import { useServicesV2Booking } from './useServicesV2Booking';
import { openMyBookings } from './ServicesV2List';
import { themedSheet } from '../../utils/themeNow';

const TRUST_ICON: Record<TrustIcon, React.ComponentType<any>> = { house: IHouse, tag: ITag, cash: ICash, ruler: IRuler, clipboard: IClipboard };

/** Brand chips: the brands the catalogue descriptions name, plus Other (the model is typed). */
const LAPTOP_BRANDS = ['Lenovo', 'HP', 'Dell', 'Asus', 'Acer', 'Apple', 'Other'];
const PHONE_BRANDS = ['Samsung', 'Apple', 'OnePlus', 'Redmi', 'Vivo', 'Oppo', 'Realme', 'Other'];

function Chips({ items, value, onPick, label }: { items: { value: string; label: string }[]; value: string; onPick: (v: string) => void; label: string }) {
  return (
    <View style={d.chips} accessibilityLabel={label}>
      {items.map((o) => {
        const on = o.value === value;
        return (
          <Press key={o.value} onPress={() => onPick(on ? '' : o.value)} label={on ? `${o.label}, selected` : o.label} style={[d.chip, on ? d.chipOn : null]} scaleTo={0.95}>
            <Text style={[d.chipText, on ? { color: '#FFFFFF', fontWeight: W.title } : null]} numberOfLines={1}>{o.label}</Text>
          </Press>
        );
      })}
    </View>
  );
}

export default function ServicesV2Detail({ shelf, id }: { shelf: ServiceShelf; id: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { items, status, retry, reload } = useShelf(shelf);
  const { book, sheet } = useServicesV2Booking(shelf, items, () => reload('silent'));
  const item = items.find((i) => i.id === id) || null;
  const form = useMemo(() => resolveServiceForm(shelf, item?.name || ''), [shelf, item?.name]);
  const fixedDevice = deviceOfForm(form);
  const deviceField = form.fields.find((f) => f.key === 'device' && f.kind === 'choice') as ChoiceField | undefined;
  const asksBrand = form.fields.some((f) => f.key === 'brandModel');

  const [device, setDevice] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const dev = fixedDevice || device;
  const brands = dev === 'Laptop' ? LAPTOP_BRANDS : dev === 'Phone' ? PHONE_BRANDS : [];

  const others = useMemo(() => items.filter((i) => i.id !== id && i.inStock && (!item || i.storeId === item.storeId)).slice(0, 3), [items, id, item]);

  if (!item) {
    return (
      <View style={{ flex: 1, backgroundColor: TV.page }}>
        <TopBar title="Service details" />
        <View style={{ paddingTop: 16 }}>
          {status === 'loading' ? <SkeletonRows count={2} /> : status !== 'ready' ? (
            <StateBlock kind={status === 'offline' ? 'offline' : status === 'waking' ? 'waking' : 'error'} action="Try again" onAction={retry} />
          ) : (
            <StateBlock kind="empty" title="This service is not listed any more" body="It may have been removed by the partner. See the other services instead." action={`Open ${SHELF_META[shelf].tile}`} onAction={() => router.replace(`/category/${shelf}` as any)} />
          )}
        </View>
      </View>
    );
  }

  const price = priceLine(shelf, item);
  const caption = form.priceLabel;
  // The caption already says "Inspection charge" / "Visit charge"; keep only unit notes ("per kg", "per piece").
  const unit = price.note && price.note !== 'inspection' && price.note !== 'visit' ? price.note : null;
  const paused = !item.inStock;

  const prefill = (): Answers => {
    const a: Answers = {};
    if (deviceField && device) a.device = device;
    const bm = [brand && brand !== 'Other' ? brand : '', model.trim()].filter(Boolean).join(' ');
    if (asksBrand && bm) a.brandModel = bm;
    return a;
  };

  return (
    <View style={{ flex: 1, backgroundColor: TV.page }}>
      <TopBar title="Service details" sub={SHELF_META[shelf].title} right={<BarIcon onPress={() => openMyBookings(router)} label="My service bookings"><IReceipt size={21} color={TV.onBand} strokeWidth={1.7} /></BarIcon>} />
      <ScrollView contentContainerStyle={{ paddingTop: 14, paddingBottom: 120 + insets.bottom }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <FadeIn>
          <View style={[d.photo, shadow(2)]}>
            <ItemPhoto shelf={shelf} item={item} maxWidth={560} />
            {paused ? <View style={d.tag}><Text style={d.tagText}>Paused for now</Text></View> : null}
          </View>
        </FadeIn>

        <View style={d.pad}>
          <Text style={d.title} accessibilityRole="header">{item.name}</Text>
          <View style={d.priceRow}>
            <Text style={d.caption}>{caption}</Text>
            <Text style={d.price}>{price.main}{unit ? <Text style={d.note}> {unit}</Text> : null}</Text>
          </View>
          {item.rating ? <Text style={d.rating}>{item.rating.toFixed(1)} from {item.ratingCount} {item.ratingCount === 1 ? 'review' : 'reviews'}</Text> : null}
          <View style={d.how}>
            <IInfo size={16} color={TV.accent} strokeWidth={1.8} />
            <Text style={d.howText}>{form.howItWorks}</Text>
          </View>
          {item.desc ? <Text style={d.desc}>{item.desc}</Text> : null}
          {item.storeName ? (
            <View style={d.store}>
              <IStore size={15} color={TV.sub} strokeWidth={1.7} />
              <Text style={d.storeText} numberOfLines={1}>{item.storeName}</Text>
            </View>
          ) : null}
        </View>

        <View style={d.trust}>
          {SHELF_TRUST[shelf].map((t) => {
            const Icon = TRUST_ICON[t.icon];
            return (
              <View key={t.text} style={[d.trustItem, shadow(1)]}>
                <View style={d.trustIcon}><Icon size={17} color={TV.accent} strokeWidth={1.7} /></View>
                <Text style={d.trustText} numberOfLines={2}>{t.text}</Text>
              </View>
            );
          })}
        </View>

        {deviceField ? (
          <View style={d.block}>
            <Text style={d.blockTitle}>Select device</Text>
            <Chips label="Device" items={deviceField.options.map((o) => ({ value: o.value, label: o.label }))} value={device} onPick={(v) => { setDevice(v); setBrand(''); }} />
          </View>
        ) : null}

        {asksBrand ? (
          <View style={d.block}>
            {brands.length ? (
              <>
                <Text style={d.blockTitle}>Select device brand</Text>
                <Chips label="Device brand" items={brands.map((b) => ({ value: b, label: b }))} value={brand} onPick={setBrand} />
              </>
            ) : null}
            <Text style={[d.blockTitle, brands.length ? { marginTop: 16 } : null]}>Device model</Text>
            <View style={d.input}>
              <TextInput
                value={model}
                onChangeText={setModel}
                placeholder={brand && brand !== 'Other' ? `${brand} model name or number` : dev === 'Phone' ? 'Brand and model, e.g. Redmi Note 12 Pro' : 'Brand and model, e.g. HP Pavilion 15'}
                placeholderTextColor={TV.faint}
                maxLength={60}
                autoCapitalize="words"
                style={d.inputText}
                accessibilityLabel="Device model"
              />
            </View>
            <Text style={d.helper}>{dev === 'Phone' ? 'Find it in Settings, About phone.' : 'The exact model is on the sticker under the laptop.'} You can change it in the next step.</Text>
          </View>
        ) : null}

        {others.length ? (
          <View style={[d.block, { paddingHorizontal: 0 }]}>
            <Text style={[d.blockTitle, { paddingHorizontal: 16 }]}>More from {item.storeName || 'this partner'}</Text>
            <View style={{ gap: 8 }}>
              {others.map((o) => {
                const pl = priceLine(shelf, o);
                return (
                  <Press key={o.id} onPress={() => router.replace(detailPath(shelf, o.id) as any)} label={`${o.name}, ${pl.main}${pl.note ? ` ${pl.note}` : ''}`} style={[d.other, shadow(1)]} scaleTo={0.985}>
                    <Thumb shelf={shelf} item={o} size={52} height={52} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={d.otherName} numberOfLines={1}>{o.name}</Text>
                      <Text style={d.otherPrice} numberOfLines={1}>{pl.main}{pl.note ? ` ${pl.note}` : ''}</Text>
                    </View>
                    <IChevronRight size={18} color={TV.faint} strokeWidth={1.8} />
                  </Press>
                );
              })}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={[d.bar, { paddingBottom: 12 + insets.bottom }, shadow(3)]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={d.barCaption} numberOfLines={1}>{caption}</Text>
          <Text style={d.barPrice} numberOfLines={1}>{formatINR(item.price)}{unit ? <Text style={d.note}> {unit}</Text> : null}</Text>
        </View>
        <Press onPress={() => book(item, prefill())} label={paused ? `${item.name} is paused` : `Book now, ${item.name}`} style={[d.book, paused ? { opacity: 0.5 } : shadow(2, TV.accent)]} scaleTo={0.96}>
          <Text style={d.bookText}>{paused ? 'Paused' : 'Book now'}</Text>
        </Press>
      </View>
      {sheet}
    </View>
  );
}

const d = themedSheet(() => ({
  photo: { marginHorizontal: 16, height: 200, borderRadius: RADIUS.xl, overflow: 'hidden', backgroundColor: TV.plate },
  tag: { position: 'absolute', left: 12, top: 12, paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: 'rgba(18,12,14,0.72)', justifyContent: 'center' },
  tagText: { color: '#FFFFFF', fontSize: 12, fontWeight: W.label },
  pad: { paddingHorizontal: 16, marginTop: 16 },
  title: { fontSize: 20, lineHeight: 26, color: TV.ink, fontWeight: W.title, letterSpacing: -0.2 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 8, flexWrap: 'wrap' },
  caption: { fontSize: 13, color: TV.sub },
  price: { fontSize: 18, color: TV.accentDeep, fontWeight: W.title },
  note: { fontSize: 12.5, color: TV.sub, fontWeight: W.body },
  rating: { fontSize: 13, color: TV.ink2, marginTop: 4 },
  how: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 12, padding: 12, borderRadius: RADIUS.md, backgroundColor: TV.accentSoft },
  howText: { flex: 1, fontSize: 13, lineHeight: 18.5, color: TV.ink2 },
  desc: { fontSize: 14, lineHeight: 20.5, color: TV.ink2, marginTop: 12 },
  store: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  storeText: { fontSize: 12.5, color: TV.sub, flexShrink: 1 },
  trust: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 16 },
  trustItem: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 6, borderRadius: RADIUS.md, backgroundColor: TV.card },
  trustIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: TV.accentSoft, alignItems: 'center', justifyContent: 'center' },
  trustText: { fontSize: 11.5, lineHeight: 15, color: TV.ink2, fontWeight: W.label, textAlign: 'center' },
  block: { paddingHorizontal: 16, marginTop: 22 },
  blockTitle: { fontSize: 15, color: TV.ink, fontWeight: W.title, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 36, paddingHorizontal: 15, borderRadius: 18, backgroundColor: TV.card, borderWidth: 1, borderColor: TV.line, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: TV.accent, borderColor: TV.accent },
  chipText: { fontSize: 13, color: TV.ink2, fontWeight: W.label },
  input: { height: 48, borderRadius: RADIUS.md, backgroundColor: TV.card, borderWidth: 1, borderColor: TV.line, paddingHorizontal: 14, justifyContent: 'center' },
  inputText: { fontSize: 14.5, color: TV.ink, paddingVertical: 8 },
  helper: { fontSize: 12, color: TV.sub, marginTop: 6, lineHeight: 16 },
  other: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, paddingRight: 12, borderRadius: RADIUS.md, backgroundColor: TV.card, marginHorizontal: 16 },
  otherName: { fontSize: 13.5, color: TV.ink, fontWeight: W.label },
  otherPrice: { fontSize: 12.5, color: TV.sub, marginTop: 2 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, paddingHorizontal: 16, backgroundColor: TV.card, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  barCaption: { fontSize: 12, color: TV.sub },
  barPrice: { fontSize: 18, color: TV.ink, fontWeight: W.title, marginTop: 1 },
  book: { height: 48, minWidth: 140, paddingHorizontal: 22, borderRadius: 24, backgroundColor: TV.accent, alignItems: 'center', justifyContent: 'center' },
  bookText: { color: '#FFFFFF', fontSize: 15, fontWeight: W.title },
}));
