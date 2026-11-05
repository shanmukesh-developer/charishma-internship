/**
 * Mounts Rentals v2: the data provider, the router-backed navigator for the screen's URL, the screen and the
 * sheets. `RentalsV2Screen` is a full-screen app/rentals/* route; `RentalsV2Home` is Others → Rentals (full
 * screen like Food v2: its own night header, with the Others section pills driven by `sections` / `onSection`).
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import StatusBarScrim from '../../components/StatusBarScrim';
import { useLocalSearchParams } from 'expo-router';
import { DAY, NIGHT } from './rentalsV2Theme';
import { RentalsV2Provider } from './rentalsV2Data';
import { RentalsV2Nav, useNav, useRouteFromParams, type ScreenName } from './rentalsV2Nav';
import { RentalsV2HomeBody } from './RentalsV2Home';
import RentalsV2Explore from './RentalsV2Explore';
import RentalsV2List from './RentalsV2List';
import RentalsV2Vehicle from './RentalsV2Vehicle';
import RentalsV2Place from './RentalsV2Place';
import RentalsV2Mine from './RentalsV2Mine';
import RentalsV2Sheets from './RentalsV2Sheets';

const VIEWS: Record<Exclude<ScreenName, 'home'>, React.ComponentType> = {
  explore: RentalsV2Explore, list: RentalsV2List, vehicle: RentalsV2Vehicle, room: RentalsV2Place, flat: RentalsV2Place, mine: RentalsV2Mine,
};

/** Development only: `?devSheet=sent` opens the success sheet with a sample payload (screenshots, QA). */
function DevSheet() {
  const p = useLocalSearchParams<{ devSheet?: string }>();
  const nav = useNav();
  useEffect(() => {
    if (__DEV__ && p.devSheet === 'sent') nav.openSheet({ kind: 'sent', title: 'Request sent', body: 'The owner has a few hours to accept. You will get a notification, and the pickup PIN appears in My rentals.', mine: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.devSheet]);
  return null;
}

function Routed({ name }: { name: Exclude<ScreenName, 'home'> }) {
  const route = useRouteFromParams(name);
  const View_ = VIEWS[name];
  return (
    <RentalsV2Nav route={route}>
      <View style={{ flex: 1, backgroundColor: DAY.page }}>
        <View_ />
        <RentalsV2Sheets />
        <DevSheet />
      </View>
    </RentalsV2Nav>
  );
}

/** A full-screen Rentals v2 route (app/rentals/*). */
export function RentalsV2Screen({ name }: { name: Exclude<ScreenName, 'home'> }) {
  return <RentalsV2Provider><Routed name={name} /></RentalsV2Provider>;
}

/** Others → Rentals. */
function RentalsV2Home({ sections, onSection }: { sections?: { key: string; label: string }[]; onSection?: (key: string) => void }) {
  // The hero scrolls away under the edge-to-edge status bar: the scrim fades in behind the clock once it does.
  const scrollY = useRef(new Animated.Value(0)).current;
  return (
    <RentalsV2Provider>
      <RentalsV2Nav route={{ name: 'home' }} onSection={onSection}>
        <View style={{ flex: 1, backgroundColor: NIGHT.page }}>
          <RentalsV2HomeBody sections={sections} scrollY={scrollY} />
          <RentalsV2Sheets />
          <StatusBarScrim color={NIGHT.pageTop} scrollY={scrollY} />
        </View>
      </RentalsV2Nav>
    </RentalsV2Provider>
  );
}
export default React.memo(RentalsV2Home);
