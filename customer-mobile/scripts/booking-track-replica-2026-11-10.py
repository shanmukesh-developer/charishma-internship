"""Booking tracking -> the approved replica's "Your order" screen (owner, 10 Nov 2026), light mode:
light diet header band ("Your order" + stall · pickup at the counter + status pill), a dashed ticket card with the big
spaced pickup code ("Show this at the counter", tap to copy, Enlarge), the ready time as one soft pill, uppercase
section labels, softer cards, current step with a soft halo. All data and actions unchanged; dark mode unchanged."""
p = 'modules/campusBooking/CbOrder.tsx'
t = open(p, encoding='utf8').read()
assert 'ticketCard' not in t

def rep(old, new):
    global t
    assert old in t, old[:90]
    t = t.replace(old, new, 1)

# header
rep("""      <CbHeader title={ready ? 'Order ready' : 'Order tracking'} sub={`Booking ${b.ref} · ${stallName}`} onBack={back} right={<StatusTag status={b.status} label={b.statusLabel} />} />""",
"""      {p.isDark ? (
        <CbHeader title={ready ? 'Order ready' : 'Order tracking'} sub={`Booking ${b.ref} · ${stallName}`} onBack={back} right={<StatusTag status={b.status} label={b.statusLabel} />} />
      ) : (
        <View style={[s.band, { backgroundColor: d.top, paddingTop: topPad + 8 }]}>
          <TouchableOpacity onPress={back} style={s.bandBack} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={20} color={d.dk} />
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.bandTitle, { color: d.dk }]} numberOfLines={1} accessibilityRole="header">{ready ? 'Order ready' : 'Your order'}</Text>
            <Text style={{ fontSize: 12, color: d.dk, opacity: 0.7 }} numberOfLines={1}>{`${stallName} · pickup at the counter · ${b.ref}`}</Text>
          </View>
          <StatusTag status={b.status} label={b.statusLabel} />
        </View>
      )}""")

# pickup code: ticket card in light mode
rep("""        {/* Pickup code (Delivery PIN card style) */}
        {live && b.pickupCode ? (""", """        {/* Pickup code: the replica's ticket card in light mode */}
        {live && b.pickupCode && !p.isDark ? (
          <StaggeredSection delay={0} direction="up">
            <TouchableOpacity activeOpacity={0.9} onPress={copyCode} style={[s.ticketCard, { borderColor: p.accent }]} accessibilityRole="button" accessibilityLabel={`Pickup code ${b.pickupCode.split('').join(' ')}. Tap to copy`}>
              <Text style={{ fontSize: 12, color: p.txtSec }}>{ready ? 'Your order is ready · pickup code' : 'Pickup code'}</Text>
              <Text style={[s.ticketCode, { color: p.accent }]}>{b.pickupCode}</Text>
              <Text style={{ fontSize: 12, color: p.txtSec }}>{copied ? 'Copied' : ready ? `Show this at ${stallName}'s counter` : 'Show this at the counter'}</Text>
              <TouchableOpacity onPress={() => setZoom(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Enlarge the pickup code">
                <Text style={{ fontSize: 12.5, fontWeight: '800', color: p.accent, marginTop: 8 }}>Enlarge</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </StaggeredSection>
        ) : null}
        {live && b.pickupCode && p.isDark ? (""")

# ready time: soft pill in light mode
rep("""        {live && !ready && b.estimatedReadyAt ? (
          <View style={[s.waitBox, { backgroundColor: p.card, borderColor: p.border }]}>""", """        {live && !ready && b.estimatedReadyAt && !p.isDark ? (
          <View style={[s.etaPill, { backgroundColor: p.accentSoft }]}>
            <Ionicons name="time-outline" size={14} color={p.accent} />
            <Text style={{ fontSize: 12.5, fontWeight: '800', color: p.accent }}>{minsToReady !== null && minsToReady > 0 ? `Ready in about ${minsToReady} min` : `Should be ready about now · ${timeIST(b.estimatedReadyAt)}`}</Text>
          </View>
        ) : null}
        {live && !ready && b.estimatedReadyAt && p.isDark ? (
          <View style={[s.waitBox, { backgroundColor: p.card, borderColor: p.border }]}>""")

# current step halo, accent ring
rep("isCurrent ? { backgroundColor: p.card, borderWidth: 2, borderColor: COLORS.gold }",
    "isCurrent ? { backgroundColor: p.card, borderWidth: 2, borderColor: gold, ...(p.isDark ? null : { shadowColor: gold, shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }) }")
rep("{ backgroundColor: pendingColor }]}>", "(p.isDark ? { backgroundColor: pendingColor } : { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#D9DBE3' })]}>")

# section labels + softer card edges in light mode
t = t.replace("<Text style={[s.cardLabel, { color: p.txtSec }]}>", "<Text style={[s.cardLabel, { color: p.txtSec }, !p.isDark && s.cardLabelCaps]}>")
t = t.replace("[s.timelineCard, { backgroundColor: p.card, borderColor: p.border }]", "[s.timelineCard, { backgroundColor: p.card, borderColor: p.isDark ? p.border : 'rgba(17,17,26,0.06)' }]")

# hooks + styles
rep("export default function CbOrder({ id }: { id: string }) {\n", "export default function CbOrder({ id }: { id: string }) {\n  const d = useDietLight();\n  const topPad = useTopInset();\n")
rep("const s = StyleSheet.create({\n", """const s = StyleSheet.create({
  band: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 16, borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  bandBack: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  bandTitle: { fontSize: 18, fontWeight: '800' },
  ticketCard: { alignItems: 'center', paddingVertical: 18, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1.5, borderStyle: 'dashed', backgroundColor: '#FFFFFF', marginBottom: 12 },
  ticketCode: { fontSize: 36, fontWeight: '900', letterSpacing: 9, marginVertical: 4 },
  etaPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, marginBottom: 14 },
  cardLabelCaps: { textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 11.5, fontWeight: '800' },
""")
imports = "import { useDietLight } from '../../components/local/dietLightTheme';\nimport { useTopInset } from '../../utils/useTopInset';\n"
i = t.index("import ")
t = t[:i] + imports + t[i:]
open(p, 'w', encoding='utf8').write(t)
print('ok')
