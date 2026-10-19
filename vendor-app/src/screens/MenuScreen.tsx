// Menu: every item with a big AVAILABLE switch; tap an item to edit it, ADD ITEM to add one.
import React, { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FormMode, ItemForm } from '../components/ItemForm';
import { NetImage } from '../components/NetImage';
import { dietOf, rupees } from '../lib/model';
import { useStore } from '../state/StoreProvider';
import { color, font, radius, space, touch } from '../theme';
import { Button, EmptyState, ErrorStrip, SkeletonCard } from '../ui/kit';
import type { Diet, MenuItem } from '../types';

function VegMark({ diet }: { diet: Diet | null }) {
  if (diet === null) return null;
  const c = diet === 'veg' ? color.veg : diet === 'egg' ? color.warning : color.nonVeg;
  return (
    <View style={[styles.veg, { borderColor: c }]} accessibilityLabel={diet === 'veg' ? 'Veg' : diet === 'egg' ? 'Egg' : 'Non-veg'}>
      <View style={[styles.vegDot, { backgroundColor: c }]} />
    </View>
  );
}

const MenuRow = memo(function MenuRow({ item, pending, onToggle, onEdit }: {
  item: MenuItem; pending: boolean; onToggle: (item: MenuItem) => void; onEdit: (item: MenuItem) => void;
}) {
  const on = item.isAvailable;
  return (
    <View style={[styles.row, !on && { backgroundColor: color.surfaceAlt }]}>
      <Pressable
        onPress={() => onEdit(item)}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${rupees(item.price)}. Tap to edit`}
        style={({ pressed }) => [styles.rowMain, pressed && { opacity: 0.7 }]}
      >
        <View style={styles.thumb}>
          <NetImage
            uri={item.imageUrl}
            thumbPx={160}
            style={StyleSheet.absoluteFill}
            fallback={<Ionicons name="fast-food-outline" size={24} color={color.textMuted} />}
          />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <VegMark diet={dietOf(item)} />
            <Text style={[font.body, { color: on ? color.text : color.textMuted, fontWeight: '800', flex: 1 }]} numberOfLines={2}>{item.name}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <Text style={[font.body, { color: color.text, fontWeight: '800' }]}>{rupees(item.price)}</Text>
            <Ionicons name="pencil" size={14} color={color.info} />
            <Text style={[font.small, { color: color.info, fontWeight: '700' }]}>Edit</Text>
          </View>
        </View>
      </Pressable>
      <Pressable
        onPress={() => onToggle(item)}
        disabled={pending}
        accessibilityRole="switch"
        accessibilityState={{ checked: on, busy: pending }}
        accessibilityLabel={`${item.name}: ${on ? 'available' : 'not available'}. Tap to change`}
        style={({ pressed }) => [styles.switch, { backgroundColor: on ? color.open : color.closed }, pressed && { opacity: 0.85 }]}
      >
        {pending ? <ActivityIndicator color={color.textInverse} /> : (
          <View style={{ flexDirection: on ? 'row' : 'row-reverse', alignItems: 'center', flex: 1 }}>
            <Text style={[font.label, { color: color.textInverse, flex: 1, textAlign: 'center' }]}>{on ? 'ON' : 'OFF'}</Text>
            <View style={styles.knob} />
          </View>
        )}
      </Pressable>
    </View>
  );
});

export default function MenuScreen() {
  const { menu, menuError, menuLoading, menuPending, refreshMenu, setStock, saveItem, deleteItem } = useStore();
  const [q, setQ] = useState('');
  const [form, setForm] = useState<FormMode | null>(null);

  const categories = useMemo(() => {
    if (!menu) return [];
    return [...new Set(menu.map((m) => m.category).filter((c) => c && c !== 'Other'))].sort((a, b) => a.localeCompare(b));
  }, [menu]);

  const offCount = menu ? menu.filter((m) => !m.isAvailable).length : 0;

  const sections = useMemo(() => {
    if (!menu) return [];
    const needle = q.trim().toLowerCase();
    const groups = new Map<string, MenuItem[]>();
    for (const m of menu) {
      if (needle && !m.name.toLowerCase().includes(needle)) continue;
      const arr = groups.get(m.category) || [];
      arr.push(m);
      groups.set(m.category, arr);
    }
    const out: { title: string; on: number; data: MenuItem[] }[] = [];
    for (const [title, items] of groups) {
      out.push({ title, on: items.filter((m) => m.isAvailable).length, data: items.sort((a, b) => a.name.localeCompare(b.name)) });
    }
    return out.sort((a, b) => (a.title === 'Other' ? 1 : b.title === 'Other' ? -1 : a.title.localeCompare(b.title)));
  }, [menu, q]);

  const onToggle = useCallback((item: MenuItem) => { setStock(item, !item.isAvailable); }, [setStock]);
  const onEdit = useCallback((item: MenuItem) => setForm({ kind: 'edit', item }), []);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.top}>
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <View style={styles.search}>
            <Ionicons name="search" size={20} color={color.textMuted} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search items"
              placeholderTextColor={color.textMuted}
              style={[font.body, { flex: 1, color: color.text, paddingVertical: 0 }]}
              accessibilityLabel="Search items"
              returnKeyType="search"
            />
            {q ? (
              <Pressable onPress={() => setQ('')} accessibilityLabel="Clear search" hitSlop={12}>
                <Ionicons name="close-circle" size={22} color={color.textMuted} />
              </Pressable>
            ) : null}
          </View>
          <Button label="ADD" icon="add" variant="accept" size="secondary" onPress={() => setForm({ kind: 'add' })} style={{ minWidth: 104 }} a11y="Add new item" />
        </View>
        {menu && menu.length > 0 ? (
          <Text style={[font.small, { color: offCount ? color.alertDark : color.textMuted, fontWeight: '700' }]}>
            {menu.length} item{menu.length === 1 ? '' : 's'}{offCount ? ` · ${offCount} switched OFF (customers can't order them)` : ' · all available'}
          </Text>
        ) : null}
        {menu && menuError ? <ErrorStrip text={menuError} onRetry={refreshMenu} busy={menuLoading} /> : null}
      </View>

      {!menu ? (
        menuError ? (
          <EmptyState icon="cloud-offline-outline" title="Couldn't load your menu" body={menuError} action={{ label: 'Try again', onPress: refreshMenu, loading: menuLoading }} />
        ) : (
          <View style={{ padding: space.md, gap: space.md }}><SkeletonCard lines={4} /><SkeletonCard lines={4} /></View>
        )
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(m) => m.id}
          stickySectionHeadersEnabled
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={menuLoading} onRefresh={refreshMenu} colors={[color.text]} />}
          renderSectionHeader={({ section }) => (
            <View style={styles.section}>
              <Text style={[font.h3, { color: color.text, flex: 1 }]}>{section.title}</Text>
              <Text style={[font.small, { color: color.textMuted }]}>{section.on}/{section.data.length} on</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <MenuRow item={item} pending={!!menuPending[item.id]} onToggle={onToggle} onEdit={onEdit} />
          )}
          contentContainerStyle={{ paddingBottom: space.xxl * 2 }}
          ListEmptyComponent={
            menu.length === 0 ? (
              <View style={{ padding: space.md }}>
                <EmptyState icon="fast-food-outline" title="No items yet" body="Add what you sell — tea, tiffin, juice — with a price. Customers see it right away." />
                <Button label="ADD YOUR FIRST ITEM" icon="add" variant="accept" onPress={() => setForm({ kind: 'add' })} />
              </View>
            ) : <EmptyState icon="search" title="No items match" body="Try another search." />
          }
        />
      )}

      <ItemForm
        mode={form}
        categories={categories}
        onClose={() => setForm(null)}
        onSave={saveItem}
        onDelete={deleteItem}
        onDuplicate={(item) => setForm({ kind: 'duplicate', item })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { padding: space.md, gap: space.sm, backgroundColor: color.bg },
  search: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.sm, minHeight: touch.secondary,
  },
  section: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingVertical: space.sm, backgroundColor: color.bg, borderBottomWidth: 1, borderBottomColor: color.border },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 80, paddingHorizontal: space.md, paddingVertical: space.xs,
    backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.surfaceAlt,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch.min },
  thumb: {
    width: 56, height: 56, borderRadius: radius.sm, backgroundColor: color.surfaceAlt, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  veg: { width: 16, height: 16, borderWidth: 2, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  vegDot: { width: 7, height: 7, borderRadius: 4 },
  switch: { width: 96, height: touch.min + 4, borderRadius: radius.pill, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  knob: { width: 38, height: 38, borderRadius: 19, backgroundColor: color.surface },
});
