/** In-Campus Booking: Track the booking and show the pickup code once ready (modules/campusBooking). */
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import Screen from '../../../modules/campusBooking/CbOrder';

export default function CampusBookingCbOrderRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const value = Array.isArray(params.id) ? params.id[0] : params.id;
  return <Screen id={String(value || '')} />;
}
