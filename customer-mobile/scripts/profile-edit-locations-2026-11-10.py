"""Edit profile, location part (owner, 10 Nov 2026: "locations all this" -> validation + look, group neatly,
auto-fill city, better address picker).
- "Where you live" group: block chips, then Block + Room side by side, then the other address and City.
- Address checked like the other fields (at least 5 characters with letters), clean look, accent on focus, clear (x).
- City fills itself from the student's college (campus directory city, e.g. Amaravathi) when it is empty, with a
  one-tap "Use <city>" chip if they cleared it.
- Address suggestions: a clean white list with a pin icon, two lines (place, then area), tap to fill. Run once."""
p = 'app/(tabs)/profile.tsx'
t = open(p, encoding='utf8').read()
assert 'campusCity' not in t

def rep(old, new, count=1):
    global t
    assert t.count(old) >= count, old[:90]
    t = t.replace(old, new, count)

rep("type EditField = 'name' | 'phone' | 'email' | 'photo' | 'block' | 'room' | 'city';",
    "type EditField = 'name' | 'phone' | 'email' | 'photo' | 'block' | 'room' | 'city' | 'address';")

# campus city
rep("  const myHostelCampuses = myCollege ? hostelCampuses.filter((c) => c.code.toLowerCase() === myCollege) : [];",
"""  const myHostelCampuses = myCollege ? hostelCampuses.filter((c) => c.code.toLowerCase() === myCollege) : [];
  // The college's city from the campus directory (SRM AP / VIT-AP: Amaravathi): fills an empty City field.
  const campusCity = myHostelCampuses.find((c) => c.city)?.city || '';
  useEffect(() => {
    if (isEditing && campusCity && !editCity.trim()) setEditCity(campusCity);
    // only when the editor opens or the campus list arrives, never while the student types
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, campusCity]);""")

# address validation
rep("    const city = editCity.trim();\n    if (city && !CITY_RE.test(city)) e.city = 'Use letters only.';",
"""    const city = editCity.trim();
    if (city && !CITY_RE.test(city)) e.city = 'Use letters only.';
    const addr = editAddress.trim();
    if (addr && (addr.length < 5 || !/\\p{L}/u.test(addr))) e.address = 'Add a little more, like the street or a landmark.';""")
rep("    const err = f === 'about' || f === 'address' ? undefined : showErr(f as EditField);",
    "    const err = f === 'about' ? undefined : showErr(f as EditField);")

# group heading + block/room side by side
old_block_label = "              {/* Hostel block (campus directory chips + free text) and room number */}\n              <Text style={[s.inputLabel, { color: txtSec }]}>Hostel block</Text>"
rep(old_block_label, """              {/* Where you live (10 Nov 2026): block chips, then Block + Room side by side, then the other address and City */}
              <View style={[s.groupHead, { borderTopColor: inputBorder }]}>
                <Ionicons name="location-outline" size={16} color={goldColor} />
                <Text style={[s.groupHeadText, { color: txt }]}>Where you live</Text>
              </View>
              {myHostelCampuses.some((c) => c.blocks.length) ? <Text style={[s.inputLabel, { color: txtSec }]}>Pick your hostel block</Text> : null}""")
# the typed block + room inputs: wrap into a row
blk_start = t.index("              <TextInput\n                value={editHostelBlock}")
room_end_marker = "              {errText('room')}"
room_end = t.index(room_end_marker, blk_start) + len(room_end_marker)
segment = t[blk_start:room_end]
# pull the pieces out of the segment
blk_input_end = segment.index("{errText('block')}") + len("{errText('block')}")
blk_part = segment[:blk_input_end]
room_label = "              <Text style={[s.inputLabel, { color: txtSec }]}>Room number</Text>"
assert room_label in segment
room_part = segment[segment.index(room_label) + len(room_label):]
indent = lambda s_: '\n'.join(('    ' + ln if ln.strip() else ln) for ln in s_.split('\n'))
new_seg = ("              <View style={s.twoCol}>\n"
           "                <View style={{ flex: 1.35 }}>\n"
           "                  <Text style={[s.inputLabel, { color: txtSec }]}>Hostel block</Text>\n"
           + indent(blk_part.replace("placeholder={myHostelCampuses.length ? 'Or type your block' : 'Your hostel or block'}", "placeholder={myHostelCampuses.some((c) => c.blocks.length) ? 'Or type it' : 'Hostel or block'}")) + "\n"
           "                </View>\n"
           "                <View style={{ flex: 1 }}>\n"
           "                  <Text style={[s.inputLabel, { color: txtSec }]}>Room</Text>\n"
           + indent(room_part.lstrip('\n')) + "\n"
           "                </View>\n"
           "              </View>")
t = t[:blk_start] + new_seg + t[room_end:]

# address field: validation hooks + clear button
rep("""                  maxLength={200}
                  onFocus={() => setFocusField('address')}
                  onBlur={() => setFocusField(null)}
                  style={fieldStyle('address')}
                />""", """                  maxLength={200}
                  onFocus={() => setFocusField('address')}
                  onBlur={() => { setFocusField(null); touch('address'); }}
                  style={fieldStyle('address', { paddingRight: 40 })}
                />
                {editAddress ? (
                  <TouchableOpacity onPress={() => { setEditAddress(''); setSuggestions([]); setShowSuggestions(false); }} style={s.clearBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Clear address">
                    <Ionicons name="close-circle" size={18} color={txtSec} />
                  </TouchableOpacity>
                ) : null}
                {errText('address')}""")
rep("<Text style={[s.inputLabel, { color: txtSec }]}>Other delivery address (optional)</Text>",
    "<Text style={[s.inputLabel, { color: txtSec }]}>Other address (optional)</Text>")

# suggestions list: pin icon + two lines
rep("""                    {suggestions.map((item, i) => (
                      <TouchableOpacity
                        key={item.place_id || i}
                        onPress={() => handleSelectSuggestion(item)}
                        style={s.suggestionItem}
                      >
                        <Text style={[s.suggestionText, { color: txt }]} numberOfLines={2}>
                          {item.display_name}
                        </Text>
                      </TouchableOpacity>
                    ))}""", """                    {suggestions.map((item, i) => {
                      const full = String(item.display_name || '');
                      const head = String(item.name || full.split(',')[0] || '').trim();
                      const rest = full.split(',').slice(1, 4).join(',').trim();
                      return (
                        <TouchableOpacity
                          key={item.place_id || i}
                          onPress={() => handleSelectSuggestion(item)}
                          style={[s.suggestionItem, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: inputBorder }]}
                          accessibilityRole="button"
                          accessibilityLabel={`Use ${full}`}
                        >
                          <View style={[s.suggestionPin, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : d.soft }]}>
                            <Ionicons name="location" size={14} color={goldColor} />
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={[s.suggestionText, { color: txt }]} numberOfLines={1}>{head}</Text>
                            {rest ? <Text style={{ fontSize: 11.5, color: txtSec, marginTop: 1 }} numberOfLines={1}>{rest}</Text> : null}
                          </View>
                        </TouchableOpacity>
                      );
                    })}""")

# city chip when empty
rep("              {errText('city')}\n",
"""              {errText('city')}
              {campusCity && !editCity.trim() ? (
                <TouchableOpacity onPress={() => setEditCity(campusCity)} style={[s.useCityChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : d.soft }]} accessibilityRole="button">
                  <Ionicons name="navigate-outline" size={13} color={goldColor} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color: goldColor }}>Use {campusCity}</Text>
                </TouchableOpacity>
              ) : null}
""")

# styles
rep("  suggestionItem: {\n    padding: 12,\n    borderBottomWidth: 1,\n    borderBottomColor: 'rgba(255,255,255,0.05)',\n  },",
    "  suggestionItem: {\n    flexDirection: 'row',\n    alignItems: 'center',\n    gap: 10,\n    paddingHorizontal: 12,\n    paddingVertical: 10,\n  },\n  suggestionPin: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },")
rep("  fieldError: {", """  groupHead: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
  groupHeadText: { fontSize: 14, fontWeight: '800' },
  twoCol: { alignSelf: 'stretch', flexDirection: 'row', gap: 10 },
  clearBtn: { position: 'absolute', right: 12, top: 15 },
  useCityChip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, marginTop: 2, marginBottom: 6 },
  fieldError: {""")

open(p, 'w', encoding='utf8').write(t)
print('ok')
