import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type DietMode = 'all' | 'veg' | 'egg' | 'eggarian' | 'non-veg' | 'nonveg';

export interface DietPrefs {
  mode: DietMode;
  nuts: boolean;
  dairy: boolean;
  gluten: boolean;
  custom?: string[];
}

interface DietaryContextType {
  dietMode: DietMode;
  dietPrefs: DietPrefs;
  setDietMode: (mode: DietMode) => void;
  updateDietPrefs: (prefs: DietPrefs) => void;
  isItemAllowed: (item: any) => boolean;
  reload: () => Promise<void>;
}

const DEFAULT_PREFS: DietPrefs = { mode: 'all', nuts: false, dairy: false, gluten: false, custom: [] };

const DietaryContext = createContext<DietaryContextType>({
  dietMode: 'all',
  dietPrefs: DEFAULT_PREFS,
  setDietMode: () => {},
  updateDietPrefs: () => {},
  isItemAllowed: () => true,
  reload: async () => {},
});

export function DietaryProvider({ children }: { children: React.ReactNode }) {
  const [dietPrefs, setDietPrefs] = useState<DietPrefs>(DEFAULT_PREFS);

  const loadPrefs = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('zenvy_diet_prefs');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.mode) {
          setDietPrefs(parsed);
        }
      }
    } catch (e) {
      console.warn('[Dietary] could not load preferences', e);
    }
  }, []);

  useEffect(() => {
    loadPrefs();
  }, [loadPrefs]);

  const setDietMode = useCallback((mode: DietMode) => {
    setDietPrefs((prev) => {
      const updated = { ...prev, mode };
      AsyncStorage.setItem('zenvy_diet_prefs', JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, []);

  const updateDietPrefs = useCallback((prefs: DietPrefs) => {
    setDietPrefs(prefs);
    AsyncStorage.setItem('zenvy_diet_prefs', JSON.stringify(prefs)).catch(() => {});
  }, []);

  /**
   * Determines if a food item should be shown based on the active dietary mode.
   * 
   * Logic:
   * - 'all': Show everything
   * - 'veg': Only show items where isVegetarian === true (strictly no meat, no egg)
   * - 'eggarian': Show veg items + egg items (items with egg tag/category but not meat)
   * - 'nonveg': Show only non-veg items (meat, chicken, fish, etc.)
   */
  const isItemAllowed = useCallback((item: any): boolean => {
    if (!item) return false;
    const tags: string[] = (Array.isArray(item.tags) ? item.tags : [])
      .filter((t: any) => typeof t === 'string')
      .map((t: string) => t.toLowerCase().trim());

    // Allergies: hide dishes the kitchen has marked with that allergen (MenuItem.allergens or tags such as
    // "nuts" / "contains-dairy"). Dishes without allergen data are not guessed about.
    const allergens: string[] = [
      ...(Array.isArray(item.allergens) ? item.allergens : []),
      ...(Array.isArray(item.specs?.allergens) ? item.specs.allergens : []),
    ].filter((a: any) => typeof a === 'string').map((a: string) => a.toLowerCase().trim());
    const marks = new Set<string>([...allergens, ...tags.map((t) => t.replace(/^contains[-_ ]/, ''))]);
    const blocked: string[] = [
      ...(dietPrefs.nuts ? ['nuts', 'nut', 'peanut', 'peanuts', 'tree nuts'] : []),
      ...(dietPrefs.dairy ? ['dairy', 'milk', 'lactose'] : []),
      ...(dietPrefs.gluten ? ['gluten', 'wheat'] : []),
      ...((dietPrefs.custom || []).filter((c) => typeof c === 'string').map((c) => c.toLowerCase().trim())),
    ];
    if (blocked.some((b) => b && marks.has(b))) return false;

    const mode = dietPrefs.mode;
    if (!mode || mode === 'all') return true;

    const isVeg = item.isVegetarian === true ||
                  String(item.isVegetarian).toLowerCase() === 'true' ||
                  Number(item.isVegetarian) === 1 ||
                  tags.includes('veg') ||
                  tags.includes('fruits');

    const name = String(item.name || '');
    const category = String(item.category || '');

    // Whole word only: "Egg Puff" / "Eggs" are egg dishes, "Veggie Burger" is not.
    const EGG_WORD = /\beggs?\b/i;
    const isEgg = item.isEgg === true || tags.includes('egg') || tags.includes('eggarian') ||
                  EGG_WORD.test(name) || EGG_WORD.test(category);

    if (mode === 'veg') {
      return isVeg && !isEgg; // Strict veg: no egg, no meat
    }

    if (mode === 'egg' || mode === 'eggarian') {
      // Veg + egg items allowed, no meat ("Chicken Egg Fried Rice" is an egg-named meat dish)
      const MEAT_WORD = /\b(chicken|mutton|lamb|fish|prawns?|shrimp|crab|beef|pork|keema|meat|seafood|bacon|ham)\b/i;
      const hasMeat = tags.includes('non-veg') || tags.includes('nonveg') || MEAT_WORD.test(name) || MEAT_WORD.test(category);
      return isVeg || (isEgg && !hasMeat);
    }

    if (mode === 'nonveg' || mode === 'non-veg') {
      return !isVeg; // Only non-veg items
    }

    return true;
  }, [dietPrefs]);

  // Memoized: an inline object re-rendered every useDietary() screen on each provider render.
  const value = useMemo<DietaryContextType>(() => ({
    dietMode: dietPrefs.mode,
    dietPrefs,
    setDietMode,
    updateDietPrefs,
    isItemAllowed,
    reload: loadPrefs,
  }), [dietPrefs, setDietMode, updateDietPrefs, isItemAllowed, loadPrefs]);

  return (
    <DietaryContext.Provider value={value}>
      {children}
    </DietaryContext.Provider>
  );
}

export const useDietary = () => useContext(DietaryContext);
export default DietaryContext;
