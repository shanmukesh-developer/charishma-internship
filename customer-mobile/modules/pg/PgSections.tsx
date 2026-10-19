/**
 * PG detail sections (v2): overview (key facts, highlights, about, amenities), house rules by category,
 * policies + moving in, safety & staff, location & nearby, FAQ. Each renders only what the housing team
 * filled in; the screen leaves a section out entirely when it has nothing (backend `sections` list).
 * Copy is plain and specific; rent is informational (Zenvy never collects rent).
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, LayoutAnimation, Linking, Alert, useWindowDimensions } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import {
  INCLUDED_KEYS, INCLUDED_LABEL, NEARBY_LABEL, chargeText, distanceLabel, fmtRange, inr, mapsUrl, metres, months, ordinal, plural,
  type NearbyCategory, type PgDetail, type PgLocationGuide, type PgMoveIn, type PgPolicies, type PgRuleGroup, type PgSafety, type PgTimings, type RuleCategory,
} from './pgApi';
import {
  usePgPalette, Press, SectionHeading, ICON, TYPE, amenityIcon, amenityLabel, s as ui,
  IconCheck, IconUsers, IconMoon, IconDoorOpen, IconCigaretteOff, IconVolumeX, IconUtensils, IconPaw, IconSparklesRule, IconWasher, IconPlug, IconInfo,
  IconClipboard, IconWallet, IconCircleCheck, IconCalendarDays, IconBan, IconWrench, IconFileText, IconShieldCheck, IconKey, IconFingerprint, IconIdCard,
  IconUserRound, IconSiren, IconMapPin, IconHospital, IconPill, IconLandmark, IconBus, IconCart, IconDumbbellPlace, IconGraduation, IconChevronDown, IconMessage,
} from './ui';
import { Card, CardRows, InfoRow, SubHeading, Paragraph, Bullets, CheckRow } from './blocks';
import { TimingsCard } from './PgMess';

// ── Overview ───────────────────────────────────────────────────────────────────────────────────
export function KeyFacts({ pg }: { pg: PgDetail }) {
  const p = usePgPalette();
  const rentFrom = pg.rentFrom ?? pg.baseRent;
  const deposit = pg.policies?.deposit?.amount ?? pg.securityDeposit;
  const types = pg.roomTypes;
  const hasRooms = types.length > 0;
  const varies = types.some((t) => t.deposit !== null && t.deposit !== pg.securityDeposit);
  return (
    <View style={[st.facts, { borderColor: p.line, backgroundColor: p.card }]}>
      <Fact label="Rent from" value={rentFrom ? inr(rentFrom) : '—'} sub="per month" />
      <View style={[st.factSep, { backgroundColor: p.line }]} />
      <Fact label="Deposit" value={Number(deposit) > 0 ? inr(deposit) : 'None'} sub={varies ? 'varies by room' : Number(deposit) > 0 ? 'one time' : ' '} />
      <View style={[st.factSep, { backgroundColor: p.line }]} />
      <Fact label="Beds free" value={hasRooms ? String(pg.bedsAvailable) : '—'} sub={hasRooms ? plural(types.length, 'room type') : 'ask the desk'} />
    </View>
  );
}
function Fact({ label, value, sub }: { label: string; value: string; sub: string }) {
  const p = usePgPalette();
  return (
    <View style={st.fact} accessible accessibilityLabel={`${label} ${value} ${sub}`}>
      <Text style={[ui.small, { color: p.muted }]} numberOfLines={1}>{label}</Text>
      <Text style={[st.factValue, { color: p.text }]} numberOfLines={1}>{value}</Text>
      <Text style={[ui.small, { color: p.muted }]} numberOfLines={1}>{sub}</Text>
    </View>
  );
}

export function Highlights({ items }: { items: string[] }) {
  const p = usePgPalette();
  if (!items.length) return null;
  return (
    <View style={{ gap: 12, marginTop: 24 }} accessibilityLabel={`Highlights: ${items.join(', ')}`}>
      {items.map((h) => (
        <View key={h} style={st.highlight}>
          <IconCheck size={16} color={p.success} strokeWidth={2} />
          <Text style={[ui.body, { color: p.text, flex: 1 }]}>{h}</Text>
        </View>
      ))}
    </View>
  );
}

const ABOUT_CLAMP = 5;
export function About({ text }: { text: string }) {
  const p = usePgPalette();
  const [open, setOpen] = useState(false);
  const long = text.length > 280 || text.split('\n').length > ABOUT_CLAMP;
  if (!text) return null;
  return (
    <View>
      <SubHeading title="About this PG" />
      <Text style={[ui.body, { color: p.text }]} numberOfLines={open || !long ? undefined : ABOUT_CLAMP}>{text}</Text>
      {long ? (
        <Press onPress={() => { LayoutAnimation.easeInEaseOut(); setOpen((v) => !v); }} accessibilityLabel={open ? 'Show less' : 'Read more about this PG'} style={st.linkBtn}>
          <Text style={[ui.body, { color: p.text, fontWeight: '600', textDecorationLine: 'underline' }]}>{open ? 'Show less' : 'Read more'}</Text>
        </Press>
      ) : null}
    </View>
  );
}

export function Amenities({ items }: { items: string[] }) {
  const p = usePgPalette();
  const { width } = useWindowDimensions();
  const list = items.map((a) => ({ raw: a, label: amenityLabel(a) })).filter((a) => a.label);
  if (!list.length) return null;
  return (
    <View>
      <SubHeading title="Amenities" />
      <View style={st.amenities}>
        {list.map((a) => {
          const Icon = amenityIcon(a.raw);
          return (
            <View key={a.raw} style={[st.amenity, { width: (width - 32 - 16) / 2 }]} accessibilityLabel={a.label}>
              <Icon size={ICON.size} color={p.sub} strokeWidth={ICON.stroke} />
              <Text style={[ui.body, { color: p.text, flex: 1 }]} numberOfLines={2}>{a.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── House rules ────────────────────────────────────────────────────────────────────────────────
const RULE_ICON: Record<RuleCategory, LucideIcon> = {
  visitors: IconUsers, overnight: IconMoon, gate: IconDoorOpen, smoking: IconCigaretteOff, noise: IconVolumeX, cooking: IconUtensils,
  pets: IconPaw, cleanliness: IconSparklesRule, laundry: IconWasher, electricity: IconPlug, other: IconInfo,
};
export function RulesSection({ groups, timings }: { groups: PgRuleGroup[]; timings: PgTimings | null }) {
  const p = usePgPalette();
  return (
    <View>
      <SectionHeading title="House rules" />
      {timings ? <TimingsCard timings={timings} /> : null}
      {groups.length ? (
        <CardRows style={timings ? { marginTop: 16 } : undefined}>
          {groups.map((g) => {
            const Icon = RULE_ICON[g.category] || IconInfo;
            return (
              <View key={g.category} style={st.ruleGroup}>
                <View style={st.ruleHead}>
                  <Icon size={ICON.size} color={p.sub} strokeWidth={ICON.stroke} />
                  <Text style={[st.groupTitle, { color: p.text }]} accessibilityRole="header">{g.label}</Text>
                </View>
                <View style={{ paddingLeft: 30 }}><Bullets items={g.rules} /></View>
              </View>
            );
          })}
        </CardRows>
      ) : null}
    </View>
  );
}

// ── Policies + moving in ───────────────────────────────────────────────────────────────────────
const METHOD_LABEL = { cash: 'cash', upi: 'UPI', bank: 'bank transfer' } as const;
const joinOr = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function PoliciesSection({ policies, moveIn, pgDeposit }: { policies: PgPolicies | null; moveIn: PgMoveIn | null; pgDeposit: number }) {
  const p = usePgPalette();
  const b = policies?.booking;
  const r = policies?.rent;
  const d = policies?.deposit;
  const s = policies?.stay;
  const c = policies?.cancellation;
  const m = policies?.maintenance;
  const included = policies?.included || [];
  const extras = policies?.extraCharges || [];
  const depositAmount = d?.amount ?? (Number(pgDeposit) > 0 ? pgDeposit : null);
  const hasRent = !!(r && (r.dueDay || r.lateFee || r.methods?.length || r.notes));
  const hasDeposit = !!(d && (d.amount !== undefined || d.refundDays !== undefined || d.deductions));
  const hasStay = !!(s && (s.noticeMonths !== undefined || s.lockInMonths !== undefined || s.notes));
  const hasCancel = !!(c && (c.freeCancelDays !== undefined || c.refundPercent !== undefined || c.text));
  const firstSub = { marginTop: 0 };
  let first = true;
  const sub = (title: string) => {
    const style = first ? firstSub : undefined;
    first = false;
    return <SubHeading title={title} style={style} />;
  };

  return (
    <View>
      <SectionHeading title="Policies" />
      {b ? (
        <>
          {sub('Booking')}
          <CardRows>
            {b.steps ? <InfoRow icon={IconClipboard} label="How to book" value={b.steps} /> : null}
            {b.tokenAmount !== undefined ? <InfoRow icon={IconWallet} label="Token amount" value={b.tokenAmount ? inr(b.tokenAmount) : 'No token needed'} /> : null}
            {b.confirmation ? <InfoRow icon={IconCircleCheck} label="Confirmation" value={b.confirmation} /> : null}
          </CardRows>
        </>
      ) : null}

      {hasRent ? (
        <>
          {sub('Rent payment')}
          <CardRows>
            {r?.dueDay ? <InfoRow icon={IconCalendarDays} label="Rent due" value={`${ordinal(r.dueDay)} of every month`} /> : null}
            {r?.lateFee ? <InfoRow icon={IconWallet} label="Late fee" value={`${inr(r.lateFee)} ${r.lateFeeUnit === 'day' ? 'per day late' : 'once'}`} /> : null}
            {r?.methods?.length ? <InfoRow icon={IconCircleCheck} label="Paid by" value={cap(joinOr(r.methods.map((k) => METHOD_LABEL[k])))} /> : null}
            {r?.notes ? <InfoRow icon={IconInfo} label="Notes" value={r.notes} /> : null}
          </CardRows>
          <Text style={[ui.small, { color: p.muted, marginTop: 8 }]}>Rent is paid to the PG. Zenvy does not collect rent.</Text>
        </>
      ) : null}

      {hasDeposit ? (
        <>
          {sub('Security deposit')}
          <CardRows>
            {depositAmount !== null && depositAmount !== undefined ? <InfoRow icon={IconWallet} label="Amount" value={depositAmount ? inr(depositAmount) : 'None'} /> : null}
            {d?.refundDays !== undefined ? <InfoRow icon={IconCalendarDays} label="Refund" value={d.refundDays === 0 ? 'On the day you move out' : `Within ${plural(d.refundDays, 'day')} of moving out`} /> : null}
            {d?.deductions ? <InfoRow icon={IconInfo} label="Deductions" value={d.deductions} /> : null}
          </CardRows>
        </>
      ) : null}

      {hasStay ? (
        <>
          {sub('Notice period and lock-in')}
          <CardRows>
            {s?.noticeMonths !== undefined ? <InfoRow icon={IconCalendarDays} label="Notice before moving out" value={months(s.noticeMonths)} /> : null}
            {s?.lockInMonths !== undefined ? <InfoRow icon={IconKey} label="Lock-in" value={s.lockInMonths ? `${months(s.lockInMonths)} minimum stay` : 'None'} /> : null}
            {s?.notes ? <InfoRow icon={IconInfo} label="Notes" value={s.notes} /> : null}
          </CardRows>
        </>
      ) : null}

      {hasCancel ? (
        <>
          {sub('Cancellation and refund')}
          <CardRows>
            {c?.freeCancelDays !== undefined ? (
              <InfoRow icon={IconBan} label="Full refund" value={c.freeCancelDays === 0 ? 'Until the check-in day' : `If you cancel ${plural(c.freeCancelDays, 'day')} or more before check-in`} />
            ) : null}
            {c?.refundPercent !== undefined ? <InfoRow icon={IconWallet} label={c.freeCancelDays !== undefined ? 'After that' : 'Refund'} value={c.refundPercent === 0 ? 'No refund' : `${c.refundPercent}% of the token refunded`} /> : null}
            {c?.text ? <InfoRow icon={IconInfo} label="Details" value={c.text} /> : null}
          </CardRows>
        </>
      ) : null}

      {included.length || extras.length ? (
        <>
          {sub('What rent includes')}
          {included.length ? (
            <CardRows>
              {INCLUDED_KEYS.map((k) => <CheckRow key={k} label={INCLUDED_LABEL[k]} on={included.includes(k)} detail={included.includes(k) ? undefined : extras.some((e) => e.item.toLowerCase().includes(k)) ? 'charged extra' : 'not included'} />)}
            </CardRows>
          ) : null}
          {extras.length ? (
            <>
              <Text style={[ui.small, { color: p.muted, marginTop: included.length ? 16 : 0, marginBottom: 8 }]}>Extra charges</Text>
              <CardRows>
                {extras.map((e) => (
                  <View key={e.item} style={st.chargeRow} accessible accessibilityLabel={`${e.item}, ${chargeText(e)}`}>
                    <Text style={[ui.body, { color: p.text, flex: 1 }]}>{e.item}</Text>
                    <Text style={[ui.body, { color: p.text, fontWeight: '600' }]}>{chargeText(e)}</Text>
                  </View>
                ))}
              </CardRows>
            </>
          ) : null}
        </>
      ) : null}

      {m ? (
        <>
          {sub('Maintenance and repairs')}
          <CardRows>
            {m.responseHours ? <InfoRow icon={IconWrench} label="Response time" value={m.responseHours < 24 ? `Within ${plural(m.responseHours, 'hour')}` : m.responseHours % 24 === 0 ? `Within ${plural(m.responseHours / 24, 'day')}` : `Within ${m.responseHours} hours`} /> : null}
            {m.notes ? <InfoRow icon={IconInfo} label="How to report" value={m.notes} /> : null}
          </CardRows>
        </>
      ) : null}

      {moveIn ? <MoveIn moveIn={moveIn} first={first} /> : null}
    </View>
  );
}

function MoveIn({ moveIn, first }: { moveIn: PgMoveIn; first: boolean }) {
  const p = usePgPalette();
  const { width } = useWindowDimensions();
  const bring = moveIn.bring || [];
  const provided = moveIn.provided || [];
  const twoCols = bring.length > 0 && provided.length > 0 && width >= 360;
  return (
    <View>
      <SubHeading title="Moving in" style={first ? { marginTop: 0 } : undefined} />
      {moveIn.documents?.length ? (
        <CardRows>
          {moveIn.documents.map((doc) => (
            <View key={doc} style={st.docRow} accessible accessibilityLabel={`Document: ${doc}`}>
              <IconFileText size={ICON.size} color={p.sub} strokeWidth={ICON.stroke} />
              <Text style={[ui.body, { color: p.text, flex: 1 }]}>{doc}</Text>
            </View>
          ))}
        </CardRows>
      ) : null}
      {bring.length || provided.length ? (
        <View style={[twoCols ? st.cols : null, { marginTop: moveIn.documents?.length ? 16 : 0 }]}>
          {bring.length ? (
            <Card style={[st.colCard, twoCols ? { flex: 1 } : null]}>
              <Text style={[ui.small, { color: p.muted, marginBottom: 8 }]}>Bring with you</Text>
              <Bullets items={bring} />
            </Card>
          ) : null}
          {provided.length ? (
            <Card style={[st.colCard, twoCols ? { flex: 1 } : { marginTop: bring.length ? 12 : 0 }]}>
              <Text style={[ui.small, { color: p.muted, marginBottom: 8 }]}>Provided by the PG</Text>
              <Bullets items={provided} />
            </Card>
          ) : null}
        </View>
      ) : null}
      {moveIn.steps?.length ? (
        <View style={{ marginTop: 16 }}>
          <Text style={[ui.small, { color: p.muted, marginBottom: 8 }]}>Steps on move-in day</Text>
          <Bullets items={moveIn.steps} numbered />
        </View>
      ) : null}
    </View>
  );
}

// ── Safety & staff ─────────────────────────────────────────────────────────────────────────────
const ENTRY_LABEL = { biometric: 'Biometric entry', keycard: 'Key card entry', key: 'Key entry' } as const;
const ENTRY_ICON = { biometric: IconFingerprint, keycard: IconIdCard, key: IconKey } as const;
export function SafetySection({ safety, onContactDesk }: { safety: PgSafety; onContactDesk: () => void }) {
  const p = usePgPalette();
  const guard = safety.guard === '24x7' ? 'Round the clock (24×7)' : safety.guard === 'night' ? 'At night' : safety.guard === 'hours' && safety.guardFrom ? fmtRange(safety.guardFrom, safety.guardTo) : '';
  const checks = ([['CCTV cameras', safety.cctv], ['Fire extinguishers', safety.fireExtinguishers], ['First aid kit', safety.firstAid]] as const).filter(([, v]) => typeof v === 'boolean');
  return (
    <View>
      <SectionHeading title="Safety and staff" />
      {safety.entry || guard ? (
        <CardRows>
          {safety.entry ? <InfoRow icon={ENTRY_ICON[safety.entry]} label="Entry" value={ENTRY_LABEL[safety.entry]} /> : null}
          {guard ? <InfoRow icon={IconShieldCheck} label="Security guard" value={guard} /> : null}
        </CardRows>
      ) : null}
      {checks.length ? (
        <CardRows style={safety.entry || guard ? { marginTop: 12 } : undefined}>
          {checks.map(([label, v]) => <CheckRow key={label} label={label} on={!!v} />)}
        </CardRows>
      ) : null}
      {safety.wardenName ? (
        <>
          <SubHeading title="Warden" />
          <Card>
            <InfoRow icon={IconUserRound} label="On site" value={safety.wardenName} detail={safety.wardenAvailability} />
          </Card>
          <Press onPress={onContactDesk} accessibilityLabel="Contact the warden through the Zenvy housing desk on WhatsApp" style={[ui.secondaryBtn, st.rowBtn, { borderColor: p.line, marginTop: 12 }]}>
            <IconMessage size={16} color={p.text} strokeWidth={ICON.stroke} />
            <Text style={[ui.btnLabel, { color: p.text }]}>Contact through housing desk</Text>
          </Press>
        </>
      ) : null}
      {safety.emergency ? (
        <>
          <SubHeading title="In an emergency" />
          <View style={[st.note, { backgroundColor: p.sunken }]}>
            <IconSiren size={ICON.size} color={p.sub} strokeWidth={ICON.stroke} style={{ marginTop: 1 }} />
            <Paragraph style={{ flex: 1 }}>{safety.emergency}</Paragraph>
          </View>
        </>
      ) : null}
    </View>
  );
}

// ── Location & nearby ──────────────────────────────────────────────────────────────────────────
const NEARBY_ICON: Record<NearbyCategory, LucideIcon> = {
  college: IconGraduation, hospital: IconHospital, pharmacy: IconPill, atm: IconLandmark, bus_stop: IconBus,
  supermarket: IconCart, restaurant: IconUtensils, gym: IconDumbbellPlace, other: IconMapPin,
};
export function LocationSection({ pg, guide }: { pg: PgDetail; guide: PgLocationGuide | null }) {
  const p = usePgPalette();
  const maps = mapsUrl(pg);
  const nearby = guide?.nearby || [];
  return (
    <View>
      <SectionHeading title="Location" />
      <Card>
        <InfoRow icon={IconMapPin} label={pg.area || 'Address'} value={pg.address} detail={distanceLabel(pg.distanceFromCollege) || undefined} />
      </Card>
      {maps ? (
        <Press onPress={() => Linking.openURL(maps).catch(() => Alert.alert('Could not open Maps'))} accessibilityRole="link" accessibilityLabel="Open in Maps" style={[ui.secondaryBtn, { borderColor: p.line, marginTop: 12 }]}>
          <Text style={[ui.btnLabel, { color: p.text }]}>Open in Maps</Text>
        </Press>
      ) : null}
      {guide?.howToReach ? (
        <>
          <SubHeading title="How to reach" />
          <Paragraph>{guide.howToReach}</Paragraph>
        </>
      ) : null}
      {nearby.length ? (
        <>
          <SubHeading title="Nearby" />
          <CardRows>
            {nearby.map((n) => {
              const Icon = NEARBY_ICON[n.category] || IconMapPin;
              const dist = [metres(n.distanceM), n.walkMinutes ? `${n.walkMinutes} min walk` : ''].filter(Boolean).join(' · ');
              return (
                <View key={n.name} style={st.nearRow} accessible accessibilityLabel={`${n.name}, ${NEARBY_LABEL[n.category]}, ${dist}`}>
                  <Icon size={ICON.size} color={p.sub} strokeWidth={ICON.stroke} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[ui.body, { color: p.text }]} numberOfLines={1}>{n.name}</Text>
                    <Text style={[ui.small, { color: p.muted, marginTop: 2 }]}>{NEARBY_LABEL[n.category]}</Text>
                  </View>
                  <Text style={[ui.small, { color: p.sub }]}>{dist}</Text>
                </View>
              );
            })}
          </CardRows>
        </>
      ) : null}
    </View>
  );
}

// ── FAQ ────────────────────────────────────────────────────────────────────────────────────────
const FAQ_PREVIEW = 6;
export function FaqSection({ items }: { items: { id: string; q: string; a: string }[] }) {
  const p = usePgPalette();
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FAQ_PREVIEW);
  const toggle = (id: string) => { LayoutAnimation.easeInEaseOut(); setOpen((cur) => (cur === id ? null : id)); };
  return (
    <View>
      <SectionHeading title="Frequently asked questions" />
      <CardRows>
        {shown.map((f) => {
          const on = open === f.id;
          return (
            <View key={f.id}>
              <Press onPress={() => toggle(f.id)} accessibilityState={{ selected: on }} accessibilityHint={on ? 'Hides the answer' : 'Shows the answer'} accessibilityLabel={f.q} style={st.faqQ}>
                <Text style={[st.faqText, { color: p.text }]}>{f.q}</Text>
                <IconChevronDown size={18} color={p.sub} strokeWidth={ICON.stroke} style={on ? { transform: [{ rotate: '180deg' }] } : undefined} />
              </Press>
              {on ? <Text style={[ui.body, st.faqA, { color: p.sub }]}>{f.a}</Text> : null}
            </View>
          );
        })}
      </CardRows>
      {items.length > FAQ_PREVIEW ? (
        <Press onPress={() => { LayoutAnimation.easeInEaseOut(); setAll((v) => !v); }} accessibilityLabel={all ? 'Show fewer questions' : `Show all ${items.length} questions`} style={[ui.secondaryBtn, { borderColor: p.line, marginTop: 12 }]}>
          <Text style={[ui.btnLabel, { color: p.text }]}>{all ? 'Show fewer' : `Show all ${items.length} questions`}</Text>
        </Press>
      ) : null}
    </View>
  );
}


const st = StyleSheet.create({
  facts: { flexDirection: 'row', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  fact: { flex: 1, paddingHorizontal: 12, paddingVertical: 12 },
  factValue: { fontSize: TYPE.heading, fontWeight: '700', marginTop: 4, marginBottom: 2 },
  factSep: { width: StyleSheet.hairlineWidth, marginVertical: 12 },
  highlight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  linkBtn: { alignSelf: 'flex-start', justifyContent: 'center' },
  amenities: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 16 },
  amenity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ruleGroup: { paddingHorizontal: 16, paddingVertical: 16, gap: 8 },
  ruleHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  groupTitle: { fontSize: TYPE.body, fontWeight: '600' },
  chargeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 48 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 48 },
  cols: { flexDirection: 'row', gap: 12 },
  colCard: { padding: 16 },
  rowBtn: { flexDirection: 'row', gap: 8 },
  note: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: 12 },
  nearRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  faqQ: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 52 },
  faqText: { flex: 1, fontSize: TYPE.body, fontWeight: '600', lineHeight: 20 },
  faqA: { paddingHorizontal: 16, paddingBottom: 16, marginTop: -4 },
});
