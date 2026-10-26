/** Tech & repairs v2 · service details: /services/<repairs|tailoring|laundry>/<catalogue item id> (modules/servicesV2). */
import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import ServicesV2Detail from '../../../modules/servicesV2/ServicesV2Detail';
import { isServiceShelf } from '../../../modules/servicesV2/servicesV2Data';

export default function ServiceDetailRoute() {
  const p = useLocalSearchParams<{ shelf?: string | string[]; id?: string | string[] }>();
  const shelf = String(Array.isArray(p.shelf) ? p.shelf[0] : p.shelf || '').toLowerCase();
  const id = String(Array.isArray(p.id) ? p.id[0] : p.id || '');
  if (!isServiceShelf(shelf)) return <Redirect href={'/(tabs)/others?tab=services' as any} />;
  return <ServicesV2Detail key={`${shelf}-${id}`} shelf={shelf} id={id} />;
}
