/** Campus Events v2 · event detail (modules/eventsV2). Samples (id sample-*) never call the server. */
import React from 'react';
import EventsV2Route from '../../modules/eventsV2/EventsV2Route';
import EventsV2Detail from '../../modules/eventsV2/EventsV2Detail';

export default function CampusEventDetailRoute() {
  return <EventsV2Route><EventsV2Detail /></EventsV2Route>;
}
