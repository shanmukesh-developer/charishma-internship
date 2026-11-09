"""Orders = the owner's chosen replica card (owner, 10 Nov 2026 screenshot), light mode:
- "On the way · N active" / "Earlier · N orders" headings; active orders first.
- order line "Order #ZEN-64 · 1 item · 7 Nov".
- In-Campus bookings as the same card: stall logo, name + Pickup tag, "Booking #REF · items · time", status pill,
  amount + Paid by UPI, the pickup code box, a full accent View booking (or Pay the stall) button. Dark unchanged."""
import re
O = 'app/(tabs)/orders.tsx'
t = open(O, encoding='utf8').read()
assert 'onTheWayHeading' not in t

def rep(old, new):
    global t
    assert old in t, old[:90]
    t = t.replace(old, new, 1)

rep("""          return true;
        }).slice(0, orderLimit).map((o, idx) => {
          const id = orderCode(o);""", """          return true;
        }).sort((a, b) => (isDark ? 0 : Number(isActiveStatus(b.status)) - Number(isActiveStatus(a.status)))).slice(0, orderLimit).map((o, idx, arr) => {
          const id = orderCode(o);
          // onTheWayHeading (owner, 10 Nov 2026): "On the way" above the live orders, "Earlier" above the rest.
          const liveHere = isActiveStatus(o.status);
          const headingHere = !isDark && (idx === 0 || isActiveStatus(arr[idx - 1].status) !== liveHere)
            ? (liveHere ? { title: 'On the way', count: `${arr.filter((x) => isActiveStatus(x.status)).length} active` } : { title: 'Earlier', count: `${arr.filter((x) => !isActiveStatus(x.status)).length} orders` })
            : null;""")
rep("""            <StaggeredSection key={o._id || o.id} delay={Math.min(idx % 10, 6) * 60} direction="up">""",
    """            <StaggeredSection key={o._id || o.id} delay={Math.min(idx % 10, 6) * 60} direction="up">
              {headingHere ? (
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginHorizontal: 18, marginTop: idx === 0 ? 4 : 10, marginBottom: 10 }}>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: txt }}>{headingHere.title}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: goldColor }}>{headingHere.count}</Text>
                </View>
              ) : null}""")
rep("{[plural(orderItems.length, 'item'), formatISTDate(o.createdAt), `#${id}`].filter(Boolean).join(' · ')}",
    "{[`Order #${id}`, plural(orderItems.length, 'item'), formatISTDate(o.createdAt)].filter(Boolean).join(' · ')}")
rep("<Text style={{ fontSize: 12, color: txtSec, marginTop: 1 }} numberOfLines={1}>{[`Order #${id}`",
    "<Text style={{ fontSize: 12, color: txtSec, marginTop: 1 }} numberOfLines={2}>{[`Order #${id}`")
open(O, 'w', encoding='utf8').write(t)
print('orders ok')

# ---- booking cards ----
C = 'modules/campusBooking/CbOrdersSection.tsx'
c = open(C, encoding='utf8').read()
assert 'replicaBookingCard' not in c
c = c.replace("import { inr } from './cbTheme';", "import { inr, timeIST, useCbTheme } from './cbTheme';\nimport { Image } from 'react-native';\nimport { resolveMediaUrl } from '../../utils/imageUpload';", 1)
c = c.replace("  const [all, setAll] = useState<CbBooking[]>([]);", "  const [all, setAll] = useState<CbBooking[]>([]);\n  const p = useCbTheme();", 1)
old = """        return (
          <TouchableOpacity
            key={b.id}
            activeOpacity={0.92}"""
new = """        if (!p.isDark) {
          // replicaBookingCard (owner, 10 Nov 2026): same card as the delivery orders.
          const liveB = isOpenStatus(b.status);
          const img = resolveMediaUrl(b.stall?.imageUrl || '') || null;
          const open_ = () => router.push((proofDue ? `/campus-booking/pay/${b.id}` : `/campus-booking/order/${b.id}`) as any);
          return (
            <TouchableOpacity key={b.id} activeOpacity={0.95} onPress={open_} style={[st.rCard, { backgroundColor: cardBg, borderColor: border }, lift]}
              accessibilityLabel={`In-Campus booking ${b.ref} at ${b.stall?.name || 'a campus stall'}, ${b.statusLabel}${code ? `, pickup code ${code.split('').join(' ')}` : ''}. Open`}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                {img ? (
                  <View style={st.rImg}><Image source={{ uri: img }} style={{ width: '100%', height: '100%' }} resizeMode="contain" /></View>
                ) : (
                  <View style={[st.rImg, { backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="storefront-outline" size={22} color={accent} /></View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: txt, flexShrink: 1 }} numberOfLines={1}>{b.stall?.name || 'Campus stall'}</Text>
                    <View style={{ backgroundColor: p.accentSoft, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}><Text style={{ fontSize: 10.5, fontWeight: '800', color: accent }}>Pickup</Text></View>
                  </View>
                  <Text style={{ fontSize: 12, color: txtSec, marginTop: 1 }} numberOfLines={2}>{`Booking #${b.ref} · ${b.itemCount} item${b.itemCount === 1 ? '' : 's'}${b.createdAt ? ` · ${timeIST(b.createdAt)}` : ''}`}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, marginTop: 7, backgroundColor: liveB ? p.accentSoft : '#F2F3F6' }}>
                    {liveB ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent }} /> : null}
                    <Text style={{ fontSize: 11.5, fontWeight: '800', color: liveB ? accent : '#4B5160' }}>{b.statusLabel}</Text>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', alignSelf: 'flex-start' }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: txt, marginTop: 4 }}>{inr(b.amount)}</Text>
                  <Text style={{ fontSize: 11, color: txtSec, marginTop: 2 }}>{b.paymentVerified ? 'Paid by UPI' : 'Pay by UPI'}</Text>
                </View>
              </View>
              {code ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: p.accentSoft }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11.5, color: txt, opacity: 0.8 }}>Pickup code</Text>
                    <Text style={{ fontSize: 11.5, color: txt, opacity: 0.8 }} numberOfLines={1}>{`Show it at the ${b.stall?.name || 'stall'} counter`}</Text>
                  </View>
                  <Text style={{ fontSize: 24, fontWeight: '900', letterSpacing: 5, color: accent }}>{code}</Text>
                </View>
              ) : !liveB ? (
                <Text style={{ fontSize: 12, color: txtSec, marginTop: 10 }} numberOfLines={2}>{nextStep(b)}</Text>
              ) : null}
              {liveB ? (
                <View style={{ marginTop: 12, backgroundColor: accent, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}>
                  <Text style={{ color: '#FFFFFF', fontSize: 13.5, fontWeight: '800' }}>{proofDue ? `Pay the stall · ${inr(b.amount)}` : 'View booking'}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        }
        return (
          <TouchableOpacity
            key={b.id}
            activeOpacity={0.92}"""
assert old in c
c = c.replace(old, new, 1)
c = c.replace("  card: { flexDirection: 'row',", "  rCard: { borderRadius: 22, borderWidth: 1, padding: 16, marginBottom: 14 },\n  rImg: { width: 54, height: 54, borderRadius: 16, backgroundColor: '#111', overflow: 'hidden' },\n  card: { flexDirection: 'row',", 1)
c = c.replace("import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';\n", "import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';\n", 1)
c = c.replace("import { inr, timeIST, useCbTheme } from './cbTheme';\nimport { Image } from 'react-native';", "import { inr, timeIST, useCbTheme } from './cbTheme';", 1)
c = c.replace("import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';", "import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';", 1)
open(C, 'w', encoding='utf8').write(c)
print('bookings ok')
