// ZCS Campus Stall: root. The stall side of In-Campus Booking (students book for pickup, pay the stall directly by
// UPI, collect with a pickup code). Signed out -> Login (the stall's ZCS Vendor account). Signed in -> one stack:
// the four tabs (Bookings, Menu, Earnings, Settings) plus a booking screen on top.
import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ToastProvider } from './src/ui/Toast';
import { SocketProvider } from './src/state/SocketProvider';
import { SESSION_EXPIRED, SessionProvider, useSession } from './src/state/SessionProvider';
import { MenuProvider } from './src/state/MenuProvider';
import { color } from './src/theme';
import type { RootStack } from './src/nav';
import LoginScreen from './src/screens/LoginScreen';
import MainScreen from './src/screens/MainScreen';
import CampusOrderScreen from './src/campus/CampusOrderScreen';
import { scheduleApiEndpointCheck } from './src/config';
import WakeBanner from './src/lib/WakeBanner';
import UpdateGate from './src/lib/UpdateGate';
import { ErrorBoundary } from './src/ui/ErrorBoundary';

const Stack = createNativeStackNavigator<RootStack>();
const navTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: color.bg, card: color.surface, text: color.text, primary: color.text } };

function Root() {
  const { ready, token, restaurant, signOut } = useSession();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bg }}>
        <ActivityIndicator size="large" color={color.text} />
      </View>
    );
  }
  if (!token || !restaurant) return <LoginScreen />;
  return (
    <SocketProvider token={token} restaurantId={restaurant.id} onAuthError={() => signOut(SESSION_EXPIRED)}>
      <MenuProvider key={restaurant.id}>
        <NavigationContainer theme={navTheme}>
          <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}>
            <Stack.Screen name="Main" component={MainScreen} />
            <Stack.Screen name="CampusOrder">
              {({ route, navigation }) => <CampusOrderScreen bookingId={route.params.bookingId} onBack={() => navigation.goBack()} />}
            </Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
      </MenuProvider>
    </SocketProvider>
  );
}

export default function App() {
  // Own-domain move: learn / verify / self-heal the API address for the NEXT launch (src/config.ts).
  useEffect(() => { scheduleApiEndpointCheck(); }, []);
  return (
    <SafeAreaProvider>
      {/* A render error shows a calm "Something went wrong — Restart" screen instead of a crash. */}
      <ErrorBoundary appName="ZCS Campus Stall">
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
