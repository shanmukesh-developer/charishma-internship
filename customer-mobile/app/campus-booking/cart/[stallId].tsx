/** In-Campus Booking: the cart of one stall and Proceed to pay (modules/campusBooking). */
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import Screen from '../../../modules/campusBooking/CbCartScreen';

export default function CampusBookingCartRoute() {
  const params = useLocalSearchParams<{ stallId?: string | string[] }>();
  const value = Array.isArray(params.stallId) ? params.stallId[0] : params.stallId;
  return <Screen stallId={String(value || '')} />;
}
