"""Bottom bar + basket button follow the diet (owner, 10 Nov 2026): pink-red for Non-veg (unchanged default),
green for Veg. Only the accent colour changes; layout, icons and sizes stay. Run once."""
import re

def patch(p, pairs):
    t = open(p, encoding='utf8').read()
    for old, new, n in pairs:
        assert t.count(old) >= 1, (p, old[:70])
        t = t.replace(old, new) if n == 'all' else t.replace(old, new, n)
    open(p, 'w', encoding='utf8').write(t)
    print('patched', p)

# --- tab bar ---
L = 'app/(tabs)/_layout.tsx'
t = open(L, encoding='utf8').read()
assert 'useNavAccent' not in t
# import after the last import line
imports = list(re.finditer(r"^import .*;$", t, flags=re.M))
pos = imports[-1].end()
t = t[:pos] + "\nimport { useNavAccent } from '../../components/local/dietLightTheme';" + t[pos:]
open(L, 'w', encoding='utf8').write(t)
patch(L, [
    ("const TabIcon = React.memo(function TabIcon({ name, focused, iconName, color, showCartBadge }: { name: string; focused: boolean; iconName: any; color: ColorValue; showCartBadge?: boolean }) {\n",
     "const TabIcon = React.memo(function TabIcon({ name, focused, iconName, color, showCartBadge }: { name: string; focused: boolean; iconName: any; color: ColorValue; showCartBadge?: boolean }) {\n  const accent = useNavAccent();\n", 1),
    ("{focused && <View style={styles.activeIndicator} />}", "{focused && <View style={[styles.activeIndicator, { backgroundColor: accent }]} />}", 1),
    ("color={focused ? COLORS.red : color}", "color={focused ? accent : color}", 'all'),
    ("{ color: focused ? COLORS.red : labelColor,", "{ color: focused ? accent : labelColor,", 1),
    ("  const tones = useTabBarTones();\n", "  const tones = useTabBarTones();\n  const navAccent = useNavAccent();\n", 1),
    ("      tabBarActiveTintColor: COLORS.red,", "      tabBarActiveTintColor: navAccent,", 1),
])
# make the options memo refresh when the accent changes
t = open(L, encoding='utf8').read()
m = re.search(r"const screenOptions = useMemo\(\(\) => \{.*?\n  \}, \[([^\]]*)\]\);", t, flags=re.S)
assert m, 'screenOptions deps'
deps = m.group(1)
if 'navAccent' not in deps:
    t = t[:m.start(1)] + deps + ', navAccent' + t[m.end(1):]
open(L, 'w', encoding='utf8').write(t)

# --- basket button + "View basket" bar ---
F = 'components/FloatingBasket.tsx'
t = open(F, encoding='utf8').read()
assert 'useNavAccent' not in t
imports = list(re.finditer(r"^import .*;$", t, flags=re.M))
pos = imports[-1].end()
t = t[:pos] + "\nimport { useNavAccent } from './local/dietLightTheme';" + t[pos:]
open(F, 'w', encoding='utf8').write(t)
patch(F, [
    ("borderColor: isDark ? COLORS.gold : COLORS.red }]}", "borderColor: isDark ? COLORS.gold : accent }]}", 1),
    ("backgroundColor: isDark ? COLORS.gold : COLORS.red }]}>\n", "backgroundColor: isDark ? COLORS.gold : accent }]}>\n", 'all'),
    ("{ color: isDark ? COLORS.gold : COLORS.red }]}>", "{ color: isDark ? COLORS.gold : accent }]}>", 1),
    ("<BasketFabIcon size={34} bg={COLORS.red} />", "<BasketFabIcon size={34} bg={accent} />", 1),
    ("    <DopaminePressable\n      style={s.fabBtn}\n", "    <DopaminePressable\n      style={[s.fabBtn, { backgroundColor: accent, shadowColor: accent }]}\n", 1),
    ("<View style={s.fabBadge} pointerEvents=\"none\">", "<View style={[s.fabBadge, { borderColor: accent }]} pointerEvents=\"none\">", 1),
    ("<Text style={s.fabBadgeText} maxFontSizeMultiplier={1.3}>", "<Text style={[s.fabBadgeText, { color: accent }]} maxFontSizeMultiplier={1.3}>", 1),
    ("    <FloatingPulse color={COLORS.red} style={s.fabBtnWrap}>", "    <FloatingPulse color={accent} style={s.fabBtnWrap}>", 1),
])
print('done')
