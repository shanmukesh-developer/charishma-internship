/**
 * PG v2 · building details (modules/pgV2): /pg/:id, also the zenvy://pg/:id deep link.
 * Hero photo, name and badge, rent range, amenities, building figures, links to location,
 * facilities & mess and the overview, and "View Rooms". Booking uses the real request endpoint.
 */
import React from 'react';
import { PgV2Screen } from '../../modules/pgV2/PgV2Route';

export default function PgV2BuildingRoute() {
  return <PgV2Screen name="building" />;
}
