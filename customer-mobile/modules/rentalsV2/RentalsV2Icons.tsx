/**
 * Thin line icons for Rentals v2 (lucide, per-icon imports so the bundle stays small). One stroke (1.6)
 * everywhere, like the boards' thin outline set. `FeatureGlyph` draws a spec / amenity icon by key.
 */
import React from 'react';
import IBike from 'lucide-react-native/icons/bike';
import ICar from 'lucide-react-native/icons/car-front';
import IBed from 'lucide-react-native/icons/bed-double';
import IBuilding from 'lucide-react-native/icons/building';
import IWifi from 'lucide-react-native/icons/wifi';
import IBath from 'lucide-react-native/icons/bath';
import IDesk from 'lucide-react-native/icons/lamp-desk';
import ISofa from 'lucide-react-native/icons/sofa';
import IKitchen from 'lucide-react-native/icons/cooking-pot';
import IParking from 'lucide-react-native/icons/square-parking';
import IPower from 'lucide-react-native/icons/plug-zap';
import IWater from 'lucide-react-native/icons/droplets';
import IHouse from 'lucide-react-native/icons/house';
import IFuel from 'lucide-react-native/icons/fuel';
import IGauge from 'lucide-react-native/icons/gauge';
import IEngine from 'lucide-react-native/icons/cog';
import IHelmet from 'lucide-react-native/icons/hard-hat';
import IDoc from 'lucide-react-native/icons/file-check';
import IWrench from 'lucide-react-native/icons/wrench';
import ISeats from 'lucide-react-native/icons/users';
import ISnow from 'lucide-react-native/icons/snowflake';
import IBluetooth from 'lucide-react-native/icons/bluetooth';
import IShield from 'lucide-react-native/icons/shield-check';
import type { FeatureIcon } from './rentalsV2Demo';

export { default as IHeart } from 'lucide-react-native/icons/heart';
export { default as IBell } from 'lucide-react-native/icons/bell';
export { default as IPin } from 'lucide-react-native/icons/map-pin';
export { default as ISearch } from 'lucide-react-native/icons/search';
export { default as IFilter } from 'lucide-react-native/icons/sliders-horizontal';
export { default as IArrowLeft } from 'lucide-react-native/icons/arrow-left';
export { default as IArrowRight } from 'lucide-react-native/icons/arrow-right';
export { default as IChevronRight } from 'lucide-react-native/icons/chevron-right';
export { default as IChevronDown } from 'lucide-react-native/icons/chevron-down';
export { default as IShare } from 'lucide-react-native/icons/share-2';
export { default as IStar } from 'lucide-react-native/icons/star';
export { default as IX } from 'lucide-react-native/icons/x';
export { default as ICheck } from 'lucide-react-native/icons/check';
export { default as IPhone } from 'lucide-react-native/icons/phone';
export { default as IChat } from 'lucide-react-native/icons/message-circle';
export { default as ICalendar } from 'lucide-react-native/icons/calendar-days';
export { default as IClock } from 'lucide-react-native/icons/clock';
export { default as ISparkles } from 'lucide-react-native/icons/sparkles';
export { default as IBadge } from 'lucide-react-native/icons/badge-check';
export { default as IWifiOff } from 'lucide-react-native/icons/wifi-off';
export { default as ICloudOff } from 'lucide-react-native/icons/cloud-off';
export { default as IInfo } from 'lucide-react-native/icons/info';
export { default as IKey } from 'lucide-react-native/icons/key-round';
export { default as IIdCard } from 'lucide-react-native/icons/id-card';
export { default as IFlame } from 'lucide-react-native/icons/flame';
export { default as IReceipt } from 'lucide-react-native/icons/receipt';
export { default as IPlus } from 'lucide-react-native/icons/plus';
export { default as ILock } from 'lucide-react-native/icons/lock';
export { default as IUser } from 'lucide-react-native/icons/user-round';
export { IBike, ICar, IBed, IBuilding, IShield, IHouse };

const MAP: Record<FeatureIcon, React.ComponentType<any>> = {
  engine: IEngine, helmet: IHelmet, doc: IDoc, wrench: IWrench, seats: ISeats, snow: ISnow, bluetooth: IBluetooth, shield: IShield,
  fuel: IFuel, gauge: IGauge, wifi: IWifi, bath: IBath, desk: IDesk, bed: IBed, sofa: ISofa, kitchen: IKitchen, parking: IParking,
  power: IPower, water: IWater, home: IHouse,
};

export function FeatureGlyph({ name, size = 20, color }: { name: FeatureIcon; size?: number; color: string }) {
  const C = MAP[name] || IShield;
  return <C size={size} color={color} strokeWidth={1.6} />;
}

export const CATEGORY_ICON = { bike: IBike, car: ICar, room: IBed, flat: IBuilding } as const;
