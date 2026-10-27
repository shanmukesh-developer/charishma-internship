// Pickup tab (In-Campus Booking, owner board vendor screens 1 and 2): today's real numbers (bookings, payments to
// check, earnings), then Pending / Accepted / History. Pending puts payments to review first; bookings still
// waiting for the student to pay are shown below them, dimmed. Tap a booking to verify, prepare and hand over.
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { campusApi, inr, type CbSummary, type CbTab, type CbVendorBooking } from '../lib/campusApi';
import { errorMessage } from '../lib/http';
import { color, font, radius, space, touch } from '../theme';
import { Button, Card, EmptyState, ErrorStrip, SkeletonCard } from '../ui/kit';
import type { MainTab, RootStack } from '../nav';
import { POLL_MS } from '../config';
import { AppState } from 'react-native';
import { BookingCard, Tile } from './CampusParts';
import { useCampusLive } from './useCampusLive';
import { useSession } from '../state/SessionProvider';

const TABS: { key: CbTab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'history', label: 'History' },
];

export default function CampusScreen({ onSummary, onOpenTab }: { onSummary?: (s: CbSummary) => void; onOpenTab?: (tab: MainTab) => void }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>();
  const { restaurant } = useSession();
  const [tab, setTab] = useState<CbTab>('pending');
  const [summary, setSummary] = useState<CbSummary | null>(null);
  const [lists, setLists] = useState<Partial<Record<CbTab, CbVendorBooking[]>>>({});
  const [counts, setCounts] = useState<{ pending: number; accepted: number }>({ pending: 0, accepted: 0 });
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (which: CbTab = tab, pull = false) => {
    if (pull) setRefreshing(true);
    try {
      const [s, l] = await Promise.all([campusApi.summary(), campusApi.list(which)]);
      setSummary(s);
      onSummary?.(s);
      setLists((prev) => ({ ...prev, [which]: l.bookings }));
      setCounts(l.counts);
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "Couldn't load bookings."));
    } finally {
      setRefreshing(false);
    }
  }, [tab, onSummary]);

  useEffect(() => { void load(tab); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useCampusLive(() => { void load(tab); });
  // Safety refresh while the app is open (covers a dropped socket and phones without closed-app pushes).
  useEffect(() => {
    const t = setInterval(() => { if (AppState.currentState === 'active') void load(tab); }, POLL_MS);
    return () => clearInterval(t);
  }, [load, tab]);
  // Coming back from a booking screen: refresh what changed there.
  useEffect(() => navigation.addListener('focus', () => { void load(tab); }), [navigation, load, tab]);

  const list = lists[tab];
  const s = summary?.settings;
  const open = (b: CbVendorBooking) => navigation.navigate('CampusOrder', { bookingId: b.id });

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.sm }}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[font.h1, { color: color.text }]} numberOfLines={1}>{restaurant?.name || 'In-Campus Booking'}</Text>
          <Text style={[font.small, { color: color.textMuted }]}>In-Campus Booking · students pay you by UPI and collect at your counter</Text>
        </View>
      </View>

      {s && !s.takingBookings ? (
        <Card style={{ gap: space.xs, backgroundColor: color.warningTint, borderColor: color.warning }}>
          <Text style={[font.h3, { color: color.warning }]}>{s.enabled ? 'Add your UPI ID to take bookings' : 'Bookings are off for your stall'}</Text>
          <Text style={[font.body, { color: color.textSecondary }]}>
            {s.enabled ? 'Students pay you on your UPI ID. Add it in Settings.' : 'ZCS switches In-Campus Booking on for your stall. You can add your UPI ID and QR now.'}
          </Text>
          <Button label="UPI and pickup settings" variant="secondary" size="secondary" icon="settings-outline" onPress={() => onOpenTab?.('settings')} />
        </Card>
      ) : null}

      <View style={styles.tiles}>
        <Tile label="Today's orders" value={String(summary?.today.orders ?? '–')} caption={summary ? `${summary.today.paidOrders} paid` : undefined} />
        <Tile label="To review" value={String(summary?.pendingReview ?? '–')} tint={summary?.pendingReview ? color.warning : undefined} caption="Payments" />
        <Tile label="Earnings" value={summary ? inr(summary.today.earnings) : '–'} tint={color.openDark} caption="Today" />
      </View>

      <View style={styles.quick}>
        <QuickLink icon="wallet-outline" label="Earnings" onPress={() => onOpenTab?.('earnings')} />
        <QuickLink icon="fast-food-outline" label="Menu" onPress={() => onOpenTab?.('menu')} />
        <QuickLink icon="qr-code-outline" label="UPI settings" onPress={() => onOpenTab?.('settings')} />
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => {
          const sel = t.key === tab;
          const n = t.key === 'history' ? null : counts[t.key];
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: sel }} style={[styles.tab, sel && styles.tabSel]}>
              <Text style={[font.body, { color: sel ? color.textInverse : color.text, fontWeight: '800' }]}>{t.label}{n !== null ? ` (${n})` : ''}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <ErrorStrip text={error} onRetry={() => load(tab, true)} busy={refreshing} /> : null}
    </View>
  );

  return (
    <FlatList
      data={list || []}
      keyExtractor={(b) => b.id}
      contentContainerStyle={{ padding: space.md, gap: space.sm, paddingBottom: space.xxl * 2 }}
      ListHeaderComponent={header}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(tab, true)} colors={[color.open]} />}
      renderItem={({ item }) => <BookingCard b={item} onPress={() => open(item)} />}
      ListEmptyComponent={!list ? <SkeletonCard /> : (
        <EmptyState
          icon={tab === 'history' ? 'time-outline' : 'bag-check-outline'}
          title={tab === 'pending' ? 'No payments to check' : tab === 'accepted' ? 'Nothing to prepare' : 'No finished bookings yet'}
          body={tab === 'pending' ? 'New bookings appear here with the payment proof. You get a notification too.' : undefined}
        />
      )}
    />
  );
}

function QuickLink({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.quickBtn, pressed && { opacity: 0.75 }]}>
      <Ionicons name={icon} size={22} color={color.openDark} />
      <Text style={[font.small, { color: color.text, fontWeight: '700' }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  tiles: { flexDirection: 'row', gap: space.xs },
  quick: { flexDirection: 'row', gap: space.xs },
  quickBtn: { flex: 1, minHeight: touch.min + 8, borderRadius: radius.md, backgroundColor: color.openTint, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: space.xs },
  tabs: { flexDirection: 'row', gap: space.xs },
  tab: { flex: 1, minHeight: touch.min, borderRadius: radius.pill, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  tabSel: { backgroundColor: color.openDark, borderColor: color.openDark },
});
