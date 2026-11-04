// "Go to Home" / "View orders" / "Back to basket" from a page (3 Nov 2026): go back to the one tab bar the app already
// has instead of stacking a second one. router.replace('/(tabs)') left the first tab bar underneath, so Android Back
// from Home showed Home again (and the pages under it). The app has one root stack whose first screen is the tabs
// (app/index.tsx redirects there): pop everything above it, then open the tab. Opened from a link with no tabs below,
// dismissTo replaces the page with the tabs. Inside the tabs it just switches to the tab.
type Nav = { canDismiss: () => boolean; dismissAll: () => void; dismissTo: (href: any) => void };

export const goHome = (router: Nav, href: any = '/(tabs)') => {
  try { if (router.canDismiss()) router.dismissAll(); } catch { /* nothing to pop */ }
  router.dismissTo(href);
};
