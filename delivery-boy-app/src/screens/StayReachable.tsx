// Stay reachable: the red "order alerts are off" banner on Home, and the one-time battery / autostart guide.
// Vivo, Xiaomi, Oppo and Realme close background apps on their own, so a rider who never changes these
// settings stops hearing orders once the screen is off. Everything here only opens the phone's own
// Settings pages (src/services/deviceSettings): no extra native modules.
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { C, R, S, T } from '../theme';
import { Banner, Btn, Card } from '../ui/kit';
import { Sheet } from '../ui/Sheet';
import { useAppActive } from '../state/hooks';
import { ALERT_CHANNEL, askNotificationPermission, checkAlertHealth, type AlertHealth } from '../services/notifications';
import { openAppSettings, openBatterySettings, openNotificationSettings, phoneBrand, type PhoneBrand } from '../services/deviceSettings';
import { getItem, setItem } from '../services/session';
import { KEYS } from '../config';

/** Re-checked on start and every time the rider comes back to the app (e.g. from Settings). */
export function useAlertHealth(): { health: AlertHealth; recheck: () => void } {
  const active = useAppActive();
  const [health, setHealth] = useState<AlertHealth>({ state: 'unknown' });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    checkAlertHealth().then((h) => {
      if (alive) setHealth(h);
    });
    return () => {
      alive = false;
    };
  }, [active, nonce]);
  const recheck = useCallback(() => setNonce((n) => n + 1), []);
  return { health, recheck };
}

async function fixAlerts(health: AlertHealth, recheck: () => void): Promise<void> {
  if (health.state === 'blocked' && health.canAskAgain) {
    await askNotificationPermission();
    recheck();
    return;
  }
  await openNotificationSettings(health.state === 'muted' ? ALERT_CHANNEL : undefined);
}

/** Red banner while new-order alerts cannot ring on this phone. Renders nothing when they can. */
export function AlertHealthBanner() {
  const { health, recheck } = useAlertHealth();
  if (health.state !== 'blocked' && health.state !== 'muted') return null;
  const text =
    health.state === 'blocked'
      ? 'Notifications are blocked. You will not hear new orders when the app is in the background.'
      : 'The "New delivery orders" sound is turned off. Turn it on so you hear new orders.';
  return <Banner tone="red" icon="bell-off" text={text} action={{ label: health.state === 'blocked' && health.canAskAgain ? 'Allow' : 'Fix', onPress: () => fixAlerts(health, recheck) }} />;
}

const AUTOSTART: Record<PhoneBrand, string> = {
  xiaomi: 'Open Security, then Manage apps, ZCS Rider and turn on Autostart. Under Battery saver choose No restrictions.',
  oppo: 'Open Settings, then Apps, ZCS Rider, Battery usage. Turn on Allow background activity and Allow auto launch.',
  realme: 'Open Settings, then Apps, ZCS Rider, Battery usage. Turn on Allow background activity and Allow auto launch.',
  vivo: 'Open Settings, then Battery, Background power consumption, ZCS Rider and choose Allow. In i Manager, turn on Autostart for ZCS Rider.',
  oneplus: 'Open Settings, then Apps, ZCS Rider, Battery and choose Unrestricted.',
  samsung: 'Open Settings, then Battery, Background usage limits, Never sleeping apps and add ZCS Rider.',
  other: 'Open Settings, then Apps, ZCS Rider, Battery and choose Unrestricted. If your phone has Autostart, turn it on for ZCS Rider.',
};

function Step({ n, title, body, done, action }: { n: number; title: string; body: string; done?: boolean; action?: React.ReactNode }) {
  return (
    <View style={styles.step}>
      <View style={[styles.num, { backgroundColor: done ? C.green : C.ink }]}>
        {done ? <MaterialCommunityIcons name="check-bold" size={16} color={C.white} /> : <Text style={[T.small, { color: C.white, fontWeight: '800' }]}>{n}</Text>}
      </View>
      <View style={{ flex: 1, gap: S.xs }}>
        <Text style={[T.body, { color: C.ink, fontWeight: '800' }]}>{title}</Text>
        <Text style={[T.small, { color: C.ink2 }]}>{body}</Text>
        {action}
      </View>
    </View>
  );
}

/** The checklist itself (also opened from Profile). */
export function StayReachableSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { health, recheck } = useAlertHealth();
  const brand = phoneBrand();
  const alertsOk = health.state === 'ok';
  return (
    <Sheet visible={visible} onClose={onClose} title="Stay reachable" footer={<Btn title="Done" icon="check" onPress={onClose} />}>
      <Text style={[T.body, { color: C.ink2 }]}>
        Many phones close apps in the background to save battery. Do these once so you keep hearing new orders with the screen off.
      </Text>
      <Step
        n={1}
        title="Notifications on, with sound"
        body={alertsOk ? 'Done. New-order alerts can ring on this phone.' : 'Allow notifications and keep the "New delivery orders" sound on.'}
        done={alertsOk}
        action={alertsOk ? null : <Btn title="Open notification settings" size="small" variant="outline" onPress={() => fixAlerts(health, recheck)} />}
      />
      {Platform.OS === 'android' ? (
        <>
          <Step
            n={2}
            title="Battery: no restrictions"
            body={`In the list, pick ZCS Rider and choose "Don't optimise", "Unrestricted" or "No restrictions".`}
            action={<Btn title="Open battery settings" size="small" variant="outline" onPress={openBatterySettings} />}
          />
          <Step
            n={3}
            title="Autostart and background activity"
            body={AUTOSTART[brand]}
            action={<Btn title="Open app settings" size="small" variant="outline" onPress={openAppSettings} />}
          />
          <Step n={4} title="Lock the app in recent apps" body="Open recent apps, then press and hold ZCS Rider (or tap its lock) so the phone does not close it." />
        </>
      ) : null}
    </Sheet>
  );
}

/** One-time card on Home until the rider opens the guide or dismisses it. */
export function StayReachableCard() {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    getItem(KEYS.reachableGuide).then((v) => setShow(!v)).catch(() => {});
  }, []);
  const finish = () => {
    setShow(false);
    setItem(KEYS.reachableGuide, String(Date.now())).catch(() => {});
  };
  if (!show && !open) return null;
  return (
    <>
      {show ? (
        <Card style={{ gap: S.sm, borderWidth: 2, borderColor: C.amber }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <MaterialCommunityIcons name="battery-alert-variant-outline" size={26} color={C.amber} />
            <Text style={[T.h3, { color: C.ink, flex: 1 }]}>Keep hearing new orders</Text>
          </View>
          <Text style={[T.body, { color: C.ink2 }]}>Your phone may close ZCS Rider in the background to save battery. It takes 2 minutes to stop that.</Text>
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <Btn title="Later" variant="soft" size="mid" onPress={finish} style={{ flex: 1 }} />
            <Btn
              title="Show me how"
              size="mid"
              onPress={() => {
                finish();
                setOpen(true);
              }}
              style={{ flex: 2 }}
            />
          </View>
        </Card>
      ) : null}
      <StayReachableSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', gap: S.md, alignItems: 'flex-start', backgroundColor: C.cardAlt, borderRadius: R.md, padding: S.md },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
