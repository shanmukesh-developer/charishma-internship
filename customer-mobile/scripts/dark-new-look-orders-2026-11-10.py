"""Dark mode gets the new Orders look (owner, 10 Nov 2026) on the dark diet tokens."""
p = 'app/(tabs)/orders.tsx'
t = open(p, encoding='utf8').read()
pairs = [
    ("  const bg = isDark ? colors.bg : d.pageDeep;\n  const cardBg = isDark ? colors.card : 'rgba(255,255,255,0.74)';\n  const lift = isDark\n    ? surfaceLift(isDark)\n",
     "  const bg = d.pageDeep;\n  const cardBg = isDark ? d.card : 'rgba(255,255,255,0.74)';\n  const lift = isDark\n    ? { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 3 }\n"),
    ("  const border = isDark ? colors.border : 'rgba(255,255,255,0.95)';\n  const goldColor = isDark ? COLORS.gold : d.acc;",
     "  const border = isDark ? d.edge : 'rgba(255,255,255,0.95)';\n  const goldColor = d.acc;"),
    ("    if (s === 'Delivered') return isDark ? COLORS.emerald : txtSec;\n    if (s === 'Cancelled') return isDark ? '#EF4444' : txtSec;",
     "    if (s === 'Delivered') return txtSec;\n    if (s === 'Cancelled') return txtSec;"),
    ("<View style={[st.container, { paddingTop: isDark ? topPad : 0, backgroundColor: bg }]}>\n      {isDark ? <AmbientBackground /> : null}",
     "<View style={[st.container, { paddingTop: 0, backgroundColor: bg }]}>"),
    ("<View style={isDark ? undefined : { backgroundColor: d.top,", "<View style={{ backgroundColor: d.top,"),
    ("{ color: isDark ? txt : d.dk, paddingHorizontal: 0, marginBottom: 0 }]}>Your orders", "{ color: d.dk, paddingHorizontal: 0, marginBottom: 0 }]}>Your orders"),
    ("<View style={[st.filterRow, !isDark && {", "<View style={[st.filterRow, {"),
    ("borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.65)' }]}>", "borderRadius: 16, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.65)' }]}>"),
    ("backgroundColor: isDark ? (isActive ? goldColor : 'rgba(255,255,255,0.05)') : (isActive ? '#FFFFFF' : 'transparent'),\n                    borderColor: isDark ? (isActive ? 'transparent' : border) : 'transparent'",
     "backgroundColor: isActive ? d.card : 'transparent',\n                    borderColor: 'transparent'"),
    ("                  !isDark && { flex: 1, alignItems: 'center', paddingHorizontal: 4 },\n                  !isActive && isDark && surfaceLift(isDark, true),\n                  isActive && !isDark && {",
     "                  { flex: 1, alignItems: 'center', paddingHorizontal: 4 },\n                  isActive && {"),
    ("{ color: isDark ? (isActive ? '#000' : txtSec) : isActive ? d.acc : d.dk }", "{ color: isActive ? d.acc : d.dk }"),
    ("cardBg={isDark ? 'rgba(255,255,255,0.05)' : cardBg}", "cardBg={cardBg}"),
    ("{ backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : cardBg, borderColor: border }, lift]}>\n            <Ionicons name=\"search-outline\"", "{ backgroundColor: cardBg, borderColor: border }, lift]}>\n            <Ionicons name=\"search-outline\""),
    ("(isDark ? 0 : Number(isActiveStatus(b.status)) - Number(isActiveStatus(a.status)))", "(Number(isActiveStatus(b.status)) - Number(isActiveStatus(a.status)))"),
    ("const headingHere = !isDark && (idx === 0", "const headingHere = (idx === 0"),
    ("              {isDark ? (\n", "              {false ? (\n"),
    ("backgroundColor: liveO ? dl.soft : '#F2F3F6' }]}>", "backgroundColor: liveO ? dl.soft : dl.mute }]}>"),
    ("size={12} color=\"#4B5160\" />", "size={12} color={dl.muteInk} />"),
    ("color: liveO ? goldColor : '#4B5160' }}>{statusLabel(o.status)}", "color: liveO ? goldColor : dl.muteInk }}>{statusLabel(o.status)}"),
    ("{!isDark && o.status !== 'Delivered' && o.status !== 'Cancelled' && !isExpanded ? (() => {", "{o.status !== 'Delivered' && o.status !== 'Cancelled' && !isExpanded ? (() => {"),
    ("height: 4, borderRadius: 3, backgroundColor: '#ECEEF3', overflow: 'hidden' }}>", "height: 4, borderRadius: 3, backgroundColor: dl.track, overflow: 'hidden' }}>"),
    ("<Text style={{ color: '#FFFFFF', fontSize: 13.5, fontWeight: '800' }}>Track order</Text>", "<Text style={{ color: dl.onAcc, fontSize: 13.5, fontWeight: '800' }}>Track order</Text>"),
    ("{!isDark && (o.status === 'Delivered' || o.status === 'Cancelled') && !isExpanded ? (", "{(o.status === 'Delivered' || o.status === 'Cancelled') && !isExpanded ? ("),
    ("{isDark && o.status !== 'Delivered' && o.status !== 'Cancelled' && !isExpanded && (", "{false && o.status !== 'Delivered' && o.status !== 'Cancelled' && !isExpanded && ("),
    ("{isDark && needsRating && !isExpanded && (", "{false && needsRating && !isExpanded && ("),
    ("color: isDark ? COLORS.emerald : goldColor, fontWeight: '600', flex: 1", "color: goldColor, fontWeight: '600', flex: 1"),
    ("color: isDark ? COLORS.emerald : goldColor, fontWeight: '700' }}>{formatINR(-Math.abs", "color: goldColor, fontWeight: '700' }}>{formatINR(-Math.abs"),
    ("colors={isDark ? ['#D4AF7A', '#F0D9A8'] : [goldColor, goldColor]}", "colors={[goldColor, goldColor]}"),
    ("<Text style={[st.trackBtnText, !isDark && { color: '#FFFFFF' }]}>Track order</Text>", "<Text style={[st.trackBtnText, { color: dl.onAcc }]}>Track order</Text>"),
    ("colors={isDark ? ['#EF4F5F', '#FF6B7B'] : [goldColor, goldColor]}", "colors={[goldColor, goldColor]}"),
    ("{ backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : cardBg, borderColor: border }, lift]}\n            onPress={loadOlderOrders}", "{ backgroundColor: cardBg, borderColor: border }, lift]}\n            onPress={loadOlderOrders}"),
]
for a, b in pairs:
    assert a in t, a[:90]
    t = t.replace(a, b, 1)
# the rating row / soft buttons used light glass
t = t.replace("borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.6)', marginBottom: 10 }}", "borderRadius: 14, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.6)', marginBottom: 10 }}")
t = t.replace("{[0, 1, 2, 3, 4].map((i) => <Ionicons key={i} name=\"star\" size={18} color=\"#E5E7EB\" />)}", "{[0, 1, 2, 3, 4].map((i) => <Ionicons key={i} name=\"star\" size={18} color={isDark ? 'rgba(255,255,255,0.2)' : '#E5E7EB'} />)}")
open(p, 'w', encoding='utf8').write(t)
print('ok')
