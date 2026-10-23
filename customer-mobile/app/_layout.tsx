import 'react-native-gesture-handler';
import React from 'react';
import { Stack } from 'expo-router';
import { Platform, View, StyleSheet, Alert, ActivityIndicator, LogBox } from 'react-native';

// Web preview only: react-native-web renders nested touchables as nested <button>s and logs a
// dev warning. It never happens on Android/iOS, so keep it out of the preview overlay.
if (Platform.OS === 'web') LogBox.ignoreLogs(['cannot contain a nested']);
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { StatusBar as RNStatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { AuthProvider } from '../context/AuthContext';
import { CartProvider } from '../context/CartContext';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { DietaryProvider } from '../context/DietaryContext';
import { WorldTransitionProvider } from '../context/WorldTransitionContext';
import WorldTransitionOverlay from '../components/WorldTransitionOverlay';
import IntroOverlay from '../components/IntroOverlay';
import GlobalAnnouncement from '../components/GlobalAnnouncement';
import TermsUpdateSheet from '../components/TermsUpdateSheet';
import ThemedAlert, { showGlobalAlert } from '../components/ThemedAlert';
import OfflineBanner from '../components/OfflineBanner';
import ServerWakeBanner from '../components/ServerWakeBanner';
import ErrorBoundary from '../components/ErrorBoundary';
import { preloadSounds, loadSoundSetting } from '../utils/sounds';
import { scheduleApiEndpointCheck } from '../constants/api';
import UpdateGate from '../utils/UpdateGate';

// Global interceptor to theme all native Alert.alert calls across the codebase automatically
const originalAlert = Alert.alert;
Alert.alert = (title, message, buttons, options) => {
  if (showGlobalAlert) {
    showGlobalAlert(title, message, buttons, options);
  } else {
    originalAlert(title, message, buttons, options);
  }
};

function AppContainer() {
  const { isDark, isThemeReady } = useTheme();
  // The Zenvy intro plays on every app start (cold launch). It is dark on its own, so it shows from the
  // first frame without waiting for the saved theme to load.
  const [showIntro, setShowIntro] = React.useState(true);

  // Preload Ionicons so tab bar icons render on Expo Web
  const [fontsLoaded, fontError] = useFonts({
    ...Ionicons.font,
  });

  // Own-domain move: learn / verify / self-heal the API address for the NEXT launch (constants/api.ts).
  React.useEffect(() => { scheduleApiEndpointCheck(); }, []);

  // Fix status bar blinking: use imperative API to set once, not on every render
  React.useEffect(() => {
    if (Platform.OS === 'android') {
      RNStatusBar.setBarStyle(isDark ? 'light-content' : 'dark-content', false);
      RNStatusBar.setBackgroundColor('transparent', false);
      RNStatusBar.setTranslucent(true);
    } else {
      RNStatusBar.setBarStyle(isDark ? 'light-content' : 'dark-content', false);
    }
  }, [isDark]);

  // Hide scrollbars on web only (safe: runs at runtime, not module load)
  React.useEffect(() => {
    if (Platform.OS === 'web') {
      try {
        const style = document.createElement('style');
        style.textContent = `
          ::-webkit-scrollbar { display: none !important; width: 0px !important; background: transparent !important; }
          body, html, #root, div { -ms-overflow-style: none !important; scrollbar-width: none !important; }
        `;
        document.head.append(style);
      } catch (e) {
        // document not available on native — silently ignore
      }
    }
  }, []);

  // App sounds are off unless the user turned them on in Profile. When on, the bundled players are
  // created once, after the intro, off the first-frame path.
  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    loadSoundSetting()
      .then((on) => { if (on) t = setTimeout(() => { try { preloadSounds(); } catch {} }, 1800); })
      .catch(() => {});
    return () => { if (t) clearTimeout(t); };
  }, []);

  const handleIntroComplete = React.useCallback(() => {
    setShowIntro(false);
  }, []);

  // Intro on top of everything; after it, a dark cover only if the saved theme is somehow still loading.
  const introLayer = showIntro ? (
    <IntroOverlay ready={(fontsLoaded || !!fontError) && isThemeReady} onComplete={handleIntroComplete} />
  ) : !isThemeReady ? (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0A0A0B', zIndex: 999999 }]} />
  ) : null;

  // Wait for icon fonts to load (critical for Expo Web)
  // If the font fails to load, render anyway (icons fall back) instead of spinning forever
  // (The intro layer sits beside the app in one stable spot, so it never restarts when the fonts finish.)
  if (!fontsLoaded && !fontError) {
    return (
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? '#0A0A0B' : '#F5F5F7' }}>
          <ActivityIndicator size="large" color="#F59E0B" />
        </View>
        {introLayer}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: isDark ? '#0A0A0B' : '#F5F5F7' }}>
        {/* Real keyboard insets for every screen (Android edge-to-edge ignores adjustResize). */}
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
        <WorldTransitionProvider>
          {/* Force update: a retired version sees only the Update screen; a newer release shows a banner. */}
          <UpdateGate>
          <AuthProvider>
          <CartProvider>
            <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
            <WorldTransitionOverlay />
            <GlobalAnnouncement />
            {/* C4: one-time, non-blocking "We've updated our Terms" sheet */}
            <TermsUpdateSheet />
            <ThemedAlert />
            <OfflineBanner />
            {/* Backend cold start: calm "waking up" banner while apiFetch retries (utils/serverWake.ts) */}
            <ServerWakeBanner />
          </CartProvider>
        </AuthProvider>
          </UpdateGate>
        </WorldTransitionProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
    {introLayer}
    </View>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <DietaryProvider>
          <AppContainer />
        </DietaryProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
