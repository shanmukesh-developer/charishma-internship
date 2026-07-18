import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar, Platform, View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from '../context/AuthContext';
import { CartProvider } from '../context/CartContext';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { WorldTransitionProvider } from '../context/WorldTransitionContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import WorldTransitionOverlay from '../components/WorldTransitionOverlay';
import IntroOverlay from '../components/IntroOverlay';
import GlobalAnnouncement from '../components/GlobalAnnouncement';

function AppContainer() {
  const { isDark } = useTheme();
  const [showIntro, setShowIntro] = React.useState(true);
  const [checkingIntro, setCheckingIntro] = React.useState(true);

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

  React.useEffect(() => {
    // Always show intro on startup
    setCheckingIntro(false);
  }, []);

  const handleIntroComplete = async () => {
    setShowIntro(false);
  };

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: isDark ? '#0A0A0B' : '#F5F5F7' }}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={isDark ? "#0A0A0B" : "#F5F5F7"} />
        <WorldTransitionProvider>
          <AuthProvider>
          <CartProvider>
            <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
            <WorldTransitionOverlay />
            <GlobalAnnouncement />
            
            {checkingIntro ? (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: '#060608', zIndex: 999999 }]} />
            ) : showIntro ? (
              <IntroOverlay onComplete={handleIntroComplete} />
            ) : null}
            
          </CartProvider>
        </AuthProvider>
        </WorldTransitionProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AppContainer />
    </ThemeProvider>
  );
}
