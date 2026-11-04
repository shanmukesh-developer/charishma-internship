/**
 * /deals/refer: invite friends, in the Deals v2 look. The real referral code (GET /api/features/referral/my-code,
 * falling back to the signed-in user's code) with Copy and Share, the real count of friends who joined with it, and
 * the real reward (+50 ZenPoints each, routes/featureRoutes.js and userController register).
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Clipboard from '@react-native-clipboard/clipboard';
import * as Haptics from 'expo-haptics';
import { API_URL } from '../../constants/api';
import { apiFetch, readJson } from '../../utils/auth';
import { DV, W, shadow } from './dealsV2Theme';
import { CTA, PageHeader, Press } from './DealsV2Kit';
import { Coin, IconPlate } from './DealsV2Decor';
import { StateBlock } from './DealsV2States';
import { ICheck, ICopy, IShare, IUserPlus, IUsers } from './DealsV2Icons';
import { useDeals } from './dealsV2Data';
import { useNav } from './dealsV2Nav';
import { themedSheet } from '../../utils/themeNow';

export default function DealsV2Refer() {
  const d = useDeals();
  const nav = useNav();
  const [mine, setMine] = useState<{ referralCode?: string; referralCount?: number } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!d.signedIn) return;
    let live = true;
    apiFetch(`${API_URL}/api/features/referral/my-code`).then(readJson).then((j) => { if (live && j) setMine(j); }).catch(() => {});
    return () => { live = false; };
  }, [d.signedIn]);
  const code = String(mine?.referralCode || d.referralCode || '');
  const count = Number(mine?.referralCount);
  const name = String(d.user?.name || '').split(' ')[0] || 'Your friend';
  const copy = () => {
    try { Clipboard.setString(code); } catch {}
    Haptics.selectionAsync().catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const share = async () => {
    try {
      await Share.share({ message: `${name} invited you to ZENV: campus food and essentials delivered to your hostel. Sign up with code ${code} and you both get 50 ZENV Points.` });
    } catch {}
  };
  return (
    <View style={{ flex: 1 }}>
      <PageHeader title="Invite friends" sub="50 ZENV Points for you and your friend" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        {!d.signedIn ? <StateBlock kind="signin" body="Sign in to get your own invite code." action="Sign in" onAction={() => nav.go('/login')} style={{ marginHorizontal: 0 }} /> : !code ? (
          <StateBlock kind="empty" title="Your invite code is on its way" body="Pull down on the Deals page to refresh, then come back." style={{ marginHorizontal: 0 }} />
        ) : (
          <>
            <View style={[s.hero, shadow(3, '#3A1A9E')]}>
              <LinearGradient colors={[DV.hero[0], DV.hero[1], DV.hero[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              <LinearGradient colors={['rgba(255,255,255,0.2)', 'rgba(255,255,255,0)']} style={[StyleSheet.absoluteFill, { height: '45%' }]} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <IconPlate size={64} radius={20}><IUserPlus size={30} color="#FFFFFF" strokeWidth={1.5} /></IconPlate>
                <Coin size={52} />
              </View>
              <Text style={s.heroTitle}>50 ZENV Points each</Text>
              <Text style={s.heroSub}>When a friend signs up with your code, you and your friend each get 50 ZENV Points.</Text>
            </View>
            <Press onPress={copy} label={copied ? 'Code copied' : `Copy invite code ${code}`} style={s.code}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.codeLabel}>Your invite code</Text>
                <Text style={s.codeText} numberOfLines={1}>{code}</Text>
              </View>
              {copied ? <ICheck size={18} color={DV.green} strokeWidth={2} /> : <ICopy size={18} color={DV.violet} strokeWidth={1.8} />}
              <Text style={[s.copy, copied ? { color: DV.green } : null]}>{copied ? 'Copied' : 'Copy'}</Text>
            </Press>
            <CTA label="Share invite" onPress={share} icon={<IShare size={17} color="#FFFFFF" strokeWidth={1.8} />} style={{ marginTop: 14 }} />
            {Number.isFinite(count) ? (
              <View style={[s.count, shadow(1)]}>
                <IconPlate size={38}><IUsers size={18} color="#FFFFFF" strokeWidth={1.7} /></IconPlate>
                <Text style={s.countText}>{count === 0 ? 'No friends have joined with your code yet' : `${count} friend${count === 1 ? '' : 's'} joined with your code`}</Text>
              </View>
            ) : null}
            <Text style={s.h2}>How it works</Text>
            {['Share your code with a friend who is not on ZENV yet.', 'They enter it when they sign up.', 'You and your friend each get 50 ZENV Points.'].map((t, i) => (
              <View key={i} style={s.step}>
                <View style={s.num}><Text style={s.numText}>{i + 1}</Text></View>
                <Text style={s.stepText}>{t}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = themedSheet(() => ({
  hero: { padding: 22, borderRadius: 26, overflow: 'hidden', alignItems: 'center' },
  heroTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: W.display, marginTop: 14 },
  heroSub: { color: 'rgba(242,238,255,0.9)', fontSize: 13.5, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  code: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, height: 62, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1.4, borderStyle: 'dashed', borderColor: DV.violetLine, backgroundColor: DV.card },
  codeLabel: { fontSize: 11.5, color: DV.sub },
  codeText: { fontSize: 19, fontWeight: W.title, color: DV.ink, letterSpacing: 1 },
  copy: { fontSize: 13.5, fontWeight: W.label, color: DV.violet },
  count: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, padding: 12, borderRadius: 18, backgroundColor: DV.card, borderWidth: StyleSheet.hairlineWidth, borderColor: DV.line },
  plate: { width: 38, height: 38, borderRadius: 12, backgroundColor: DV.violet, alignItems: 'center', justifyContent: 'center' },
  countText: { flex: 1, fontSize: 13.5, color: DV.ink },
  h2: { fontSize: 17, fontWeight: W.title, color: DV.ink, marginTop: 24, marginBottom: 4 },
  step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 10 },
  num: { width: 24, height: 24, borderRadius: 12, backgroundColor: DV.violetSoft, alignItems: 'center', justifyContent: 'center' },
  numText: { fontSize: 12, color: DV.violetDeep, fontWeight: W.title },
  stepText: { flex: 1, fontSize: 13.5, color: DV.ink, lineHeight: 19 },
}));
