"""Dark mode gets the new Basket look (owner, 10 Nov 2026), on dark diet tokens (d.card / d.edge / d.mute ...)."""
p = 'app/(tabs)/basket.tsx'
t = open(p, encoding='utf8').read()
pairs = [
    ("  const bg = isDark ? colors.bg : d.page;", "  const bg = d.page;"),
    ("<KeyboardAvoidingView style={[s.container, { paddingTop: isDark ? topPad : 0, backgroundColor: bg }]} enabled={basketFocused}>\n      {isDark ? <AmbientBackground /> : null}",
     "<KeyboardAvoidingView style={[s.container, { paddingTop: 0, backgroundColor: bg }]} enabled={basketFocused}>"),
    ("<View style={isDark ? undefined : { backgroundColor: d.top,", "<View style={{ backgroundColor: d.top,"),
    ("{ color: isDark ? txt : d.dk, marginBottom: 0, paddingHorizontal: 0 }]}>Your basket", "{ color: d.dk, marginBottom: 0, paddingHorizontal: 0 }]}>Your basket"),
    ("backgroundColor: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.7)'", "backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)'"),
    ("color: isDark ? '#EF4444' : d.acc, letterSpacing: 0.2 }}>Clear this basket", "color: d.acc, letterSpacing: 0.2 }}>Clear this basket"),
    ("isDark ? { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: border } : { backgroundColor: 'rgba(255,255,255,0.65)', borderColor: 'transparent', marginBottom: 0 }",
     "{ backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.65)', borderColor: 'transparent', marginBottom: 0 }"),
    ("selected && (isDark ? { backgroundColor: goldColor } : { backgroundColor: '#FFFFFF',", "selected && ({ backgroundColor: d.card,"),
    ("{ color: isDark ? (selected ? onColor : txt) : selected ? d.acc : d.dk }", "{ color: selected ? d.acc : d.dk }"),
    ("                {isDark ? (\n                  <Text style={[s.segCount", "                {false ? (\n                  <Text style={[s.segCount"),
    ("backgroundColor: selected ? d.acc : '#FFFFFF' }}>", "backgroundColor: selected ? d.acc : d.card }}>"),
    ("{ fontSize: 11, color: selected ? '#FFFFFF' : txtSec }", "{ fontSize: 11, color: selected ? d.onAcc : txtSec }"),
    ("borderColor: isDark ? border : 'rgba(17,17,26,0.06)' }]}>\n            {!roomCode", "borderColor: d.edge }]}>\n            {!roomCode"),
    ("                {isDark ? (\n                  <>\n                    <Text style={{ fontSize: 12, fontWeight: '900', color: goldColor", "                {false ? (\n                  <>\n                    <Text style={{ fontSize: 12, fontWeight: '900', color: goldColor"),
    ("<Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>Start</Text>", "<Text style={{ color: d.onAcc, fontSize: 12, fontWeight: '800' }}>Start</Text>"),
    ("backgroundColor: isDark ? goldColor : d.acc }]} ", "backgroundColor: d.acc }]} "),
    ("borderColor: isDark ? border : 'rgba(17,17,26,0.06)' }]}>\n              {isDark ? <Ionicons name=\"cart-outline\"", "borderColor: d.edge }]}>\n              {false ? <Ionicons name=\"cart-outline\""),
    ("{ backgroundColor: isDark ? COLORS.red : d.acc, shadowColor: isDark ? COLORS.red : d.acc }", "{ backgroundColor: d.acc, shadowColor: d.acc }"),
]
for a, b in pairs:
    assert a in t, a[:80]
    t = t.replace(a, b, 1)
open(p, 'w', encoding='utf8').write(t)
print('ok')
