/**
 * Mounts Deals & spin v2: the navigator, the home and the sheets. `DealsV2Home` is Others → Deals & spin (full screen
 * like Food v2 / Rentals v2 / Events v2: its own indigo header with the Others section pills).
 */
import React from 'react';
import { View } from 'react-native';
import { DV } from './dealsV2Theme';
import { DealsV2Nav } from './dealsV2Nav';
import { DealsV2HomeBody } from './DealsV2Home';
import DealsV2Sheets from './DealsV2Sheets';

function DealsV2Home({ sections, onSection }: { sections?: { key: string; label: string }[]; onSection?: (key: string) => void }) {
  return (
    <DealsV2Nav isHome onSection={onSection}>
      <View style={{ flex: 1, backgroundColor: DV.page }}>
        <DealsV2HomeBody sections={sections} />
        <DealsV2Sheets />
      </View>
    </DealsV2Nav>
  );
}
export default React.memo(DealsV2Home);
