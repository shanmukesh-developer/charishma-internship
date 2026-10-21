// Top of every main screen: shop name + the OPEN / CLOSED switch, then the connection and voice-off
// banners. `useOpenToggle` is shared with the big switch on the Shop screen.
import React, { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SUPPORT_PHONE } from '../config';
import { clockIST, formatHHMM, rupees, todayNumbers } from '../lib/model';
import { openNotificationSettings } from '../lib/push';
import { useStore } from '../state/StoreProvider';
import { useVoice } from '../voice/useVoice';
import { color, font, radius, space, touch } from '../theme';
import { Button, Sheet } from '../ui/kit';

const callSupport = () => Linking.openURL(`tel:+${SUPPORT_PHONE}`).catch(() => {});

/** Open / close logic + its confirm and info sheets. Render `sheets` once wherever the hook is used. */
export function useOpenToggle() {
  const { store, storeError, setOpen, refreshStore, orders } = useStore();
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<null | 'paused'>(null);
  const [err, setErr] = useState<string | null>(null);

  const paused = store?.isActive === false;
  const on = !!store?.isOpenNow && !paused;
  const live = !!store?.isOpen && !paused;

  const change = async (open: boolean) => {
    if (saving) return;
    setSaving(true);
    setErr(null);
    const res = await setOpen(open);
    setSaving(false);
    if (res.ok) setConfirm(false);
    else if (res.error) setErr(res.error);
  };

  const press = () => {
    if (!store) { refreshStore(); return; }
    if (paused) { setInfo('paused'); return; }
    setErr(null);
    if (on) setConfirm(true);
    else change(true);
  };

  const t = confirm ? todayNumbers(orders) : null;
  const activeCount = orders.filter((o) => o.stage === 'new' || o.stage === 'accepted' || o.stage === 'outForDelivery').length;

  const sheets = (
    <>
      <Sheet visible={confirm} onClose={() => setConfirm(false)} title="Close the shop?">
        <Text style={[font.body, { color: color.textSecondary, marginBottom: space.sm }]}>
          Customers can't order until you open again.{activeCount ? ` Your ${activeCount} running order${activeCount === 1 ? '' : 's'} stay on screen.` : ''}
        </Text>
        {t && t.orders > 0 ? (
          <Text style={[font.body, { color: color.text, fontWeight: '700', marginBottom: space.md }]}>
            Today: {t.orders} order{t.orders === 1 ? '' : 's'} · {rupees(t.cashCollected)} cash collected
          </Text>
        ) : null}
        {err ? <Text style={[font.body, { color: color.alertDark, fontWeight: '700', marginBottom: space.sm }]}>{err}</Text> : null}
        <View style={{ gap: space.xs }}>
          <Button label={err ? 'TRY AGAIN — CLOSE SHOP' : 'CLOSE SHOP'} variant="reject" onPress={() => change(false)} loading={saving} />
          <Button label="Stay open" variant="secondary" size="secondary" onPress={() => setConfirm(false)} disabled={saving} />
        </View>
      </Sheet>
      <Sheet visible={info !== null} onClose={() => setInfo(null)} title="Paused by Zenvy">
        <Text style={[font.body, { color: color.textSecondary, marginBottom: space.md }]}>
          Zenvy has paused your shop, so customers can't order right now. Call Zenvy support to turn it back on.
        </Text>
        <Button label="Call Zenvy support" icon="call" onPress={callSupport} />
      </Sheet>
    </>
  );

  return { store, storeError, paused, on, live, saving, press, sheets };
}

function OpenPill() {
  const { store, storeError, paused, on, live, saving, press, sheets } = useOpenToggle();
  if (!store) {
    return (
      <Pressable
        onPress={press}
        accessibilityRole="button"
        accessibilityLabel={storeError ? 'Shop status failed to load. Tap to retry' : 'Loading shop status'}
        style={[styles.pill, { backgroundColor: color.surfaceAlt, justifyContent: 'center' }]}
      >
        {storeError ? <Ionicons name="refresh" size={22} color={color.text} /> : <ActivityIndicator color={color.textMuted} />}
      </Pressable>
    );
  }
  return (
    <>
      <Pressable
        onPress={press}
        disabled={saving}
        accessibilityRole="switch"
        accessibilityState={{ checked: on, busy: saving }}
        accessibilityLabel={paused ? 'Shop paused by Zenvy. Tap for support' : live ? 'Shop open. Tap to close' : on ? 'Switched on but outside hours' : 'Shop closed. Tap to open'}
        style={({ pressed }) => [styles.pill, { backgroundColor: live ? color.open : on ? color.warning : color.closed }, pressed && { opacity: 0.85 }]}
      >
        {saving ? <ActivityIndicator color={color.textInverse} style={{ flex: 1 }} /> : (
          <>
            <Text style={[font.label, { color: color.textInverse, fontSize: 14 }]}>{paused ? 'PAUSED' : on ? 'OPEN' : 'CLOSED'}</Text>
            <View style={[styles.track, { alignItems: on ? 'flex-end' : 'flex-start' }]}>
              <View style={styles.knob} />
            </View>
          </>
        )}
      </Pressable>
      {sheets}
    </>
  );
}

/** One-line description of the shop's live state. */
export function shopLine(store: ReturnType<typeof useStore>['store']): { text: string; tint: string } {
  if (!store) return { text: 'Checking status…', tint: color.textMuted };
  if (store.isActive === false) return { text: 'Paused by Zenvy — contact support', tint: color.alertDark };
  if (store.isOpen) return { text: 'Open · taking orders', tint: color.openDark };
  if (store.isOpenNow) {
    // Switch ON but closed: outside the hours (opensAt), or something Zenvy set (offline stall, closed today).
    if (store.opensAt) return { text: `Outside your hours (opens at ${formatHHMM(store.opensAt)})`, tint: color.warning };
    return { text: store.closedReason || 'Outside your hours', tint: color.warning };
  }
  return { text: 'Closed — no new orders', tint: color.alertDark };
}

export function ShopBar() {
  const insets = useSafeAreaInsets();
  const { restaurant, store } = useStore();
  const name = store?.name || restaurant.name || 'Your shop';
  const line = shopLine(store);
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.xs }]}>
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={[font.h2, { color: color.text }]} numberOfLines={1}>{name}</Text>
          <Text style={[font.small, { color: line.tint, fontWeight: '800' }]} numberOfLines={1}>{line.text}</Text>
        </View>
        <OpenPill />
      </View>
    </View>
  );
}

export function ConnBanner() {
  const { conn, retryConnection, lastSyncedAt, refreshing } = useStore();
  if (conn === 'online') return null;
  if (conn === 'offline') {
    return (
      <View style={[styles.banner, { backgroundColor: color.alert }]} accessibilityLiveRegion="assertive">
        <Ionicons name="cloud-offline" size={24} color={color.textInverse} />
        <View style={{ flex: 1 }}>
          <Text style={[font.body, { color: color.textInverse, fontWeight: '800' }]}>No internet — orders won't ring</Text>
          <Text style={[font.small, { color: color.textInverse }]}>
            {lastSyncedAt ? `Last updated ${clockIST(lastSyncedAt)}` : 'Check Wi-Fi or mobile data'}
          </Text>
        </View>
        <Pressable onPress={retryConnection} disabled={refreshing} accessibilityRole="button" accessibilityLabel="Retry connection" style={styles.retry}>
          {refreshing ? <ActivityIndicator color={color.alertDark} /> : <Text style={[font.label, { color: color.alertDark }]}>RETRY</Text>}
        </Pressable>
      </View>
    );
  }
  return (
    <View style={[styles.banner, { backgroundColor: color.warningTint }]} accessibilityLiveRegion="polite">
      <ActivityIndicator color={color.warning} />
      <Text style={[font.body, { color: color.warning, fontWeight: '800', flex: 1 }]}>
        {conn === 'connecting' ? 'Connecting to Zenvy…' : 'Reconnecting…'}
      </Text>
    </View>
  );
}

/** Closed-app order alerts are off (or silent) on this phone: new orders only ring while the app is open. */
export function PushOffBanner() {
  const { pushState } = useStore();
  if (pushState !== 'blocked' && pushState !== 'unavailable' && pushState !== 'muted') return null;
  const fixable = pushState === 'blocked' || pushState === 'muted';
  const text = pushState === 'blocked'
    ? 'Do not close this app. Notifications are blocked, so new orders ring only while Zenvy is open. Tap to fix.'
    : pushState === 'muted'
      ? 'The "New orders" sound is off in your phone settings, so a new order may not ring when Zenvy is closed. Tap to turn it on.'
      : 'Do not close this app. Alerts with the app closed are not available on this phone, so new orders ring only while Zenvy is open.';
  return (
    <Pressable
      onPress={fixable ? () => { openNotificationSettings(pushState); } : undefined}
      disabled={!fixable}
      accessibilityRole={fixable ? 'button' : 'text'}
      accessibilityLabel={fixable ? `${text} Open settings` : text}
      style={[styles.banner, { backgroundColor: color.alertTint }]}
    >
      <Ionicons name="notifications-off" size={22} color={color.alert} />
      <Text style={[font.body, { color: color.alertDark, fontWeight: '800', flex: 1 }]}>{text}</Text>
      {fixable ? <Text style={[font.label, { color: color.alertDark }]}>FIX</Text> : null}
    </Pressable>
  );
}

export function VoiceOffBanner({ onFix }: { onFix: () => void }) {
  const v = useVoice();
  if (!v.loaded || v.settings.enabled) return null;
  return (
    <Pressable onPress={onFix} accessibilityRole="button" accessibilityLabel="Voice is off. Open settings" style={[styles.banner, { backgroundColor: color.alertTint }]}>
      <Ionicons name="volume-mute" size={22} color={color.alert} />
      <Text style={[font.body, { color: color.alertDark, fontWeight: '800', flex: 1 }]}>Voice announcements are OFF</Text>
      <Text style={[font.label, { color: color.alertDark }]}>TURN ON</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: color.surface, paddingHorizontal: space.md, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: color.border },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pill: { minWidth: 132, height: touch.icon + 8, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: space.sm, paddingRight: 6, gap: space.xs },
  track: { width: 54, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.35)', padding: 3, justifyContent: 'center' },
  knob: { width: 26, height: 26, borderRadius: 13, backgroundColor: color.surface },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.xs, minHeight: 52 },
  retry: { backgroundColor: color.surface, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: touch.min, minWidth: 84, alignItems: 'center', justifyContent: 'center' },
});
