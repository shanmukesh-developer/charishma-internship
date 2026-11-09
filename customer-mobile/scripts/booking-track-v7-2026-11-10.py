"""Booking tracking -> approved Orders replica v7 tracking screen (owner, 10 Nov 2026), light mode:
a status card (Current status, big status, ready-time pill, the stall's own photo, progress bar over the real
timeline), the pickup code in a soft box with Enlarge, three tiles (Visit stall / Help / Share), then Updates and the
order summary. Replaces the dashed ticket, the separate ready pill and the dot timeline in light mode only."""
p = 'modules/campusBooking/CbOrder.tsx'
t = open(p, encoding='utf8').read()
assert 'v7StatusCard' not in t

def rep(old, new):
    global t
    assert old in t, old[:90]
    t = t.replace(old, new, 1)

# 1. ticket card -> status card + soft pickup box
a = t.index("        {/* Pickup code: the replica's ticket card in light mode */}")
b_ = t.index("        {live && b.pickupCode && p.isDark ? (")
t = t[:a] + """        {/* v7StatusCard: the replica's tracking card (light mode) */}
        {!p.isDark && b.status !== 'CANCELLED' ? (() => {
          const steps = b.timeline;
          const short = (l: string) => l.replace(/^(Payment |Order |Ready for |Preparing your )/i, '').replace(/^./, (c) => c.toUpperCase());
          const doneN = steps.filter((x) => x.done).length;
          const img = resolveMediaUrl(b.stall?.imageUrl || '') || null;
          const sub = ready ? `Show your code at ${stallName}'s counter` : live && b.estimatedReadyAt ? (minsToReady !== null && minsToReady > 0 ? `Ready in about ${minsToReady} min` : `Should be ready about now · ${timeIST(b.estimatedReadyAt)}`) : null;
          return (
            <StaggeredSection delay={0} direction="up">
              <View style={[s.v7Card, { borderColor: 'rgba(17,17,26,0.06)' }]}>
                <View style={{ flexDirection: 'row' }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={{ fontSize: 11.5, fontWeight: '700', color: p.txtSec }}>Current status</Text>
                    <Text style={{ fontSize: 22, fontWeight: '800', color: p.txt, marginTop: 2 }}>{b.statusLabel}</Text>
                    {sub ? (
                      <View style={[s.etaPill, { backgroundColor: p.accentSoft, alignSelf: 'flex-start', marginTop: 8, marginBottom: 0 }]}>
                        <Ionicons name="time-outline" size={13} color={p.accent} />
                        <Text style={{ fontSize: 12, fontWeight: '800', color: p.accent }}>{sub}</Text>
                      </View>
                    ) : null}
                  </View>
                  {img ? <Image source={{ uri: img }} style={s.v7Img} /> : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 4, marginTop: 18 }}>
                  {steps.map((x, i) => (
                    <View key={x.key} style={{ flex: 1, height: 4, borderRadius: 3, backgroundColor: '#ECEEF3', overflow: 'hidden' }}>
                      {x.done ? <View style={{ flex: 1, backgroundColor: p.accent }} /> : i === doneN && live ? <View style={{ width: '50%', height: '100%', backgroundColor: p.accent }} /> : null}
                    </View>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', marginTop: 6 }}>
                  {steps.map((x, i) => (
                    <Text key={x.key} style={{ flex: 1, textAlign: i === 0 ? 'left' : i === steps.length - 1 ? 'right' : 'center', fontSize: 10, fontWeight: '700', color: i === doneN && live ? p.accent : p.txtSec }} numberOfLines={1}>{short(x.label)}</Text>
                  ))}
                </View>
              </View>
              {live && b.pickupCode ? (
                <View style={[s.v7Pin, { backgroundColor: p.accentSoft }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11.5, fontWeight: '700', color: d.dk, opacity: 0.85 }}>Pickup code</Text>
                    <Text style={{ fontSize: 11.5, color: d.dk, opacity: 0.8 }}>{copied ? 'Copied' : 'Show it at the counter'}</Text>
                    <TouchableOpacity onPress={() => setZoom(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Enlarge the pickup code">
                      <Text style={{ fontSize: 12, fontWeight: '800', color: p.accent, marginTop: 4 }}>Enlarge</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={copyCode} accessibilityRole="button" accessibilityLabel={`Pickup code ${b.pickupCode.split('').join(' ')}. Tap to copy`}>
                    <Text style={{ fontSize: 28, fontWeight: '900', letterSpacing: 6, color: p.accent }}>{b.pickupCode}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                {[
                  ...(b.stall ? [{ icon: 'storefront-outline', label: 'Visit stall', on: () => router.push(`/campus-booking/stall/${b.stall!.id}` as any) }] : []),
                  { icon: 'help-circle-outline', label: 'Help', on: () => router.push('/support' as any) },
                  { icon: 'share-social-outline', label: 'Share', on: () => { Share.share({ message: `My ZenWe booking ${b.ref} at ${stallName}${b.pickupCode ? ` · pickup code ${b.pickupCode}` : ''}` }).catch(() => {}); } },
                ].map((a) => (
                  <TouchableOpacity key={a.label} onPress={a.on} style={[s.v7Tile, { borderColor: 'rgba(17,17,26,0.06)' }]} accessibilityRole="button">
                    <Ionicons name={a.icon as any} size={20} color={p.accent} />
                    <Text style={{ fontSize: 12, fontWeight: '800', color: p.txt }}>{a.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </StaggeredSection>
          );
        })() : null}
""" + t[b_:]

# 2. drop the light ready pill (now inside the status card) and the light dot timeline
rep("{live && !ready && b.estimatedReadyAt && !p.isDark ? (", "{false ? (")
rep("        {b.status !== 'CANCELLED' ? (\n          <StaggeredSection delay={80} direction=\"up\">", "        {b.status !== 'CANCELLED' && p.isDark ? (\n          <StaggeredSection delay={80} direction=\"up\">")
# 3. bottom action row only in dark (tiles replace it)
rep("        {/* Quick actions (tracking action row) */}\n        <View style={s.actionRow}>", "        {/* Quick actions (tracking action row) - dark mode; light mode has the tiles */}\n        <View style={[s.actionRow, !p.isDark && { display: 'none' }]}>")
# 4. header title like the replica
rep("{ready ? 'Order ready' : 'Your order'}", "{ready ? 'Order ready' : 'Order tracking'}")

rep("const s = StyleSheet.create({\n", """const s = StyleSheet.create({
  v7Card: { backgroundColor: '#FFFFFF', borderRadius: 22, borderWidth: 1, padding: 16, marginBottom: 12, overflow: 'hidden' },
  v7Img: { width: 86, height: 86, borderRadius: 18, marginTop: -2, marginRight: -2 },
  v7Pin: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18, marginBottom: 12 },
  v7Tile: { flex: 1, alignItems: 'center', gap: 5, paddingVertical: 12, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1 },
""")
t = t.replace("import { Linking, Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';",
              "import { Image, Linking, Modal, RefreshControl, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';\nimport { resolveMediaUrl } from '../../utils/imageUpload';", 1)
open(p, 'w', encoding='utf8').write(t)
print('ok')
