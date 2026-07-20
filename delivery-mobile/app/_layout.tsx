import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#08080A' }}>
        <StatusBar barStyle="light-content" backgroundColor="#08080A" />
        <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
