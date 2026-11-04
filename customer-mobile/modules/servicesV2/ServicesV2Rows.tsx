/**
 * Tech & repairs v2 list rows (board: photo, title, "From ₹…", a "Book" / "Add" pill).
 *   ServiceRow   a booking-only service: tap the row for its details, "Book" opens the booking flow straight away
 *   ProductRow   a campus store product: tap for the product page, "Add" / stepper for the campus store basket
 * Photos are the catalogue's own (SafeImage sizes the request to the drawn width × screen density), or the item's type
 * photo (servicesV2Art typePhoto) when the catalogue has none or it fails to load. A rating shows
 * only when the server sends one; today it sends none for these shelves, so the price and a plain line show instead.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import SafeImage from '../../components/SafeImage';
import { typePhoto } from './servicesV2Art';
import { MAX_ITEM_QTY } from '../../context/CartContext';
import { formatINR } from '../../utils/format';
import { TV, RADIUS, W, shadow } from './servicesV2Theme';
import { BookPill, Press, Stepper } from './ServicesV2Kit';
import { isServiceShelf, priceLine, type ShelfId, type ShelfItem } from './servicesV2Data';
import { themedSheet } from '../../utils/themeNow';

/** The catalogue photo over the item's type photo: the type photo shows while the catalogue photo loads (the campus
 * media server can be slow), and stays when the catalogue has no photo or it fails to load (services). */
export function ItemPhoto({ shelf, item, maxWidth }: { shelf: ShelfId; item: Pick<ShelfItem, 'name' | 'image'>; maxWidth: number }) {
  const local = <Image source={typePhoto(shelf, item.name)} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />;
  if (!item.image) return local;
  // Store products can be cut-outs on a transparent background, so their type photo only replaces a missing photo.
  if (!isServiceShelf(shelf)) return <SafeImage source={{ uri: item.image }} style={{ width: '100%', height: '100%' }} maxWidth={maxWidth} fallback={local} accessibilityIgnoresInvertColors />;
  return (
    <>
      {local}
      <SafeImage source={{ uri: item.image }} style={r.over} maxWidth={maxWidth} fallback={null} accessibilityIgnoresInvertColors />
    </>
  );
}

export function Thumb({ shelf, item, size = 84, height = 76, dim }: { shelf: ShelfId; item: Pick<ShelfItem, 'name' | 'image'>; size?: number; height?: number; dim?: boolean }) {
  return (
    <View style={[r.thumb, { width: size, height }, dim ? { opacity: 0.5 } : null]}>
      <ItemPhoto shelf={shelf} item={item} maxWidth={size} />
    </View>
  );
}

export function ServiceRow({ shelf, item, onOpen, onBook, showStore }: { shelf: ShelfId; item: ShelfItem; onOpen: () => void; onBook: () => void; showStore?: boolean }) {
  const price = priceLine(shelf, item);
  const paused = !item.inStock;
  const priceText = `${price.main}${price.note ? ` ${price.note}` : ''}`;
  return (
    <Press onPress={onOpen} label={`${item.name}, ${priceText}${paused ? ', paused' : ''}. Opens details.`} style={[r.row, shadow(1)]} scaleTo={0.985}>
      <Thumb shelf={shelf} item={item} dim={paused} />
      <View style={r.body}>
        <Text style={[r.title, paused ? { color: TV.faint } : null]} numberOfLines={2}>{item.name}</Text>
        {showStore && item.storeName ? <Text style={r.store} numberOfLines={1}>{item.storeName}</Text> : item.desc ? <Text style={r.desc} numberOfLines={1}>{item.desc}</Text> : null}
        <View style={r.foot}>
          <View style={{ flex: 1, minWidth: 0 }}>
            {paused ? <Text style={r.paused}>Paused for now</Text> : (
              <Text style={r.price} numberOfLines={1}>{price.main}{price.note ? <Text style={r.note}> {price.note}</Text> : null}</Text>
            )}
          </View>
          <BookPill label={paused ? 'Paused' : 'Book'} muted={paused} onPress={onBook} a11y={paused ? `${item.name} is paused` : `Book ${item.name}, ${priceText}`} />
        </View>
      </View>
    </Press>
  );
}

export function ProductRow({ shelf, item, qty, storeClosed, onOpen, onAdd, onMinus, onPlus }: {
  shelf: ShelfId; item: ShelfItem; qty: number; storeClosed: boolean;
  onOpen: () => void; onAdd: () => void; onMinus: () => void; onPlus: () => void;
}) {
  const soldOut = !item.inStock;
  const blocked = soldOut || storeClosed || !item.orderable;
  const label = soldOut ? 'Sold out' : blocked ? 'Closed' : 'Add';
  return (
    <Press onPress={onOpen} label={`${item.name}, ${formatINR(item.price)}${soldOut ? ', sold out' : ''}. Opens the product.`} style={[r.row, shadow(1)]} scaleTo={0.985}>
      <Thumb shelf={shelf} item={item} dim={soldOut} />
      <View style={r.body}>
        <Text style={[r.title, soldOut ? { color: TV.faint } : null]} numberOfLines={2}>{item.name}</Text>
        {item.desc ? <Text style={r.desc} numberOfLines={1}>{item.desc}</Text> : null}
        <View style={r.foot}>
          <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={r.price} numberOfLines={1}>{formatINR(item.price)}</Text>
            {item.originalPrice ? <Text style={r.was} numberOfLines={1} accessibilityLabel={`Was ${formatINR(item.originalPrice)}`}>{formatINR(item.originalPrice)}</Text> : null}
          </View>
          {qty > 0 ? (
            <Stepper qty={qty} name={item.name} onMinus={onMinus} onPlus={onPlus} atMax={qty >= MAX_ITEM_QTY} />
          ) : (
            <BookPill label={label} muted={blocked} onPress={onAdd} a11y={blocked ? `${item.name}, ${label.toLowerCase()}` : `Add ${item.name} to the campus store basket`} />
          )}
        </View>
      </View>
    </Press>
  );
}

const r = themedSheet(() => ({
  row: { flexDirection: 'row', gap: 12, padding: 10, borderRadius: RADIUS.lg, backgroundColor: TV.card, marginHorizontal: 16, alignItems: 'stretch' },
  thumb: { borderRadius: 12, overflow: 'hidden', backgroundColor: TV.plate },
  over: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'transparent' },
  body: { flex: 1, minWidth: 0, justifyContent: 'space-between' },
  title: { fontSize: 14.5, lineHeight: 19, color: TV.ink, fontWeight: W.title },
  desc: { fontSize: 12, lineHeight: 16, color: TV.sub, marginTop: 2 },
  store: { fontSize: 12, lineHeight: 16, color: TV.accentDeep, marginTop: 2, fontWeight: W.label },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  price: { fontSize: 14.5, color: TV.ink, fontWeight: W.title },
  note: { fontSize: 12, color: TV.sub, fontWeight: W.body },
  was: { fontSize: 12, color: TV.faint, textDecorationLine: 'line-through' },
  paused: { fontSize: 12.5, color: TV.faint, fontWeight: W.label },
}));
