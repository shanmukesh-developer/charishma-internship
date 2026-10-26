// Stack routes (react-navigation native stack).
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStack = {
  Login: undefined;
  Register: undefined;
  Home: undefined;
  Verification: undefined;
  Documents: undefined;
  Vehicles: undefined;
  VehicleForm: { vehicleId?: string } | undefined;
  Publish: { draftId?: string } | undefined;
  PutOnCharge: undefined;
  Charge: { tripId: string };
  TripDetail: { tripId: string; tab?: 'status' | 'seats' | 'bookings' };
  CheckIn: { tripId: string; code?: string };
  Requests: undefined;
  Notifications: undefined;
  History: undefined;
  Earnings: undefined;
  Queue: undefined;
  Profile: undefined;
  Support: undefined;
  Settings: undefined;
  DeleteAccount: undefined;
};

export type ScreenProps<K extends keyof RootStack> = NativeStackScreenProps<RootStack, K>;
