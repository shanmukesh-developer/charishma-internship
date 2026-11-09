"""Orders tab -> approved replica look (owner, 10 Nov 2026), look only, light mode only:
light diet header band, deeper diet page tint, see-through white "glass" cards with a bright edge and soft tinted
depth, All/Active/Past/Services on a soft track (selected white pill + accent), one diet accent instead of the
gold/red mix, finished/cancelled statuses in grey. Dark mode unchanged. Run once."""
p = 'app/(tabs)/orders.tsx'
t = open(p, encoding='utf8').read()
assert 'useDietLight' not in t

def rep(old, new, count=1):
    global t
    assert t.count(old) >= (1 if count == 'all' else count), old[:90]
    t = t.replace(old, new) if count == 'all' else t.replace(old, new, count)

rep("import AmbientBackground from '../../components/AmbientBackground';",
    "import AmbientBackground from '../../components/AmbientBackground';\nimport { useDietLight } from '../../components/local/dietLightTheme';")
rep("""  const bg = colors.bg;
  const cardBg = colors.card;
  // Light mode: cards get a soft lift so they separate from the page (dark: none)
  const lift = surfaceLift(isDark);
  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const border = colors.border;
  const goldColor = isDark ? COLORS.gold : colors.gold;""", """  // Owner, 10 Nov 2026: Orders takes the app's new look - light diet band and page, glass cards, one diet accent.
  const d = useDietLight();
  const bg = isDark ? colors.bg : d.pageDeep;
  const cardBg = isDark ? colors.card : 'rgba(255,255,255,0.74)';
  const lift = isDark
    ? surfaceLift(isDark)
    : { shadowColor: d.dk, shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 3 };
  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const border = isDark ? colors.border : 'rgba(255,255,255,0.95)';
  const goldColor = isDark ? COLORS.gold : d.acc;""")
rep("isDark ? goldColor : COLORS.red", "goldColor", 'all')
rep("""    if (s === 'Delivered') return COLORS.emerald;
    if (s === 'Cancelled') return '#EF4444';
    return isDark ? COLORS.gold : colors.gold;""", """    if (s === 'Delivered') return isDark ? COLORS.emerald : txtSec;
    if (s === 'Cancelled') return isDark ? '#EF4444' : txtSec;
    return goldColor;""")

rep("""    <View style={[st.container, { paddingTop: topPad, backgroundColor: bg }]}>
      <AmbientBackground />
      <ScrollView""", """    <View style={[st.container, { paddingTop: isDark ? topPad : 0, backgroundColor: bg }]}>
      {isDark ? <AmbientBackground /> : null}
      <ScrollView""")
rep("""        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 }}>
          <TabBackButton />
          <Text style={[st.pageTitle, { color: txt, paddingHorizontal: 0, marginBottom: 0 }]}>Your orders</Text>
        </View>

        <View style={st.filterRow}>""", """        <View style={isDark ? undefined : { backgroundColor: d.top, paddingTop: topPad + 8, paddingBottom: 14, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, marginBottom: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 }}>
          <TabBackButton />
          <Text style={[st.pageTitle, { color: isDark ? txt : d.dk, paddingHorizontal: 0, marginBottom: 0 }]}>Your orders</Text>
        </View>

        <View style={[st.filterRow, !isDark && { flexWrap: 'nowrap', gap: 4, marginHorizontal: 16, paddingHorizontal: 4, paddingVertical: 4, marginBottom: 0, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.65)' }]}>""")
# close band after the filter row: find the filter row end
i = t.index("{FILTER_LABEL[f] || f}")
j = t.index("        </View>\n", i) + len("        </View>\n")
t = t[:j] + "        </View>\n" + t[j:]
rep("""                    backgroundColor: isActive ? (goldColor) : (isDark ? 'rgba(255,255,255,0.05)' : cardBg),
                    borderColor: isActive ? 'transparent' : border
                  },
                  !isActive && surfaceLift(isDark, true),""", """                    backgroundColor: isDark ? (isActive ? goldColor : 'rgba(255,255,255,0.05)') : (isActive ? '#FFFFFF' : 'transparent'),
                    borderColor: isDark ? (isActive ? 'transparent' : border) : 'transparent'
                  },
                  !isDark && { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
                  !isActive && isDark && surfaceLift(isDark, true),
                  isActive && !isDark && { shadowColor: d.acc, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },""")
rep("""                  { color: isActive ? (isDark ? '#000' : '#FFF') : txtSec }""",
    """                  { color: isDark ? (isActive ? '#000' : txtSec) : isActive ? d.acc : d.dk }""")
open(p, 'w', encoding='utf8').write(t)
print('ok')
