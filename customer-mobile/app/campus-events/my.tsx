/** Campus Events v2 · my registrations (modules/eventsV2). ?tab=upcoming|pending|waitlisted|completed|cancelled */
import React from 'react';
import EventsV2Route from '../../modules/eventsV2/EventsV2Route';
import EventsV2Mine from '../../modules/eventsV2/EventsV2Mine';

export default function CampusEventsMyRoute() {
  return <EventsV2Route><EventsV2Mine /></EventsV2Route>;
}
