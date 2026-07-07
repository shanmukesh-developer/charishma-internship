const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

const components = [
  'ScrollProgressIndicator',
  'ZenvySuperPortal',
  'SurgeBanner',
  'IntroOverlay',
  'Navbar',
  'RewardsPanel',
  'Central Command',
  'SearchOverlay',
  'What\'s on your mind?',
  'NexusExplorer',
  'ZenvyVault',
  'elite-card',
  'RecentlyViewed',
  'favoriteItems',
  'stationary',
  'rentals',
  'fruits',
  'pharmacy',
  'laundry',
  'restaurant-feed',
  'CampusBitesSection',
  'footer'
];

components.forEach(comp => {
  const idx = content.indexOf(comp);
  console.log(`${comp}: ${idx}`);
});
