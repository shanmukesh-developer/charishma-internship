/**
 * Food & groceries v2 tokens (modules/foodV2).
 */
/**
 * Food & groceries look (owner reference v2, 23 Oct; colours sampled from the reference boards):
 * deep forest-green headers, white / light-grey content, bright green pills, slate text.
 * Headers stay green in dark mode; the content switches to the dark surfaces.
 */
export const FOOD = {
  /** Header gradient (top -> bottom). */
  header: ['#03321E', '#045029'] as [string, string],
  /** Darker header used by search, saved items and inner pages. */
  headerDeep: ['#012218', '#03321E'] as [string, string],
  /** Home hero card (dark green) and its border. */
  hero: ['#04391F', '#042F20'] as [string, string],
  heroLine: 'rgba(140,220,170,0.28)',
  /** Bright pill on dark green ("Shop now", "Start a shopping list"). */
  bright: ['#2DAD64', '#3BC671'] as [string, string],
  /** Primary green: "+", selected chips, buttons on white. */
  primary: '#07843F',
  /** "Add to basket" / "View basket" pill. */
  cta: '#028A4A',
  /** Basket bar. */
  bar: '#01271A',
  /** Light-green notice / soft cards. */
  notice: { light: '#D6EDD8', dark: 'rgba(76,193,122,0.16)' },
  noticeInk: { light: '#184B33', dark: '#BFEBCD' },
  soft: { light: '#E8F5EC', dark: 'rgba(76,193,122,0.12)' },
  /** Steppers (mint circles with dark-green icons). */
  mint: { light: '#E3F5EB', dark: 'rgba(76,193,122,0.16)' },
  mintInk: { light: '#0B6B36', dark: '#7FDCA3' },
  /** Page and cards. */
  page: { light: '#FFFFFF', dark: '#09090B' },
  /** Listing surface behind the white product rows. */
  surface: { light: '#F7FAF9', dark: '#09090B' },
  card: { light: '#FFFFFF', dark: '#1D1D20' },
  plate: { light: '#F3F6F5', dark: '#26262B' },
  field: { light: '#F4F9F9', dark: '#26262B' },
  line: { light: 'rgba(16,40,30,0.07)', dark: 'rgba(255,255,255,0.08)' },
  /** Text. */
  title: { light: '#0B121A', dark: '#F4F4F5' },
  name: { light: '#2E3F4B', dark: '#E4E4E7' },
  price: { light: '#123340', dark: '#F4F4F5' },
  slate: { light: '#567084', dark: '#A1A1AA' },
  was: { light: '#A8B9C4', dark: '#71717A' },
  off: { light: '#2FA35B', dark: '#5CCB85' },
  /** Unselected chip on white. */
  chip: { light: '#F1F6F4', dark: '#26262B' },
  /** Sidebar (aisles). */
  side: { light: '#F5FAF8', dark: '#141416' },
  sideSel: ['#24A359', '#5FC983'] as [string, string],
  /** Chips on the dark-green header (search, saved items). */
  onGreenChip: 'rgba(22,72,56,0.9)',
  onGreenChipSel: '#CEF2D8',
  onGreenChipSelInk: '#1B5E3B',
  wave: ['rgba(14,110,58,0.10)', 'rgba(14,110,58,0.22)'] as [string, string],
} as const;
