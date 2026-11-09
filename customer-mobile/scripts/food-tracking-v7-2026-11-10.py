"""Food order tracking -> approved Orders replica v7 tracking screen (owner, 10 Nov 2026), light mode only:
light diet header band; one status card (Current status, short status, ETA pill, the realistic delivery-scooter art,
4-step progress bar Confirmed / Preparing / On the way / Delivered, the detailed line under it); the Delivery PIN as
a soft box with Enlarge; Call / Help / Share as tiles; gold stars on the rating card; diet accent instead of gold.
Replaces the cockpit + stage card in light mode. Dark mode, data and actions unchanged. Run once."""
p = 'app/tracking/[id].tsx'
t = open(p, encoding='utf8').read()
assert 'v7FoodStatus' not in t

def rep(old, new, n=1):
    global t
    assert old in t, old[:90]
    t = t.replace(old, new, n)

# palette
rep("  const bg = isDark ? COLORS.bgDark : COLORS.bgLight;", "  const dl = useDietLight();\n  const acc = isDark ? COLORS.gold : dl.acc;\n  const bg = isDark ? COLORS.bgDark : dl.page;")
rep("  const cardBg = isDark ? COLORS.bgCard : COLORS.bgLightCard;", "  const cardBg = isDark ? COLORS.bgCard : '#FFFFFF';")
rep("  const border = isDark ? COLORS.borderDark : COLORS.borderLight;", "  const border = isDark ? COLORS.borderDark : 'rgba(17,17,26,0.07)';")

# header band
rep("<View style={[s.header, { paddingTop: topPad, backgroundColor: isDark ? '#000' : '#fff', borderBottomColor: border }]}>",
    "<View style={[s.header, { paddingTop: topPad, backgroundColor: isDark ? '#000' : dl.top, borderBottomColor: isDark ? border : 'transparent' }, !isDark && { borderBottomLeftRadius: 22, borderBottomRightRadius: 22 }]}>")
rep("            <Text style={{ fontSize: 12, color: COLORS.gold, fontWeight: '600', letterSpacing: 1 }}>\n              {orderCode(orderInfo, orderId)}",
    "            <Text style={{ fontSize: 12, color: isDark ? COLORS.gold : dl.dk, opacity: isDark ? 1 : 0.7, fontWeight: '600', letterSpacing: 0.4 }}>\n              {storeName && !isDark ? `${storeName} · ` : ''}{orderCode(orderInfo, orderId)}")
rep("<Text style={[s.headerTitle, { color: txt }]}>Order tracking</Text>", "<Text style={[s.headerTitle, { color: isDark ? txt : dl.dk }]}>Order tracking</Text>")
rep("<Ionicons name=\"chevron-back\" size={20} color={txt} />\n        </TouchableOpacity>\n        <View style={{ flex: 1 }}>",
    "<Ionicons name=\"chevron-back\" size={20} color={isDark ? txt : dl.dk} />\n        </TouchableOpacity>\n        <View style={{ flex: 1 }}>")
rep("backgroundColor: isConnected ? 'rgba(16,185,129,0.1)' : 'rgba(136,136,136,0.12)' }]}>", "backgroundColor: isConnected ? (isDark ? 'rgba(16,185,129,0.1)' : '#FFFFFF') : 'rgba(136,136,136,0.12)' }]}>")
rep("<View style={[s.statusDot, { backgroundColor: isConnected ? COLORS.emerald : txtSec }]} />", "<View style={[s.statusDot, { backgroundColor: isConnected ? (isDark ? COLORS.emerald : acc) : txtSec }]} />")
rep("<Text style={[s.statusText, { color: isConnected ? COLORS.emerald : txtSec }]}>", "<Text style={[s.statusText, { color: isConnected ? (isDark ? COLORS.emerald : acc) : txtSec }]}>")

# status card replaces cockpit + stage card in light mode
rep("""        {/* ── LIVE ORDER COCKPIT ── */}
        <StaggeredSection delay={30} direction="up">""", """        {/* v7FoodStatus: the replica's status card (light mode) */}
        {!isDark ? (() => {
          const done = status >= 6 ? 4 : status >= 4 ? 2 : status >= 2 ? 1 : 0;
          const labels = ['Confirmed', 'Preparing', 'On the way', 'Delivered'];
          const big = status === 1 ? 'Waiting for the store' : status === 2 ? 'Confirmed' : status === 3 ? 'Preparing' : status === 4 ? 'Out for delivery' : status === 5 ? 'At your gate' : 'Delivered';
          const eta = status === 5 ? 'Your rider is at the gate' : estMinutes && status >= 2 && status <= 4 ? `About ${estMinutes} min away` : slotLabel && status < 6 ? `Delivery: ${slotLabel}` : null;
          return (
            <StaggeredSection delay={30} direction="up">
              <View style={[s.v7Card, { backgroundColor: cardBg, borderColor: border }]}>
                <View style={{ flexDirection: 'row' }}>
                  <View style={{ flex: 1, paddingRight: 6 }}>
                    <Text style={{ fontSize: 11.5, fontWeight: '700', color: txtSec }}>Current status</Text>
                    <Text style={{ fontSize: 22, fontWeight: '800', color: txt, marginTop: 2 }}>{big}</Text>
                    {eta ? (
                      <View style={[s.v7Eta, { backgroundColor: dl.soft }]}>
                        <Ionicons name="time-outline" size={13} color={acc} />
                        <Text style={{ fontSize: 12, fontWeight: '800', color: acc }} numberOfLines={1}>{eta}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Image source={TRACK_SCOOTER} style={s.v7Art} resizeMode="contain" />
                </View>
                <View style={{ flexDirection: 'row', gap: 4, marginTop: 16 }}>
                  {labels.map((l, i) => (
                    <View key={l} style={{ flex: 1, height: 4, borderRadius: 3, backgroundColor: '#ECEEF3', overflow: 'hidden' }}>
                      {i < done ? <View style={{ flex: 1, backgroundColor: acc }} /> : i === done && status < 6 ? <View style={{ width: '50%', height: '100%', backgroundColor: acc }} /> : null}
                    </View>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  {labels.map((l, i) => <Text key={l} style={{ fontSize: 10.5, fontWeight: '700', color: i === done && status < 6 ? acc : txtSec }}>{l}</Text>)}
                </View>
                {!!liveFix && (
                  <Text style={{ fontSize: 12, fontWeight: '700', color: txtSec, marginTop: 10 }}>
                    {riderDistanceText ? `${rider?.name || 'Your rider'} is ${riderDistanceText}` : 'Live rider location on'}
                    {fixAgeSec !== null ? (fixAgeSec < 15 ? ' · live' : ` · updated ${fixAgeSec}s ago`) : ''}
                  </Text>
                )}
                {isVendorOrder && status >= 4 && status < 6 ? <Text style={{ fontSize: 12, color: txtSec, marginTop: 8 }}>{`${stallLabel} is bringing it. Keep cash ready.`}</Text> : null}
              </View>
            </StaggeredSection>
          );
        })() : null}

        {/* ── LIVE ORDER COCKPIT (dark mode) ── */}
        {isDark ? <StaggeredSection delay={30} direction="up">""")
rep("""            vendor={isVendorOrder ? { name: stallLabel, onCall: stallCallable ? callStall : null } : null}
          />
        </StaggeredSection>

        {/* ── CURRENT STAGE CARD ── */}
        <StaggeredSection delay={50} direction="up">""", """            vendor={isVendorOrder ? { name: stallLabel, onCall: stallCallable ? callStall : null } : null}
          />
        </StaggeredSection> : null}

        {/* ── CURRENT STAGE CARD (dark mode) ── */}
        {isDark ? <StaggeredSection delay={50} direction="up">""")
rep("""              <View style={s.etaChip}>
                <Text style={s.etaText}>~{estMinutes} min</Text>
              </View>
            ) : null}
          </View>
        </StaggeredSection>""", """              <View style={s.etaChip}>
                <Text style={s.etaText}>~{estMinutes} min</Text>
              </View>
            ) : null}
          </View>
        </StaggeredSection> : null}""")

# PIN: soft box in light mode
rep("""            <View style={[s.pinCard, { backgroundColor: cardBg, borderColor: status >= 4 ? COLORS.gold : border }]}>""",
"""            {!isDark ? (
              <View style={[s.v7Pin, { backgroundColor: dl.soft }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11.5, fontWeight: '700', color: dl.dk, opacity: 0.85 }}>Delivery PIN</Text>
                  <Text style={{ fontSize: 11.5, color: dl.dk, opacity: 0.8 }}>Share it with your rider at handover only</Text>
                  <TouchableOpacity onPress={() => setZoomPin(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Enlarge Delivery PIN">
                    <Text style={{ fontSize: 12, fontWeight: '800', color: acc, marginTop: 4 }}>Enlarge</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity onPress={copyPinToClipboard} accessibilityLabel="Copy Delivery PIN">
                  <Text style={{ fontSize: 28, fontWeight: '900', letterSpacing: 6, color: acc }}>{orderInfo.deliveryPin}</Text>
                </TouchableOpacity>
              </View>
            ) : (
            <View style={[s.pinCard, { backgroundColor: cardBg, borderColor: status >= 4 ? COLORS.gold : border }]}>""")
rep("""                  <Text style={{ fontSize: 12, fontWeight: '600', color: txt }}>Enlarge</Text>
                </TouchableOpacity>
              </View>
            </View>
          </StaggeredSection>""", """                  <Text style={{ fontSize: 12, fontWeight: '600', color: txt }}>Enlarge</Text>
                </TouchableOpacity>
              </View>
            </View>
            )}
          </StaggeredSection>""")

# action tiles: icon over label, accent icons
t = t.replace("<Ionicons name=\"call-outline\" size={16} color={txt} />", "<Ionicons name=\"call-outline\" size={isDark ? 16 : 20} color={isDark ? txt : acc} />")
t = t.replace("<Ionicons name=\"help-buoy-outline\" size={16} color={txt} />", "<Ionicons name=\"help-buoy-outline\" size={isDark ? 16 : 20} color={isDark ? txt : acc} />")
t = t.replace("<Ionicons name=\"share-social-outline\" size={16} color={txt} />", "<Ionicons name=\"share-social-outline\" size={isDark ? 16 : 20} color={isDark ? txt : acc} />")
t = t.replace("[s.actionBtn, { backgroundColor: cardBg, borderColor: border }", "[s.actionBtn, { backgroundColor: cardBg, borderColor: border }, !isDark && s.v7Tile")

# rating with gold stars
rep("""              <Ionicons name="star-outline" size={20} color={COLORS.gold} />
              <View style={{ flex: 1 }}>
                <Text style={[s.rateCtaTitle, { color: txt }]}>How was your order?</Text>
                <Text style={[s.rateCtaSub, { color: txtSec }]}>Rate it and earn 10 points</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.gold} />""", """              {isDark ? <Ionicons name="star-outline" size={20} color={COLORS.gold} /> : null}
              <View style={{ flex: 1 }}>
                <Text style={[s.rateCtaTitle, { color: txt }]}>How was your order?</Text>
                <Text style={[s.rateCtaSub, { color: txtSec }]}>Rate it and earn 10 points</Text>
              </View>
              {isDark ? <Ionicons name="chevron-forward" size={16} color={COLORS.gold} /> : (
                <View style={{ flexDirection: 'row', gap: 4 }}>{[0, 1, 2, 3, 4].map((i) => <Ionicons key={i} name="star" size={20} color="#E5E7EB" />)}</View>
              )}""")
rep("""              <Ionicons name="heart-outline" size={20} color={COLORS.gold} />""", """              {isDark ? <Ionicons name="heart-outline" size={20} color={COLORS.gold} /> : (
                <View style={{ flexDirection: 'row', gap: 2 }}>{[1, 2, 3, 4, 5].map((i) => <Ionicons key={i} name="star" size={16} color={i <= Number(orderInfo.rating) ? '#F5B301' : '#E5E7EB'} />)}</View>
              )}""")
t = t.replace("<ActivityIndicator size=\"small\" color={COLORS.gold} />\n            <View style={{ flex: 1 }}>\n              <Text style={[s.waitStoreTitle", "<ActivityIndicator size=\"small\" color={acc} />\n            <View style={{ flex: 1 }}>\n              <Text style={[s.waitStoreTitle")
t = t.replace("borderColor: COLORS.goldBorder }]}>\n              <View style={{ flex: 1 }}>\n                <Text style={[s.stageLabel, { color: txtSec }]}>Receipt</Text>", "borderColor: isDark ? COLORS.goldBorder : border }]}>\n              <View style={{ flex: 1 }}>\n                <Text style={[s.stageLabel, { color: txtSec }]}>Receipt</Text>")

# styles + imports
rep("const s = StyleSheet.create({\n", """const s = StyleSheet.create({
  v7Card: { borderRadius: 22, borderWidth: 1, padding: 16, marginBottom: 12, overflow: 'hidden' },
  v7Eta: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, marginTop: 8 },
  v7Art: { width: 104, height: 96, marginRight: -6, marginTop: -4 },
  v7Pin: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18 },
  v7Tile: { flexDirection: 'column', gap: 5, paddingVertical: 12, borderRadius: 16 },
""")
rep("import { orderCode } from '../../utils/orderCode';", "import { orderCode } from '../../utils/orderCode';\nimport { useDietLight } from '../../components/local/dietLightTheme';\nconst TRACK_SCOOTER = require('../../assets/home-redesign-2026-11-09/tracking-delivery-scooter-gemini-2026-11-10.webp');")
open(p, 'w', encoding='utf8').write(t)
print('ok')
