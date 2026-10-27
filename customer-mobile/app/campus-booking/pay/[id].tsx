/** In-Campus Booking: Pay the stall by UPI and send the payment proof (modules/campusBooking). */
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import Screen from '../../../modules/campusBooking/CbPay';

export default function CampusBookingCbPayRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const value = Array.isArray(params.id) ? params.id[0] : params.id;
  return <Screen id={String(value || '')} />;
}
