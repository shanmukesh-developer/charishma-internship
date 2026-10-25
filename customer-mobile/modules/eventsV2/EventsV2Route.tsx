/**
 * Frame for a full-screen Campus Events v2 route (app/campus-events/*): the navigator, the night page and the sheets.
 */
import React from 'react';
import { View } from 'react-native';
import { NIGHT } from './eventsV2Theme';
import { EventsV2Nav } from './eventsV2Nav';
import EventsV2Sheets from './EventsV2Sheets';

export default function EventsV2Route({ children }: { children: React.ReactNode }) {
  return (
    <EventsV2Nav>
      <View style={{ flex: 1, backgroundColor: NIGHT.page }}>
        {children}
        <EventsV2Sheets />
      </View>
    </EventsV2Nav>
  );
}
