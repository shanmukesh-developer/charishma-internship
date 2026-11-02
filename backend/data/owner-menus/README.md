# Owner menus (real restaurants from the owner's menu cards)

Each `<store>-v1-<date>.json` is one store; `images/<store>/` holds its photos and `sources.json` (one credit per photo).
`scripts/owner_menu_import.js` imports them on every start (create-only, ledger-keyed; admin edits always win).

Owner's rules (1-2 Nov 2026), checked by `tests/s1/31_*` / `32_*`:

- **Prices and dishes exactly as on the printed card** (circled / crossed-out items left out). Dish order = card order:
  the importer sets `specs.sortOrder` 10, 20, ... from the file order.
- **Every photo is a real photograph of that exact dish**, checked by eye against the dish's own description. No AI
  images, no illustrations, no photo of a different dish, no two dishes with the same photo. A veg dish never shows
  egg or meat. If no free photo of the exact dish exists, use the closest real one and mark it `"match": "closest match"`
  (the Photo credits page says so); if nothing close exists, `"image": null` (the app shows its placeholder).
- **Licensed only**: Wikimedia Commons (CC0 / CC BY / CC BY-SA, author named), Unsplash, Pexels. A restaurant's own
  photo only with the owner's stated permission ("Used with the permission of ..."). Never photos from Zomato, Swiggy,
  Google Maps, blogs, shops or Amazon (those belong to others).
- `sources.json` `shows` says what the photo really shows (not "Authentic serving of ..."); `modified: "cropped"` when cropped.
- Photos: at least ~1000 px on the long side when the original allows (made at up to 1400 px, JPEG q86, no EXIF,
  upright as on the source page); store photo = a banner crop (~1.7:1) with the name sign fully inside.
- **Descriptions state facts only**: nothing invented (no "established in ...", ratings, awards, portions, weights).
- **Changing a live photo or text**: give the new file a new name (`<slug>-v2.jpg`, never overwrite) and list the
  SHA-256 of the replaced photo in `replacesPhotos` (`null` = "had no photo"), or of the replaced text in
  `replacesDescriptions`; the importer swaps it on the next start only while the live one is still ours.
