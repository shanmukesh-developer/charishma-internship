/**
 * Line icons for PG v2 (lucide, per-icon imports so the bundle stays small).
 * Stroke 1.75 everywhere, like the reference's thin outline set.
 */
import type { LucideIcon } from 'lucide-react-native';
export { default as IArrowLeft } from 'lucide-react-native/icons/arrow-left';
export { default as IArrowRight } from 'lucide-react-native/icons/arrow-right';
export { default as IShare } from 'lucide-react-native/icons/share-2';
export { default as IHeart } from 'lucide-react-native/icons/heart';
export { default as IMapPin } from 'lucide-react-native/icons/map-pin';
export { default as ISearch } from 'lucide-react-native/icons/search';
export { default as IStar } from 'lucide-react-native/icons/star';
export { default as IChevronDown } from 'lucide-react-native/icons/chevron-down';
export { default as IChevronRight } from 'lucide-react-native/icons/chevron-right';
export { default as INavigation } from 'lucide-react-native/icons/navigation';
export { default as IPhone } from 'lucide-react-native/icons/phone';
export { default as ICalendar } from 'lucide-react-native/icons/calendar-days';
export { default as ICalendarCheck } from 'lucide-react-native/icons/calendar-check';
export { default as IClock } from 'lucide-react-native/icons/clock';
export { default as IBed } from 'lucide-react-native/icons/bed-double';
export { default as IBedSingle } from 'lucide-react-native/icons/bed-single';
export { default as IBath } from 'lucide-react-native/icons/bath';
export { default as IUser } from 'lucide-react-native/icons/user-round';
export { default as IUsers } from 'lucide-react-native/icons/users';
export { default as IHouse } from 'lucide-react-native/icons/house';
export { default as IBuilding } from 'lucide-react-native/icons/building';
export { default as IDoor } from 'lucide-react-native/icons/door-open';
export { default as IClipboard } from 'lucide-react-native/icons/clipboard-list';
export { default as INotebook } from 'lucide-react-native/icons/notebook-pen';
export { default as IShieldCheck } from 'lucide-react-native/icons/shield-check';
export { default as IBadgeCheck } from 'lucide-react-native/icons/badge-check';
export { default as ICheck } from 'lucide-react-native/icons/check';
export { default as IX } from 'lucide-react-native/icons/x';
export { default as ISnow } from 'lucide-react-native/icons/snowflake';
export { default as ILamp } from 'lucide-react-native/icons/lamp-desk';
export { default as ISofa } from 'lucide-react-native/icons/armchair';
export { default as IWifi } from 'lucide-react-native/icons/wifi';
export { default as IUtensils } from 'lucide-react-native/icons/utensils';
export { default as ICoffee } from 'lucide-react-native/icons/coffee';
export { default as ISoup } from 'lucide-react-native/icons/soup';
export { default as ICookie } from 'lucide-react-native/icons/cookie';
export { default as ISalad } from 'lucide-react-native/icons/salad';
export { default as ILeaf } from 'lucide-react-native/icons/leaf';
export { default as ISunrise } from 'lucide-react-native/icons/sunrise';
export { default as ISun } from 'lucide-react-native/icons/sun';
export { default as ISunset } from 'lucide-react-native/icons/sunset';
export { default as IMoon } from 'lucide-react-native/icons/moon';
export { default as IInfo } from 'lucide-react-native/icons/info';
export { default as IAlert } from 'lucide-react-native/icons/circle-alert';
export { default as IInbox } from 'lucide-react-native/icons/inbox';
export { default as IPlus } from 'lucide-react-native/icons/plus';
export { default as IMinus } from 'lucide-react-native/icons/minus';
export { default as ILayers } from 'lucide-react-native/icons/layers';
export { default as IDoorClosed } from 'lucide-react-native/icons/door-closed';
export { default as IRefresh } from 'lucide-react-native/icons/refresh-cw';
export { default as ICalendarClock } from 'lucide-react-native/icons/calendar-clock';
import ISunriseRaw from 'lucide-react-native/icons/sunrise';
import ISunRaw from 'lucide-react-native/icons/sun';
import ICookieRaw from 'lucide-react-native/icons/cookie';
import IMoonRaw from 'lucide-react-native/icons/moon';
import IUtensilsRaw from 'lucide-react-native/icons/utensils';

export const STROKE = 1.75;

/** Meal key/label -> icon (breakfast, lunch, snacks, dinner; others get cutlery). */
export const mealIcon = (keyOrLabel: string): LucideIcon => {
  const v = keyOrLabel.toLowerCase();
  if (v.includes('break')) return ISunriseRaw;
  if (v.includes('lunch')) return ISunRaw;
  if (v.includes('snack') || v.includes('tea')) return ICookieRaw;
  if (v.includes('dinner') || v.includes('supper')) return IMoonRaw;
  return IUtensilsRaw;
};
