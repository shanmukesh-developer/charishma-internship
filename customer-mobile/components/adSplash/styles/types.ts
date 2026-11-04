import type React from 'react';

/** One ad style. `transparent`: the ad background is clear, so Home shows through what is torn / peeled. */
export type StyleDef = {
  Comp: React.ComponentType;
  hint: string; // bottom hint (the design's .hint), "or just tap" is added below it
  ghost: Array<[number, number]>; // ghost finger path, design units
  transparent?: boolean;
};
