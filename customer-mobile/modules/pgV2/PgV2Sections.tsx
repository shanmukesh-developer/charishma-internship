/**
 * PG v2 detail sections, listing style: collapsible groups with hairlines, slate line icons, no tinted
 * blobs. Covers everything the old modules/pg detail showed (house rules and timings, policies,
 * included and extra charges, safety, move-in, location guide and nearby places, FAQ).
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, LayoutAnimation, Platform, UIManager } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import IChevronDown from 'lucide-react-native/icons/chevron-down';
import ICheck from 'lucide-react-native/icons/check';
import IMinus from 'lucide-react-native/icons/minus';
import IClock from 'lucide-react-native/icons/clock';
import IUsers from 'lucide-react-native/icons/users';
import IVolumeX from 'lucide-react-native/icons/volume-x';
import ICigOff from 'lucide-react-native/icons/cigarette-off';
import ISparkles from 'lucide-react-native/icons/sparkles';
import IPlug from 'lucide-react-native/icons/plug-zap';
import IDoor from 'lucide-react-native/icons/door-open';
import IInfo from 'lucide-react-native/icons/info';
import IGrad from 'lucide-react-native/icons/graduation-cap';
import IUtensils from 'lucide-react-native/icons/utensils-crossed';
import IPill from 'lucide-react-native/icons/pill';
import ILandmark from 'lucide-react-native/icons/landmark';
import IBus from 'lucide-react-native/icons/bus';
import IHospital from 'lucide-react-native/icons/hospital';
import ICart from 'lucide-react-native/icons/shopping-cart';
import IMapPin from 'lucide-react-native/icons/map-pin';
import { PG2, R, W } from './pgV2Theme';
import { Tap } from './PgV2Kit';
import { SLATE, LINE_ICON } from './PgV2Amenities';
import {
  fmtRange, fmtTime, inr, months, ordinal, metres, chargeText, INCLUDED_KEYS, INCLUDED_LABEL,
  type PgRuleGroup, type PgTimings, type PgPolicies, type PgSafety, type PgMoveIn, type PgLocationGuide, type PgFaq, type NearbyCategory,
} from '../pg/pgApi';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) UIManager.setLayoutAnimationEnabledExperimental(true);

/** Collapsible group: title row with a chevron; content below a hairline. */
export function Collapsible({ title, sub, icon: Icon, initiallyOpen = false, children }: { title: string; sub?: string; icon?: LucideIcon; initiallyOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  const toggle = () => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen((v) => !v); };
  return (
    <View style={st.group}>
      <Tap onPress={toggle} label={`${title}, ${open ? 'collapse' : 'expand'}`} selected={open} style={st.groupHead}>
        {Icon ? <Icon size={LINE_ICON.size} color={SLATE} strokeWidth={LINE_ICON.stroke} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.groupTitle}>{title}</Text>
          {sub && !open ? <Text style={st.groupSub} numberOfLines={1}>{sub}</Text> : null}
        </View>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}><IChevronDown size={18} color={PG2.faint} strokeWidth={1.6} /></View>
      </Tap>
      {open ? <View style={st.groupBody}>{children}</View> : null}
    </View>
  );
}

/** Label / value rows. */
export function Rows({ rows }: { rows: [string, string][] }) {
  const list = rows.filter(([, v]) => !!v);
  return (
    <View>
      {list.map(([k, v], i) => (
        <View key={k} style={[st.kv, i > 0 && st.hair]}>
          <Text style={st.kvKey}>{k}</Text>
          <Text style={st.kvVal}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

export function Bullets({ items, numbered }: { items: string[]; numbered?: boolean }) {
  return (
    <View style={{ gap: 8 }}>
      {items.map((t, i) => (
        <View key={`${i}-${t}`} style={st.bullet}>
          <Text style={st.bulletMark}>{numbered ? `${i + 1}.` : '·'}</Text>
          <Text style={st.body}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

function Check({ label, on, detail }: { label: string; on: boolean; detail?: string }) {
  const Icon = on ? ICheck : IMinus;
  return (
    <View style={st.check}>
      <Icon size={16} color={on ? PG2.green : PG2.faint} strokeWidth={2} />
      <Text style={[st.body, { flex: 1 }, !on && { color: PG2.muted }]}>{label}</Text>
      {detail ? <Text style={st.small}>{detail}</Text> : null}
    </View>
  );
}

const RULE_ICON: Record<string, LucideIcon> = { gate: IDoor, visitors: IUsers, overnight: IDoor, noise: IVolumeX, smoking: ICigOff, cleanliness: ISparkles, electricity: IPlug };

export function RulesBlock({ groups, timings }: { groups: PgRuleGroup[]; timings: PgTimings | null }) {
  const t = timings;
  return (
    <View>
      {t ? (
        <Collapsible title="Gate and house timings" sub={t.gateClose ? `Gate closes ${fmtTime(t.gateClose)}` : undefined} icon={IClock} initiallyOpen>
          <Rows rows={[
            ['Gate', fmtRange(t.gateOpen, t.gateClose)], ['Visitors', fmtRange(t.visitorFrom, t.visitorTo)],
            ['Check-in', fmtTime(t.checkIn)], ['Check-out', fmtTime(t.checkOut)], ['Quiet hours', fmtRange(t.quietFrom, t.quietTo)],
          ]} />
          {t.curfewNote ? <Text style={[st.small, { marginTop: 10 }]}>{t.curfewNote}</Text> : null}
        </Collapsible>
      ) : null}
      {groups.map((g) => (
        <Collapsible key={g.category + g.label} title={g.label} sub={g.rules[0]} icon={RULE_ICON[g.category] || IInfo}>
          <Bullets items={g.rules} />
        </Collapsible>
      ))}
    </View>
  );
}

export function PoliciesBlock({ policies, deposit }: { policies: PgPolicies; deposit: number }) {
  const r = policies.rent; const d = policies.deposit; const s = policies.stay; const c = policies.cancellation; const b = policies.booking;
  const included = policies.included || []; const extras = policies.extraCharges || [];
  return (
    <View>
      <Collapsible title="Rent and late fee" sub={r?.dueDay ? `Due by the ${ordinal(r.dueDay)} of each month` : undefined} icon={IClock} initiallyOpen>
        <Rows rows={[
          ['Rent due', r?.dueDay ? `By the ${ordinal(r.dueDay)} of each month` : ''],
          ['Late fee', r?.lateFee ? `${inr(r.lateFee)}${r.lateFeeUnit === 'day' ? ' per day' : ' once'}` : ''],
          ['Pay by', (r?.methods || []).map((m) => (m === 'upi' ? 'UPI' : m === 'bank' ? 'Bank transfer' : 'Cash')).join(', ')],
        ]} />
        {r?.notes ? <Text style={[st.small, { marginTop: 10 }]}>{r.notes}</Text> : null}
      </Collapsible>
      <Collapsible title="Deposit and refund" sub={inr(d?.amount ?? deposit)} icon={ILandmark}>
        <Rows rows={[['Security deposit', inr(d?.amount ?? deposit)], ['Refund', d?.refundDays ? `Within ${d.refundDays} days of moving out` : '']]} />
        {d?.deductions ? <Text style={[st.small, { marginTop: 10 }]}>{d.deductions}</Text> : null}
      </Collapsible>
      <Collapsible title="Notice and lock-in" sub={s?.noticeMonths !== undefined ? `Notice ${months(s.noticeMonths)}` : undefined} icon={IDoor}>
        <Rows rows={[['Notice period', s?.noticeMonths !== undefined ? months(s.noticeMonths) : ''], ['Lock-in', s?.lockInMonths !== undefined ? months(s.lockInMonths) : '']]} />
        {s?.notes ? <Text style={[st.small, { marginTop: 10 }]}>{s.notes}</Text> : null}
      </Collapsible>
      <Collapsible title="Booking and cancellation" sub={b?.confirmation} icon={IInfo}>
        {b?.steps ? <Text style={st.body}>{b.steps}</Text> : null}
        <Rows rows={[['Token amount', b?.tokenAmount ? inr(b.tokenAmount) : ''], ['Free cancellation', c?.freeCancelDays !== undefined ? `${c.freeCancelDays} days after confirmation` : ''], ['Refund', c?.refundPercent !== undefined ? `${c.refundPercent}%` : '']]} />
        {c?.text ? <Text style={[st.small, { marginTop: 10 }]}>{c.text}</Text> : null}
      </Collapsible>
      {included.length || extras.length ? (
        <Collapsible title="Included and extra" sub={`${included.length} included · ${extras.length} extra`} icon={ICheck}>
          {INCLUDED_KEYS.map((k) => <Check key={k} label={INCLUDED_LABEL[k]} on={included.includes(k)} detail={included.includes(k) ? 'Included' : undefined} />)}
          {extras.length ? <Text style={[st.small, { marginTop: 12, marginBottom: 4 }]}>Extra charges</Text> : null}
          {extras.map((e) => <View key={e.item} style={st.kv}><Text style={st.kvKey}>{e.item}</Text><Text style={[st.kvVal, { color: PG2.amber }]}>{chargeText(e)}</Text></View>)}
        </Collapsible>
      ) : null}
      {policies.maintenance ? (
        <Collapsible title="Maintenance" sub={policies.maintenance.responseHours ? `Response within ${policies.maintenance.responseHours} hours` : undefined} icon={ISparkles}>
          {policies.maintenance.notes ? <Text style={st.body}>{policies.maintenance.notes}</Text> : null}
        </Collapsible>
      ) : null}
    </View>
  );
}

export function SafetyBlock({ safety }: { safety: PgSafety }) {
  const entry = safety.entry === 'biometric' ? 'Biometric' : safety.entry === 'keycard' ? 'Keycard' : safety.entry === 'key' ? 'Key' : '';
  const guard = safety.guard === '24x7' ? 'Round the clock' : safety.guard === 'night' ? 'At night' : safety.guard === 'hours' ? fmtRange(safety.guardFrom, safety.guardTo) : '';
  return (
    <Collapsible title="Safety and security" sub={[entry && `${entry} entry`, safety.cctv ? 'CCTV' : ''].filter(Boolean).join(' · ')} icon={IInfo} initiallyOpen>
      <Rows rows={[['Entry', entry], ['Security guard', guard], ['Warden', safety.wardenName || ''], ['Available', safety.wardenAvailability || '']]} />
      <View style={{ marginTop: 8 }}>
        {typeof safety.cctv === 'boolean' ? <Check label="CCTV cameras" on={safety.cctv} /> : null}
        {typeof safety.fireExtinguishers === 'boolean' ? <Check label="Fire extinguishers" on={safety.fireExtinguishers} /> : null}
        {typeof safety.firstAid === 'boolean' ? <Check label="First aid kit" on={safety.firstAid} /> : null}
      </View>
      {safety.emergency ? <Text style={[st.small, { marginTop: 10 }]}>{safety.emergency}</Text> : null}
    </Collapsible>
  );
}

export function MoveInBlock({ moveIn }: { moveIn: PgMoveIn }) {
  return (
    <View>
      {moveIn.documents?.length ? <Collapsible title="Documents needed" sub={moveIn.documents.join(', ')} icon={IInfo}><Bullets items={moveIn.documents} /></Collapsible> : null}
      {moveIn.bring?.length ? <Collapsible title="What to bring" sub={moveIn.bring.slice(0, 3).join(', ')} icon={ICheck}><Bullets items={moveIn.bring} /></Collapsible> : null}
      {moveIn.provided?.length ? <Collapsible title="Provided in the room" sub={moveIn.provided.slice(0, 3).join(', ')} icon={ICheck}><Bullets items={moveIn.provided} /></Collapsible> : null}
      {moveIn.steps?.length ? <Collapsible title="Move-in steps" sub={`${moveIn.steps.length} steps`} icon={IDoor}><Bullets items={moveIn.steps} numbered /></Collapsible> : null}
    </View>
  );
}

const NEAR_ICON: Record<NearbyCategory, LucideIcon> = { college: IGrad, hospital: IHospital, pharmacy: IPill, atm: ILandmark, bus_stop: IBus, supermarket: ICart, restaurant: IUtensils, gym: IInfo, other: IMapPin };

export function NearbyBlock({ guide }: { guide: PgLocationGuide }) {
  return (
    <View>
      {guide.howToReach ? <Text style={[st.body, { marginBottom: 10 }]}>{guide.howToReach}</Text> : null}
      <View style={st.card}>
        {(guide.nearby || []).map((n, i) => {
          const Icon = NEAR_ICON[n.category] || IMapPin;
          return (
            <View key={n.name} style={[st.near, i > 0 && st.hair]}>
              <Icon size={LINE_ICON.size} color={SLATE} strokeWidth={LINE_ICON.stroke} />
              <Text style={[st.body, { flex: 1 }]} numberOfLines={1}>{n.name}</Text>
              <Text style={st.small}>{[metres(n.distanceM), n.walkMinutes ? `${n.walkMinutes} min walk` : ''].filter(Boolean).join(' · ')}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function FaqBlock({ items }: { items: PgFaq[] }) {
  return <View>{items.map((f) => <Collapsible key={f.id} title={f.q}><Text style={st.body}>{f.a}</Text></Collapsible>)}</View>;
}

const st = StyleSheet.create({
  group: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E6E3F5' },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 10 },
  groupTitle: { fontSize: 14.5, fontWeight: W.label, color: PG2.ink },
  groupSub: { marginTop: 2, fontSize: 12, color: PG2.muted },
  groupBody: { paddingBottom: 16, paddingLeft: 32 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 9 },
  hair: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ECEAF5' },
  kvKey: { fontSize: 13.5, color: PG2.muted },
  kvVal: { fontSize: 13.5, color: PG2.ink, fontWeight: W.label, textAlign: 'right', flexShrink: 1 },
  bullet: { flexDirection: 'row', gap: 8 },
  bulletMark: { width: 14, fontSize: 13.5, color: PG2.muted, lineHeight: 20 },
  body: { fontSize: 13.5, color: PG2.ink2, lineHeight: 20, flexShrink: 1 },
  small: { fontSize: 12, color: PG2.muted, lineHeight: 17 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  card: { backgroundColor: '#FFFFFF', borderRadius: R.md, borderWidth: StyleSheet.hairlineWidth, borderColor: '#E6E3F5', paddingHorizontal: 14 },
  near: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50 },
});
