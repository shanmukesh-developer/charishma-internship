"""Booking tracking + status badges + orders discounts -> diet accent (owner, 10 Nov 2026: "we have updated all this").
Light mode only: gold pickup code, dots, lines, icons -> diet accent; StatusTag = soft accent pill (live) or grey
(closed / cancelled), red kept only for rejected; Orders' discount lines and live dot -> accent. Run once."""
B = 'modules/campusBooking/'

def patch(p, pairs):
    t = open(p, encoding='utf8').read()
    for old, new in pairs:
        n = t.count(old)
        assert n, (p, old[:80])
        t = t.replace(old, new)
    open(p, 'w', encoding='utf8').write(t)
    print('patched', p)

patch(B + 'CbOrder.tsx', [
    ("borderColor: ready ? COLORS.gold : p.border", "borderColor: ready ? gold : p.border"),
    ("size={18} color={COLORS.gold} />", "size={18} color={gold} />"),
    ('<Ionicons name="time-outline" size={20} color={COLORS.gold} />', '<Ionicons name="time-outline" size={20} color={gold} />'),
    ("step.done ? { backgroundColor: COLORS.gold }", "step.done ? { backgroundColor: gold }"),
    ("b.timeline[i + 1].done ? COLORS.gold : pendingColor", "b.timeline[i + 1].done ? gold : pendingColor"),
    ("color: isCurrent ? COLORS.gold : step.done ? p.txt : p.txtSec", "color: isCurrent ? gold : step.done ? p.txt : p.txtSec"),
    ("<TouchableOpacity style={[s.pinButton, ready && { paddingVertical: 18 }]}", "<TouchableOpacity style={[s.pinButton, { backgroundColor: gold, shadowColor: gold }, ready && { paddingVertical: 18 }]}"),
    ("<View style={s.dotInner} />", "<View style={[s.dotInner, { backgroundColor: gold }]} />"),
    ("<Text style={s.zoomTitle}>Pickup code</Text>", "<Text style={[s.zoomTitle, { color: gold }]}>Pickup code</Text>"),
    ("<View style={s.zoomPinDisplay}>", "<View style={[s.zoomPinDisplay, { backgroundColor: gold, shadowColor: gold }]}>"),
    ("  const ready = b.status === 'READY';", "  const ready = b.status === 'READY';\n  // Owner, 10 Nov 2026: the gold of this screen follows the diet accent in light mode.\n  const gold = p.isDark ? COLORS.gold : p.accent;"),
])
# white code text on the accent button in light mode
t = open(B + 'CbOrder.tsx', encoding='utf8').read()
import re
for name in ['pinText', 'zoomPinText', 'pinButtonText']:
    m = re.search(r"\n  %s: \{[^}]*color: '#000'" % name, t)
    if m:
        t = t[:m.end() - 6] + "'#FFF'" + t[m.end():]
        print('white', name)
open(B + 'CbOrder.tsx', 'w', encoding='utf8').write(t)

patch(B + 'cbKit.tsx', [
    ("""export function StatusTag({ status, label }: { status: CbStatus; label: string }) {
""", """export function StatusTag({ status, label }: { status: CbStatus; label: string }) {
  const p = useCbTheme();
  // Light mode (owner, 10 Nov 2026): one diet accent for live steps, grey for closed ones, red only when rejected.
  if (!p.isDark) {
    const closed = status === 'COMPLETED' || status === 'CANCELLED' || (status as string) === 'EXPIRED';
    const bad = status === 'REJECTED';
    return (
      <View style={[k.statusBadge, { backgroundColor: bad ? '#FEECEC' : closed ? '#F2F3F6' : p.accentSoft }]}>
        <Text style={[k.statusBadgeText, { color: bad ? '#B42318' : closed ? '#4B5160' : p.accent }]} numberOfLines={1}>{label}</Text>
      </View>
    );
  }
"""),
])

patch('app/(tabs)/orders.tsx', [
    ("<View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981' }} />", "<View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isDark ? '#10B981' : goldColor }} />"),
    ("<Text style={{ fontSize: 12, color: COLORS.emerald, fontWeight: '600', flex: 1, marginRight: 8 }}", "<Text style={{ fontSize: 12, color: isDark ? COLORS.emerald : goldColor, fontWeight: '600', flex: 1, marginRight: 8 }}"),
    ("<Text style={{ fontSize: 12, color: COLORS.emerald, fontWeight: '700' }}>{formatINR(-Math.abs", "<Text style={{ fontSize: 12, color: isDark ? COLORS.emerald : goldColor, fontWeight: '700' }}>{formatINR(-Math.abs"),
    ("const color = b.status === 'COMPLETED' ? COLORS.emerald : b.status === 'CANCELLED' ? '#EF4444' : goldColor;", "const color = b.status === 'COMPLETED' ? (isDark ? COLORS.emerald : txtSec) : b.status === 'CANCELLED' ? (isDark ? '#EF4444' : txtSec) : goldColor;"),
])
