"""Profile restyle (owner, 10 Nov 2026): keep the owner's Profile layout exactly; only give it the same look as Local,
Basket and Orders - the light diet band and page, glass cards, the diet accent instead of the gold / red mix.
Gold stays only where it means rewards (the ZenWe badge, ZenWe Points, badge progress). Run once."""
p = 'app/(tabs)/profile.tsx'
t = open(p, encoding='utf8').read()
assert 'useDietLight' not in t, 'already applied'

def rep(old, new, count=1):
    global t
    assert t.count(old) >= count, old[:70]
    t = t.replace(old, new, count)

rep("import AmbientBackground from '../../components/AmbientBackground';",
    "import AmbientBackground from '../../components/AmbientBackground';\nimport { useDietLight } from '../../components/local/dietLightTheme';")

rep("""  const bg = colors.bg;
  const cardBg = colors.card;
  // Light mode: cards get a soft lift so they separate from the page (dark: none)
  const lift = surfaceLift(isDark);
  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const border = colors.border;
  const goldColor = isDark ? COLORS.gold : colors.gold;""",
"""  // Owner, 10 Nov 2026: Profile keeps its layout but takes the app's new look (Local / Basket / Orders): the light
  // diet band and page, glass cards and the diet accent. Gold stays only for rewards (badge, points, progress).
  const d = useDietLight();
  const bg = isDark ? colors.bg : d.pageDeep;
  const cardBg = isDark ? colors.card : 'rgba(255,255,255,0.74)';
  const lift = isDark
    ? surfaceLift(isDark)
    : { shadowColor: d.dk, shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 3 };
  const txt = colors.text;
  const txtSec = colors.textSecondary;
  const border = isDark ? colors.border : 'rgba(255,255,255,0.95)';
  const goldColor = isDark ? COLORS.gold : d.acc;
  const rewardGold = isDark ? COLORS.gold : colors.gold;""")

# signed-in screen: light diet band behind the title, page tint instead of the ambient background in light mode
rep("""    <View style={[s.container, { paddingTop: topPad, backgroundColor: bg }]}>
      <AmbientBackground />
      <ScrollView""", """    <View style={[s.container, { paddingTop: isDark ? topPad : 0, backgroundColor: bg }]}>
      {isDark ? <AmbientBackground /> : null}
      <ScrollView""")
rep("""        {/* Back (goes to the previous screen, or Home) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 }}>
          <TabBackButton />
          <Text style={{ fontSize: 20, fontWeight: '700', color: txt }}>Profile</Text>
        </View>""", """        {/* Back (goes to the previous screen, or Home), on the light diet band */}
        <View style={isDark ? { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 } : { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: topPad + 8, paddingBottom: 18, marginBottom: 14, backgroundColor: d.top, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}>
          <TabBackButton />
          <Text style={{ fontSize: 20, fontWeight: '800', color: isDark ? txt : d.dk }}>Profile</Text>
        </View>""")

# avatar ring + initials + streak badge: diet accent instead of the fixed red
rep("colors={isDark ? [goldColor, '#FFF', '#C9962C'] : ['#EF4F5F', '#FF7E8B', '#E03546']}",
    "colors={isDark ? [goldColor, '#FFF', '#C9962C'] : [d.acc, d.soft, d.acc]}")
rep("fallback={<Text style={[s.avatarText, { color: isDark ? goldColor : '#EF4F5F' }]}>{initials}</Text>}",
    "fallback={<Text style={[s.avatarText, { color: goldColor }]}>{initials}</Text>}")
rep("backgroundColor: isDark ? '#000' : '#EF4F5F' }]}>", "backgroundColor: isDark ? '#000' : d.acc }]}>")

# rewards keep gold
rep("<View style={[s.zenvyBadge, { backgroundColor: goldColor }]}>", "<View style={[s.zenvyBadge, { backgroundColor: rewardGold }]}>")
rep("<Text style={[s.telemetryVal, { color: goldColor }]}>{formatCount(user?.zenPoints)}</Text>", "<Text style={[s.telemetryVal, { color: rewardGold }]}>{formatCount(user?.zenPoints)}</Text>")
rep("<Text style={[s.progressVal, { color: goldColor }]}>", "<Text style={[s.progressVal, { color: rewardGold }]}>")
rep("<View style={[s.progressBarFill, { backgroundColor: goldColor, width: `${milestonePct}%` }]} />", "<View style={[s.progressBarFill, { backgroundColor: rewardGold, width: `${milestonePct}%` }]} />")
rep("<Text style={[s.footerVal, { color: goldColor }]}>{formatCount(user?.zenPoints)} ZenWe Points</Text>", "<Text style={[s.footerVal, { color: rewardGold }]}>{formatCount(user?.zenPoints)} ZenWe Points</Text>")

# no separate green for "On": the accent, like the rest of the app
rep("<View style={[s.pushBtn, { borderColor: pushOn ? COLORS.emerald : goldColor }]}>", "<View style={[s.pushBtn, { borderColor: goldColor }]}>")
rep("<Text style={[s.pushBtnText, { color: pushOn ? COLORS.emerald : goldColor }]}>", "<Text style={[s.pushBtnText, { color: goldColor }]}>")

open(p, 'w', encoding='utf8').write(t)
print('ok')
