/** In-Campus Booking: Stall menu (Menu / About, Add to this stall's own pickup cart) (modules/campusBooking). */
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import Screen from '../../../modules/campusBooking/CbStall';

export default function CampusBookingCbStallRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const value = Array.isArray(params.id) ? params.id[0] : params.id;
  return <Screen id={String(value || '')} />;
}
