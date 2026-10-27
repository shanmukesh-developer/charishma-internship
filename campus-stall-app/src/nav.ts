// ZCS Campus Stall routes (react-navigation native stack). The four bottom tabs (Bookings, Menu, Earnings,
// Settings) live inside 'Main' (src/screens/MainScreen.tsx); a booking opens on top of them.
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type MainTab = 'bookings' | 'menu' | 'earnings' | 'settings';

export type RootStack = {
  Main: { tab?: MainTab } | undefined;
  CampusOrder: { bookingId: string };
};

export type ScreenProps<K extends keyof RootStack> = NativeStackScreenProps<RootStack, K>;
