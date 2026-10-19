// Add / edit / duplicate / delete a dish. Full-screen form with big fields, inline messages and one
// save button at the bottom that cannot be pressed twice.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from '../ui/KeyboardAvoidingView';
import * as api from '../lib/api';
import { errorMessage } from '../lib/http';
import { dietOf } from '../lib/model';
import { pickPhoto, PhotoSource } from '../lib/photo';
import { NetImage } from './NetImage';
import type { DeleteResult } from '../state/StoreProvider';
import { color, font, radius, space, touch } from '../theme';
import { Button, Chip, IconButton } from '../ui/kit';
import type { Diet, ItemInput, MenuItem } from '../types';

export type FormMode =
  | { kind: 'add'; category?: string }
  | { kind: 'edit'; item: MenuItem }
  | { kind: 'duplicate'; item: MenuItem };

interface Draft {
  name: string;
  price: string;
  category: string;
  diet: Diet;
  description: string;
  imageUrl: string | null;
  isAvailable: boolean;
  /** MRP text ('' = none). */
  mrp: string;
}

type Field = 'name' | 'price' | 'category' | 'mrp';

const NAME_MAX = 80;
const DESC_MAX = 300;

function draftFor(mode: FormMode | null): Draft {
  if (!mode || mode.kind === 'add') {
    return { name: '', price: '', category: mode?.category || '', diet: 'veg', description: '', imageUrl: null, isAvailable: true, mrp: '' };
  }
  const it = mode.item;
  return {
    name: mode.kind === 'duplicate' ? `${it.name} (copy)`.slice(0, NAME_MAX) : it.name,
    price: String(it.price || ''),
    category: it.category === 'Other' ? '' : it.category,
    diet: dietOf(it) || 'veg',
    description: it.description || '',
    imageUrl: it.imageUrl,
    isAvailable: mode.kind === 'duplicate' ? true : it.isAvailable,
    mrp: it.originalPrice ? String(it.originalPrice) : '',
  };
}

function parsePrice(t: string): number | null {
  const v = t.trim();
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(v)) return null;
  const n = Number(v);
  return n > 0 && n <= 100000 ? n : null;
}

function validate(d: Draft): Partial<Record<Field, string>> {
  const errs: Partial<Record<Field, string>> = {};
  const name = d.name.trim();
  if (!name) errs.name = 'Type the dish name.';
  else if (name.length < 2) errs.name = 'Name is too short.';
  if (!d.price.trim()) errs.price = 'Type the price.';
  else if (parsePrice(d.price) === null) errs.price = 'Price must be between ₹1 and ₹1,00,000 (like 120 or 99.50).';
  if (d.mrp.trim()) {
    const mrp = parsePrice(d.mrp);
    const price = parsePrice(d.price);
    if (mrp === null) errs.mrp = 'MRP must be between ₹1 and ₹1,00,000, or leave it empty.';
    else if (price !== null && mrp < price) errs.mrp = 'MRP cannot be lower than the selling price.';
  }
  if (d.category.trim().length > 40) errs.category = 'Category name is too long (40 letters max).';
  return errs;
}

const friendlyUploadError = (e: unknown) => {
  const msg = errorMessage(e, "The photo didn't upload. Please try again.");
  if (/too large|exceeds|2mb/i.test(msg)) return 'This photo is too big. Please pick a smaller one.';
  if (/only jpeg|format/i.test(msg)) return 'Use a JPG or PNG photo.';
  return msg;
};

export function ItemForm({ mode, categories, onClose, onSave, onDelete, onDuplicate }: {
  mode: FormMode | null;
  categories: string[];
  onClose: () => void;
  onSave: (input: ItemInput, editing: MenuItem | null) => Promise<MenuItem>;
  onDelete: (item: MenuItem) => Promise<DeleteResult>;
  onDuplicate: (item: MenuItem) => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<Draft>(() => draftFor(mode));
  const [initial, setInitial] = useState<Draft>(() => draftFor(mode));
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [triedSave, setTriedSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [newCat, setNewCat] = useState(false);
  const [confirm, setConfirm] = useState<null | 'delete' | 'discard'>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<{ text: string } | null>(null);
  const savingRef = useRef(false);
  const priceRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);

  const modeKey = mode ? `${mode.kind}:${'item' in mode ? mode.item.id : mode.category || ''}` : '';
  useEffect(() => {
    if (!mode) return;
    const d = draftFor(mode);
    setDraft(d);
    setInitial(d);
    setTouched({});
    setTriedSave(false);
    setSaving(false);
    savingRef.current = false;
    setServerErr(null);
    setPhotoBusy(false);
    setPhotoErr(null);
    setConfirm(null);
    setDeleting(false);
    setDeleteErr(null);
    setNewCat(!!d.category && !categories.includes(d.category));
  }, [modeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The delete confirmation opens at the very bottom of the form, under the fold: bring its buttons into view.
  useEffect(() => {
    if (confirm !== 'delete') return;
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [confirm]);

  const editing = mode?.kind === 'edit' ? mode.item : null;
  const errs = useMemo(() => validate(draft), [draft]);
  const show = (f: Field) => (triedSave || touched[f]) ? errs[f] : undefined;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setServerErr(null);
  };

  const requestClose = () => {
    if (saving || deleting) return;
    if (dirty && confirm !== 'discard') { setConfirm('discard'); return; }
    onClose();
  };

  const addPhoto = async (src: PhotoSource) => {
    if (photoBusy || saving) return;
    setPhotoErr(null);
    setPhotoBusy(true);
    try {
      const picked = await pickPhoto(src);
      if (!picked.ok) {
        if (picked.reason !== 'cancelled') setPhotoErr(picked.message);
        return;
      }
      const url = await api.uploadPhoto(picked.uri, picked.mimeType);
      set('imageUrl', url);
    } catch (e) {
      setPhotoErr(friendlyUploadError(e));
    } finally {
      setPhotoBusy(false);
    }
  };

  const save = async () => {
    if (!mode || savingRef.current || photoBusy) return;
    setTriedSave(true);
    if (Object.keys(errs).length) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    const name = draft.name.trim().replace(/\s+/g, ' ');
    const category = draft.category.trim().replace(/\s+/g, ' ');
    // Reuse the existing spelling of a category typed in a different case ("starters" → "Starters").
    const known = categories.find((c) => c.toLowerCase() === category.toLowerCase());
    const input: ItemInput = {
      name,
      price: parsePrice(draft.price) as number,
      category: known || category,
      diet: draft.diet,
      description: draft.description.trim(),
      imageUrl: draft.imageUrl,
      isAvailable: draft.isAvailable,
      // Same as the price: no MRP strike-through. Empty = clear it.
      originalPrice: (() => {
        const mrp = draft.mrp.trim() ? parsePrice(draft.mrp) : null;
        return mrp !== null && mrp > (parsePrice(draft.price) as number) ? mrp : null;
      })(),
    };
    savingRef.current = true;
    setSaving(true);
    setServerErr(null);
    try {
      await onSave(input, editing);
      savingRef.current = false;
      onClose();
    } catch (e) {
      setServerErr(errorMessage(e, "Couldn't save the item. Check your internet and try again."));
      savingRef.current = false;
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!editing || deleting) return;
    setDeleting(true);
    setDeleteErr(null);
    const res = await onDelete(editing);
    if (res.ok) { onClose(); return; }
    setDeleting(false);
    setDeleteErr({ text: res.error });
  };

  const title = !mode ? '' : mode.kind === 'edit' ? 'Edit item' : mode.kind === 'duplicate' ? 'Copy of item' : 'Add new item';
  const diets: { key: Diet; label: string; c: string }[] = [
    { key: 'veg', label: 'Veg', c: color.veg },
    { key: 'nonveg', label: 'Non-veg', c: color.nonVeg },
    { key: 'egg', label: 'Egg', c: color.warning },
  ];

  return (
    <Modal visible={!!mode} animationType="slide" onRequestClose={requestClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.bg }}>
        <View style={[styles.head, { paddingTop: insets.top + space.xs }]}>
          <IconButton icon="close" label="Close" onPress={requestClose} />
          <Text style={[font.h2, { color: color.text, flex: 1 }]} numberOfLines={1}>{title}</Text>
          {editing ? (
            <IconButton icon="copy-outline" label="Duplicate item" onPress={() => { if (!saving && !deleting) onDuplicate(editing); }} />
          ) : null}
        </View>

        <ScrollView ref={scrollRef} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {serverErr ? (
            <View style={styles.errBox} accessibilityLiveRegion="assertive">
              <Ionicons name="alert-circle" size={22} color={color.alert} />
              <Text style={[font.body, { color: color.alertDark, flex: 1, fontWeight: '700' }]}>{serverErr}</Text>
            </View>
          ) : null}

          {/* Photo */}
          <View style={styles.photoRow}>
            <View style={styles.photo}>
              <NetImage
                uri={draft.imageUrl}
                thumbPx={500}
                style={StyleSheet.absoluteFill}
                accessibilityLabel="Dish photo"
                fallback={<Ionicons name="image-outline" size={34} color={color.textMuted} />}
              />
              {photoBusy ? (
                <View style={styles.photoBusy}><ActivityIndicator color={color.textInverse} /></View>
              ) : null}
            </View>
            <View style={{ flex: 1, gap: space.xs }}>
              <Text style={[font.label, { color: color.textMuted }]}>PHOTO (OPTIONAL)</Text>
              <View style={{ flexDirection: 'row', gap: space.xs }}>
                {Platform.OS !== 'web' ? (
                  <Button label="Camera" icon="camera" variant="secondary" size="secondary" onPress={() => addPhoto('camera')} disabled={photoBusy || saving} style={{ flex: 1, paddingHorizontal: space.xs }} />
                ) : null}
                <Button label="Gallery" icon="images" variant="secondary" size="secondary" onPress={() => addPhoto('gallery')} disabled={photoBusy || saving} style={{ flex: 1, paddingHorizontal: space.xs }} />
              </View>
              {draft.imageUrl && !photoBusy ? (
                <Pressable onPress={() => set('imageUrl', null)} accessibilityRole="button" hitSlop={8} style={{ alignSelf: 'flex-start' }}>
                  <Text style={[font.small, { color: color.alertDark, fontWeight: '800' }]}>Remove photo</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          {photoBusy ? <Text style={[font.small, { color: color.textMuted }]}>Uploading photo…</Text> : null}
          {photoErr ? <Text style={styles.err}>{photoErr}</Text> : null}

          {/* Name */}
          <Text style={styles.label}>DISH NAME *</Text>
          <TextInput
            value={draft.name}
            onChangeText={(t) => set('name', t.slice(0, NAME_MAX))}
            onBlur={() => setTouched((x) => ({ ...x, name: true }))}
            placeholder="e.g. Chicken Biryani"
            placeholderTextColor={color.textMuted}
            style={[styles.input, show('name') ? styles.inputBad : null]}
            autoCapitalize="words"
            returnKeyType="next"
            onSubmitEditing={() => priceRef.current?.focus()}
            editable={!saving}
            accessibilityLabel="Dish name"
          />
          {show('name') ? <Text style={styles.err}>{show('name')}</Text> : null}

          {/* Price */}
          <Text style={styles.label}>PRICE *</Text>
          <View style={[styles.priceBox, show('price') ? styles.inputBad : null]}>
            <Text style={[font.money, { color: color.text }]}>₹</Text>
            <TextInput
              ref={priceRef}
              value={draft.price}
              onChangeText={(t) => set('price', t.replace(/[^\d.]/g, ''))}
              onBlur={() => setTouched((x) => ({ ...x, price: true }))}
              placeholder="0"
              placeholderTextColor={color.textMuted}
              keyboardType="decimal-pad"
              maxLength={9}
              style={[font.money, { flex: 1, color: color.text, paddingVertical: 0 }]}
              editable={!saving}
              accessibilityLabel="Price in rupees"
            />
          </View>
          {show('price') ? <Text style={styles.err}>{show('price')}</Text> : null}

          {/* MRP (optional strike-through price) */}
          <Text style={styles.label}>MRP (OPTIONAL)</Text>
          <View style={[styles.priceBox, { minHeight: touch.secondary + 4 }, show('mrp') ? styles.inputBad : null]}>
            <Text style={[font.h3, { color: color.textMuted }]}>₹</Text>
            <TextInput
              value={draft.mrp}
              onChangeText={(t) => set('mrp', t.replace(/[^\d.]/g, ''))}
              onBlur={() => setTouched((x) => ({ ...x, mrp: true }))}
              placeholder="Higher price shown crossed out"
              placeholderTextColor={color.textMuted}
              keyboardType="decimal-pad"
              maxLength={9}
              style={[font.body, { flex: 1, color: color.text, paddingVertical: 0 }]}
              editable={!saving}
              accessibilityLabel="MRP in rupees, optional"
            />
          </View>
          {show('mrp') ? <Text style={styles.err}>{show('mrp')}</Text> : (
            <Text style={styles.hint}>Leave empty if there is no MRP. Customers see it crossed out next to your price.</Text>
          )}

          {/* Veg / non-veg / egg */}
          <Text style={styles.label}>TYPE *</Text>
          <View style={{ flexDirection: 'row', gap: space.xs }}>
            {diets.map((d) => {
              const sel = draft.diet === d.key;
              return (
                <Pressable
                  key={d.key}
                  onPress={() => set('diet', d.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: sel }}
                  style={[styles.diet, sel && { borderColor: d.c, backgroundColor: d.c }]}
                >
                  <View style={[styles.vegBox, { borderColor: sel ? color.textInverse : d.c }]}>
                    <View style={[styles.vegDot, { backgroundColor: sel ? color.textInverse : d.c }]} />
                  </View>
                  <Text style={[font.h3, { color: sel ? color.textInverse : color.text }]}>{d.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Category */}
          <Text style={styles.label}>CATEGORY</Text>
          {categories.length ? (
            <View style={styles.cats}>
              {categories.map((c) => {
                const sel = !newCat && draft.category.toLowerCase() === c.toLowerCase();
                return (
                  <Pressable
                    key={c}
                    onPress={() => { setNewCat(false); set('category', sel ? '' : c); }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: sel }}
                    style={[styles.cat, sel && { backgroundColor: color.text, borderColor: color.text }]}
                  >
                    <Text style={[font.small, { color: sel ? color.textInverse : color.text, fontWeight: '800' }]} numberOfLines={1}>{c}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => { if (!newCat) { setNewCat(true); set('category', ''); } }}
                accessibilityRole="button"
                style={[styles.cat, { borderStyle: 'dashed' }, newCat && { borderColor: color.info, backgroundColor: color.infoTint }]}
              >
                <Text style={[font.small, { color: color.info, fontWeight: '800' }]}>+ New category</Text>
              </Pressable>
            </View>
          ) : null}
          {newCat || !categories.length ? (
            <TextInput
              value={draft.category}
              onChangeText={(t) => set('category', t.slice(0, 41))}
              onBlur={() => setTouched((x) => ({ ...x, category: true }))}
              placeholder="e.g. Biryani, Starters, Drinks"
              placeholderTextColor={color.textMuted}
              style={[styles.input, show('category') ? styles.inputBad : null]}
              autoCapitalize="words"
              autoFocus={newCat && categories.length > 0}
              editable={!saving}
              accessibilityLabel="New category name"
            />
          ) : null}
          {show('category') ? <Text style={styles.err}>{show('category')}</Text> : null}
          {!draft.category.trim() ? <Text style={styles.hint}>No category: the dish shows under "Other".</Text> : null}

          {/* Description */}
          <Text style={styles.label}>DESCRIPTION (OPTIONAL)</Text>
          <TextInput
            value={draft.description}
            onChangeText={(t) => set('description', t.slice(0, DESC_MAX))}
            placeholder="e.g. Served with raita and salan"
            placeholderTextColor={color.textMuted}
            style={[styles.input, { minHeight: 88, textAlignVertical: 'top', paddingTop: space.sm }]}
            multiline
            editable={!saving}
            accessibilityLabel="Description"
          />
          <Text style={styles.hint}>{draft.description.length}/{DESC_MAX}</Text>

          {/* Availability */}
          <Text style={styles.label}>AVAILABLE NOW?</Text>
          <View style={{ flexDirection: 'row', gap: space.xs }}>
            <Chip label="In stock" selected={draft.isAvailable} tone="green" onPress={() => set('isAvailable', true)} style={{ flex: 1 }} />
            <Chip label="Out of stock" selected={!draft.isAvailable} tone="red" onPress={() => set('isAvailable', false)} style={{ flex: 1 }} />
          </View>

          {/* Delete (edit only) */}
          {editing ? (
            <View style={{ marginTop: space.lg, gap: space.xs }}>
              {confirm === 'delete' ? (
                <View style={styles.confirm}>
                  <Text style={[font.h3, { color: color.alertDark }]}>Delete "{editing.name}"?</Text>
                  <Text style={[font.body, { color: color.textSecondary }]}>Customers won't see it any more. This can't be undone.</Text>
                  {deleteErr ? <Text style={styles.err}>{deleteErr.text}</Text> : null}
                  <View style={{ flexDirection: 'row', gap: space.xs }}>
                    <Button label="Cancel" variant="secondary" size="secondary" onPress={() => { setConfirm(null); setDeleteErr(null); }} disabled={deleting} style={{ flex: 1 }} />
                    <Button label="Yes, delete" variant="reject" size="secondary" icon="trash" onPress={doDelete} loading={deleting} style={{ flex: 1 }} />
                  </View>
                </View>
              ) : (
                <Button label="Delete item" variant="rejectOutline" size="secondary" icon="trash-outline" onPress={() => setConfirm('delete')} disabled={saving} />
              )}
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.foot, { paddingBottom: insets.bottom + space.sm }]}>
          {confirm === 'discard' ? (
            <View style={{ gap: space.xs }}>
              <Text style={[font.h3, { color: color.text }]}>Leave without saving?</Text>
              <View style={{ flexDirection: 'row', gap: space.xs }}>
                <Button label="Keep editing" variant="secondary" size="secondary" onPress={() => setConfirm(null)} style={{ flex: 1 }} />
                <Button label="Discard" variant="reject" size="secondary" onPress={onClose} style={{ flex: 1 }} />
              </View>
            </View>
          ) : (
            <>
              {triedSave && Object.keys(errs).length ? (
                <Text style={[styles.err, { marginTop: 0, marginBottom: space.xs }]}>Please fix the red boxes above.</Text>
              ) : null}
              <Button
                label={photoBusy ? 'UPLOADING PHOTO…' : editing ? 'SAVE CHANGES' : 'ADD ITEM'}
                icon={editing ? 'checkmark' : 'add'}
                variant="accept"
                onPress={save}
                loading={saving}
                disabled={photoBusy || deleting}
              />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm,
    backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.border,
  },
  body: { padding: space.md, paddingBottom: space.xxl, gap: space.xs },
  label: { ...font.label, color: color.textMuted, marginTop: space.sm },
  hint: { ...font.small, color: color.textMuted },
  err: { ...font.body, color: color.alertDark, fontWeight: '700', marginTop: 2 },
  input: {
    ...font.body, color: color.text, backgroundColor: color.surface, borderWidth: 2, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.sm, minHeight: touch.secondary + 4,
  },
  inputBad: { borderColor: color.alert, backgroundColor: color.alertTint },
  priceBox: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.surface, borderWidth: 2, borderColor: color.border,
    borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 64,
  },
  diet: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, minHeight: touch.secondary + 4,
    borderRadius: radius.md, borderWidth: 2, borderColor: color.border, backgroundColor: color.surface,
  },
  vegBox: { width: 18, height: 18, borderWidth: 2, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  vegDot: { width: 8, height: 8, borderRadius: 4 },
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  cat: {
    minHeight: touch.min, paddingHorizontal: space.sm, borderRadius: radius.pill, borderWidth: 2, borderColor: color.border,
    backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center', maxWidth: '100%',
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  photo: {
    width: 104, height: 104, borderRadius: radius.md, backgroundColor: color.surfaceAlt, borderWidth: 1, borderColor: color.border,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  photoBusy: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(11,13,18,0.5)', alignItems: 'center', justifyContent: 'center' },
  errBox: { flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: color.alertTint, borderRadius: radius.md, padding: space.sm },
  confirm: { gap: space.xs, padding: space.md, borderRadius: radius.md, borderWidth: 2, borderColor: color.alert, backgroundColor: color.alertTint },
  foot: { paddingHorizontal: space.md, paddingTop: space.sm, backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.border },
});
