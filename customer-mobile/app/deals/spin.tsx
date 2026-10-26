/** Deals & spin v2 · the spin page (modules/dealsV2). /rewards?spin=1 lands here. */
import React from 'react';
import DealsV2Route from '../../modules/dealsV2/DealsV2Route';
import DealsV2Spin from '../../modules/dealsV2/DealsV2Spin';

export default function DealsSpinRoute() {
  return <DealsV2Route night><DealsV2Spin /></DealsV2Route>;
}
