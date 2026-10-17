// Zenvy Rider: root switch (Splash → Login → Pending approval → Shell).
// State: src/state/RiderStore. Screens: src/screens. API/socket/queue: src/services. Voice: src/voice.
import React from 'react';
import { StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { C, useInsets } from './src/theme';
import { Toast } from './src/ui/Toast';
import { RiderProvider, useRider } from './src/state/RiderStore';
import { LoginScreen, PendingScreen, SplashScreen } from './src/screens/Auth';
import { Shell } from './src/screens/Shell';
import { scheduleApiEndpointCheck } from './src/config';

function Root() {
  const { phase, toast, deliveryId, overlay } = useRider();
  const insets = useInsets();
  let screen: React.ReactNode;
  if (phase === 'splash' || phase === 'splash-error') screen = <SplashScreen />;
  else if (phase === 'login') screen = <LoginScreen />;
  else if (phase === 'pending') screen = <PendingScreen />;
  else screen = <Shell />;
  const tabBarVisible = phase === 'main' && !deliveryId && !overlay;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: phase === 'main' ? insets.top : 0 }}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} translucent />
      {screen}
      <Toast toast={toast} bottom={(tabBarVisible ? 84 : 104) + insets.bottom} />
    </View>
  );
}

export default function App() {
  // Own-domain move: learn / verify / self-heal the API address for the NEXT launch (src/config.ts).
  React.useEffect(() => { scheduleApiEndpointCheck(); }, []);
  return (
    <SafeAreaProvider>
      <RiderProvider>
        <Root />
      </RiderProvider>
    </SafeAreaProvider>
  );
}
