/**
 * Campus Events v2: no sample events (owner, 3 Nov 2026: "remove mock data from everywhere in the entire project";
 * the 25 Oct sample layer is gone). Only real events from the server show; with none, or with Events switched off
 * on the server, the screens show their own empty state and "Events open soon". The exports stay so the screens'
 * imports are unchanged; an old "sample-..." link opens as not found.
 */
import type { ImageSourcePropType } from 'react-native';
import type { EventDetail } from '../campusEvents/campusEventsApi';

export const EVENTS_V2_DEMO_CONTENT = false;

export interface AgendaItem { time: string; label: string }
/** A real event (the server's EventDetail) with the app's optional art and agenda. */
export type EvEvent = EventDetail & { isDemoContent?: boolean; art?: ImageSourcePropType; agenda?: AgendaItem[] };

export function demoEvents(): EvEvent[] {
  return [];
}
export const demoEvent = (_id: string): EvEvent | null => null;
export const isSampleId = (id?: string | null) => !!id && id.startsWith('sample-');

export function demoClubs(): { id: string; name: string; eventCount: number; isDemoContent: true }[] {
  return [];
}
