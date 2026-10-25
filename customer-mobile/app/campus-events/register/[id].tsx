/**
 * Campus Events v2 · registration / ticket flow (modules/eventsV2). Same modes as before:
 * ?regId= confirm a held slot, ?teamId= submit a team, ?waitlist=1 join the waitlist, ?slotId= waitlist a slot.
 */
import React from 'react';
import EventsV2Route from '../../../modules/eventsV2/EventsV2Route';
import EventsV2Register from '../../../modules/eventsV2/EventsV2Register';

export default function CampusEventRegisterRoute() {
  return <EventsV2Route><EventsV2Register /></EventsV2Route>;
}
