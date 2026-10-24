// Stack routes (react-navigation native stack). The five bottom tabs (Home, Rooms, Mess, Payments, More) live
// inside 'Tabs' (src/screens/Tabs.tsx); everything else is pushed on top of them.
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type TabKey = 'home' | 'rooms' | 'mess' | 'payments' | 'more';

export type RootStack = {
  Login: undefined;
  Tabs: { tab?: TabKey } | undefined;
  Requests: { status?: 'Pending' | 'Confirmed' | 'closed' } | undefined;
  Tenants: undefined;
  Complaints: undefined;
  Building: undefined;
  Notifications: undefined;
  Settings: undefined;
  ChangePassword: undefined;
  DeleteAccount: undefined;
};

export type ScreenProps<K extends keyof RootStack> = NativeStackScreenProps<RootStack, K>;
