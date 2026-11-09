"""Order cards -> approved Orders replica v7 (owner, 10 Nov 2026), light mode:
active: 4-step progress bar (Confirmed / Preparing / On the way / Delivered), the Delivery PIN box while a rider is
on it, a full accent "Track order" button, "Order details" toggle; delivered: "Rate this order" with gold stars
(opens the rating), Reorder / Details soft buttons; expanded buttons in the accent. Dark mode unchanged."""
p = 'app/(tabs)/orders.tsx'
t = open(p, encoding='utf8').read()
assert 'v7ProgressBar' not in t

def rep(old, new):
    global t
    assert old in t, old[:90]
    t = t.replace(old, new, 1)

rep("""              {/* Quick 1-Tap Track Strip on Active Orders */}
              {o.status !== 'Delivered' && o.status !== 'Cancelled' && !isExpanded && (""", """              {/* v7ProgressBar: the replica's live block (light mode) */}
              {!isDark && o.status !== 'Delivered' && o.status !== 'Cancelled' && !isExpanded ? (() => {
                const stage = ['Picking', 'PickedUp', 'OutForDelivery', 'ArrivedAtGate'].includes(o.status) ? 2 : ['Accepted', 'Preparing', 'ReadyForPickup'].includes(o.status) ? 1 : 0;
                const labels = ['Confirmed', 'Preparing', 'On the way', 'Delivered'];
                return (
                  <View style={{ marginTop: 14 }}>
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      {labels.map((l, i) => (
                        <View key={l} style={{ flex: 1, height: 4, borderRadius: 3, backgroundColor: '#ECEEF3', overflow: 'hidden' }}>
                          {i < stage ? <View style={{ flex: 1, backgroundColor: goldColor }} /> : i === stage ? <View style={{ width: '50%', height: '100%', backgroundColor: goldColor }} /> : null}
                        </View>
                      ))}
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                      {labels.map((l, i) => <Text key={l} style={{ fontSize: 10.5, fontWeight: '700', color: i === stage ? goldColor : txtSec }}>{l}</Text>)}
                    </View>
                    {showPin ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: dl.soft }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 11.5, color: dl.dk, opacity: 0.8 }}>Delivery PIN</Text>
                          <Text style={{ fontSize: 11.5, color: dl.dk, opacity: 0.8 }}>Share it with your rider at handover only</Text>
                        </View>
                        <Text style={{ fontSize: 24, fontWeight: '900', letterSpacing: 5, color: goldColor, fontVariant: ['tabular-nums'] }}>{o.deliveryPin}</Text>
                      </View>
                    ) : null}
                    <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); router.push(`/tracking/${o._id || o.id}` as any); }} style={{ marginTop: 12, backgroundColor: goldColor, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }} accessibilityRole="button">
                      <Text style={{ color: '#FFFFFF', fontSize: 13.5, fontWeight: '800' }}>Track order</Text>
                    </TouchableOpacity>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 10 }}>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: goldColor }}>Order details</Text>
                      <Ionicons name="chevron-down" size={13} color={goldColor} />
                    </View>
                  </View>
                );
              })() : null}
              {!isDark && (o.status === 'Delivered' || o.status === 'Cancelled') && !isExpanded ? (
                <View style={{ marginTop: 12 }}>
                  {needsRating ? (
                    <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); router.push(`/tracking/${o._id || o.id}` as any); }} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.6)', marginBottom: 10 }} accessibilityRole="button" accessibilityLabel="Rate this order">
                      <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '700', color: txt }}>Rate this order</Text>
                      <View style={{ flexDirection: 'row', gap: 4 }}>
                        {[0, 1, 2, 3, 4].map((i) => <Ionicons key={i} name="star" size={18} color="#E5E7EB" />)}
                      </View>
                    </TouchableOpacity>
                  ) : o.rating != null ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 10 }}>
                      {[1, 2, 3, 4, 5].map((i) => <Ionicons key={i} name="star" size={15} color={i <= Number(o.rating) ? '#F5B301' : '#E5E7EB'} />)}
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {!(storeGoneFromOrder(o) || goneStores.has(storeIdOf(o))) ? (
                      <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); handleReorder(o); }} style={{ flex: 1, backgroundColor: dl.soft, borderRadius: 12, paddingVertical: 11, alignItems: 'center' }} accessibilityRole="button">
                        {reorderingId === (o._id || o.id) ? <ActivityIndicator size="small" color={goldColor} /> : <Text style={{ color: goldColor, fontSize: 13, fontWeight: '800' }}>Reorder</Text>}
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); toggleExpand(o._id || o.id); }} style={{ flex: 1, backgroundColor: dl.soft, borderRadius: 12, paddingVertical: 11, alignItems: 'center' }} accessibilityRole="button">
                      <Text style={{ color: goldColor, fontSize: 13, fontWeight: '800' }}>Details</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              {/* Quick 1-Tap Track Strip on Active Orders (dark mode) */}
              {isDark && o.status !== 'Delivered' && o.status !== 'Cancelled' && !isExpanded && (""")
rep("{needsRating && !isExpanded && (", "{isDark && needsRating && !isExpanded && (")
# expanded buttons in the accent (light)
rep("""                      <LinearGradient
                        colors={['#D4AF7A', '#F0D9A8']}""", """                      <LinearGradient
                        colors={isDark ? ['#D4AF7A', '#F0D9A8'] : [goldColor, goldColor]}""")
rep("""                        <Text style={st.trackBtnText}>Track order</Text>""", """                        <Text style={[st.trackBtnText, !isDark && { color: '#FFFFFF' }]}>Track order</Text>""")
rep("""                        colors={['#EF4F5F', '#FF6B7B']}""", """                        colors={isDark ? ['#EF4F5F', '#FF6B7B'] : [goldColor, goldColor]}""")
open(p, 'w', encoding='utf8').write(t)
print('ok')
