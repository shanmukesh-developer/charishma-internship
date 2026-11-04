// The Local tab's icon. Owner reference (3 Nov 2026): a small shop (striped awning with a scalloped edge, a door) with
// a map pin standing on the awning, in place of the plain location pin. Original vector on a 24 grid in the tab bar's
// Ionicons line style: outline when the tab is not selected, pin and awning solid when it is.
import React from 'react';
import { type ColorValue, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// Awning: top edge y 9.6 (x 4.6 -> 19.4), sides out to x 2.8 / 21.2 at y 12, four scallops along the bottom edge.
// The top edge stops either side of the pin's tip, so the pin stands in the awning instead of crossing a line.
const AWNING_SIDES = 'M11.1 9.6 H4.6 L2.8 12 A2.9 2.9 0 0 0 7.4 12 A2.9 2.9 0 0 0 12 12 A2.9 2.9 0 0 0 16.6 12 A2.9 2.9 0 0 0 21.2 12 L19.4 9.6 H12.9';
const AWNING_SOLID = 'M4.6 9.6 H19.4 L21.2 12 A2.9 2.9 0 0 1 16.6 12 A2.9 2.9 0 0 1 12 12 A2.9 2.9 0 0 1 7.4 12 A2.9 2.9 0 0 1 2.8 12 Z';
// Stripes from the top edge to each scallop joint, slanting with the sides.
const STRIPES = 'M8.3 9.6 L7.4 12 M15.7 9.6 L16.6 12';
// Shop front below the scallops, rounded at the base, and its door.
const BODY = 'M4.6 13.4 V19.4 Q4.6 20.5 5.7 20.5 H18.3 Q19.4 20.5 19.4 19.4 V13.4';
const DOOR = 'M10 20.5 V16.7 Q10 16.1 10.6 16.1 H13.4 Q14 16.1 14 16.7 V20.5';
// Map pin: head centred at (12, 5.4), radius 3.3, tip at (12, 10.6); the hole is cut with evenodd when solid.
const PIN = 'M12 10.6 C10.6 9.2 8.7 7.3 8.7 5.4 A3.3 3.3 0 0 1 15.3 5.4 C15.3 7.3 13.4 9.2 12 10.6 Z';
const PIN_HOLE = 'M12 4.15 A1.25 1.25 0 1 0 12 6.65 A1.25 1.25 0 1 0 12 4.15 Z';

export default function LocalStoreIcon({ size = 22, color, filled = false, style }: { size?: number; color: ColorValue; filled?: boolean; style?: StyleProp<ViewStyle> }) {
  const line = { stroke: color, strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      {filled ? <Path d={AWNING_SOLID} fill={color} stroke={color} strokeWidth={1.2} strokeLinejoin="round" /> : (
        <>
          <Path d={AWNING_SIDES} {...line} />
          <Path d={STRIPES} {...line} />
        </>
      )}
      <Path d={BODY} {...line} />
      <Path d={DOOR} {...line} />
      {filled
        ? <Path d={`${PIN} ${PIN_HOLE}`} fill={color} fillRule="evenodd" />
        : <Path d={`${PIN} ${PIN_HOLE}`} {...line} />}
    </Svg>
  );
}
