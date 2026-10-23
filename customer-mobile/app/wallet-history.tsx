// C5 Wallet history: every change of the wallet from GET /api/users/wallet/transactions (newest
// first, 20 per page). Each row: what it was (label), +/- amount in green / red, date, the balance right
// after it, and a link to the order / booking / registration it belongs to. Real server data only.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch, readJson, NETWORK_ERROR_MESSAGE } from '../utils/auth';
import { ENDPOINTS } from '../constants/api';
import { formatINR, formatISTDateTime } from '../utils/format';
import { useTopInset } from '../utils/useTopInset';
import { ACCENTS, SURFACE, STATUS, shadow as othersShadow } from '../modules/others/othersTheme';
import { PressScale, FadeInUp, StateCard, SkeletonList } from '../modules/others/motion';

interface WalletTx {
  id: string;
  type: string;
  label: string;
  amount: number;
  direction: 'credit' | 'debit';
  balanceAfter: number;
  note: string | null;
  ref: { type: string; id: string; label: string | null; link: string | null } | null;
  createdAt: string;
}

const PAGE = 20;

const inr = (n: number) => formatINR(Math.abs(Number(n) || 0));
const when = (iso: string) => formatISTDateTime(iso, { year: true });

// Server-supplied links are only followed when they point at a screen the app has.
const ALLOWED_LINK_PREFIXES = ['/tracking/', '/campus-events/', '/rentals/', '/auto-ride/', '/pg/', '/mega-basket', '/wallet-history', '/rewards', '/(tabs)'];
const safeLink = (link: string | null | undefined) =>
  typeof link === 'string' && ALLOWED_LINK_PREFIXES.some((p) => link.startsWith(p)) ? link : null;

export default function WalletHistoryScreen() {
  // Real status-bar inset, never less than the old fixed padding (utils/useTopInset)
  const topPad = useTopInset(36, Platform.OS === 'web' ? 12 : 44); // same top as the Others hub
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const [rows, setRows] = useState<WalletTx[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async (p: number) => {
    try {
      const res = await apiFetch(`${ENDPOINTS.walletTransactions}?page=${p}&limit=${PAGE}`);
      const data = await readJson(res);
      if (!res.ok) throw new Error((data && typeof data.message === 'string' && data.message) || 'Could not load your wallet history.');
      if (!mounted.current) return;
      const list: WalletTx[] = Array.isArray(data?.transactions) ? data.transactions : [];
      setRows((cur) => (p === 1 ? list : [...cur, ...list.filter((x) => !cur.some((c) => c.id === x.id))]));
      setBalance(typeof data?.balance === 'number' ? data.balance : null);
      setHasMore(!!data?.hasMore);
      setPage(p);
      setError(null);
    } catch (e: any) {
      if (!mounted.current) return;
      setError(e instanceof TypeError ? NETWORK_ERROR_MESSAGE : e?.message || 'Could not load your wallet history.');
    }
  }, []);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    load(1).finally(() => mounted.current && setLoading(false));
  }, [user, load]);

  const onRefresh = async () => { setRefreshing(true); await load(1); if (mounted.current) setRefreshing(false); };
  const onEnd = async () => {
    if (!hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    await load(page + 1);
    if (mounted.current) setLoadingMore(false);
  };

  // Deals & spin palette from the Others tokens (modules/others/othersTheme.ts): purple accent, white cards.
  const A = ACCENTS.deals;
  const sf = isDark ? SURFACE.dark : SURFACE.light;
  const stt = isDark ? STATUS.dark : STATUS.light;
  const dp = {
    solid: isDark ? '#7C5CFF' : A.solid,
    ink: isDark ? A.ink.dark : A.ink.light,
    tint: isDark ? A.tint.dark : A.tint.light,
    heroA: isDark ? '#3B2A99' : '#6D4AFF',
    heroB: isDark ? '#24185F' : A.deep,
    card: sf.card,
    hair: 'transparent',
    bg: sf.page,
  };
  // Credit / debit in contrast-safe green and red (WCAG AA on white and on dark cards).
  const GREEN = stt.success;
  const RED = stt.error;
  const shadow = othersShadow(isDark);
  const shownBalance = balance !== null ? balance : (typeof (user as any)?.walletBalance === 'number' ? (user as any).walletBalance : null);
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile' as any));

  const renderItem = ({ item, index }: { item: WalletTx; index: number }) => {
    const credit = item.amount >= 0;
    const link = safeLink(item.ref && item.ref.link);
    return (
      <FadeInUp index={index}>
      <View style={[s.row, shadow, { backgroundColor: dp.card, borderColor: dp.hair }]} accessible accessibilityLabel={`${item.label}, ${credit ? 'added' : 'paid'} ${inr(item.amount)}, ${when(item.createdAt)}, balance after ${inr(item.balanceAfter)}`}>
        <View style={[s.badge, { backgroundColor: credit ? stt.successTint : stt.errorTint }]}>
          <Ionicons name={credit ? 'arrow-down' : 'arrow-up'} size={18} color={credit ? GREEN : RED} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.label, { color: colors.text }]} numberOfLines={2}>{item.label}</Text>
          <Text style={[s.meta, { color: colors.textSecondary }]}>{when(item.createdAt)}</Text>
          {item.note ? <Text style={[s.meta, { color: colors.textSecondary }]} numberOfLines={2}>{item.note}</Text> : null}
          {item.ref && item.ref.label ? (
            link ? (
              <PressScale onPress={() => router.push(link as any)} accessibilityRole="link" hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                <Text style={[s.link, { color: dp.ink }]}>{item.ref.label} ›</Text>
              </PressScale>
            ) : <Text style={[s.meta, { color: colors.textSecondary }]}>{item.ref.label}</Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[s.amount, { color: credit ? GREEN : RED }]}>{credit ? '+' : '−'}{inr(item.amount)}</Text>
          <Text style={[s.meta, { color: colors.textSecondary }]}>Balance {inr(item.balanceAfter)}</Text>
        </View>
      </View>
      </FadeInUp>
    );
  };

  const header = (
    <View>
      <LinearGradient colors={[dp.heroA, dp.heroB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
        <View style={s.heroIcon}>
          <Ionicons name="wallet-outline" size={22} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.heroLabel}>Wallet balance</Text>
          <Text style={s.heroValue}>{shownBalance !== null ? inr(shownBalance) : '—'}</Text>
        </View>
      </LinearGradient>
      <View style={[s.note, { backgroundColor: dp.tint }]}>
        <Ionicons name="information-circle-outline" size={18} color={dp.ink} />
        <Text style={[s.noteText, { color: colors.text }]}>Your wallet is credit for orders: refunds land here and wallet payments leave from here. It cannot be withdrawn or sent to others.</Text>
      </View>
      <Text style={[s.section, { color: colors.text }]}>Recent activity</Text>
    </View>
  );

  return (
    <View style={[s.container, { paddingTop: topPad, backgroundColor: dp.bg }]}>
      <View style={s.header}>
        <PressScale style={[s.backBtn, shadow, { backgroundColor: dp.card, borderColor: dp.hair }]} onPress={goBack} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </PressScale>
        <Text style={[s.title, { color: colors.text }]} accessibilityRole="header">My wallet</Text>
      </View>

      {!user ? (
        <View style={s.stateWrap}>
          <StateCard kind="signin" section="deals" title="Sign in to see your wallet" message="Your balance and every refund or payment show here." actionLabel="Sign in" onAction={() => router.push('/login' as any)} />
        </View>
      ) : loading ? (
        <View style={s.stateWrap}><SkeletonList count={1} height={92} /><SkeletonList count={4} height={72} style={{ marginTop: 24 }} /></View>
      ) : error && rows.length === 0 ? (
        <View style={s.stateWrap}>
          <StateCard kind="error" section="deals" title="Could not load your wallet" message={error} actionLabel="Try again"
            onAction={() => { setLoading(true); load(1).finally(() => mounted.current && setLoading(false)); }} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={dp.solid} />}
          onEndReached={onEnd}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <View style={[s.empty, shadow, { backgroundColor: dp.card, borderColor: dp.hair }]}>
              <Ionicons name="receipt-outline" size={22} color={dp.ink} />
              <Text style={[s.meta, { color: colors.textSecondary, flex: 1, marginTop: 0 }]}>No wallet activity yet. Refunds and wallet payments will show here.</Text>
            </View>
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator color={dp.solid} style={{ marginTop: 12 }} /> : error ? <Text style={[s.meta, { color: RED, textAlign: 'center' }]}>{error}</Text> : null}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, maxWidth: 600, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12, gap: 12 },
  backBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 20, marginTop: 4 },
  heroIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  heroLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '500' },
  heroValue: { color: '#FFFFFF', fontSize: 28, fontWeight: '800', marginTop: 2 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 14, marginTop: 12 },
  noteText: { flex: 1, fontSize: 13, fontWeight: '400', lineHeight: 18 },
  section: { fontSize: 17, fontWeight: '800', marginTop: 24, marginBottom: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  stateWrap: { paddingHorizontal: 16, paddingTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1 },
  badge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '600' },
  meta: { fontSize: 12, fontWeight: '400', marginTop: 2 },
  link: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  amount: { fontSize: 15, fontWeight: '800' },
  empty: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16, borderWidth: 1 },
  retry: { height: 44, paddingHorizontal: 24, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
});
