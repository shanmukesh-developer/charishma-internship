"""In-Campus Booking -> approved counter-page replica (owner, 10 Nov 2026: "Yes, shift it"). Light mode only.
- cbTheme: page / accent / soft follow the diet (useDietLight); every booking screen picks this up.
- cbKit: Add button + stepper = soft accent pill with white round - / + ; Place button = accent; notice bars = soft
  accent tint (no orange / indigo); header on the light diet band.
- CbStall: info card = name, "Category · place", one status line (open in accent, closed grey), a 3-fact row
  (Ready in prep..prep+15 min · Pickup at the counter · UPI pay the stall), description folded to 2 lines with
  Read more; the orange badge, time/place line and FSSAI line leave the card (FSSAI stays in About); one quiet
  "Show your pickup code at the counter" line instead of the two notices; tabs, prices, chips, cart bar in accent.
- Cart / Pay / Order: decorative reds -> accent (errors stay red). Run once."""
import re
B = 'modules/campusBooking/'

def patch(f, pairs):
    p = B + f
    t = open(p, encoding='utf8').read()
    for old, new in pairs:
        assert old in t, (f, old[:80])
        t = t.replace(old, new)
    open(p, 'w', encoding='utf8').write(t)
    print('patched', f)

# ---------- theme ----------
patch('cbTheme.ts', [
    ("import { useTheme } from '../../context/ThemeContext';",
     "import { useTheme } from '../../context/ThemeContext';\nimport { useDietLight } from '../../components/local/dietLightTheme';"),
    ("  const { isDark } = useTheme();\n  return {\n    isDark,\n    page: isDark ? COLORS.bgDark : COLORS.bgLight,",
     "  const { isDark } = useTheme();\n  // Owner, 10 Nov 2026: booking screens follow the diet picked on Home (light page, one accent).\n  const d = useDietLight();\n  return {\n    isDark,\n    page: isDark ? COLORS.bgDark : d.page,"),
    ("    accent: isDark ? COLORS.gold : COLORS.red,\n    accentSoft: isDark ? 'rgba(212,175,122,0.10)' : '#FFF5F6',",
     "    accent: isDark ? COLORS.gold : d.acc,\n    accentSoft: isDark ? 'rgba(212,175,122,0.10)' : d.soft,"),
    ("    openInk: isDark ? '#6FBF8B' : '#2F7D4F',\n    closedInk: isDark ? '#E08A84' : '#B4473F',",
     "    openInk: isDark ? '#6FBF8B' : d.acc,\n    closedInk: isDark ? '#E08A84' : '#6B7280',"),
])

# ---------- kit ----------
patch('cbKit.tsx', [
    ("  const tint = COLORS.red;\n  if (soldOut) {", "  const tint = p.accent;\n  if (soldOut) {"),
    ("""      <View style={[k.stepper, { backgroundColor: tint, borderColor: tint }]}>
        <TouchableOpacity style={k.stepBtn} onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={`Remove one. ${qty} in cart`}>
          <SymbolIcon name="remove" style={k.stepText} />
        </TouchableOpacity>
        <Text style={k.stepCount}>{qty}</Text>
        <TouchableOpacity style={k.stepBtn} onPress={onAdd} disabled={qty >= max} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={`Add one more. ${qty} in cart`}>
          <SymbolIcon name="add" style={[k.stepText, qty >= max && { opacity: 0.4 }]} />
        </TouchableOpacity>
      </View>""", """      // Owner, 10 Nov 2026: soft accent pill, white round - / + (same size as Add), count centred.
      <View style={[k.softStepper, { backgroundColor: p.accentSoft, borderColor: p.isDark ? tint : 'rgba(0,0,0,0.06)' }]}>
        <TouchableOpacity style={k.softStepBtn} onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={`Remove one. ${qty} in cart`}>
          <Ionicons name="remove" size={15} color={tint} />
        </TouchableOpacity>
        <Text style={[k.stepCount, { color: tint, fontSize: 13 }]}>{qty}</Text>
        <TouchableOpacity style={k.softStepBtn} onPress={onAdd} disabled={qty >= max} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={`Add one more. ${qty} in cart`}>
          <Ionicons name="add" size={15} color={tint} style={qty >= max ? { opacity: 0.4 } : undefined} />
        </TouchableOpacity>
      </View>"""),
    ("<CartPressable style={[k.addBtn, closed ? { backgroundColor: '#F3F4F6', borderColor: '#9CA3AF' } : { backgroundColor: p.isDark ? 'rgba(239,79,95,0.10)' : '#FFF5F6', borderColor: tint }]} onPress={onAdd} sound=\"addToCart\">",
     "<CartPressable style={[k.addBtn, closed ? { backgroundColor: '#F3F4F6', borderColor: '#D1D5DB' } : { backgroundColor: p.isDark ? 'rgba(239,79,95,0.10)' : '#FFFFFF', borderColor: p.isDark ? tint : 'rgba(0,0,0,0.08)' }]} onPress={onAdd} sound=\"addToCart\">"),
    ("export function PlaceButton({ label, onPress, busy, busyLabel, disabled, style }: { label: string; onPress: () => void; busy?: boolean; busyLabel?: string; disabled?: boolean; style?: StyleProp<ViewStyle> }) {\n",
     "export function PlaceButton({ label, onPress, busy, busyLabel, disabled, style }: { label: string; onPress: () => void; busy?: boolean; busyLabel?: string; disabled?: boolean; style?: StyleProp<ViewStyle> }) {\n  const p = useCbTheme();\n"),
    ("      style={[k.placeBtn, { opacity: disabled && !busy ? 0.5 : 1 }, style]}",
     "      style={[k.placeBtn, { backgroundColor: p.accent, shadowColor: p.accent, opacity: disabled && !busy ? 0.5 : 1 }, style]}"),
    ("""  const c = tone === 'indigo' ? '#6366F1' : tone === 'red' ? '#EF4F5F' : tone === 'green' ? '#10B981' : '#F97316';
  const rgb = tone === 'indigo' ? '99,102,241' : tone === 'red' ? '239,79,95' : tone === 'green' ? '16,185,129' : '249,115,22';
  return (
    <View style={[k.noticeBar, { backgroundColor: `rgba(${rgb},${p.isDark ? 0.12 : 0.08})`, borderColor: `rgba(${rgb},0.3)` }, style]}>""",
     """  const c = tone === 'indigo' ? '#6366F1' : tone === 'red' ? '#EF4F5F' : tone === 'green' ? '#10B981' : '#F97316';
  const rgb = tone === 'indigo' ? '99,102,241' : tone === 'red' ? '239,79,95' : tone === 'green' ? '16,185,129' : '249,115,22';
  // Light mode (owner, 10 Nov 2026): one quiet soft-accent line, no orange / indigo boxes. Dark keeps the tones.
  if (!p.isDark) {
    return (
      <View style={[k.noticeBar, { backgroundColor: p.accentSoft, borderColor: 'transparent' }, style]}>
        <Ionicons name={icon} size={16} color={p.accent} />
        <Text style={{ flex: 1, color: p.txt, fontSize: 12.5, fontWeight: '600', lineHeight: 17 }}>{text}</Text>
      </View>
    );
  }
  return (
    <View style={[k.noticeBar, { backgroundColor: `rgba(${rgb},${p.isDark ? 0.12 : 0.08})`, borderColor: `rgba(${rgb},0.3)` }, style]}>"""),
    ("  stepper: {", "  softStepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: 84, height: 32, paddingHorizontal: 4, borderRadius: 16, borderWidth: 1, ...SHADOWS.card },\n  softStepBtn: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },\n  stepper: {"),
    ("  addBtn: { width: 72, paddingVertical: 6, borderRadius: 12,", "  addBtn: { width: 84, height: 32, borderRadius: 16,"),
])

# ---------- counter page ----------
s = open(B + 'CbStall.tsx', encoding='utf8').read()
old_card_start = s.index("        {/* Floating info card */}")
old_card_end = s.index("        {/* Menu / About */}")
new_card = """        {/* Info card (owner, 10 Nov 2026, from the approved replica): name, type · place, one status line, three
            facts, the description folded to two lines; FSSAI moved to About; one quiet pickup line. */}
        <View style={[st.floatingInfoCard, { backgroundColor: p.card, borderColor: p.isDark ? p.border : 'rgba(17,17,26,0.06)' }]}>
          {sample ? <View style={{ marginBottom: 6 }}><CbSampleTag /></View> : null}
          <Text style={[st.infoCardName, { color: p.txt }]}>{stall.name}</Text>
          <Text style={{ fontSize: 13, color: p.txtSec, fontWeight: '500' }} numberOfLines={1}>{[stall.tags?.[0] || stall.categoryLabel, stall.location].filter(Boolean).join(' · ')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: stall.isOpen ? p.accent : '#9CA3AF' }} />
            <Text style={{ fontSize: 12.5, fontWeight: '700', color: stall.isOpen ? p.accent : '#6B7280' }}>
              {stall.isOpen ? (closes ? `Open now · closes ${closes}` : 'Open now') : opens ? `Closed now · opens at ${opens}` : 'Closed now'}
            </Text>
            {stall.rating ? <Text style={{ color: p.txt, fontSize: 12, fontWeight: '700', marginLeft: 6 }}>{`★ ${stall.rating.toFixed(1)}`}</Text> : null}
          </View>
          <View style={[st.facts, { borderColor: p.isDark ? p.border : 'rgba(17,17,26,0.07)' }]}>
            {[
              [`${stall.prepMinutes}–${stall.prepMinutes + 15} min`, 'Ready in'],
              ['Pickup', 'At the counter'],
              ['UPI', 'Pay the stall'],
            ].map(([v, l], i) => (
              <View key={l} style={[st.fact, i > 0 && { borderLeftWidth: 1, borderLeftColor: p.isDark ? p.border : 'rgba(17,17,26,0.07)' }]}>
                <Text style={{ fontSize: 13.5, fontWeight: '800', color: p.txt }} numberOfLines={1}>{v}</Text>
                <Text style={{ fontSize: 11, color: p.txtSec, marginTop: 2 }} numberOfLines={1}>{l}</Text>
              </View>
            ))}
          </View>
          {stall.description ? (
            <View style={{ marginTop: 12 }}>
              <Text style={{ fontSize: 13, lineHeight: 19, color: p.txtSec }} numberOfLines={descOpen ? undefined : 2}>{stall.description}</Text>
              <TouchableOpacity onPress={() => setDescOpen((v) => !v)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} accessibilityRole="button">
                <Text style={{ fontSize: 12.5, fontWeight: '800', color: p.accent, marginTop: 3 }}>{descOpen ? 'Show less' : 'Read more'}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {sample ? (
          <NoticeBar icon="information-circle-outline" text="Sample stall. This shows what's coming to In-Campus Booking. You can't book it yet." style={{ marginHorizontal: 16, marginTop: 12 }} />
        ) : (
          <NoticeBar icon="qr-code-outline" text="Show your pickup code at the counter" style={{ marginHorizontal: 16, marginTop: 12 }} />
        )}

"""
s = s[:old_card_start] + new_card + s[old_card_end:]
for old, new in [
    ("  const [tab, setTab] = useState<'menu' | 'about'>('menu');", "  const [tab, setTab] = useState<'menu' | 'about'>('menu');\n  const [descOpen, setDescOpen] = useState(false);"),
    ("<Text style={[st.tabText, { color: tab === t ? COLORS.red : p.txtSec }]}>", "<Text style={[st.tabText, { color: tab === t ? p.accent : p.txtSec }]}>"),
    ("<View style={[st.tabBar, { backgroundColor: tab === t ? COLORS.red : 'transparent' }]} />", "<View style={[st.tabBar, { backgroundColor: tab === t ? p.accent : 'transparent' }]} />"),
    ("on && { backgroundColor: '#EF4F5F', borderColor: '#EF4F5F' }", "on && { backgroundColor: p.accent, borderColor: p.accent }"),
    ("<Text style={[st.menuItemPrice, { color: '#EF4F5F' }]}>", "<Text style={[st.menuItemPrice, { color: p.txt }]}>"),
    ("            style={st.floatingCart}\n", "            style={[st.floatingCart, { backgroundColor: p.accent, shadowColor: p.accent }]}\n"),
    ("  floatingInfoCard: {", "  facts: { flexDirection: 'row', marginTop: 14, borderWidth: 1, borderRadius: 16 },\n  fact: { flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 },\n  floatingInfoCard: {"),
    ("style={[st.menuCard, { backgroundColor: p.card, borderColor: p.border }, !m.isAvailable && { opacity: 0.6 }]}",
     "style={[st.menuCard, { backgroundColor: p.card, borderColor: p.isDark ? p.border : 'rgba(17,17,26,0.06)' }, !m.isAvailable && { opacity: 0.6 }]}"),
]:
    assert old in s, ('CbStall', old[:80])
    s = s.replace(old, new)
open(B + 'CbStall.tsx', 'w', encoding='utf8').write(s)
print('patched CbStall.tsx')

# ---------- cart / pay / order: decorative reds -> accent ----------
patch('CbCartScreen.tsx', [
    ("borderColor: COLORS.red }, { backgroundColor: p.isDark", "borderColor: p.accent }, { backgroundColor: p.isDark"),
    ('<Ionicons name="qr-code-outline" size={22} color={COLORS.red} />', '<Ionicons name="qr-code-outline" size={22} color={p.accent} />'),
    ("<Text style={[s.payCardTitle, { color: COLORS.red }]}>Pay the stall by UPI</Text>", "<Text style={[s.payCardTitle, { color: p.accent }]}>Pay the stall by UPI</Text>"),
    ("<View style={[s.radioOuter, { borderColor: COLORS.red }]}><View style={[s.radioInner, { backgroundColor: COLORS.red", "<View style={[s.radioOuter, { borderColor: p.accent }]}><View style={[s.radioInner, { backgroundColor: p.accent"),
    ('<Ionicons name="cloud-upload-outline" size={20} color={COLORS.red} />', '<Ionicons name="cloud-upload-outline" size={20} color={p.accent} />'),
    ("<Text style={{ fontSize: 22, fontWeight: '700', color: COLORS.red }}>{inr(cart.total)}</Text>", "<Text style={{ fontSize: 22, fontWeight: '700', color: p.txt }}>{inr(cart.total)}</Text>"),
    ('<Ionicons name="moon-outline" size={20} color={COLORS.red} />', '<Ionicons name="moon-outline" size={20} color={p.accent} />'),
])
patch('CbPay.tsx', [
    ("<Text style={{ fontSize: 22, fontWeight: '700', color: COLORS.red }}>{inr(b.amount)}</Text>", "<Text style={{ fontSize: 22, fontWeight: '700', color: p.txt }}>{inr(b.amount)}</Text>"),
    ("size={22} color={COLORS.red} />", "size={22} color={p.accent} />"),
    ("<Text style={[s.payCardTitle, { color: shot ? COLORS.red : p.txt }]}>", "<Text style={[s.payCardTitle, { color: shot ? p.accent : p.txt }]}>"),
])
patch('CbOrder.tsx', [
    ("color={u.tone === 'red' ? COLORS.red : COLORS.gold} />", "color={u.tone === 'red' ? COLORS.red : p.accent} />"),
])
print('done')
