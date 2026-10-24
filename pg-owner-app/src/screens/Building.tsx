// Building info: description, amenities, house rules and photos (each section saves on its own). Photos upload
// as public listing media (XHR multipart, base64 JSON fallback: src/lib/photo.ts), then the gallery is saved.
// Name, address, rents and the "Verified" badge stay with the ZCS housing team.
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, font, radius, space } from '../theme';
import { Badge, Button, Card, Chip, ErrorStrip, IconButton, Sheet, SkeletonCard } from '../ui/kit';
import { Banner, Field, Screen, SectionTitle } from '../ui/Screen';
import { ListingSwitcher } from '../ui/ListingSwitcher';
import { useListing } from '../state/ListingProvider';
import { useToast } from '../ui/Toast';
import { ownerApi } from '../api/ownerApi';
import { errorMessage } from '../lib/http';
import { imageUrl, pickPhoto, uploadPhoto, type PhotoSource } from '../lib/photo';
import { LIMITS } from '../config';
import type { ListingDetail, Photo, PhotoCategory, RuleGroup } from '../types';
import type { ScreenProps } from '../nav';

const AMENITY_IDEAS = ['Wi-Fi', 'Hot water', 'Power backup', 'Washing machine', 'RO drinking water', 'Housekeeping', 'CCTV', 'Parking', 'Study table', 'Wardrobe', 'Fridge', 'Lift'];
const PHOTO_LABEL: Record<PhotoCategory, string> = { ROOM: 'Room', BATHROOM: 'Bathroom', MESS: 'Mess', BUILDING: 'Building', COMMON_AREA: 'Common area', OTHER: 'Other' };

/** One saving state per section. */
function useSaver(setDetail: (d: ListingDetail) => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<{ listing: ListingDetail; message?: string }>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      setDetail(r.listing);
      toast.show(r.message || 'Saved.', 'success');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export default function BuildingScreen({ navigation }: ScreenProps<'Building'>) {
  const { detail, loading, error, reload, setDetail, current } = useListing();
  return (
    <Screen title="Building info" subtitle={current?.name} onBack={() => navigation.goBack()} right={<ListingSwitcher />} refreshing={loading && !!detail} onRefresh={reload} keyboard>
      {error && !detail ? <ErrorStrip text={error} onRetry={reload} busy={loading} /> : null}
      {!detail && !error ? <><SkeletonCard /><SkeletonCard /></> : null}
      {detail ? (
        <>
          <Card style={st.idCard}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[font.h3, { color: color.text }]}>{detail.name}</Text>
              <Text style={[font.small, { color: color.textMuted }]}>{detail.address}</Text>
            </View>
            {detail.isVerified ? <Badge text="Verified by ZCS" fg={color.ok} bg={color.okTint} icon="shield-checkmark" /> : <Badge text="Not verified yet" fg={color.textMuted} bg={color.surfaceAlt} />}
          </Card>
          <Text style={[font.small, { color: color.textMuted }]}>Name, address, rents and verification are managed by the ZCS housing team. Changes below show to students right away.</Text>
          <DescriptionSection key={`d-${detail.id}`} detail={detail} setDetail={setDetail} />
          <AmenitiesSection key={`a-${detail.id}`} detail={detail} setDetail={setDetail} />
          <RulesSection key={`r-${detail.id}`} detail={detail} setDetail={setDetail} />
          <PhotosSection key={`p-${detail.id}`} detail={detail} setDetail={setDetail} />
        </>
      ) : null}
    </Screen>
  );
}

type SectionProps = { detail: ListingDetail; setDetail: (d: ListingDetail) => void };

function DescriptionSection({ detail, setDetail }: SectionProps) {
  const [text, setText] = useState(detail.description);
  useEffect(() => { setText(detail.description); }, [detail.description]);
  const s = useSaver(setDetail);
  const dirty = text.trim() !== detail.description.trim();
  return (
    <>
      <SectionTitle text="About your PG" />
      <Card style={{ gap: space.sm }}>
        <Field label="Description" value={text} onChangeText={(v) => setText(v.slice(0, LIMITS.DESCRIPTION_MAX))} multiline
          placeholder="What makes your PG a good home: rooms, food, location, staff." hint={`${text.length} / ${LIMITS.DESCRIPTION_MAX}. No phone numbers.`} />
        {s.error ? <Banner tone="error" text={s.error} /> : null}
        <Button label="Save description" size="secondary" onPress={() => s.run(() => ownerApi.saveInfo(detail.id, { description: text.trim() }))} loading={s.busy} disabled={!dirty} />
      </Card>
    </>
  );
}

function AmenitiesSection({ detail, setDetail }: SectionProps) {
  const [list, setList] = useState<string[]>(detail.amenities);
  const [custom, setCustom] = useState('');
  useEffect(() => { setList(detail.amenities); }, [detail.amenities]);
  const s = useSaver(setDetail);
  const has = (a: string) => list.some((x) => x.toLowerCase() === a.toLowerCase());
  const toggle = (a: string) => setList((l) => (has(a) ? l.filter((x) => x.toLowerCase() !== a.toLowerCase()) : l.length < LIMITS.AMENITIES_MAX ? [...l, a] : l));
  const addCustom = () => { const a = custom.trim().slice(0, LIMITS.AMENITY_LEN); if (a && !has(a)) toggle(a); setCustom(''); };
  const dirty = JSON.stringify(list) !== JSON.stringify(detail.amenities);
  const shown = useMemo(() => [...list, ...AMENITY_IDEAS.filter((a) => !list.some((x) => x.toLowerCase() === a.toLowerCase()))], [list]);
  return (
    <>
      <SectionTitle text="Amenities" />
      <Card style={{ gap: space.sm }}>
        <View style={st.wrap}>
          {shown.map((a) => <Chip key={a} label={a} selected={has(a)} icon={has(a) ? 'checkmark' : 'add'} onPress={() => toggle(a)} />)}
        </View>
        <View style={st.addRow}>
          <TextInput value={custom} onChangeText={setCustom} placeholder="Add another amenity" placeholderTextColor={color.textMuted} style={st.input}
            onSubmitEditing={addCustom} returnKeyType="done" accessibilityLabel="Add another amenity" maxLength={LIMITS.AMENITY_LEN} />
          <IconButton icon="add" label="Add amenity" onPress={addCustom} bg={color.primary} tint={color.textInverse} disabled={!custom.trim()} />
        </View>
        {s.error ? <Banner tone="error" text={s.error} /> : null}
        <Button label="Save amenities" size="secondary" onPress={() => s.run(() => ownerApi.saveInfo(detail.id, { amenities: list }))} loading={s.busy} disabled={!dirty} />
      </Card>
    </>
  );
}

function RulesSection({ detail, setDetail }: SectionProps) {
  type G = { category: string; text: string };
  const toDraft = (groups: RuleGroup[]): G[] => groups.map((g) => ({ category: g.category, text: g.rules.join('\n') }));
  const [groups, setGroups] = useState<G[]>(toDraft(detail.houseRules));
  const [picking, setPicking] = useState(false);
  useEffect(() => { setGroups(toDraft(detail.houseRules)); }, [detail.houseRules]);
  const s = useSaver(setDetail);
  const labelOf = (k: string) => detail.ruleCategories.find((c) => c.key === k)?.label || k;
  const payload = groups.map((g) => ({ category: g.category, rules: g.text.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, LIMITS.RULES_PER_GROUP) })).filter((g) => g.rules.length);
  const dirty = JSON.stringify(payload) !== JSON.stringify(detail.houseRules);
  const unused = detail.ruleCategories.filter((c) => !groups.some((g) => g.category === c.key));
  return (
    <>
      <SectionTitle text="House rules" />
      <Card style={{ gap: space.sm }}>
        {!groups.length ? <Text style={[font.body, { color: color.textMuted }]}>No rules yet. Add groups like Gate & curfew or Visitors.</Text> : null}
        {groups.map((g, i) => (
          <View key={g.category} style={{ gap: space.xxs }}>
            <View style={st.groupHead}>
              <Text style={[font.h3, { color: color.text, flex: 1 }]}>{labelOf(g.category)}</Text>
              <IconButton icon="trash-outline" label={`Remove ${labelOf(g.category)}`} onPress={() => setGroups((x) => x.filter((_, j) => j !== i))} tint={color.alertDark} bg={color.alertTint} size={34} />
            </View>
            <TextInput value={g.text} onChangeText={(v) => setGroups((x) => x.map((y, j) => (j === i ? { ...y, text: v } : y)))} multiline
              placeholder="One rule per line" placeholderTextColor={color.textMuted} style={[st.input, { minHeight: 80, textAlignVertical: 'top', paddingTop: 10 }]}
              accessibilityLabel={`${labelOf(g.category)} rules, one per line`} />
          </View>
        ))}
        {unused.length ? <Button label="Add a rule group" icon="add" variant="secondary" size="secondary" onPress={() => setPicking(true)} /> : null}
        {s.error ? <Banner tone="error" text={s.error} /> : null}
        <Button label="Save house rules" size="secondary" onPress={() => s.run(() => ownerApi.saveHouseRules(detail.id, payload))} loading={s.busy} disabled={!dirty} />
      </Card>
      <Sheet visible={picking} onClose={() => setPicking(false)} title="Which rules?">
        <View style={st.wrap}>
          {unused.map((c) => <Chip key={c.key} label={c.label} selected={false} onPress={() => { setGroups((x) => [...x, { category: c.key, text: '' }]); setPicking(false); }} />)}
        </View>
      </Sheet>
    </>
  );
}

function PhotosSection({ detail, setDetail }: SectionProps) {
  const [photos, setPhotos] = useState<Photo[]>(detail.photos);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState<PhotoCategory>('ROOM');
  const [choosing, setChoosing] = useState(false);
  const [upError, setUpError] = useState<string | null>(null);
  useEffect(() => { setPhotos(detail.photos); }, [detail.photos]);
  const s = useSaver(setDetail);
  const dirty = JSON.stringify(photos.map((p) => [p.url, p.category, p.isCover])) !== JSON.stringify(detail.photos.map((p) => [p.url, p.category, p.isCover]));

  const add = async (src: PhotoSource) => {
    setChoosing(false);
    setUpError(null);
    const picked = await pickPhoto(src);
    if (!picked.ok) { if (picked.reason !== 'cancelled') setUpError(picked.message); return; }
    setUploading(true);
    try {
      const up = await uploadPhoto(picked.uri, picked.mimeType);
      setPhotos((p) => [...p, { url: up.url, category, caption: '', roomType: null, isCover: p.length === 0 }]);
    } catch (e) {
      setUpError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };
  const setCover = (i: number) => setPhotos((p) => p.map((x, j) => ({ ...x, isCover: j === i })));
  const remove = (i: number) => setPhotos((p) => {
    const next = p.filter((_, j) => j !== i);
    if (next.length && !next.some((x) => x.isCover)) next[0] = { ...next[0], isCover: true };
    return next;
  });

  return (
    <>
      <SectionTitle text={`Photos (${photos.length} / ${LIMITS.MAX_PHOTOS})`} />
      <Card style={{ gap: space.sm }}>
        <View style={st.grid}>
          {photos.map((p, i) => (
            <View key={`${p.url}-${i}`} style={st.tile}>
              <Image source={{ uri: imageUrl(p.url) || undefined }} style={st.img} accessibilityLabel={`${PHOTO_LABEL[p.category]} photo`} />
              {p.isCover ? <View style={st.cover}><Text style={[font.label, { color: color.textInverse }]}>COVER</Text></View> : null}
              <View style={st.tileBar}>
                <Text style={[font.label, { color: color.textInverse, flex: 1 }]} numberOfLines={1}>{PHOTO_LABEL[p.category]}</Text>
                {!p.isCover ? (
                  <Pressable onPress={() => setCover(i)} accessibilityRole="button" accessibilityLabel="Make cover photo" hitSlop={6}>
                    <Ionicons name="star-outline" size={18} color={color.textInverse} />
                  </Pressable>
                ) : null}
                <Pressable onPress={() => remove(i)} accessibilityRole="button" accessibilityLabel="Remove photo" hitSlop={6}>
                  <Ionicons name="trash-outline" size={18} color={color.textInverse} />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
        <Text style={[font.label, { color: color.textSecondary }]}>NEW PHOTOS ARE</Text>
        <View style={st.wrap}>
          {detail.photoCategories.map((c) => <Chip key={c} label={PHOTO_LABEL[c]} selected={category === c} onPress={() => setCategory(c)} />)}
        </View>
        {upError ? <Banner tone="error" text={upError} /> : null}
        {photos.length < LIMITS.MAX_PHOTOS ? (
          <Button label={uploading ? 'Uploading…' : 'Add a photo'} icon="camera-outline" variant="secondary" size="secondary" onPress={() => setChoosing(true)} loading={uploading} />
        ) : null}
        {s.error ? <Banner tone="error" text={s.error} /> : null}
        <Button label="Save photos" size="secondary" onPress={() => s.run(() => ownerApi.savePhotos(detail.id, photos))} loading={s.busy} disabled={!dirty || uploading} />
      </Card>
      <Sheet visible={choosing} onClose={() => setChoosing(false)} title="Add a photo">
        <View style={{ gap: space.xs }}>
          <Button label="Take a photo" icon="camera-outline" onPress={() => add('camera')} />
          <Button label="Choose from gallery" icon="images-outline" variant="secondary" onPress={() => add('gallery')} />
        </View>
      </Sheet>
    </>
  );
}

const st = StyleSheet.create({
  idCard: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  input: { ...font.body, flex: 1, color: color.text, minHeight: 44, borderWidth: 1.5, borderColor: color.border, borderRadius: radius.md, paddingHorizontal: 10, backgroundColor: color.surface },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  tile: { width: '48.5%', aspectRatio: 4 / 3, borderRadius: radius.md, overflow: 'hidden', backgroundColor: color.surfaceAlt },
  img: { width: '100%', height: '100%' },
  cover: { position: 'absolute', top: 6, left: 6, backgroundColor: color.primary, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  tileBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: 'rgba(27,24,70,0.6)' },
});
