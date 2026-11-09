"""Basket screen -> approved replica v1 + full cart (owner, 10 Nov 2026). Look only, no logic changes:
light diet header band, basket switch on a soft track (selected = white pill, accent text + accent count badge),
group basket as one "Order together" row (Start / Join) - the live room card is unchanged, empty state with the
photoreal full cart on a soft circle and an accent button. Light mode only; dark mode keeps its look. Run once."""
import re
p = 'app/(tabs)/basket.tsx'
t = open(p, encoding='utf8').read()
assert 'useDietLight' not in t

def rep(old, new, count=1):
    global t
    assert t.count(old) >= count, old[:90]
    t = t.replace(old, new, count)

rep("import AmbientBackground from '../../components/AmbientBackground';",
    "import AmbientBackground from '../../components/AmbientBackground';\nimport { useDietLight } from '../../components/local/dietLightTheme';\nimport { Image } from 'react-native';\nconst EMPTY_CART = require('../../assets/home-redesign-2026-11-09/basket-fab-full-cart-gemini-2026-11-10.webp');")

# first component's palette (line ~252)
rep("  const bg = colors.bg;\n  const cardBg = colors.card;",
    "  const d = useDietLight();\n  const bg = isDark ? colors.bg : d.page;\n  const cardBg = colors.card;", 1)

rep("""    <KeyboardAvoidingView style={[s.container, { paddingTop: topPad, backgroundColor: bg }]} enabled={basketFocused}>
      <AmbientBackground />""", """    <KeyboardAvoidingView style={[s.container, { paddingTop: isDark ? topPad : 0, backgroundColor: bg }]} enabled={basketFocused}>
      {isDark ? <AmbientBackground /> : null}""")

# header on the light band, with the switch inside it
rep("""        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <TabBackButton />
            <Text style={[s.pageTitle, { color: txt, marginBottom: 0, paddingHorizontal: 0 }]}>Your basket</Text>
          </View>""", """        <View style={isDark ? undefined : { backgroundColor: d.top, paddingTop: topPad + 8, paddingBottom: 14, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <TabBackButton />
            <Text style={[s.pageTitle, { color: isDark ? txt : d.dk, marginBottom: 0, paddingHorizontal: 0 }]}>Your basket</Text>
          </View>""")
rep("""              <Text style={{ fontSize: 12, fontWeight: '900', color: '#EF4444', letterSpacing: 0.2 }}>Clear this basket</Text>""",
    """              <Text style={{ fontSize: 12, fontWeight: '900', color: isDark ? '#EF4444' : d.acc, letterSpacing: 0.2 }}>Clear this basket</Text>""")
rep("style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.08)' }}",
    "style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.7)' }}")

rep("<View style={[s.segWrap, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F1F5F9', borderColor: border }]} accessibilityRole=\"tablist\">",
    "<View style={[s.segWrap, isDark ? { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: border } : { backgroundColor: 'rgba(255,255,255,0.65)', borderColor: 'transparent', marginBottom: 0 }]} accessibilityRole=\"tablist\">")
rep("""                style={[s.seg, selected && { backgroundColor: isDark ? goldColor : COLORS.red }]}""",
    """                style={[s.seg, selected && (isDark ? { backgroundColor: goldColor } : { backgroundColor: '#FFFFFF', shadowColor: d.acc, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 })]}""")
rep("""                <Text style={[s.segText, { color: selected ? onColor : txt }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{BASKET_LABELS[k]}</Text>
                <Text style={[s.segCount, { color: selected ? onColor : n === 0 ? txtSec : txt }]} numberOfLines={1}>{n}</Text>""",
    """                <Text style={[s.segText, { color: isDark ? (selected ? onColor : txt) : selected ? d.acc : d.dk }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{BASKET_LABELS[k]}</Text>
                {isDark ? (
                  <Text style={[s.segCount, { color: selected ? onColor : n === 0 ? txtSec : txt }]} numberOfLines={1}>{n}</Text>
                ) : (
                  <View style={{ minWidth: 20, height: 18, paddingHorizontal: 6, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? d.acc : '#FFFFFF' }}>
                    <Text style={[s.segCount, { fontSize: 11, color: selected ? '#FFFFFF' : txtSec }]} numberOfLines={1}>{n}</Text>
                  </View>
                )}""")
# close the band after the switch
rep("""            );
          })}
        </View>

        {/* Group basket (restaurant orders only) */}""", """            );
          })}
        </View>
        </View>

        {/* Group basket (restaurant orders only) */}""")

# group basket idle -> one row
rep("""                <Text style={{ fontSize: 12, fontWeight: '900', color: goldColor, letterSpacing: 0.3, marginBottom: 2 }}>Group basket</Text>
                <Text style={[s.groupDesc, { color: txtSec }]}>Build one basket with your roommates. One person checks out and pays.</Text>
                <View style={s.groupBtns}>
                  <TouchableOpacity style={[s.hostBtn, { borderColor: border, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }]} onPress={onHostRoom} accessibilityRole="button">
                    <Text style={[s.hostBtnText, { color: txt }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>Start a group basket</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.joinBtn, { backgroundColor: goldColor }]} onPress={() => setIsJoinOpen(!isJoinOpen)} accessibilityRole="button" accessibilityState={{ expanded: isJoinOpen }}>
                    <Text style={s.joinBtnText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>Join a group basket</Text>
                  </TouchableOpacity>
                </View>""", """                {isDark ? (
                  <>
                    <Text style={{ fontSize: 12, fontWeight: '900', color: goldColor, letterSpacing: 0.3, marginBottom: 2 }}>Group basket</Text>
                    <Text style={[s.groupDesc, { color: txtSec }]}>Build one basket with your roommates. One person checks out and pays.</Text>
                    <View style={s.groupBtns}>
                      <TouchableOpacity style={[s.hostBtn, { borderColor: border, backgroundColor: 'rgba(255,255,255,0.03)' }]} onPress={onHostRoom} accessibilityRole="button">
                        <Text style={[s.hostBtnText, { color: txt }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>Start a group basket</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.joinBtn, { backgroundColor: goldColor }]} onPress={() => setIsJoinOpen(!isJoinOpen)} accessibilityRole="button" accessibilityState={{ expanded: isJoinOpen }}>
                        <Text style={s.joinBtnText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>Join a group basket</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  // Owner, 10 Nov 2026: one quiet row - icon, "Order together", Start (accent) / Join (soft)
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: d.soft, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="people-outline" size={21} color={d.acc} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: txt }}>Order together</Text>
                      <Text style={{ fontSize: 11.5, color: txtSec, marginTop: 2, lineHeight: 15 }}>One basket with your roommates. One person checks out and pays.</Text>
                    </View>
                    <View style={{ gap: 6 }}>
                      <TouchableOpacity onPress={onHostRoom} style={{ backgroundColor: d.acc, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, alignItems: 'center' }} accessibilityRole="button" accessibilityLabel="Start a group basket">
                        <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>Start</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setIsJoinOpen(!isJoinOpen)} style={{ backgroundColor: d.soft, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, alignItems: 'center' }} accessibilityRole="button" accessibilityLabel="Join a group basket" accessibilityState={{ expanded: isJoinOpen }}>
                        <Text style={{ color: d.acc, fontSize: 12, fontWeight: '800' }}>Join</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}""")
rep("style={[s.joinSubmit, { backgroundColor: goldColor }]} ", "style={[s.joinSubmit, { backgroundColor: isDark ? goldColor : d.acc }]} ")
rep("<View style={[s.groupCard, { backgroundColor: cardBg, borderColor: border }]}>",
    "<View style={[s.groupCard, { backgroundColor: cardBg, borderColor: isDark ? border : 'rgba(17,17,26,0.06)' }]}>")

# empty state
rep("""            <View style={[s.emptyBox, { backgroundColor: cardBg, borderColor: border }]}>
              <Ionicons name="cart-outline" size={48} color={txtSec} style={{ marginBottom: 16 }} />""",
"""            <View style={[s.emptyBox, { backgroundColor: cardBg, borderColor: isDark ? border : 'rgba(17,17,26,0.06)' }]}>
              {isDark ? <Ionicons name="cart-outline" size={48} color={txtSec} style={{ marginBottom: 16 }} /> : (
                // Owner, 10 Nov 2026: a real cart full of items on a soft diet-colour circle
                <View style={{ width: 128, height: 128, borderRadius: 64, backgroundColor: d.soft, marginBottom: 16, alignItems: 'center', justifyContent: 'flex-end' }}>
                  <Image source={EMPTY_CART} style={{ width: 118, height: 134, marginBottom: 4 }} resizeMode="contain" accessibilityIgnoresInvertColors />
                </View>
              )}""")
rep("""                style={[s.exploreBtn, { backgroundColor: COLORS.red }]}""",
    """                style={[s.exploreBtn, { backgroundColor: isDark ? COLORS.red : d.acc, shadowColor: isDark ? COLORS.red : d.acc }]}""")

t = t.replace("import { Image } from 'react-native';\n", "", 1)
t = t.replace("import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, TextInput, Alert, ActivityIndicator, RefreshControl } from 'react-native';",
              "import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, TextInput, Alert, ActivityIndicator, RefreshControl, Image } from 'react-native';", 1)
open(p, 'w', encoding='utf8').write(t)
print('ok')
