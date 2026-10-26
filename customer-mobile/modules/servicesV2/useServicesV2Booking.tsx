/**
 * Opens the existing booking flow (modules/services/ServiceBookingSheet: per-service questions, real server
 * prices, POST /api/services/book) from a Tech & repairs v2 screen. Nothing about the booking is re-implemented
 * here: this only keeps which item / start step is open and renders the sheet.
 * Browsing and filling the steps needs no account; the sheet asks to sign in when the booking is sent.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import ServiceBookingSheet, { type BookableItem, type FlowStart } from '../services/ServiceBookingSheet';
import { PRINT_RATE_RES, type Answers, type PrintRates } from '../services/serviceForms';
import { SHELF_META, type ServiceShelf, type ShelfItem } from './servicesV2Data';

const toBookable = (i: ShelfItem): BookableItem => ({ id: i.id, name: i.name, price: i.price, desc: i.desc, image: i.image, inStock: i.inStock, storeName: i.storeName });

export function useServicesV2Booking(shelf: ServiceShelf, items: ShelfItem[], onUnavailable: () => void) {
  const [flow, setFlow] = useState<{ item: BookableItem | null; start?: FlowStart; prefill?: Answers } | null>(null);
  const catalogue = useMemo(() => items.map(toBookable), [items]);
  const rates: PrintRates = useMemo(() => {
    const find = (re: RegExp) => items.find((i) => re.test(i.name))?.price ?? null;
    return { bw: find(PRINT_RATE_RES[0]), color: find(PRINT_RATE_RES[1]), spiral: find(PRINT_RATE_RES[2]), hardbound: find(PRINT_RATE_RES[3]) };
  }, [items]);

  const book = useCallback((item: ShelfItem, prefill?: Answers) => {
    if (!item.inStock) {
      Alert.alert('Not taking bookings right now', `${item.name} is paused. Pick another service or check back later.`);
      return;
    }
    setFlow({ item: toBookable(item), prefill });
  }, []);
  /** Repairs: "Not sure what is wrong?" opens the device -> issue steps of the same flow. */
  const startDevice = useCallback(() => setFlow({ item: null, start: { kind: 'device' } }), []);

  const sheet = (
    <ServiceBookingSheet
      visible={!!flow}
      item={flow?.item || null}
      start={flow?.start}
      prefill={flow?.prefill}
      catalogue={catalogue}
      shelfId={shelf}
      shelfTitle={SHELF_META[shelf].title}
      rates={rates}
      onClose={() => setFlow(null)}
      onServiceUnavailable={onUnavailable}
    />
  );
  return { book, startDevice, sheet };
}
