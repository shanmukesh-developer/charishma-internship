/**
 * Deal detail sheet: one of today's real deals (GET /api/vault) with the real "how to avail" steps and the real
 * claim (POST /api/vault/claim/:id, only on the student's tap). The claim returns the student's own coupon code,
 * shown here with Copy; it also lands in Your coupons. Streak deals stay locked until the server would allow them.
 */
import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Clipboard from '@react-native-clipboard/clipboard';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { ENDPOINTS } from '../../constants/api';
import { apiFetch, readJson, NETWORK_ERROR_MESSAGE, SERVER_BUSY_MESSAGE } from '../../utils/auth';
import { DV, W, rupees } from './dealsV2Theme';
import { CTA, Press } from './DealsV2Kit';
import { IconPlate } from './DealsV2Decor';
import { IClock, ICopy, ICheck, ILock, ITicketPercent } from './DealsV2Icons';
import { Notice } from './DealsV2States';
import { dealMinOrder, refreshRewards, refreshVault, useDeals } from './dealsV2Data';
import { dealInfo } from './DealsV2Deals';
import { themedSheet } from '../../utils/themeNow';

export function DealSheetBody({ item, onClose }: { item: any; onClose: () => void }) {
  const d = useDeals();
  const router = useRouter();
  const i = dealInfo(item, d.streak, d.signedIn);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const lock = useRef(false);
  const min = dealMinOrder(item);
  const steps = [
    i.streak > 0 ? `Keep a ${i.streak}-day order streak (order on consecutive days).` : null,
    'Tap "Claim deal". You get your own coupon code.',
    min > 0 ? `Apply the code at checkout on an order of ${rupees(min)} or more. It works until midnight today.` : 'Apply the code at checkout. It works until midnight today.',
  ].filter(Boolean) as string[];

  const claim = async () => {
    if (!d.signedIn) { onClose(); router.push('/login' as any); return; }
    if (lock.current) return; // a double tap must not claim twice
    lock.current = true;
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch(ENDPOINTS.vaultClaim(String(item.id)), { method: 'POST' });
      const data: any = await readJson(res);
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setCode(String(data?.code || data?.coupon?.code || ''));
        refreshVault();
        refreshRewards();
      } else {
        setErr(data?.message || (res.status >= 500 ? SERVER_BUSY_MESSAGE : 'Please try again in a moment.'));
      }
    } catch {
      setErr(NETWORK_ERROR_MESSAGE);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const copy = () => {
    if (!code) return;
    try { Clipboard.setString(code); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <View>
      <View style={s.art}>
        {i.img ? <Image source={i.img} style={StyleSheet.absoluteFill} contentFit="cover" /> : (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <LinearGradient colors={DV.lavender} style={StyleSheet.absoluteFill} />
            <IconPlate size={72}><ITicketPercent size={32} color="#FFFFFF" strokeWidth={1.5} /></IconPlate>
          </View>
        )}
        {i.tag ? (
          <View style={s.tag}>
            <LinearGradient colors={[DV.go[0], DV.go[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <Text style={s.tagText}>{i.tag}</Text>
          </View>
        ) : null}
      </View>
      <Text style={s.title} accessibilityRole="header">{i.name}</Text>
      <View style={s.metaRow}>
        <View style={s.meta}><IClock size={13} color={DV.violetDeep} strokeWidth={1.8} /><Text style={s.metaText}>Valid till midnight</Text></View>
        <View style={s.meta}><ITicketPercent size={13} color={DV.violetDeep} strokeWidth={1.8} /><Text style={s.metaText}>{i.left} left today</Text></View>
      </View>
      {code ? (
        <View style={{ marginTop: 14 }}>
          <Notice tone="success">Deal claimed. Use this code at checkout before midnight; it is also in Your coupons.</Notice>
          <Press onPress={copy} label={copied ? 'Code copied' : `Copy code ${code}`} style={s.code}>
            <Text style={s.codeText} numberOfLines={1}>{code}</Text>
            {copied ? <ICheck size={18} color={DV.green} strokeWidth={2} /> : <ICopy size={18} color={DV.violet} strokeWidth={1.8} />}
          </Press>
        </View>
      ) : (
        <>
          <Text style={s.how}>How to avail</Text>
          {steps.map((t, k) => (
            <View key={k} style={s.step}>
              <View style={s.num}><Text style={s.numText}>{k + 1}</Text></View>
              <Text style={s.stepText}>{t}</Text>
            </View>
          ))}
          {err ? <Notice tone="warn" style={{ marginTop: 12 }}>{err}</Notice> : null}
        </>
      )}
      <View style={{ marginTop: 16 }}>
        {code ? <CTA label="Done" onPress={onClose} /> : i.need > 0 ? (
          <View style={s.locked} accessibilityLabel={`Locked. ${i.need} more day${i.need === 1 ? '' : 's'} of orders needed`}>
            <ILock size={16} color={DV.violetDeep} strokeWidth={1.8} />
            <Text style={s.lockedText}>Unlocks after {i.need} more day{i.need === 1 ? '' : 's'} of orders</Text>
          </View>
        ) : <CTA label={d.signedIn ? 'Claim deal' : 'Sign in to claim'} onPress={claim} busy={busy} />}
      </View>
    </View>
  );
}

const s = themedSheet(() => ({
  art: { height: 170, borderRadius: 20, overflow: 'hidden', backgroundColor: DV.violetSoft },
  tag: { position: 'absolute', left: 12, top: 12, paddingHorizontal: 10, height: 26, borderRadius: 13, overflow: 'hidden', justifyContent: 'center' },
  tagText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: W.title },
  title: { fontSize: 19, fontWeight: W.title, color: DV.ink, marginTop: 14 },
  metaRow: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: DV.violetSoft },
  metaText: { fontSize: 12, color: DV.violetDeep, fontWeight: W.label },
  how: { fontSize: 15, fontWeight: W.title, color: DV.ink, marginTop: 18, marginBottom: 6 },
  step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 8 },
  num: { width: 24, height: 24, borderRadius: 12, backgroundColor: DV.violetSoft, alignItems: 'center', justifyContent: 'center' },
  numText: { fontSize: 12, color: DV.violetDeep, fontWeight: W.title },
  stepText: { flex: 1, fontSize: 13.5, color: DV.ink, lineHeight: 19 },
  code: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 54, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1.2, borderStyle: 'dashed', borderColor: DV.violetLine, backgroundColor: DV.violetSoft },
  codeText: { flex: 1, fontSize: 16, fontWeight: W.title, color: DV.ink, letterSpacing: 0.5 },
  locked: { flexDirection: 'row', gap: 8, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: DV.violetSoft, borderWidth: 1, borderColor: DV.violetLine },
  lockedText: { fontSize: 14, color: DV.violetDeep, fontWeight: W.label },
}));
