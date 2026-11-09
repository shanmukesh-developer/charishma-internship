"""Order cards -> replica card (owner, 10 Nov 2026), light mode: store photo (or a storefront tile), store name big,
"items · date · ORDER ID" in one quiet line, status as a pill (soft accent + pulse dot while live, grey ✓/✕ when done),
amount on the right with the payment under it. Dark mode keeps the old card header. Data unchanged."""
p = 'app/(tabs)/orders.tsx'
t = open(p, encoding='utf8').read()
assert 'orderCardReplica' not in t
start = t.index("              <View style={st.cardHeader}>")
end_marker = "              {/* Quick 1-Tap Track Strip on Active Orders */}"
end = t.index(end_marker, start)
old_header = t[start:end]
new_header = """              {isDark ? (
""" + "\n".join("  " + ln if ln.strip() else ln for ln in old_header.rstrip('\n').split('\n')) + """
              ) : (
                // orderCardReplica (owner, 10 Nov 2026)
                <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                  {(() => {
                    const img = o.restaurant?.image || o.restaurant?.imageUrl || o.restaurant?.logo || o.restaurantImage || null;
                    return img ? (
                      <Image source={{ uri: String(img) }} style={st.cardImg} />
                    ) : (
                      <View style={[st.cardImg, { backgroundColor: dl.soft, alignItems: 'center', justifyContent: 'center' }]}>
                        <Ionicons name="storefront-outline" size={22} color={goldColor} />
                      </View>
                    );
                  })()}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[st.restaurantName, { color: txt, fontSize: 16 }]} numberOfLines={1}>{restaurantName}</Text>
                    <Text style={{ fontSize: 12, color: txtSec, marginTop: 1 }} numberOfLines={1}>{[plural(orderItems.length, 'item'), formatISTDate(o.createdAt), `#${id}`].filter(Boolean).join(' · ')}</Text>
                    {!!orderSlotLabel(o) && o.status !== 'Cancelled' ? (
                      <Text style={{ fontSize: 12, color: txt, fontWeight: '700', marginTop: 2 }} numberOfLines={1}>Delivery: {orderSlotLabel(o)}</Text>
                    ) : null}
                    {(() => {
                      const liveO = o.status !== 'Delivered' && o.status !== 'Cancelled';
                      return (
                        <View style={[st.statusPill, { backgroundColor: liveO ? dl.soft : '#F2F3F6' }]}>
                          {liveO ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: goldColor }} /> : (
                            <Ionicons name={o.status === 'Delivered' ? 'checkmark' : 'close'} size={12} color="#4B5160" />
                          )}
                          <Text style={{ fontSize: 11.5, fontWeight: '800', color: liveO ? goldColor : '#4B5160' }}>{statusLabel(o.status)}</Text>
                        </View>
                      );
                    })()}
                  </View>
                  <View style={{ alignItems: 'flex-end', alignSelf: 'flex-start' }}>
                    <Text style={[st.price, { color: txt }]}>{formatINR(charged)}</Text>
                    {paymentLabel ? <Text style={{ fontSize: 11, color: txtSec, marginTop: 2 }} numberOfLines={1}>{o.paymentMethod === 'COD' ? 'Cash on delivery' : 'ZenWe Wallet'}</Text> : null}
                  </View>
                </View>
              )}

"""
t = t[:start] + new_header + t[end:]
t = t.replace("  const goldColor = isDark ? COLORS.gold : d.acc;", "  const goldColor = isDark ? COLORS.gold : d.acc;\n  const dl = d;", 1)
t = t.replace("  card: { marginHorizontal: 16,", "  cardImg: { width: 54, height: 54, borderRadius: 16, backgroundColor: '#F3EDE4' },\n  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, marginTop: 7 },\n  card: { marginHorizontal: 16,", 1)
if "Image," not in t.split("from 'react-native'")[0]:
    t = t.replace("import { View, Text, StyleSheet, ScrollView,", "import { Image, View, Text, StyleSheet, ScrollView,", 1)
open(p, 'w', encoding='utf8').write(t)
print('ok')
