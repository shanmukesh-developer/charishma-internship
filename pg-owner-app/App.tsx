// ZCS PG Partner: root. Signed out -> Login. Temporary password still set -> FirstPassword (the server refuses
// every other owner endpoint until then). Suspended -> Suspended screen. Signed in -> one stack: the five tabs
// plus the pushed screens. Push taps open Booking requests / Complaints; the offline queue (mark-read only) is
// flushed whenever the internet comes back.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ToastProvider } from './src/ui/Toast';
import { SessionProvider, useSession } from './src/state/SessionProvider';
import { ListingProvider } from './src/state/ListingProvider';
import { HomeProvider, useHome } from './src/state/HomeProvider';
import { flushQueue } from './src/lib/offlineQueue';
import { onOwnerPush, takeLaunchPushTap, type PushData } from './src/lib/push';
import { startLive } from './src/lib/live';
import { color } from './src/theme';
import type { RootStack } from './src/nav';
import { FirstPasswordScreen, LoginScreen, SuspendedScreen } from './src/screens/Auth';
import TabsScreen from './src/screens/Tabs';
import RequestsScreen from './src/screens/Requests';
import TenantsScreen from './src/screens/Tenants';
import ComplaintsScreen from './src/screens/Complaints';
import BuildingScreen from './src/screens/Building';
import { ChangePasswordScreen, DeleteAccountScreen, NotificationsScreen, SettingsScreen } from './src/screens/More';
import { scheduleApiEndpointCheck } from './src/config';
import WakeBanner from './src/lib/WakeBanner';
import UpdateGate from './src/lib/UpdateGate';
import { ErrorBoundary } from './src/ui/ErrorBoundary';

const Stack = createNativeStackNavigator<RootStack>();
const navRef = createNavigationContainerRef<RootStack>();
const navTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: color.bg, card: color.surface, text: color.text, primary: color.primary } };
const screenOpts = { headerShown: false, contentStyle: { backgroundColor: color.bg } } as const;

function Splash() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bg }}>
      <ActivityIndicator size="large" color={color.primary} />
    </View>
  );
}

/** Flushes the offline queue when the HTTP client sees the internet again. */
function QueueRunner() {
  const { netOk, token } = useSession();
  useEffect(() => {
    if (token && netOk) flushQueue().catch(() => {});
  }, [netOk, token]);
  return null;
}

const routePush = (data: PushData) => {
  if (data.type === 'PG_OWNER_COMPLAINT' || data.complaintId) navRef.navigate('Complaints');
  // A request the student withdrew is under Closed.
  else if (data.type === 'PG_OWNER_BOOKING_CANCELLED') navRef.navigate('Requests', { status: 'closed' });
  else if (data.type === 'PG_OWNER_BOOKING' || data.bookingId) navRef.navigate('Requests', { status: 'Pending' });
  else navRef.navigate('Notifications');
};

/** Live `pg:changed` events while signed in (src/lib/live.ts): the open list and the badges refetch at once. */
function LiveRunner() {
  const { token } = useSession();
  const { nudge } = useHome();
  const nudgeRef = useRef(nudge);
  nudgeRef.current = nudge;
  useEffect(() => {
    if (!token) return undefined;
    return startLive(token, (kind) => nudgeRef.current(kind));
  }, [token]);
  return null;
}

const pushKind = (data: PushData): 'bookings' | 'complaints' | 'all' =>
  data.type === 'PG_OWNER_COMPLAINT' || data.complaintId ? 'complaints' : data.bookingId || String(data.type || '').includes('BOOKING') ? 'bookings' : 'all';

/**
 * Push received -> refresh the badges and the open list (PF-09); push tapped -> the right screen. A tap before the navigator is ready is kept
 * and routed on ready; the tap that launched a closed app is read once (takeLaunchPushTap).
 */
function PushRouter({ navReady }: { navReady: boolean }) {
  const { refresh, nudge } = useHome();
  const pending = useRef<PushData | null>(null);
  useEffect(() => onOwnerPush((data, tapped) => {
    nudge(pushKind(data));
    if (!tapped) return;
    if (!navRef.isReady()) { pending.current = data; return; }
    routePush(data);
  }), [nudge]);
  useEffect(() => {
    if (!navReady) return;
    if (pending.current) { const d = pending.current; pending.current = null; routePush(d); }
    let alive = true;
    takeLaunchPushTap().then((d) => {
      if (!alive || !d || !navRef.isReady()) return;
      refresh();
      routePush(d);
    });
    return () => { alive = false; };
  }, [navReady, refresh]);
  return null;
}

function SignedIn() {
  const [navReady, setNavReady] = useState(false);
  return (
    <ListingProvider>
      <HomeProvider>
        <QueueRunner />
        <LiveRunner />
        <PushRouter navReady={navReady} />
        <NavigationContainer theme={navTheme} ref={navRef} onReady={() => setNavReady(true)}>
          <Stack.Navigator screenOptions={screenOpts}>
            <Stack.Screen name="Tabs" component={TabsScreen} />
            <Stack.Screen name="Requests" component={RequestsScreen} />
            <Stack.Screen name="Tenants" component={TenantsScreen} />
            <Stack.Screen name="Complaints" component={ComplaintsScreen} />
            <Stack.Screen name="Building" component={BuildingScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
            <Stack.Screen name="DeleteAccount" component={DeleteAccountScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </HomeProvider>
    </ListingProvider>
  );
}

function Root() {
  const { ready, token, owner, suspended, signOut } = useSession();
  if (!ready) return <Splash />;
  if (!token || !owner) return <LoginScreen />;
  if (suspended) return <SuspendedScreen message={suspended} onSignOut={() => signOut(suspended)} />;
  if (owner.mustChangePassword) return <FirstPasswordScreen />;
  return <SignedIn />;
}

export default function App() {
  // Own-domain move: learn / verify / self-heal the API address for the NEXT launch (src/config.ts).
  useEffect(() => { scheduleApiEndpointCheck(); }, []);
  return (
    <SafeAreaProvider>
      {/* A render error shows a calm "Something went wrong — Restart" screen instead of a crash. */}
      <ErrorBoundary appName="ZCS PG Partner">
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
          <StatusBar style="dark" />
          <ToastProvider>
            {/* Force update: a retired version sees only the Update screen; a newer release shows a banner. */}
            <UpdateGate>
              <SessionProvider>
                <Root />
              </SessionProvider>
            </UpdateGate>
            {/* Backend restart: calm "waking up" banner while GETs retry (serverWake.ts) */}
            <WakeBanner />
          </ToastProvider>
        </KeyboardProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
