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
import { NowProvider, StoreProvider } from './src/state/StoreProvider';
import { initVoice } from './src/voice/voice';
import { color } from './src/theme';
import LoginScreen from './src/screens/LoginScreen';
import MainScreen, { RootStack } from './src/screens/MainScreen';
import OrderDetailScreen from './src/screens/OrderDetailScreen';
import { scheduleApiEndpointCheck } from './src/config';

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
      <StoreProvider key={restaurant.id}>
        <NowProvider>
          <NavigationContainer theme={navTheme}>
            <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}>
              <Stack.Screen name="Main" component={MainScreen} />
              <Stack.Screen name="OrderDetail">
                {({ route, navigation }) => <OrderDetailScreen orderId={route.params.orderId} onBack={() => navigation.goBack()} />}
              </Stack.Screen>
            </Stack.Navigator>
          </NavigationContainer>
        </NowProvider>
      </StoreProvider>
    </SocketProvider>
  );
}

export default function App() {
  // Own-domain move: learn / verify / self-heal the API address for the NEXT launch (src/config.ts).
  useEffect(() => { scheduleApiEndpointCheck(); }, []);
  useEffect(() => { initVoice(); }, []);
  return (
    <SafeAreaProvider>
      {/* Real keyboard insets for every screen and sheet (Android edge-to-edge ignores adjustResize). */}
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
        <StatusBar style="dark" />
        <ToastProvider>
          <SessionProvider>
            <Root />
          </SessionProvider>
        </ToastProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
