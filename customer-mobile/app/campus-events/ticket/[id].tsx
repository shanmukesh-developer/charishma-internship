/** Campus Events v2 · QR ticket (modules/eventsV2; the QR itself is modules/campusEvents/TicketQR). */
import React from 'react';
import EventsV2Route from '../../../modules/eventsV2/EventsV2Route';
import EventsV2Ticket from '../../../modules/eventsV2/EventsV2Ticket';

export default function CampusEventTicketRoute() {
  return <EventsV2Route><EventsV2Ticket /></EventsV2Route>;
}
