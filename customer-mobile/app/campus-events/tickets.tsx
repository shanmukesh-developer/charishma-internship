/** Campus Events v2 · my tickets (modules/eventsV2). */
import React from 'react';
import EventsV2Route from '../../modules/eventsV2/EventsV2Route';
import EventsV2Tickets from '../../modules/eventsV2/EventsV2Tickets';

export default function CampusEventsTicketsRoute() {
  return <EventsV2Route><EventsV2Tickets /></EventsV2Route>;
}
