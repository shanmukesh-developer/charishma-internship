/**
 * In-Campus Booking home now lives in the Local tab's In-Campus folder (redesign, 10 Nov 2026). Owner, 9 Nov 2026:
 * "while I'm tapping In-Campus button why it's taking to old UI/UX?" - every way in (Home card, promo carousel,
 * basket "add more", back buttons inside bookings) still pointed here, so this route forwards to the new screen.
 * The old screen (modules/campusBooking/CbHome) is kept in the code, unused.
 */
import React from 'react';
import { Redirect } from 'expo-router';

export default function CampusBookingHomeRoute() {
  return <Redirect href={'/(tabs)/local' as any} />;
}
