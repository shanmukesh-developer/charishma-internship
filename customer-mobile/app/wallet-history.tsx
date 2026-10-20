// C5 Wallet history: every change of the Zenvy Wallet from GET /api/users/wallet/transactions (newest
// first, 20 per page). Each row: what it was (label), +/- amount in green / red, date, the balance right
// after it, and a link to the order / booking / registration it belongs to. Real server data only.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch, readJson, NETWORK_ERROR_MESSAGE } from '../utils/auth';
import { ENDPOINTS } from '../constants/api';
import { formatINR, formatISTDateTime } from '../utils/format';

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
const GREEN = '#22C55E';
const RED = '#EF4F5F';

const inr = (n: number) => formatINR(Math.abs(Number(n) || 0));
const when = (iso: string) => formatISTDateTime(iso, { year: true });

// Server-supplied links are only followed when they point at a screen the app has.
const ALLOWED_LINK_PREFIXES = ['/tracking/', '/campus-events/', '/rentals/', '/auto-ride/', '/pg/', '/mega-basket', '/wallet-history', '/rewards', '/(tabs)'];
const safeLink = (link: string | null | undefined) =>
  typeof link === 'string' && ALLOWED_LINK_PREFIXES.some((p) => link.startsWith(p)) ? link : null;

export default function WalletHistoryScreen() {
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
  useEffect(() => () => { mounted.current = false; }, []);

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

  const gold = isDark ? COLORS.gold : colors.gold;
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile' as any));

  const renderItem = ({ item }: { item: WalletTx }) => {
    const credit = item.amount >= 0;
    const link = safeLink(item.ref && item.ref.link);
    return (
      <View style={[s.row, { backgroundColor: colors.card, borderColor: colors.border }]} accessible accessibilityLabel={`${item.label}, ${credit ? 'added' : 'paid'} ${inr(item.amount)}, ${when(item.createdAt)}, balance after ${inr(item.balanceAfter)}`}>
        <View style={[s.badge, { backgroundColor: credit ? 'rgba(34,197,94,0.12)' : 'rgba(239,79,95,0.12)' }]}>
          <Text style={{ fontSize: 16, fontWeight: '900', color: credit ? GREEN : RED }}>{credit ? '+' : '−'}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.label, { color: colors.text }]} numberOfLines={1}>{item.label}</Text>
          <Text style={[s.meta, { color: colors.textSecondary }]}>{when(item.createdAt)}</Text>
          {item.note ? <Text style={[s.meta, { color: colors.textSecondary }]} numberOfLines={2}>{item.note}</Text> : null}
          {item.ref && item.ref.label ? (
            link ? (
              <TouchableOpacity onPress={() => router.push(link as any)} accessibilityRole="link" hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                <Text style={[s.link, { color: gold }]}>{item.ref.label} ›</Text>
              </TouchableOpacity>
            ) : <Text style={[s.meta, { color: colors.textSecondary }]}>{item.ref.label}</Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[s.amount, { color: credit ? GREEN : RED }]}>{credit ? '+' : '−'}{inr(item.amount)}</Text>
          <Text style={[s.meta, { color: colors.textSecondary }]}>Balance {inr(item.balanceAfter)}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={[s.container, { backgroundColor: colors.bg }]}>
      <View style={[s.header, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
        <TouchableOpacity style={[s.backBtn, { borderColor: colors.border, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#F3F4F6' }]} onPress={goBack} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={{ fontSize: 16, color: colors.text }}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[s.subText, { color: gold }]}>Zenvy Wallet</Text>
          <Text style={[s.title, { color: colors.text }]}>Wallet history</Text>
        </View>
        {balance !== null ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[s.subText, { color: colors.textSecondary }]}>Balance</Text>
            <Text style={[s.title, { color: gold }]}>{inr(balance)}</Text>
          </View>
        ) : null}
      </View>

      {!user ? (
        <View style={s.center}>
          <Text style={[s.meta, { color: colors.textSecondary, textAlign: 'center', marginBottom: 12 }]}>Sign in to see your wallet history.</Text>
          <TouchableOpacity onPress={() => router.push('/login' as any)} style={[s.retry, { borderColor: gold }]} accessibilityRole="button" accessibilityLabel="Sign in">
            <Text style={{ color: gold, fontWeight: '900' }}>Sign in</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <View style={s.center}><ActivityIndicator color={gold} /></View>
      ) : error && rows.length === 0 ? (
        <View style={s.center}>
          <Text style={[s.meta, { color: colors.textSecondary, textAlign: 'center', marginBottom: 12 }]}>{error}</Text>
          <TouchableOpacity onPress={() => { setLoading(true); load(1).finally(() => mounted.current && setLoading(false)); }} style={[s.retry, { borderColor: gold }]} accessibilityRole="button">
            <Text style={{ color: gold, fontWeight: '900' }}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={gold} />}
          onEndReached={onEnd}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={<Text style={[s.meta, { color: colors.textSecondary, marginBottom: 4 }]}>Your wallet is Zenvy credit for orders: refunds and credits land here, wallet payments leave from here. It cannot be withdrawn or sent to others.</Text>}
          ListEmptyComponent={<Text style={[s.meta, { color: colors.textSecondary, textAlign: 'center', marginTop: 40 }]}>No wallet activity yet. Refunds and wallet payments will show here.</Text>}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={gold} style={{ marginTop: 12 }} /> : error ? <Text style={[s.meta, { color: RED, textAlign: 'center' }]}>{error}</Text> : null}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === 'android' ? 40 : 50, maxWidth: 600, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, gap: 8 },
  backBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  subText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  title: { fontSize: 18, fontWeight: '900' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1 },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '800' },
  meta: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  link: { fontSize: 12, fontWeight: '800', marginTop: 4 },
  amount: { fontSize: 15, fontWeight: '900' },
  retry: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
});
