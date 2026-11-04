// Services tab (owner, 28 Oct 2026: replaces the Basket tab): PG stays, Co-Ride, Rentals, Campus events and
// Tech & repairs, on the same screen and look as Groceries (app/(tabs)/others.tsx HubScreen).
import React from 'react';
import { HubScreen } from './others';

export default function ServicesScreen() {
  return <HubScreen hub="services" />;
}
