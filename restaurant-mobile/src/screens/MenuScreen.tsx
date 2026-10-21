import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FormMode, ItemForm } from '../components/ItemForm';
import { MenuRow, PriceSheet, StockSheet } from '../components/MenuParts';
import { useStore } from '../state/StoreProvider';
import { color, font, radius, space, touch } from '../theme';
import { Button, EmptyState, ErrorStrip, SkeletonCard } from '../ui/kit';
import type { MenuItem } from '../types';

type Filter = 'all' | 'in' | 'out';

export default function MenuScreen() {
  const { menu, menuError, menuLoading, menuPending, refreshMenu, setStock, setCategoryStock, categoryPending, setPrice, saveItem, deleteItem, store, restaurant } = useStore();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [stockFor, setStockFor] = useState<MenuItem | null>(null);
  const [priceFor, setPriceFor] = useState<MenuItem | null>(null);
  const [form, setForm] = useState<FormMode | null>(null);

  const categories = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const m of menu || []) if (m.category && m.category !== 'Other') byKey.set(m.category.toLowerCase(), m.category);
    return [...byKey.values()].sort((a, b) => a.localeCompare(b));
  }, [menu]);
  const openAdd = useCallback(
    () => setForm({ kind: 'add', category: categories.length === 1 ? categories[0] : undefined }),
    [categories],
  );
  const openEdit = useCallback((item: MenuItem) => setForm({ kind: 'edit', item }), []);

  const outCount = menu ? menu.filter((m) => !m.isAvailable).length : 0;

  const sections = useMemo(() => {
    if (!menu) return [];
    const needle = q.trim().toLowerCase();
    const groups = new Map<string, MenuItem[]>();
    for (const m of menu) {
      const arr = groups.get(m.category) || [];
      arr.push(m);
      groups.set(m.category, arr);
    }
    const out: { title: string; inStock: number; total: number; data: MenuItem[] }[] = [];
    for (const [title, items] of groups) {
      const data = items
        .filter((m) => (filter === 'all' ? true : filter === 'in' ? m.isAvailable : !m.isAvailable))
        .filter((m) => !needle || m.name.toLowerCase().includes(needle))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (data.length) out.push({ title, inStock: items.filter((m) => m.isAvailable).length, total: items.length, data });
    }
    return out.sort((a, b) => (a.title === 'Other' ? 1 : b.title === 'Other' ? -1 : a.title.localeCompare(b.title)));
  }, [menu, q, filter]);

  const onToggle = useCallback((item: MenuItem) => {
    if (item.isAvailable) setStockFor(item);
    else setStock(item, { isAvailable: true });
  }, [setStock]);

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'in', label: 'In stock' },
    { key: 'out', label: `Out (${outCount})` },
  ];

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.top}>
        <View style={styles.search}>
          <Ionicons name="search" size={20} color={color.textMuted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search dishes"
            placeholderTextColor={color.textMuted}
            style={[font.body, { flex: 1, color: color.text, paddingVertical: 0 }]}
            accessibilityLabel="Search dishes"
            returnKeyType="search"
          />
          {q ? (
            <Pressable onPress={() => setQ('')} accessibilityLabel="Clear search" hitSlop={12}>
              <Ionicons name="close-circle" size={22} color={color.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.chips}>
          {chips.map((c) => {
            const sel = c.key === filter;
            const warn = c.key === 'out' && outCount > 0 && !sel;
            return (
              <Pressable
                key={c.key}
                onPress={() => setFilter(c.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: sel }}
                style={[styles.chip, sel && { backgroundColor: color.text, borderColor: color.text }, warn && { borderColor: color.alert, borderWidth: 2 }]}
              >
                <Text style={[font.small, { color: sel ? color.textInverse : warn ? color.alertDark : color.text, fontWeight: '800' }]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>
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
              <Text style={[font.small, { color: color.textMuted }]}>{section.inStock}/{section.total} in stock</Text>
              <CategorySwitch
                title={section.title}
                inStock={section.inStock}
                total={section.total}
                busy={!!categoryPending[section.title]}
                onSet={(on) => { setCategoryStock(section.title, on); }}
              />
            </View>
          )}
          renderItem={({ item }) => (
            <MenuRow item={item} pending={!!menuPending[item.id]} onToggle={onToggle} onEditPrice={setPriceFor} onEdit={openEdit} />
          )}
          contentContainerStyle={{ paddingBottom: 120 }}
          ListEmptyComponent={
            menu.length === 0
              ? (
                <View style={styles.firstItem}>
                  <Ionicons name="restaurant-outline" size={52} color={color.textMuted} />
                  <Text style={[font.h2, { color: color.text, textAlign: 'center' }]}>No dishes yet</Text>
                  <Text style={[font.body, { color: color.textSecondary, textAlign: 'center' }]}>Add your first dish. Customers can order it right away.</Text>
                  <Button label="+ ADD FIRST ITEM" variant="accept" size="huge" onPress={openAdd} style={{ alignSelf: 'stretch', marginTop: space.xs }} />
                </View>
              )
              : <EmptyState icon="search" title="No dishes match" body="Try another search or filter." />
          }
        />
      )}

      {menu && menu.length > 0 ? (
        <Pressable
          onPress={openAdd}
          accessibilityRole="button"
          accessibilityLabel="Add item"
          style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
        >
          <Ionicons name="add" size={28} color={color.textInverse} />
          <Text style={[font.button, { color: color.textInverse }]}>Add item</Text>
        </Pressable>
      ) : null}

      <ItemForm
        mode={form}
        categories={categories}
        onClose={() => setForm(null)}
        onSave={saveItem}
        onDelete={deleteItem}
        onDuplicate={(item) => setForm({ kind: 'duplicate', item })}
      />

      <StockSheet
        item={stockFor}
        opensAt={store?.operatingHours?.start || restaurant.operatingHours?.start || null}
        onClose={() => setStockFor(null)}
        onPick={(change) => {
          const it = stockFor;
          setStockFor(null);
          if (it) setStock(it, change);
        }}
      />
      <PriceSheet item={priceFor} onClose={() => setPriceFor(null)} onSave={setPrice} />
    </View>
  );
}

/** One tap: the whole category out of stock (or back in when it is all out). Saves on the server at once. */
function CategorySwitch({ title, inStock, total, busy, onSet }: {
  title: string; inStock: number; total: number; busy: boolean; onSet: (isAvailable: boolean) => void;
}) {
  const turnOn = inStock === 0;
  const label = turnOn ? 'All in stock' : 'All out';
  return (
    <Pressable
      onPress={() => { if (!busy) onSet(turnOn); }}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={turnOn ? `Mark all ${total} ${title} items in stock` : `Mark all ${total} ${title} items out of stock`}
      hitSlop={6}
      style={({ pressed }) => [styles.catSwitch, turnOn ? styles.catOn : styles.catOff, pressed && { opacity: 0.75 }]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={turnOn ? color.textInverse : color.alertDark} />
      ) : (
        <Text style={[font.small, { color: turnOn ? color.textInverse : color.alertDark, fontWeight: '800' }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { padding: space.md, gap: space.sm, backgroundColor: color.bg },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.sm, minHeight: touch.min + 4,
  },
  chips: { flexDirection: 'row', gap: space.xs },
  chip: { flex: 1, minHeight: touch.min, paddingHorizontal: space.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  fab: {
    position: 'absolute', right: space.md, bottom: space.md, flexDirection: 'row', alignItems: 'center', gap: space.xs,
    minHeight: touch.primary, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: color.open,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6,
  },
  firstItem: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.xl },
  catSwitch: { minHeight: 36, minWidth: 96, paddingHorizontal: space.sm, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', marginLeft: space.xs },
  catOn: { backgroundColor: color.open },
  catOff: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.alert },
  section: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingVertical: space.sm, backgroundColor: color.bg, borderBottomWidth: 1, borderBottomColor: color.border },
});
