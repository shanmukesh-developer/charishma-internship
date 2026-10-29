/**
 * The admin's information architecture: every page, grouped by area, with plain names.
 * The sidebar, the global search (Ctrl/Cmd K) and page titles all read from here, so a page is
 * always called the same thing everywhere.
 */
export type NavIcon =
  | 'home' | 'orders' | 'basket' | 'store' | 'catalogue' | 'rider' | 'pg' | 'events' | 'auto' | 'bike'
  | 'car' | 'services' | 'users' | 'school' | 'wallet' | 'ticket' | 'tag' | 'gift' | 'bell' | 'layout'
  | 'pulse' | 'pin' | 'trophy' | 'message' | 'image' | 'shield' | 'heart' | 'chart' | 'star'
  | 'settings' | 'lock' | 'history';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** One line used in search results and as the default page description. */
  description: string;
  /** Extra words people may type in search. */
  keywords?: string;
  /** Paths that also highlight this item (e.g. sub-pages). */
  match?: string[];
  /** Exact match only (so /analytics does not light up for /analytics/rewards). */
  exact?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_HOME: NavItem = {
  href: '/', label: 'Overview', icon: 'home', exact: true,
  description: 'What needs attention today, live orders and key numbers.',
  keywords: 'dashboard home needs attention',
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'orders',
    label: 'Orders & stores',
    items: [
      { href: '/orders', label: 'Orders', icon: 'orders', description: 'Every food and store order: status, rider, payment and refunds.', keywords: 'live orders delivery refund cancel stuck' },
      { href: '/campus-booking', label: 'In-Campus Booking', icon: 'orders', description: 'Pickup bookings paid straight to campus stalls by UPI; each stall: switch, UPI ID and QR.', keywords: 'campus booking pickup stall upi qr payment proof commission' },
      { href: '/restaurants', label: 'Stores', icon: 'store', description: 'Restaurants, local vendors and stalls: details, hours, compliance.', keywords: 'restaurants vendors stalls shops merchants fssai gst' },
      { href: '/catalogue', label: 'Catalogue', icon: 'catalogue', description: 'Add, edit and delete items for any store or Groceries category.', keywords: 'menu items products prices stock categories toys fruits groceries stationery' },
    ],
  },
  {
    id: 'riders',
    label: 'Riders & fleet',
    items: [
      { href: '/fleet', label: 'Riders', icon: 'rider', description: 'Delivery riders: approvals, live status, SOS and cash on hand.', keywords: 'fleet delivery partners approve sos' },
    ],
  },
  {
    id: 'campus',
    label: 'Campus',
    items: [
      { href: '/pg', label: 'PG and hostels', icon: 'pg', description: 'PG listings, rooms, photos and booking requests.', keywords: 'pg hostel rooms booking accommodation' },
      { href: '/campus-events', label: 'Events', icon: 'events', description: 'Campus events, organisers, registrations and check-in.', keywords: 'events tickets organisers registrations scan check in', match: ['/campus-events'] },
      { href: '/auto-ride', label: 'Auto-ride', icon: 'auto', description: 'Auto drivers, vehicles, routes, trips and fares.', keywords: 'auto rickshaw drivers vehicles routes trips add driver' },
      { href: '/bikepool', label: 'Co-ride', icon: 'bike', description: 'Shared bike rides posted by students.', keywords: 'bike pool co-ride share ride' },
      { href: '/rentals', label: 'Rentals', icon: 'car', description: 'Vehicle rental listings and bookings.', keywords: 'rent bike car scooter rental' },
      { href: '/service-bookings', label: 'Services', icon: 'services', description: 'Service bookings such as laundry and repairs.', keywords: 'services laundry repair bookings' },
    ],
  },
  {
    id: 'customers',
    label: 'Customers & wallet',
    items: [
      { href: '/users', label: 'Customers', icon: 'users', description: 'Customer accounts, wallet balance and bans.', keywords: 'users students customers residents ban wallet' },
      { href: '/student-verification', label: 'Student verification', icon: 'school', description: 'College ID checks waiting for review.', keywords: 'student id verification college' },
      { href: '/finance', label: 'Payments and payouts', icon: 'wallet', description: 'Revenue, store and rider payouts, rider cash and disputes.', keywords: 'finance payouts settlements disputes refunds rider cash wallet ledger' },
      { href: '/tickets', label: 'Support tickets', icon: 'ticket', description: 'Help requests from customers, riders and stores.', keywords: 'support help tickets complaints' },
    ],
  },
  {
    id: 'promotions',
    label: 'Content & promotions',
    items: [
      { href: '/coupons', label: 'Coupons', icon: 'tag', description: 'Discount codes and their usage.', keywords: 'coupons discount promo codes offers' },
      { href: '/vault', label: 'Daily deals', icon: 'gift', description: 'Limited daily deals (Vault) that customers claim as coupons.', keywords: 'vault deals daily claim' },
      { href: '/notifications', label: 'Push notifications', icon: 'bell', description: 'Send push notifications to customers.', keywords: 'push notification broadcast message send' },
      { href: '/cms', label: 'Home screen layout', icon: 'layout', description: 'Saved Home banners, shortcuts and flags (the current app does not show them yet).', keywords: 'cms banners layout home sections' },
      { href: '/splash-ads', label: 'Splash ads', icon: 'image', description: 'Full-screen store ads shown right after the customer app intro (one per style, up to 8).', keywords: 'splash ads advert sponsored intro full screen promotion store offer' },
    ],
  },
  {
    id: 'community',
    label: 'Community',
    items: [
      { href: '/moderation', label: 'Reports and moderation', icon: 'shield', description: 'Reported profiles, messages and posts waiting for a decision.', keywords: 'moderation reports flagged abuse whispers' },
      { href: '/friends', label: 'Friends app', icon: 'heart', description: 'Friends features: connect, forum, pulse and spaces.', keywords: 'friends connect forum pulse spaces whispers', match: ['/friends'] },
      { href: '/community', label: 'Community posts', icon: 'message', description: 'Posts and birthday wishes shown in the community feed.', keywords: 'community posts birthday' },
      { href: '/wall', label: 'The Wall', icon: 'image', description: 'Student photo wall: submissions to approve and events.', keywords: 'wall photos submissions moderate' },
      { href: '/campus', label: 'Campus Pulse', icon: 'pulse', description: '"Today on campus" and "The 9 PM question" content.', keywords: 'campus pulse today question', exact: true },
      { href: '/campus/spots', label: 'Campus spots', icon: 'pin', description: 'Open chat rooms for places like the library or mess.', keywords: 'spots chat rooms library mess gym' },
      { href: '/blocks', label: 'Block wars', icon: 'trophy', description: 'Hostel block leaderboard.', keywords: 'blocks leaderboard hostel competition' },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { href: '/analytics', label: 'Analytics', icon: 'chart', description: 'Order volume, revenue and store performance over time.', keywords: 'analytics reports performance revenue charts', exact: true },
      { href: '/analytics/rewards', label: 'Rewards', icon: 'star', description: 'Rewards and spin-wheel analytics.', keywords: 'rewards spin wheel points' },
    ],
  },
  {
    id: 'config',
    label: 'Config',
    items: [
      { href: '/config', label: 'Settings and fees', icon: 'settings', description: 'Delivery fees, feature switches, app versions, receipts and legal pages.', keywords: 'config settings delivery fee feature flags app version legal terms privacy receipts gst' },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    items: [
      { href: '/security', label: 'Account security', icon: 'lock', description: 'Your password, 2-step sign-in and recovery codes.', keywords: 'password 2fa two factor authenticator recovery' },
      { href: '/audit', label: 'Audit log', icon: 'history', description: 'Who changed what in the admin, and when.', keywords: 'audit log history changes' },
    ],
  },
];

/** Sub-pages that are not in the sidebar but should be findable from search. */
export const EXTRA_SEARCH_PAGES: NavItem[] = [
  { href: '/campus-events/scan', label: 'Event check-in scanner', icon: 'events', description: 'Scan event tickets at the entrance.', keywords: 'scan qr check in ticket entry' },
  { href: '/friends/connect', label: 'Friends: Connect', icon: 'heart', description: 'Connect matching, selfie checks and retention.', keywords: 'connect selfie matching' },
  { href: '/friends/forum', label: 'Friends: Forum', icon: 'heart', description: 'Forum communities and posts.', keywords: 'forum communities' },
  { href: '/friends/pulse', label: 'Friends: Pulse', icon: 'heart', description: 'Pulse trends and whispers.', keywords: 'pulse whispers trends' },
  { href: '/friends/spaces', label: 'Friends: Spaces', icon: 'heart', description: 'Live audio rooms.', keywords: 'spaces live audio rooms' },
];

export const ALL_NAV_ITEMS: NavItem[] = [NAV_HOME, ...NAV_GROUPS.flatMap(g => g.items)];

const clean = (p: string) => p.replace(/\/+$/, '') || '/';

export function isNavActive(item: NavItem, pathname: string): boolean {
  const path = clean(pathname);
  if (item.exact || item.href === '/') return path === item.href;
  const bases = [item.href, ...(item.match || [])];
  return bases.some(b => path === b || path.startsWith(`${b}/`));
}

/** The nav item for the current page (used for the document title and breadcrumbs). */
export function findNavItem(pathname: string): { item: NavItem; group: NavGroup | null } | null {
  const path = clean(pathname);
  if (path === '/') return { item: NAV_HOME, group: null };
  for (const g of NAV_GROUPS) {
    // Exact items first so /analytics/rewards resolves to Rewards, not Analytics.
    const hit = g.items.find(i => clean(i.href) === path) || g.items.find(i => isNavActive(i, path));
    if (hit) return { item: hit, group: g };
  }
  const extra = EXTRA_SEARCH_PAGES.find(i => clean(i.href) === path);
  return extra ? { item: extra, group: null } : null;
}
