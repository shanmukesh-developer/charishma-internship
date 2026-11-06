import type { NavIcon as NavIconName } from '@/lib/nav';
import {
  IconAuto, IconBasket, IconBike, IconBuilding, IconCalendar, IconCar, IconChart, IconGift, IconHeart, IconHistory,
  IconHome, IconImage, IconLayout, IconList, IconLock, IconMessage, IconPackage, IconPin, IconSchool, IconSettings,
  IconShield, IconSpark, IconStar, IconStore, IconTag, IconTicket, IconTrophy, IconUsers, IconWallet, IconWrench,
  IconBell, IconRupee, type IconProps,
} from '@/components/ui/icons';

const MAP: Record<NavIconName, (p: IconProps) => React.ReactElement> = {
  home: IconHome,
  orders: IconPackage,
  basket: IconBasket,
  store: IconStore,
  catalogue: IconList,
  rider: IconBike,
  pg: IconBuilding,
  events: IconCalendar,
  auto: IconAuto,
  bike: IconBike,
  car: IconCar,
  services: IconWrench,
  users: IconUsers,
  school: IconSchool,
  wallet: IconWallet,
  ticket: IconTicket,
  tag: IconTag,
  gift: IconGift,
  bell: IconBell,
  layout: IconLayout,
  pulse: IconSpark,
  pin: IconPin,
  trophy: IconTrophy,
  message: IconMessage,
  image: IconImage,
  shield: IconShield,
  heart: IconHeart,
  chart: IconChart,
  star: IconStar,
  settings: IconSettings,
  lock: IconLock,
  history: IconHistory,
  revenue: IconRupee,
};

export function NavIcon({ name, ...rest }: { name: NavIconName } & IconProps) {
  const Icon = MAP[name] || IconList;
  return <Icon {...rest} />;
}
