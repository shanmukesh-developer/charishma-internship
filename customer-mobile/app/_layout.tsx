import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider } from '../context/AuthContext';
import { CartProvider } from '../context/CartContext';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { WorldTransitionProvider } from '../context/WorldTransitionContext';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import WorldTransitionOverlay from '../components/WorldTransitionOverlay';
import IntroOverlay from '../components/IntroOverlay';
import GlobalAnnouncement from '../components/GlobalAnnouncement';

if (Platform.OS === 'web') {
  const style = document.createElement('style');
  style.textContent = `
    ::-webkit-scrollbar {
      display: none !important;
      width: 0px !important;
      background: transparent !important;
    }
    body, html, #root, div {
      -ms-overflow-style: none !important;
      scrollbar-width: none !important;
    }
  `;
  document.head.append(style);
}

function AppContainer() {
  const { isDark } = useTheme();
  const [showIntro, setShowIntro] = React.useState(true);
  const [checkingIntro, setCheckingIntro] = React.useState(true);

  React.useEffect(() => {
    const checkIntroSeen = async () => {
      try {
        const seen = await AsyncStorage.getItem('zenvy_intro_seen');
        if (seen === 'true') {
          setShowIntro(false);
        }
      } catch (e) {
        console.log('Error reading intro seen:', e);
      } finally {
        setCheckingIntro(false);
      }
    };
    checkIntroSeen();
  }, []);

  const handleIntroComplete = async () => {
    setShowIntro(false);
    try {
      await AsyncStorage.setItem('zenvy_intro_seen', 'true');
    } catch (e) {
      console.log('Error saving intro seen:', e);
    }
  };

  if (checkingIntro) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: isDark ? '#0A0A0B' : '#F5F5F7' }}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={isDark ? "#0A0A0B" : "#F5F5F7"} />
      <WorldTransitionProvider>
        <AuthProvider>
          <CartProvider>
            <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
            <WorldTransitionOverlay />
            <GlobalAnnouncement />
            {showIntro && <IntroOverlay onComplete={handleIntroComplete} />}
          </CartProvider>
        </AuthProvider>
      </WorldTransitionProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AppContainer />
    </ThemeProvider>
  );
}

