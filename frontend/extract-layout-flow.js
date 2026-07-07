const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'recovered_return_jsx.js'), 'utf8');

// We want to see where all JSX tags are opened/closed in recovered_return_jsx.js
// Let's search for tags or webpack import references like ZenvyVault, NexusExplorer, CampusBitesSection, RecentlyViewed, etc.
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
  'ZenvyModal'
];

console.log('Component references in recovered return JSX:');
tags.forEach(tag => {
  let index = 0;
  while ((index = content.indexOf(tag, index)) !== -1) {
    console.log(`- ${tag} found at index ${index}`);
    // Print around index
    console.log(content.slice(Math.max(0, index - 150), index + 150));
    console.log('---');
    index += tag.length;
  }
});
