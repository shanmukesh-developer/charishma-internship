// Menu row with a big IN STOCK / OUT switch and a tappable price, plus the stock and price sheets.
import React, { memo, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '../lib/http';
import { NetImage } from './NetImage';
import { clockIST, dietOf, nextISTTime, rupees } from '../lib/model';
import type { StockChange } from '../state/StoreProvider';
import { color, font, radius, space, touch } from '../theme';
import { Badge, Button, Chip, Sheet } from '../ui/kit';
import type { Diet, MenuItem } from '../types';

function VegMark({ diet }: { diet: Diet | null }) {
  if (diet === null) return <View style={{ width: 18 }} />;
  const c = diet === 'veg' ? color.veg : diet === 'egg' ? color.warning : color.nonVeg;
  return (
    <View style={[styles.veg, { borderColor: c }]} accessibilityLabel={diet === 'veg' ? 'Veg' : diet === 'egg' ? 'Egg' : 'Non-veg'}>
      <View style={[styles.vegDot, { backgroundColor: c }]} />
    </View>
  );
}

function MenuRowBase({ item, pending, onToggle, onEditPrice, onEdit }: {
  item: MenuItem; pending: boolean; onToggle: (item: MenuItem) => void; onEditPrice: (item: MenuItem) => void; onEdit: (item: MenuItem) => void;
}) {
  const on = item.isAvailable;
  const diet = dietOf(item);
  return (
    <View style={[styles.row, !on && { backgroundColor: color.surfaceAlt }]}>
      <Pressable
        onPress={() => onEdit(item)}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}. Tap to edit`}
        style={({ pressed }) => [styles.thumb, pressed && { opacity: 0.7 }]}
      >
        <NetImage
          uri={item.imageUrl}
          thumbPx={160}
          style={StyleSheet.absoluteFill}
          fallback={<Ionicons name="restaurant-outline" size={22} color={color.textMuted} />}
        />
        {/* Veg mark in the corner whether or not the photo loads. */}
        <View style={styles.thumbMark}><VegMark diet={diet} /></View>
      </Pressable>
      <View style={{ flex: 1, gap: 4 }}>
        <Pressable onPress={() => onEdit(item)} accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`} hitSlop={6} style={styles.nameTap}>
          <Text style={[font.body, { color: on ? color.text : color.textMuted, fontWeight: '800', flexShrink: 1 }]} numberOfLines={2}>{item.name}</Text>
          <Ionicons name="create-outline" size={18} color={color.textMuted} />
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' }}>
          <Pressable
            onPress={() => onEditPrice(item)}
            accessibilityRole="button"
            accessibilityLabel={`Price ${rupees(item.price)}. Tap to change`}
            hitSlop={8}
            style={styles.price}
          >
            <Text style={[font.body, { color: color.text, fontWeight: '800' }]}>{rupees(item.price)}</Text>
            <Ionicons name="pencil" size={14} color={color.info} />
          </Pressable>
          {item.originalPrice && item.originalPrice > item.price ? (
            <Text style={[font.small, { color: color.textMuted, textDecorationLine: 'line-through' }]} accessibilityLabel={`MRP ${rupees(item.originalPrice)}`}>
              {rupees(item.originalPrice)}
            </Text>
          ) : null}
          {!on && item.outOfStockUntil ? <Text style={[font.small, { color: color.textMuted }]}>Back {clockIST(item.outOfStockUntil)}</Text> : null}
        </View>
      </View>
      <Pressable
        onPress={() => onToggle(item)}
        disabled={pending}
        accessibilityRole="switch"
        accessibilityState={{ checked: on, busy: pending }}
        accessibilityLabel={`${item.name}: ${on ? 'in stock' : 'out of stock'}. Tap to change`}
        style={({ pressed }) => [styles.switch, { backgroundColor: on ? color.open : color.closed }, pressed && { opacity: 0.85 }]}
      >
        {pending ? <ActivityIndicator color={color.textInverse} /> : (
          <View style={{ flexDirection: on ? 'row' : 'row-reverse', alignItems: 'center', flex: 1 }}>
            <Text style={[font.label, { color: color.textInverse, flex: 1, textAlign: 'center' }]}>{on ? 'IN STOCK' : 'OUT'}</Text>
            <View style={styles.knob} />
          </View>
        )}
      </Pressable>
    </View>
  );
}
export const MenuRow = memo(MenuRowBase);

type StockChoice = '2h' | 'tomorrow' | 'manual';

/** Out-of-stock options. "Next opening" uses operatingHours.start (IST), default 9 AM. */
export function StockSheet({ item, opensAt, onClose, onPick }: {
  item: MenuItem | null; opensAt?: string | null; onClose: () => void; onPick: (change: StockChange) => void;
}) {
  const [choice, setChoice] = useState<StockChoice>('2h');
  useEffect(() => { setChoice('2h'); }, [item?.id]);
  const open = opensAt && /^\d{1,2}:\d{2}$/.test(opensAt) ? opensAt : '09:00';
  const tomorrowAt = nextISTTime(open);
  const apply = () => {
    if (choice === 'manual') onPick({ isAvailable: false });
    else if (choice === '2h') onPick({ outOfStockUntil: new Date(Date.now() + 2 * 3600 * 1000).toISOString() });
    else if (tomorrowAt) onPick({ outOfStockUntil: new Date(tomorrowAt).toISOString() });
  };
  return (
    <Sheet visible={!!item} onClose={onClose} title={item ? `${item.name} — out of stock` : ''}>
      <View style={{ gap: space.xs }}>
        <Chip label="For 2 hours" sub={`BACK AT ${clockIST(Date.now() + 2 * 3600 * 1000)}`} selected={choice === '2h'} onPress={() => setChoice('2h')} />
        {tomorrowAt ? (
          <Chip label="Until next opening" sub={`BACK AT ${clockIST(tomorrowAt)}`} selected={choice === 'tomorrow'} onPress={() => setChoice('tomorrow')} />
        ) : null}
        <Chip label="Until I turn it on" selected={choice === 'manual'} onPress={() => setChoice('manual')} />
        <Button label="MARK OUT OF STOCK" variant="reject" onPress={apply} style={{ marginTop: space.xs }} />
      </View>
    </Sheet>
  );
}

export function PriceSheet({ item, onClose, onSave }: {
  item: MenuItem | null; onClose: () => void; onSave: (item: MenuItem, price: number) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setText(item ? String(item.price) : '');
    setErr(null);
    setSaving(false);
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const parse = (t: string): number | null => {
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(t.trim())) return null;
    const n = Number(t);
    return n > 0 && n <= 100000 ? n : null;
  };

  const save = async () => {
    if (!item || saving) return;
    const n = parse(text);
    if (n === null) { setErr('Enter a price between ₹1 and ₹1,00,000.'); return; }
    if (n === item.price) { onClose(); return; }
    setSaving(true);
    setErr(null);
    try {
      await onSave(item, n);
      onClose();
    } catch (e) {
      setErr(errorMessage(e, "Couldn't save the price. Try again."));
    } finally {
      setSaving(false);
    }
  };

  const old = item?.price ?? 0;
  const n = parse(text);
  const bigJump = n !== null && old > 0 && (n > old * 2 || n < old / 2);

  return (
    <Sheet visible={!!item} onClose={onClose} title={item ? `Price · ${item.name}` : ''}>
      <View style={styles.inputRow}>
        <Text style={[font.money, { color: color.text }]}>₹</Text>
        <TextInput
          value={text}
          onChangeText={(t) => { setText(t.replace(/[^\d.]/g, '')); setErr(null); }}
          keyboardType="decimal-pad"
          autoFocus
          selectTextOnFocus
          style={[font.money, styles.input]}
          accessibilityLabel="New price in rupees"
          onSubmitEditing={save}
          maxLength={9}
          editable={!saving}
        />
      </View>
      <Text style={[font.small, { color: color.textMuted, marginTop: space.xs }]}>Now {rupees(old)}. Customers see the new price right away.</Text>
      {bigJump ? <Badge text="BIG CHANGE — PLEASE CHECK" icon="warning" fg={color.warning} bg={color.warningTint} /> : null}
      {err ? <Text style={[font.body, { color: color.alertDark, marginTop: space.xs, fontWeight: '700' }]}>{err}</Text> : null}
      <Button label="SAVE PRICE" onPress={save} loading={saving} style={{ marginTop: space.md }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 76, paddingHorizontal: space.md, paddingVertical: space.xs,
    backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.surfaceAlt,
  },
  thumb: {
    width: 48, height: 48, borderRadius: radius.sm, backgroundColor: color.surfaceAlt, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  thumbMark: { position: 'absolute', left: 2, top: 2, backgroundColor: color.surface, borderRadius: 3 },
  nameTap: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  veg: { width: 18, height: 18, borderWidth: 2, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  vegDot: { width: 8, height: 8, borderRadius: 4 },
  price: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: space.xs, borderRadius: radius.sm, backgroundColor: color.infoTint },
  switch: { width: 116, height: touch.min + 4, borderRadius: radius.pill, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  knob: { width: 38, height: 38, borderRadius: 19, backgroundColor: color.surface },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, borderWidth: 2, borderColor: color.text, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 68 },
  input: { flex: 1, color: color.text, paddingVertical: 0 },
});
