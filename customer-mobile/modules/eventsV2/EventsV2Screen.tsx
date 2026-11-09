/**
 * Mounts Campus Events v2: the data provider, the navigator, the screen and the sheets. `EventsV2Home` is
 * Others → Campus events (full screen like Food v2 / Rentals v2: its own header with the Others section
 * pills driven by `sections` / `onSection`).
 */
import React, { useRef } from 'react';
import { Animated, View } from 'react-native';
import StatusBarScrim from '../../components/StatusBarScrim';
import { NIGHT } from './eventsV2Theme';
import { EventsV2Provider } from './eventsV2Data';
import { EventsV2Nav } from './eventsV2Nav';
import { EventsV2HomeBody } from './EventsV2Home';
import EventsV2Sheets from './EventsV2Sheets';

/** Others → Campus events. */
function EventsV2Home({ sections, onSection }: { sections?: { key: string; label: string }[]; onSection?: (key: string) => void }) {
  // The hero scrolls away under the edge-to-edge status bar: the scrim fades in behind the clock once it does.
  const scrollY = useRef(new Animated.Value(0)).current;
  return (
    <EventsV2Provider>
      <EventsV2Nav isHome onSection={onSection}>
        <View style={{ flex: 1, backgroundColor: NIGHT.page }}>
          <EventsV2HomeBody sections={sections} scrollY={scrollY} />
          <EventsV2Sheets />
          <StatusBarScrim color={NIGHT.pageTop} scrollY={scrollY} />
        </View>
      </EventsV2Nav>
    </EventsV2Provider>
  );
}
export default React.memo(EventsV2Home);
