/**
 * Mounts one PG v2 screen for an app/pg/* route (or the Others → PG stays tab): the shared data
 * provider plus a router-backed navigator built from the URL.
 */
import React from 'react';
import { View } from 'react-native';
import { PgV2DataProvider, usePgV2 } from './pgV2Data';
import { RouterNav, useRouteFromParams, type ScreenName } from './pgV2Nav';
import { PG2 } from './pgV2Theme';
import { PgV2HomeBody } from './PgV2Home';
import PgV2List from './PgV2List';
import PgV2Building from './PgV2Building';
import PgV2Map from './PgV2Map';
import PgV2Facilities from './PgV2Facilities';
import PgV2Rooms from './PgV2Rooms';
import PgV2Overview from './PgV2Overview';
import PgV2RoomDetail from './PgV2RoomDetail';
import PgV2Mess from './PgV2Mess';
import PgV2Booking from './PgV2Booking';
import PgV2MyBookings from './PgV2MyBookings';

const VIEWS: Record<Exclude<ScreenName, 'home'>, React.ComponentType> = {
  list: PgV2List, building: PgV2Building, map: PgV2Map, facilities: PgV2Facilities, rooms: PgV2Rooms,
  overview: PgV2Overview, room: PgV2RoomDetail, mess: PgV2Mess, booking: PgV2Booking, bookings: PgV2MyBookings,
};

function Mounted({ name, children }: { name: ScreenName; children: React.ReactNode }) {
  const route = useRouteFromParams(name);
  const { list } = usePgV2();
  const defaultPgId = list.find((p) => p.hasRooms)?.id || list[0]?.id || null;
  return <RouterNav route={route} defaultPgId={defaultPgId}>{children}</RouterNav>;
}

/** A full-screen PG v2 route. */
export function PgV2Screen({ name }: { name: Exclude<ScreenName, 'home'> }) {
  const View_ = VIEWS[name];
  return (
    <PgV2DataProvider>
      <Mounted name={name}>
        <View style={{ flex: 1, backgroundColor: PG2.page }}><View_ /></View>
      </Mounted>
    </PgV2DataProvider>
  );
}

/** The PG v2 home content for the Others shell (the shell provides the header and the scroll view). */
export function PgV2OthersSection() {
  return (
    <PgV2DataProvider>
      <Mounted name="home"><PgV2HomeBody /></Mounted>
    </PgV2DataProvider>
  );
}
