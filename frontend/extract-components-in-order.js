const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

// Find all matches of fileName: "C:\\hostel-bite\\frontend\\src\\app\\page.tsx" or WEBPACK_IMPORTED_MODULE
// Let's find occurrences of components or section tags and list them with indices.
const tags = [
  'ScrollProgressIndicator',
  'Navbar',
  'ZenvySuperPortal',
  'SurgeBanner',
  'IntroOverlay',
  'RewardsPanel',
  'SearchOverlay',
  'NexusExplorer',
  'ZenvyVault',
  'CampusBitesSection',
  'RecentlyViewed',
  'NexusLeaderboard',
  'ConciergeDrawer',
  'SupportModal',
  'RatingModal',
  'ZenvyModal',
  'Tilt',
  'LiveOrderStatusBar',
  'ZenvyPulse',
  'id: \\"restaurant-feed\\"',
  'id: "restaurant-feed"',
  'Academic Essentials',
  'SEASON SPECIALS',
  'Sweets & Desserts',
  'Drinks & Beverages',
  'Gym & Protein',
  'Campus Rentals',
  'Fresh Fruits',
  'Pharmacy',
  'Dry Wash',
  'Chef\\\'s Picks',
  'Chef\'s Picks',
  'Picked For You',
  'Gourmet Favorites'
];

const found = [];
tags.forEach(tag => {
  let idx = 0;
  while ((idx = content.indexOf(tag, idx)) !== -1) {
    found.push({ tag, index: idx });
    idx += tag.length;
  }
});

found.sort((a, b) => a.index - b.index);

console.log('Order of elements in recovered return JSX:');
found.forEach(item => {
  console.log(`- ${item.tag} at index ${item.index}`);
});
