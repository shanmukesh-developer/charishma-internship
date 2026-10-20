// Zenvy Auto Driver: root. Signed out -> Login / Register. Suspended -> Suspended screen.
// Signed in -> one stack; the first screen is Home when verified, else the Verification hub (the stack is
// re-keyed when the status changes). Push taps open the right screen; the offline queue (safe actions
// only) is flushed on every reconnect.
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ToastProvider, useToast } from './src/ui/Toast';
import { SESSION_EXPIRED, SessionProvider, useSession } from './src/state/SessionProvider';
import { SocketProvider, useSocket } from './src/state/SocketProvider';
import { flushQueue } from './src/lib/offlineQueue';
import { onDriverPush } from './src/lib/push';
import { color } from './src/theme';
import type { RootStack } from './src/nav';
import { LoginScreen, RegisterScreen } from './src/screens/Auth';
import { DocumentsScreen, SuspendedScreen, VerificationScreen } from './src/screens/Onboarding';
import { VehicleFormScreen, VehiclesScreen } from './src/screens/Vehicles';
import HomeScreen from './src/screens/Home';
import PublishScreen from './src/screens/Publish';
import TripDetailScreen from './src/screens/TripDetail';
import CheckInScreen from './src/screens/CheckIn';
import RequestsScreen from './src/screens/Requests';
import { EarningsScreen, HistoryScreen, NotificationsScreen, ProfileScreen, QueueScreen, SettingsScreen, SupportScreen } from './src/screens/More';
import { DeleteAccountScreen } from './src/screens/DeleteAccount';
import { scheduleApiEndpointCheck } from './src/config';
import WakeBanner from './src/lib/WakeBanner';
import UpdateGate from './src/lib/UpdateGate';
import { ErrorBoundary } from './src/ui/ErrorBoundary';

const Stack = createNativeStackNavigator<RootStack>();
const navRef = createNavigationContainerRef<RootStack>();
const navTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: color.bg, card: color.surface, text: color.text, primary: color.text } };
const screenOpts = { headerShown: false, contentStyle: { backgroundColor: color.bg } } as const;

function Splash() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bg }}>
      <ActivityIndicator size="large" color={color.text} />
    </View>
  );
}

/** Flushes the offline queue on every (re)connect and when the HTTP client sees the internet again. */
function QueueRunner() {
  const { connectCount } = useSocket();
  const { netOk, token } = useSession();
  const toast = useToast();
  useEffect(() => {
    if (!token || !netOk) return;
    flushQueue().then((r) => {
      if (r.done.includes('GO_OFFLINE')) toast.show('You are now offline (sent when the internet came back).', 'info');
    }).catch(() => {});
  }, [connectCount, netOk, token, toast]);
  return null;
}

/** Push tap -> screen (data from modules/autoRide/services/notify.js: type, tripId, requestId, vehicleId). */
function PushRouter() {
  const { refreshMe } = useSession();
  useEffect(() => onDriverPush((data, tapped) => {
    if (data.type && /DRIVER_|VEHICLE_/.test(data.type)) refreshMe();
    if (!tapped || !navRef.isReady()) return;
    if (data.requestId || data.type === 'AUTO_PRIVATE_REQUEST') navRef.navigate('Requests');
    else if (data.tripId) navRef.navigate('TripDetail', { tripId: String(data.tripId) });
    else if (data.vehicleId) navRef.navigate('Vehicles');
    else navRef.navigate('Notifications');
  }), [refreshMe]);
  return null;
}

function SignedIn() {
  const { me, driver } = useSession();
  const status = me?.driver.status || driver?.status;
  const verified = status === 'VERIFIED';
  return (
    <Stack.Navigator key={verified ? 'verified' : 'onboarding'} initialRouteName={verified ? 'Home' : 'Verification'} screenOptions={screenOpts}>
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="Verification" component={VerificationScreen} />
      <Stack.Screen name="Documents" component={DocumentsScreen} />
      <Stack.Screen name="Vehicles" component={VehiclesScreen} />
      <Stack.Screen name="VehicleForm" component={VehicleFormScreen} />
      <Stack.Screen name="Publish" component={PublishScreen} />
      <Stack.Screen name="TripDetail" component={TripDetailScreen} />
      <Stack.Screen name="CheckIn" component={CheckInScreen} />
      <Stack.Screen name="Requests" component={RequestsScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="History" component={HistoryScreen} />
      <Stack.Screen name="Earnings" component={EarningsScreen} />
      <Stack.Screen name="Queue" component={QueueScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="Support" component={SupportScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="DeleteAccount" component={DeleteAccountScreen} />
    </Stack.Navigator>
  );
}

function Root() {
  const { ready, token, suspended, signOut, refreshMe } = useSession();
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  if (!ready) return <Splash />;
  if (!token) {
    return (
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator screenOptions={screenOpts}>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }
  if (suspended) return <SuspendedScreen message={suspended} onSignOut={() => signOut(suspended)} />;
  return (
    <SocketProvider token={token} onAuthError={(m) => { if (/suspended/i.test(m)) refreshMe(); else signOutRef.current(SESSION_EXPIRED); }}>
      <QueueRunner />
      <PushRouter />
      <NavigationContainer theme={navTheme} ref={navRef}>
        <SignedIn />
      </NavigationContainer>
    </SocketProvider>
  );
}

export default function App() {
  // Own-domain move: learn / verify / self-heal the API address for the NEXT launch (src/config.ts).
  useEffect(() => { scheduleApiEndpointCheck(); }, []);
  return (
    <SafeAreaProvider>
      {/* C9: a render error shows a calm "Something went wrong — Restart" screen instead of a crash. */}
      <ErrorBoundary appName="Zenvy Auto Driver">
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
