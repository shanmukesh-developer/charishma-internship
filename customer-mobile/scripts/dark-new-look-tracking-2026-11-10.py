"""Dark mode gets the new food-tracking look (owner, 10 Nov 2026) on the dark diet tokens."""
import re
p = 'app/tracking/[id].tsx'
t = open(p, encoding='utf8').read()
pairs = [
    ("  const acc = isDark ? COLORS.gold : dl.acc;\n  const bg = isDark ? colors.bg : dl.page;\n  const cardBg = isDark ? colors.card : '#FFFFFF';",
     "  const acc = dl.acc;\n  const bg = dl.page;\n  const cardBg = dl.card;"),
    ("  const border = isDark ? COLORS.borderDark : 'rgba(17,17,26,0.07)';", "  const border = dl.edge;\n  // Old dark layout stays in the file but no longer renders (owner, 10 Nov 2026: dark gets the new look).\n  const legacy = false as boolean;"),
    ("backgroundColor: isDark ? '#000' : dl.top, borderBottomColor: isDark ? border : 'transparent' }, !isDark && { borderBottomLeftRadius",
     "backgroundColor: dl.top, borderBottomColor: 'transparent' }, { borderBottomLeftRadius"),
    ("<Ionicons name=\"chevron-back\" size={20} color={isDark ? txt : dl.dk} />", "<Ionicons name=\"chevron-back\" size={20} color={dl.dk} />"),
    ("{ color: isDark ? txt : dl.dk }]}>Order tracking", "{ color: dl.dk }]}>Order tracking"),
    ("color: isDark ? COLORS.gold : dl.dk, opacity: isDark ? 1 : 0.7,", "color: dl.dk, opacity: 0.7,"),
    ("{storeName && !isDark ? `${storeName} · ` : ''}", "{storeName ? `${storeName} · ` : ''}"),
    ("isConnected ? (isDark ? 'rgba(16,185,129,0.1)' : '#FFFFFF')", "isConnected ? dl.card"),
    ("isConnected ? (isDark ? COLORS.emerald : acc) : txtSec }]} />", "isConnected ? acc : txtSec }]} />"),
    ("{ color: isConnected ? (isDark ? COLORS.emerald : acc) : txtSec }", "{ color: isConnected ? acc : txtSec }"),
    ("        {!isDark ? (() => {", "        {!legacy ? (() => {"),
    ("        {isDark ? <StaggeredSection delay={30} direction=\"up\">", "        {legacy ? <StaggeredSection delay={30} direction=\"up\">"),
    ("        {isDark ? <StaggeredSection delay={50} direction=\"up\">", "        {legacy ? <StaggeredSection delay={50} direction=\"up\">"),
    ("borderColor: isDark ? COLORS.goldBorder : border }]}>", "borderColor: border }]}>"),
    ("style={[s.receiptBtn, !isDark && { backgroundColor: acc },", "style={[s.receiptBtn, { backgroundColor: acc },"),
    ("color={isDark ? '#000' : '#FFF'} /> : <Text style={[s.receiptBtnText, !isDark && { color: '#FFFFFF' }]}>View receipt", "color={dl.onAcc} /> : <Text style={[s.receiptBtnText, { color: dl.onAcc }]}>View receipt"),
    ("            {!isDark ? (\n              <View style={[s.v7Pin", "            {!legacy ? (\n              <View style={[s.v7Pin"),
    ("{isDark ? <Ionicons name=\"star-outline\" size={20} color={COLORS.gold} /> : null}", "{null}"),
    ("{isDark ? <Ionicons name=\"chevron-forward\" size={16} color={COLORS.gold} /> : (", "{legacy ? <Ionicons name=\"chevron-forward\" size={16} color={COLORS.gold} /> : ("),
    ("{isDark ? <Ionicons name=\"heart-outline\" size={20} color={COLORS.gold} /> : (", "{legacy ? <Ionicons name=\"heart-outline\" size={20} color={COLORS.gold} /> : ("),
]
for a, b in pairs:
    assert a in t, a[:90]
    t = t.replace(a, b, 1)
t = t.replace("!isDark && s.v7Tile", "s.v7Tile")
t = t.replace("size={isDark ? 16 : 20} color={isDark ? txt : acc} />", "size={20} color={acc} />")
t = t.replace("backgroundColor: '#ECEEF3', overflow: 'hidden' }}>", "backgroundColor: dl.track, overflow: 'hidden' }}>")
t = t.replace("<Ionicons key={i} name=\"star\" size={20} color=\"#E5E7EB\" />", "<Ionicons key={i} name=\"star\" size={20} color={isDark ? 'rgba(255,255,255,0.2)' : '#E5E7EB'} />")
open(p, 'w', encoding='utf8').write(t)
print('ok')
