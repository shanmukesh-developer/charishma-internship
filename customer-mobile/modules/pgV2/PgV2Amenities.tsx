/**
 * Amenities, listing style (no icon blobs): every backend amenity name maps to one canonical amenity
 * with the right lucide line icon and a group. Rendered as a grouped 2-column list (20 px icons,
 * stroke 1.6, slate) with an optional "Included" / "Extra ₹X" tag, and a compact strip for the
 * Building and Overview screens.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import IArrowUpDown from 'lucide-react-native/icons/arrow-up-down';
import IDumbbell from 'lucide-react-native/icons/dumbbell';
import IWifi from 'lucide-react-native/icons/wifi';
import IUtensilsCrossed from 'lucide-react-native/icons/utensils-crossed';
import IAirVent from 'lucide-react-native/icons/air-vent';
import IWasher from 'lucide-react-native/icons/washing-machine';
import IBattery from 'lucide-react-native/icons/battery-charging';
import IShower from 'lucide-react-native/icons/shower-head';
import IDroplets from 'lucide-react-native/icons/droplets';
import ICctv from 'lucide-react-native/icons/cctv';
import IParking from 'lucide-react-native/icons/square-parking';
import IBook from 'lucide-react-native/icons/book-open';
import ISparkles from 'lucide-react-native/icons/sparkles';
import IShield from 'lucide-react-native/icons/shield-check';
import ISofa from 'lucide-react-native/icons/sofa';
import ILampDesk from 'lucide-react-native/icons/lamp-desk';
import IFingerprint from 'lucide-react-native/icons/fingerprint-pattern';
import IFire from 'lucide-react-native/icons/fire-extinguisher';
import IBed from 'lucide-react-native/icons/bed-double';
import ITv from 'lucide-react-native/icons/tv';
import IFridge from 'lucide-react-native/icons/refrigerator';
import IMedical from 'lucide-react-native/icons/briefcase-medical';
import IBus from 'lucide-react-native/icons/bus';
import IDoorClosed from 'lucide-react-native/icons/door-closed';
import IUserCheck from 'lucide-react-native/icons/user-check';
import IGamepad from 'lucide-react-native/icons/gamepad-2';
import ITrees from 'lucide-react-native/icons/trees';
import IKey from 'lucide-react-native/icons/key-round';
import ICircleCheck from 'lucide-react-native/icons/circle-check';
import { amenityLabel } from '../../modules/pg/ui';
import { PG2, R, W } from './pgV2Theme';
import { themedSheet } from '../../utils/themeNow';

export const SLATE = '#475569';
export const LINE_ICON = { size: 20, stroke: 1.6 } as const;

export type AmenityGroup = 'Essentials' | 'Comfort' | 'Food & services' | 'Safety' | 'Fitness & leisure';
export const GROUP_ORDER: AmenityGroup[] = ['Essentials', 'Comfort', 'Food & services', 'Safety', 'Fitness & leisure'];

interface Def { key: string; label: string; icon: LucideIcon; group: AmenityGroup; match: RegExp }
/** Order matters: the first match wins ("hot water" before "water", "biometric" before "lock"). */
const DEFS: Def[] = [
  { key: 'wifi', label: 'Wi-Fi', icon: IWifi, group: 'Essentials', match: /wi-?fi|internet|fiber|fibre|broadband/i },
  { key: 'power', label: 'Power backup', icon: IBattery, group: 'Essentials', match: /power|backup|inverter|generator/i },
  { key: 'hotwater', label: 'Hot water', icon: IShower, group: 'Essentials', match: /hot water|geyser|solar/i },
  { key: 'water', label: 'RO drinking water', icon: IDroplets, group: 'Essentials', match: /\bro\b|water|purifier|filter/i },
  { key: 'lift', label: 'Lift', icon: IArrowUpDown, group: 'Essentials', match: /\blift\b|elevator/i },
  { key: 'ac', label: 'Air conditioning', icon: IAirVent, group: 'Comfort', match: /\bac\b|air con/i },
  { key: 'furnished', label: 'Furnished room', icon: IBed, group: 'Comfort', match: /furnish|spacious|bed|mattress|single & double/i },
  { key: 'study', label: 'Study table', icon: ILampDesk, group: 'Comfort', match: /study|desk|library|co-?working/i },
  { key: 'wardrobe', label: 'Wardrobe', icon: IDoorClosed, group: 'Comfort', match: /wardrobe|cupboard|almirah/i },
  { key: 'bath', label: 'Attached washroom', icon: IShower, group: 'Comfort', match: /attached|washroom|bath/i },
  { key: 'tv', label: 'TV lounge', icon: ITv, group: 'Fitness & leisure', match: /\btv\b|television/i },
  { key: 'mess', label: 'Mess', icon: IUtensilsCrossed, group: 'Food & services', match: /mess|food|meal|buffet|cafeteria|breakfast|kitchen/i },
  { key: 'laundry', label: 'Laundry', icon: IWasher, group: 'Food & services', match: /laundry|washing/i },
  { key: 'housekeeping', label: 'Housekeeping', icon: ISparkles, group: 'Food & services', match: /housekeep|clean/i },
  { key: 'fridge', label: 'Refrigerator', icon: IFridge, group: 'Food & services', match: /fridge|refrigerator/i },
  { key: 'bus', label: 'Campus bus pickup', icon: IBus, group: 'Food & services', match: /bus|pickup|shuttle/i },
  { key: 'cctv', label: 'CCTV', icon: ICctv, group: 'Safety', match: /cctv|camera/i },
  { key: 'biometric', label: 'Biometric entry', icon: IFingerprint, group: 'Safety', match: /biometric|fingerprint|smart lock/i },
  { key: 'warden', label: 'Warden', icon: IUserCheck, group: 'Safety', match: /warden|caretaker/i },
  { key: 'security', label: 'Security guard', icon: IShield, group: 'Safety', match: /security|guard/i },
  { key: 'fire', label: 'Fire safety', icon: IFire, group: 'Safety', match: /fire/i },
  { key: 'medical', label: 'First aid', icon: IMedical, group: 'Safety', match: /medical|nurse|first aid/i },
  { key: 'keycard', label: 'Keycard entry', icon: IKey, group: 'Safety', match: /keycard|lock/i },
  { key: 'gym', label: 'Gym', icon: IDumbbell, group: 'Fitness & leisure', match: /gym|fitness|yoga|cricket/i },
  { key: 'common', label: 'Common room', icon: ISofa, group: 'Fitness & leisure', match: /lounge|common|terrace/i },
  { key: 'games', label: 'Games room', icon: IGamepad, group: 'Fitness & leisure', match: /gaming|games/i },
  { key: 'parking', label: 'Parking', icon: IParking, group: 'Fitness & leisure', match: /parking/i },
  { key: 'garden', label: 'Garden', icon: ITrees, group: 'Fitness & leisure', match: /garden|park facing|hill view|pool/i },
  { key: 'books', label: 'Reading room', icon: IBook, group: 'Fitness & leisure', match: /reading/i },
];

export interface AmenityItem { key: string; label: string; icon: LucideIcon; group: AmenityGroup; tag?: string }

/** One backend amenity name -> canonical amenity (the PG's own wording kept when it isn't generic). */
export const amenityInfo = (raw: string): AmenityItem => {
  const name = amenityLabel(raw);
  const d = DEFS.find((x) => x.match.test(name));
  if (!d) return { key: name.toLowerCase(), label: name, icon: ICircleCheck, group: 'Comfort' };
  return { key: d.key, label: d.label, icon: d.icon, group: d.group };
};

/** Unique canonical amenities, in group order. `tags` maps an amenity key to "Included" / "Extra ₹X". */
export const normaliseAmenities = (names: string[], tags: Record<string, string> = {}): AmenityItem[] => {
  const out: AmenityItem[] = [];
  names.forEach((n) => {
    const a = amenityInfo(n);
    if (!out.some((x) => x.key === a.key)) out.push({ ...a, tag: tags[a.key] });
  });
  return out.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
};

function Row({ a }: { a: AmenityItem }) {
  const extra = a.tag?.startsWith('Extra');
  return (
    <View style={st.row} accessible accessibilityLabel={`${a.label}${a.tag ? `, ${a.tag}` : ''}`}>
      <a.icon size={LINE_ICON.size} color={SLATE} strokeWidth={LINE_ICON.stroke} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.label} numberOfLines={2}>{a.label}</Text>
        {a.tag ? <Text style={[st.tag, extra && { color: PG2.amber }]} numberOfLines={1}>{a.tag}</Text> : null}
      </View>
    </View>
  );
}

/** Two-column rows with hairline dividers. */
export function AmenityRows({ items }: { items: AmenityItem[] }) {
  const pairs: AmenityItem[][] = [];
  for (let i = 0; i < items.length; i += 2) pairs.push(items.slice(i, i + 2));
  return (
    <View style={st.card}>
      {pairs.map((p, i) => (
        <View key={p[0].key} style={[st.pair, i > 0 && st.divider]}>
          <Row a={p[0]} />
          {p[1] ? <Row a={p[1]} /> : <View style={{ flex: 1 }} />}
        </View>
      ))}
    </View>
  );
}

/** Grouped list with small section headers (Facilities screen, Overview tab). */
export function AmenityGroups({ items }: { items: AmenityItem[] }) {
  return (
    <View style={{ gap: 18 }}>
      {GROUP_ORDER.map((g) => {
        const list = items.filter((a) => a.group === g);
        if (!list.length) return null;
        return (
          <View key={g}>
            <Text style={st.groupTitle}>{g}</Text>
            <AmenityRows items={list} />
          </View>
        );
      })}
    </View>
  );
}

const st = themedSheet(() => ({
  card: { backgroundColor: PG2.card, borderRadius: R.md, borderWidth: StyleSheet.hairlineWidth, borderColor: PG2.line, paddingHorizontal: 14 },
  pair: { flexDirection: 'row', gap: 14, paddingVertical: 13 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: PG2.line },
  row: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 10, minWidth: 0 },
  label: { fontSize: 14, fontWeight: W.label, color: PG2.ink, lineHeight: 20 },
  tag: { marginTop: 1, fontSize: 11.5, color: PG2.green },
  groupTitle: { fontSize: 12.5, fontWeight: W.label, color: PG2.muted, marginBottom: 8, letterSpacing: 0.1 },
}));
