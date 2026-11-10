/**
 * Very light diet colours (owner, 10 Nov 2026): the Local tab and every In-Campus Booking screen follow the
 * Veg / Non-veg choice made on Home (DietaryContext). Non-veg = very light red with Home's red accent, Veg = very
 * light green with Home's green accent. Dark mode keeps the app's dark surfaces and only takes the accent.
 */
import { useDietary } from '../../context/DietaryContext';
import { useTheme } from '../../context/ThemeContext';

export interface DietLight {
  veg: boolean;
  isDark: boolean;
  /** Header band. */
  top: string;
  /** Selected folder tab + the panel under it. */
  sel: string;
  /** Unselected folder tab. */
  un: string;
  /** The one accent (buttons, selected chip, links). */
  acc: string;
  /** Soft tint (pickup line, steppers, icon wells). */
  soft: string;
  /** Page background. */
  page: string;
  /** Dark text on the light bands. */
  dk: string;
  /** Hairlines. */
  line: string;
  /** A slightly deeper page tint so white / glass cards stand out (Orders, Profile). */
  pageDeep: string;
  /** Card surface, its edge, progress-bar track, neutral pill and its ink, text on the accent. */
  card: string;
  edge: string;
  track: string;
  mute: string;
  muteInk: string;
  onAcc: string;
}

const LIGHT_SURF = { card: '#FFFFFF', edge: 'rgba(17,17,26,0.10)', track: '#ECEEF3', mute: '#F2F3F6', muteInk: '#4B5160', onAcc: '#FFFFFF' };
const LIGHT = {
  nonveg: { top: '#FBE1E6', sel: '#FFF5F7', un: '#F4D0D8', acc: '#C8143F', soft: '#FDEEF1', page: '#FFFBFB', dk: '#4C0912', line: '#F4E3E6', pageDeep: '#F7ECEE', ...LIGHT_SURF },
  veg: { top: '#DCF1E3', sel: '#F3FBF5', un: '#C8E8D2', acc: '#15803D', soft: '#ECF8EF', page: '#FAFEFB', dk: '#08351C', line: '#E0EFE4', pageDeep: '#ECF5EF', ...LIGHT_SURF },
};
// Dark (owner, 10 Nov 2026: "work on dark mode"): the same look on deep diet-tinted surfaces.
const DARK_SURF = { card: '#1A1316', edge: 'rgba(255,255,255,0.08)', track: 'rgba(255,255,255,0.12)', mute: 'rgba(255,255,255,0.08)', muteInk: '#B4B4BC', line: 'rgba(255,255,255,0.08)' };
const DARK = {
  nonveg: { top: '#2A1015', sel: '#3A161D', un: '#1C0A0E', acc: '#FF5C7A', soft: 'rgba(255,92,122,0.14)', dk: '#FFE4E9', page: '#0F0A0B', pageDeep: '#0F0A0B', onAcc: '#FFFFFF', ...DARK_SURF, card: '#1C1315' },
  veg: { top: '#0F2418', sel: '#163322', un: '#0A1910', acc: '#4ADE80', soft: 'rgba(74,222,128,0.14)', dk: '#DCFCE7', page: '#080E0A', pageDeep: '#080E0A', onAcc: '#052E16', ...DARK_SURF, card: '#121C16' },
};

export const isVegDiet = (mode: string) => mode === 'veg' || mode === 'eggarian';

export function useDietLight(): DietLight {
  const { dietMode } = useDietary();
  const { isDark } = useTheme();
  const veg = isVegDiet(dietMode);
  if (isDark) {
    return { veg, isDark, ...(veg ? DARK.veg : DARK.nonveg) };
  }
  return { veg, isDark, ...(veg ? LIGHT.veg : LIGHT.nonveg) };
}

/**
 * Owner, 10 Nov 2026: the bottom bar and the basket button follow the diet too - the app's default pink-red for
 * Non-veg, green for Veg (dark mode keeps its own gold / red elsewhere; this is only the accent).
 */
export const NAV_ACCENT = { nonveg: '#EF4F5F', veg: '#15803D' } as const;
export function useNavAccent(): string {
  const { dietMode } = useDietary();
  return isVegDiet(dietMode) ? NAV_ACCENT.veg : NAV_ACCENT.nonveg;
}
