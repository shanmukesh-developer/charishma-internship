/**
 * Frame for a full-screen Deals & spin v2 route (app/deals/*): the navigator, the page and the sheets.
 */
import React from 'react';
import { View } from 'react-native';
import { DV } from './dealsV2Theme';
import { DealsV2Nav } from './dealsV2Nav';
import DealsV2Sheets from './DealsV2Sheets';

export default function DealsV2Route({ children, night }: { children: React.ReactNode; night?: boolean }) {
  return (
    <DealsV2Nav>
      <View style={{ flex: 1, backgroundColor: night ? DV.night[2] : DV.page }}>
        {children}
        <DealsV2Sheets />
      </View>
    </DealsV2Nav>
  );
}
