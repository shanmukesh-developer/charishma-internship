/** Campus Events v2 · all events / category listing with filters (modules/eventsV2). */
import React from 'react';
import EventsV2Route from '../../modules/eventsV2/EventsV2Route';
import EventsV2Explore from '../../modules/eventsV2/EventsV2Explore';

export default function CampusEventsListRoute() {
  return <EventsV2Route><EventsV2Explore /></EventsV2Route>;
}
