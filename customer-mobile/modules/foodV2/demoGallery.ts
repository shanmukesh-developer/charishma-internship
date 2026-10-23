/**
 * DEMO PICTURES: extra gallery photos per exact item type, so products show 2–5 photos.
 * TODO before the Play release: replace with real store photos (server returns images[] from specs.images).
 * Rules: picture 1 is always the item's own catalogue photo; extra photos show EXACTLY that item
 * (hand-checked, Unsplash licence, unbranded, no brand pack shots); matched on a specific noun in
 * the product name, never on broad words like "fruit" or "snack"; no exact set -> own photo(s) only.
 */
const U = (id: string) => `https://images.unsplash.com/photo-${id}?w=900&q=80&auto=format&fit=crop`;

/** Most specific nouns first. Each photo is used by one item type only. */
const SETS: { re: RegExp; not?: RegExp; ids: string[] }[] = [
  { re: /\bcarrots?\b/i, ids: ['1598170845058-32b9d6a5da37', '1633380110125-f6e685676160', '1590868309235-ea34bed7bd7f', '1589927986089-35812388d1f4'] },
  { re: /\bbananas?\b/i, ids: ['1587132137056-bfbf0166836e', '1571771894821-ce9b6c11b08e', '1528825871115-3581a5387919'] },
  { re: /\bonions?\b/i, ids: ['1618512496248-a07fe83aa8cb', '1620574387735-3624d75b2dbc'] },
  { re: /\bpotato(es)?\b/i, not: /chip|crisp|wafer/i, ids: ['1518977676601-b53f82aba655'] },
  { re: /\bapples?\b/i, not: /juice|cider/i, ids: ['1560806887-1e4cd0b6cbd6', '1619546813926-a78fa6372cd2', '1576179635662-9d1983e97e1e'] },
  { re: /\bgrapes?\b/i, ids: ['1596363505729-4190a9506133', '1766186471436-5bb49b29c1c8', '1537640538966-79f369143f8f'] },
  { re: /\boranges?\b/i, not: /juice|drink|beverage/i, ids: ['1611080626919-7cf5a9dbab5b'] },
  { re: /\btomato(es)?\b/i, not: /ketchup|sauce|soup|chips|crisps/i, ids: ['1592924357228-91a4daadcfea'] },
  { re: /\beggs?\b/i, ids: ['1713176679386-fc0ad35e56f8'] },
  { re: /\bmilk\b/i, not: /chocolate|silk|shake|biscuit|cookie|powder/i, ids: ['1550583724-b2692b85b150', '1517448931760-9bf4414148c5', '1639151082235-406d8eb262b9', '1611211301828-be4b317d0707'] },
  { re: /\bcroissants?\b/i, ids: ['1709798289100-7b46217e0325', '1709798288301-719572ca8e98'] },
  { re: /\bbread\b/i, ids: ['1509440159596-0249088772ff', '1693480532368-de842fb9dcf4'] },
  { re: /choco(late)? ?chip/i, ids: ['1592065201038-52c9da2a6194', '1557310717-d6bea9f36682', '1657312125229-e8e83cf46ff1'] },
  { re: /potato chips|\bchips\b|\bcrisps\b|\bwafers?\b/i, not: /choco|cookie/i, ids: ['1528751014936-863e6e7a319c', '1749281592570-2f743d7d2824', '1740993384870-0793845268e6'] },
  { re: /\bchocolate\b/i, not: /drink|milk|cookie|biscuit/i, ids: ['1720029106261-0d0396bb270d', '1772986509919-61b14bf702fa'] },
  { re: /\bnoodles?\b|\bramen\b/i, ids: ['1612927601601-6638404737ce', '1569718212165-3a8278d5f624'] },
  { re: /\brice\b/i, not: /cracker|flakes|bran oil|puff/i, ids: ['1586201375761-83865001e31c', '1686820740687-426a7b9b2043', '1536153635972-1fc2e818f642'] },
  { re: /\bcoffee\b/i, ids: ['1514432324607-a09d9b4aefdd'] },
  { re: /\btea\b/i, not: /green tea bag/i, ids: ['1544787219-7f47ccb76574'] },
  { re: /\borange juice\b/i, ids: ['1598830853058-3474f6a66003'] },
  { re: /\b(sunflower|groundnut|mustard|olive|cooking) oil\b/i, ids: ['1474979266404-7eaacbcd87c5'] },
  { re: /\bshampoo\b|\bshower gel\b|\bbody wash\b/i, ids: ['1549869638-10ef712893a7'] },
  { re: /\btowels?\b/i, ids: ['1639298108944-76a403a7c38d'] },
];

/** Own photo(s) first, then the exact-item set (2–5 total); no exact set -> own photo(s) only. */
export function demoGallery(own: string[], name: string): string[] {
  const set = SETS.find(st => st.re.test(name) && !(st.not && st.not.test(name)));
  const out: string[] = [];
  [...own, ...(set ? set.ids.map(U) : [])].forEach(u => { if (u && !out.includes(u) && out.length < 5) out.push(u); });
  return out;
}

/** True when the item has an exact demo set (used for the "needs real photos" list). */
export const hasDemoSet = (name: string) => SETS.some(st => st.re.test(name) && !(st.not && st.not.test(name)));
