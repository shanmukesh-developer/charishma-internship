import type { SVGProps } from 'react';

/**
 * Small stroke icon set (24 px grid, 1.75 stroke) drawn inline so the admin needs no icon package.
 * Icons are decorative by default (aria-hidden); pass aria-label + role="img" when one stands alone.
 */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const make = (paths: React.ReactNode, displayName: string) => {
  const Icon = ({ size = 16, strokeWidth = 1.75, ...rest }: IconProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={rest['aria-label'] ? undefined : true}
      focusable="false"
      {...rest}
    >
      {paths}
    </svg>
  );
  Icon.displayName = displayName;
  return Icon;
};

export const IconHome = make(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></>, 'IconHome');
export const IconPackage = make(<><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="m3 8 9 5 9-5" /><path d="M12 13v8" /><path d="m7.5 5.5 9 5" /></>, 'IconPackage');
export const IconBasket = make(<><path d="M5 10h14l-1.5 9a2 2 0 0 1-2 1.7h-7a2 2 0 0 1-2-1.7L5 10Z" /><path d="m9 10 3-6 3 6" /><path d="M3 10h18" /><path d="M10 14v3M14 14v3" /></>, 'IconBasket');
export const IconStore = make(<><path d="M4 9.5 5.5 4h13L20 9.5" /><path d="M4 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0" /><path d="M5 12v8h14v-8" /><path d="M10 20v-4h4v4" /></>, 'IconStore');
export const IconList = make(<><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></>, 'IconList');
export const IconBike = make(<><circle cx="5.5" cy="17" r="3.5" /><circle cx="18.5" cy="17" r="3.5" /><path d="M15 6h2l1.5 11" /><path d="m5.5 17 4-8h6l-3 8" /></>, 'IconBike');
export const IconCar = make(<><path d="M5 17h14v-4l-2-5H7l-2 5v4Z" /><path d="M5 13h14" /><circle cx="8" cy="17" r="1.5" /><circle cx="16" cy="17" r="1.5" /><path d="M5 17v2M19 17v2" /></>, 'IconCar');
export const IconAuto = make(<><path d="M4 16V9a4 4 0 0 1 4-4h6l4 5h1a1 1 0 0 1 1 1v5" /><path d="M4 16h16" /><path d="M10 5v5h8" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></>, 'IconAuto');
export const IconUsers = make(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18 14a6.5 6.5 0 0 1 3.5 6" /></>, 'IconUsers');
export const IconUser = make(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>, 'IconUser');
export const IconWallet = make(<><path d="M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6" /><path d="M16.5 13.5h.01" /></>, 'IconWallet');
export const IconBuilding = make(<><path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" /><path d="M15 9h4a1 1 0 0 1 1 1v11" /><path d="M3 21h18" /><path d="M8 8h3M8 12h3M8 16h3" /></>, 'IconBuilding');
export const IconCalendar = make(<><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>, 'IconCalendar');
export const IconTicket = make(<><path d="M3 9a3 3 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a3 3 0 0 1 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v3Z" /><path d="M14 5v2M14 11v2M14 17v2" /></>, 'IconTicket');
export const IconWrench = make(<><path d="M14.5 6.5a4 4 0 0 0 5 5L21 13l-8 8-3-3 1.5-1.5" /><path d="M14.5 6.5 9 12l-5.5 5.5a2.1 2.1 0 0 0 3 3L12 15" /><path d="M14.5 6.5a4 4 0 0 1 5-3.5l-2.5 2.5.5 2.5 2.5.5L22.5 6a4 4 0 0 1-3 5.5" /></>, 'IconWrench');
export const IconMegaphone = make(<><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1Z" /><path d="M16 8.5a5 5 0 0 1 0 7" /><path d="M19 6a8.5 8.5 0 0 1 0 12" /></>, 'IconMegaphone');
export const IconTag = make(<><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z" /><circle cx="7.5" cy="7.5" r="1.5" /></>, 'IconTag');
export const IconSettings = make(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>, 'IconSettings');
export const IconShield = make(<><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.3 7.5 9.5 4.3-1.2 7.5-5 7.5-9.5V6L12 3Z" /><path d="m9 12 2 2 4-4" /></>, 'IconShield');
export const IconLock = make(<><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></>, 'IconLock');
export const IconSearch = make(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, 'IconSearch');
export const IconPlus = make(<path d="M12 5v14M5 12h14" />, 'IconPlus');
export const IconMinus = make(<path d="M5 12h14" />, 'IconMinus');
export const IconX = make(<path d="M18 6 6 18M6 6l12 12" />, 'IconX');
export const IconCheck = make(<path d="m5 12.5 4.5 4.5L19 7.5" />, 'IconCheck');
export const IconChevronDown = make(<path d="m6 9 6 6 6-6" />, 'IconChevronDown');
export const IconChevronUp = make(<path d="m6 15 6-6 6 6" />, 'IconChevronUp');
export const IconChevronRight = make(<path d="m9 6 6 6-6 6" />, 'IconChevronRight');
export const IconChevronLeft = make(<path d="m15 6-6 6 6 6" />, 'IconChevronLeft');
export const IconSort = make(<><path d="m8 9 4-4 4 4" /><path d="m8 15 4 4 4-4" /></>, 'IconSort');
export const IconArrowUp = make(<><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></>, 'IconArrowUp');
export const IconArrowDown = make(<><path d="M12 5v14" /><path d="m6 13 6 6 6-6" /></>, 'IconArrowDown');
export const IconArrowLeft = make(<><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></>, 'IconArrowLeft');
export const IconArrowRight = make(<><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>, 'IconArrowRight');
export const IconSun = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>, 'IconSun');
export const IconMoon = make(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />, 'IconMoon');
export const IconMonitor = make(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>, 'IconMonitor');
export const IconLogOut = make(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>, 'IconLogOut');
export const IconBell = make(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>, 'IconBell');
export const IconAlert = make(<><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>, 'IconAlert');
export const IconInfo = make(<><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>, 'IconInfo');
export const IconCheckCircle = make(<><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>, 'IconCheckCircle');
export const IconXCircle = make(<><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></>, 'IconXCircle');
export const IconTrash = make(<><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M5.5 7 6.5 19a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8L18.5 7" /><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" /></>, 'IconTrash');
export const IconEdit = make(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" /></>, 'IconEdit');
export const IconMore = make(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>, 'IconMore');
export const IconExternal = make(<><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>, 'IconExternal');
export const IconFilter = make(<path d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5Z" />, 'IconFilter');
export const IconRefresh = make(<><path d="M20 11a8 8 0 0 0-14.8-4.2L3 9" /><path d="M3 4v5h5" /><path d="M4 13a8 8 0 0 0 14.8 4.2L21 15" /><path d="M21 20v-5h-5" /></>, 'IconRefresh');
export const IconUpload = make(<><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>, 'IconUpload');
export const IconDownload = make(<><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></>, 'IconDownload');
export const IconImage = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5L5 20" /></>, 'IconImage');
export const IconMap = make(<><path d="m9 4-6 2.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Z" /><path d="M9 4v13.5M15 6.5V20" /></>, 'IconMap');
export const IconPin = make(<><path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></>, 'IconPin');
export const IconChart = make(<><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8 16v-5M12 16V8M16 16v-3" /></>, 'IconChart');
export const IconMessage = make(<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12Z" />, 'IconMessage');
export const IconEye = make(<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>, 'IconEye');
export const IconEyeOff = make(<><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.8" /><path d="M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="m3 3 18 18" /></>, 'IconEyeOff');
export const IconCopy = make(<><rect x="8.5" y="8.5" width="12" height="12" rx="2" /><path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5" /></>, 'IconCopy');
export const IconMenu = make(<path d="M4 6h16M4 12h16M4 18h16" />, 'IconMenu');
export const IconClock = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, 'IconClock');
export const IconPhone = make(<path d="M21 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.1 4.2 2 2 0 0 1 3.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />, 'IconPhone');
export const IconMail = make(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6 8.5-6" /></>, 'IconMail');
export const IconStar = make(<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3Z" />, 'IconStar');
export const IconLayers = make(<><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>, 'IconLayers');
export const IconLayout = make(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>, 'IconLayout');
export const IconScan = make(<><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M7 12h10" /></>, 'IconScan');
export const IconHeart = make(<path d="M19.5 13.6 12 21l-7.5-7.4A5 5 0 0 1 12 6.9a5 5 0 0 1 7.5 6.7Z" />, 'IconHeart');
export const IconFile = make(<><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>, 'IconFile');
export const IconFlag = make(<><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>, 'IconFlag');
export const IconTrophy = make(<><path d="M8 21h8M12 17v4" /><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" /><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></>, 'IconTrophy');
export const IconGift = make(<><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v8h14v-8M12 8v12" /><path d="M12 8S10.5 3.5 8 4.5 9 8 12 8Zm0 0s1.5-4.5 4-3.5S15 8 12 8Z" /></>, 'IconGift');
export const IconZap = make(<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />, 'IconZap');
export const IconCommand = make(<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z" />, 'IconCommand');
export const IconDot = make(<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />, 'IconDot');
export const IconGrip = make(<><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>, 'IconGrip');
export const IconSidebar = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>, 'IconSidebar');
export const IconBox = make(<><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></>, 'IconBox');
export const IconRupee = make(<><path d="M6 4h12M6 9h12" /><path d="M9 4c5 0 5 10 0 10H6l8 7" /></>, 'IconRupee');
export const IconSchool = make(<><path d="m2 9 10-5 10 5-10 5L2 9Z" /><path d="M6 11v5c3 2.5 9 2.5 12 0v-5" /><path d="M22 9v6" /></>, 'IconSchool');
export const IconHistory = make(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></>, 'IconHistory');
export const IconSpark = make(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="m6 6 2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></>, 'IconSpark');
