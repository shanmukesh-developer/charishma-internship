// Photo credits for the owner's real menus (data/owner-menus): every dish photo comes from Unsplash, Pexels or
// Wikimedia Commons; the Commons ones (CC BY / CC BY-SA) must name the author, the licence and the source, and say
// when ZCS changed the photo (crops). Read from each menu's images/<store>/sources.json; shown on /legal/photo-credits.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'owner-menus');

const LICENCE_LINKS = [
  [/^cc0|public domain/i, 'https://creativecommons.org/publicdomain/zero/1.0/'],
  [/cc by-sa 4\.0/i, 'https://creativecommons.org/licenses/by-sa/4.0/'],
  [/cc by-sa 3\.0/i, 'https://creativecommons.org/licenses/by-sa/3.0/'],
  [/cc by-sa 2\.0/i, 'https://creativecommons.org/licenses/by-sa/2.0/'],
  [/cc by 4\.0/i, 'https://creativecommons.org/licenses/by/4.0/'],
  [/cc by 3\.0/i, 'https://creativecommons.org/licenses/by/3.0/'],
  [/cc by 2\.0/i, 'https://creativecommons.org/licenses/by/2.0/'],
  [/unsplash/i, 'https://unsplash.com/license'],
  [/pexels/i, 'https://www.pexels.com/license/'],
];
const licenceLink = (licence) => {
  const hit = LICENCE_LINKS.find(([re]) => re.test(String(licence || '')));
  return hit ? hit[1] : null;
};

/** -> [{ store, photos: [{ dish, author, licence, licenceUrl, sourcePage, modified }] }] (never throws) */
const loadPhotoCredits = (dir = DATA_DIR) => {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const sp = path.join(dir, String(data.imagesDir || ''), 'sources.json');
      const sources = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, 'utf8')) : [];
      const photos = (Array.isArray(sources) ? sources : []).map((s) => ({
        dish: String(s.dish || ''),
        author: String(s.author || ''),
        licence: String(s.licence || ''),
        licenceUrl: licenceLink(s.licence),
        sourcePage: /^https:\/\//.test(String(s.sourcePage || '')) ? s.sourcePage : null,
        modified: s.modified ? String(s.modified) : null,
      })).filter((p) => p.dish && p.licence);
      return { store: String((data.store && data.store.name) || ''), photos };
    }).filter((g) => g.store && g.photos.length);
  } catch (err) {
    console.warn('[PHOTO_CREDITS_WARN]', err.message);
    return [];
  }
};

module.exports = { loadPhotoCredits, licenceLink, DATA_DIR };
