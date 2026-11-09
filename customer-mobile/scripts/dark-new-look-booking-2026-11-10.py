"""Dark mode gets the new In-Campus Booking look (owner, 10 Nov 2026) on the dark diet tokens."""
B = 'modules/campusBooking/'

def patch(f, pairs):
    p = B + f
    t = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert a in t, (f, a[:80])
        t = t.replace(a, b)
    open(p, 'w', encoding='utf8').write(t)
    print('patched', f)

patch('cbTheme.ts', [
    ("    page: isDark ? COLORS.bgDark : d.page,\n    card: isDark ? COLORS.bgCard : '#FFFFFF',\n    border: isDark ? COLORS.borderDark : COLORS.borderLight,",
     "    page: d.page,\n    card: d.card,\n    border: isDark ? d.edge : COLORS.borderLight,"),
    ("    accent: isDark ? COLORS.gold : d.acc,\n    accentSoft: isDark ? 'rgba(212,175,122,0.10)' : d.soft,\n    openInk: isDark ? '#6FBF8B' : d.acc,\n    closedInk: isDark ? '#E08A84' : '#6B7280',",
     "    accent: d.acc,\n    accentSoft: d.soft,\n    openInk: d.acc,\n    closedInk: d.muteInk,"),
])
patch('cbKit.tsx', [
    ("borderColor: p.isDark ? tint : 'rgba(0,0,0,0.06)' }]}>", "borderColor: p.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>"),
    ("{ backgroundColor: p.isDark ? 'rgba(239,79,95,0.10)' : '#FFFFFF', borderColor: p.isDark ? tint : 'rgba(0,0,0,0.08)' }", "{ backgroundColor: p.card, borderColor: p.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)' }"),
    ("  if (!p.isDark) {\n    const closed", "  if (true) {\n    const closed"),
    ("backgroundColor: bad ? '#FEECEC' : closed ? '#F2F3F6' : p.accentSoft", "backgroundColor: bad ? (p.isDark ? 'rgba(239,68,68,0.15)' : '#FEECEC') : closed ? (p.isDark ? 'rgba(255,255,255,0.08)' : '#F2F3F6') : p.accentSoft"),
    ("color: bad ? '#B42318' : closed ? '#4B5160' : p.accent", "color: bad ? (p.isDark ? '#FCA5A5' : '#B42318') : closed ? p.closedInk : p.accent"),
    ("  if (!p.isDark) {\n    return (\n      <View style={[k.noticeBar", "  if (true) {\n    return (\n      <View style={[k.noticeBar"),
    ("style={[k.placeBtn, { backgroundColor: p.accent, shadowColor: p.accent,", "style={[k.placeBtn, { backgroundColor: p.accent, shadowColor: p.accent,"),
])
patch('CbOrdersSection.tsx', [
    ("        if (!p.isDark) {", "        if (true) {"),
    ("backgroundColor: liveB ? p.accentSoft : '#F2F3F6' }}>", "backgroundColor: liveB ? p.accentSoft : (p.isDark ? 'rgba(255,255,255,0.08)' : '#F2F3F6') }}>"),
    ("color: liveB ? accent : '#4B5160' }}>{b.statusLabel}", "color: liveB ? accent : p.closedInk }}>{b.statusLabel}"),
    ("<Text style={{ color: '#FFFFFF', fontSize: 13.5, fontWeight: '800' }}>{proofDue", "<Text style={{ color: p.isDark && p.accent === '#4ADE80' ? '#052E16' : '#FFFFFF', fontSize: 13.5, fontWeight: '800' }}>{proofDue"),
])
patch('CbOrder.tsx', [
    ("  const gold = p.isDark ? COLORS.gold : p.accent;", "  const gold = p.accent;"),
    ("      {p.isDark ? (\n        <CbHeader", "      {false ? (\n        <CbHeader"),
    ("        {!p.isDark && b.status !== 'CANCELLED' ? (() => {", "        {b.status !== 'CANCELLED' ? (() => {"),
    ("        {live && b.pickupCode && p.isDark ? (", "        {false && live && b.pickupCode ? ("),
    ("        {live && !ready && b.estimatedReadyAt && p.isDark ? (", "        {false && live && !ready && b.estimatedReadyAt ? ("),
    ("        {b.status !== 'CANCELLED' && p.isDark ? (", "        {false && b.status !== 'CANCELLED' ? ("),
    ("<View style={[s.actionRow, !p.isDark && { display: 'none' }]}>", "<View style={[s.actionRow, { display: 'none' }]}>"),
])
c = open(B + 'CbOrder.tsx', encoding='utf8').read()
c = c.replace("!p.isDark && s.cardLabelCaps", "s.cardLabelCaps")
c = c.replace("borderColor: p.isDark ? p.border : 'rgba(17,17,26,0.06)'", "borderColor: p.border")
c = c.replace("s.v7Card, { borderColor: 'rgba(17,17,26,0.06)' }", "s.v7Card, { backgroundColor: p.card, borderColor: p.border }")
c = c.replace("s.v7Tile, { borderColor: 'rgba(17,17,26,0.06)' }", "s.v7Tile, { backgroundColor: p.card, borderColor: p.border }")
c = c.replace("backgroundColor: '#ECEEF3', overflow: 'hidden' }}>", "backgroundColor: p.isDark ? 'rgba(255,255,255,0.12)' : '#ECEEF3', overflow: 'hidden' }}>")
open(B + 'CbOrder.tsx', 'w', encoding='utf8').write(c)
s = open(B + 'CbStall.tsx', encoding='utf8').read()
s = s.replace("p.isDark ? p.border : 'rgba(17,17,26,0.06)'", "p.border").replace("p.isDark ? p.border : 'rgba(17,17,26,0.07)'", "p.border")
open(B + 'CbStall.tsx', 'w', encoding='utf8').write(s)
print('done')
