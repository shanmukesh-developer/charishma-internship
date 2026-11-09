"""Edit profile sheet (owner, 10 Nov 2026: "work on this section validation and perfect things").
- Solid sheet (white / dark card) instead of the see-through glass, clean light input fill, accent border on focus.
- Live inline validation under each field (red border + short message once the field was left, or after Save):
  name 2-50 letters, Indian mobile, email (optional), photo link https, room format, a room needs a block, city letters.
- Save shows every problem at once (no alert chain) and nudges the haptic; the server rules stay the same.
- "Choose from gallery" is a clear soft button in the diet accent. Run once."""
p = 'app/(tabs)/profile.tsx'
t = open(p, encoding='utf8').read()
assert 'fieldErrors' not in t

def rep(old, new, count=1):
    global t
    assert t.count(old) >= count, old[:80]
    t = t.replace(old, new, count)

# --- validation rules (module scope) ---
rep("const EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/;",
"""const EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/;
// Edit profile rules (10 Nov 2026): letters (any script), spaces and . ' - only; rooms like 304, B-214, 12A.
const NAME_RE = /^[\\p{L}][\\p{L}\\p{M} .'-]*$/u;
const ROOM_RE = /^[A-Za-z0-9][A-Za-z0-9 /-]*$/;
const CITY_RE = /^[\\p{L}][\\p{L}\\p{M} .'-]*$/u;
type EditField = 'name' | 'phone' | 'email' | 'photo' | 'block' | 'room' | 'city';""")

# --- state ---
rep("  const [editName, setEditName] = useState('');",
"""  const [editName, setEditName] = useState('');
  // Inline validation: a field shows its message once it was left (touched) or after a Save attempt.
  const [touched, setTouched] = useState<Partial<Record<EditField, boolean>>>({});
  const [triedSave, setTriedSave] = useState(false);
  const [focusField, setFocusField] = useState<EditField | 'about' | 'address' | null>(null);""")

# reset on open
rep("    setEditProfileImage(user?.profileImage || null);\n    setOtpSent(false);",
    "    setEditProfileImage(user?.profileImage || null);\n    setTouched({});\n    setTriedSave(false);\n    setFocusField(null);\n    setOtpSent(false);")

# --- errors computed before handleUpdateProfile ---
rep("  const handleUpdateProfile = async () => {\n    if (savingRef.current) return;\n    const name = editName.trim();\n    const email = normalizedEditEmail;\n    if (name.length < 2) {\n      Alert.alert('Add your name', 'Please enter your name (at least 2 letters).');\n      return;\n    }\n    if (!PHONE_RE.test(normalizedEditPhone)) {\n      Alert.alert('Check your number', 'Enter a valid 10-digit Indian mobile number.');\n      return;\n    }\n    if (email && !EMAIL_RE.test(email)) {\n      Alert.alert('Check your email', \"That email address doesn't look right.\");\n      return;\n    }\n    if (editProfileImage && !/^(https?:\\/\\/|data:image\\/)/i.test(editProfileImage)) {\n      Alert.alert('Check the photo link', 'Paste a full image link starting with https://, or choose a photo from your gallery.');\n      return;\n    }",
"""  const fieldErrors: Partial<Record<EditField, string>> = (() => {
    const e: Partial<Record<EditField, string>> = {};
    const n = editName.trim().replace(/\\s+/g, ' ');
    if (n.length < 2) e.name = 'Enter your name (at least 2 letters).';
    else if (!NAME_RE.test(n)) e.name = 'Use letters only (spaces, . \\' - are fine).';
    if (!normalizedEditPhone) e.phone = 'Enter your mobile number.';
    else if (normalizedEditPhone.length < 10) e.phone = `${10 - normalizedEditPhone.length} more digit${normalizedEditPhone.length === 9 ? '' : 's'} needed.`;
    else if (!PHONE_RE.test(normalizedEditPhone)) e.phone = 'Indian mobile numbers start with 6, 7, 8 or 9.';
    if (normalizedEditEmail && !EMAIL_RE.test(normalizedEditEmail)) e.email = 'Check the email, like name@gmail.com.';
    if (editProfileImage && !/^(https?:\\/\\/|data:image\\/)/i.test(editProfileImage)) e.photo = 'Paste a full link starting with https://';
    const room = editRoom.trim();
    if (room && !ROOM_RE.test(room)) e.room = 'Use letters, numbers or - only (e.g. 304, B-214).';
    if (room && !editHostelBlock.trim()) e.block = 'Add your hostel block for this room.';
    const city = editCity.trim();
    if (city && !CITY_RE.test(city)) e.city = 'Use letters only.';
    return e;
  })();
  const showErr = (f: EditField) => (triedSave || touched[f] ? fieldErrors[f] : undefined);
  const touch = (f: EditField) => setTouched((prev) => (prev[f] ? prev : { ...prev, [f]: true }));

  const handleUpdateProfile = async () => {
    if (savingRef.current) return;
    const name = editName.trim().replace(/\\s+/g, ' ');
    const email = normalizedEditEmail;
    if (Object.keys(fieldErrors).length) {
      setTriedSave(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }""")

# --- sheet + inputs look ---
rep("<View style={[s.modalContent, { backgroundColor: cardBg, borderColor: border }]}>",
    "<View style={[s.modalContent, { backgroundColor: isDark ? colors.card : '#FFFFFF', borderColor: isDark ? colors.border : 'rgba(17,17,26,0.06)' }]}>")
rep("  const inputBg = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';",
"""  const inputBg = isDark ? 'rgba(255,255,255,0.05)' : '#F7F8FA';
  const inputBorder = isDark ? colors.border : '#E4E6EC';
  // One look for every field: accent border while typing, red border + message when it needs a fix.
  const fieldStyle = (f: EditField | 'about' | 'address', extra?: any) => {
    const err = f === 'about' || f === 'address' ? undefined : showErr(f as EditField);
    return [s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: err ? '#DC2626' : focusField === f ? goldColor : inputBorder, borderWidth: err || focusField === f ? 1.5 : 1 }, extra];
  };
  const errText = (f: EditField) => {
    const m = showErr(f);
    return m ? <Text style={s.fieldError} accessibilityLiveRegion="polite">{m}</Text> : null;
  };""")

# photo link
rep("""                    keyboardType="url"
                    style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: border }]}
                  />""", """                    keyboardType="url"
                    onFocus={() => setFocusField('photo')}
                    onBlur={() => { setFocusField(null); touch('photo'); }}
                    style={fieldStyle('photo')}
                  />
                  {errText('photo')}""")
# name
rep("""                maxLength={50}
                autoCapitalize="words"
                style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: border }]}
              />""", """                maxLength={50}
                autoCapitalize="words"
                textContentType="name"
                autoComplete="name"
                onFocus={() => setFocusField('name')}
                onBlur={() => { setFocusField(null); touch('name'); setEditName((v) => v.trim().replace(/\\s+/g, ' ')); }}
                style={fieldStyle('name')}
              />
              {errText('name')}""")
# phone
rep("""                keyboardType="number-pad"
                maxLength={10}
                style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: border }]}
              />""", """                keyboardType="number-pad"
                maxLength={10}
                textContentType="telephoneNumber"
                onFocus={() => setFocusField('phone')}
                onBlur={() => { setFocusField(null); touch('phone'); }}
                style={fieldStyle('phone')}
              />
              {errText('phone')}""")
# email
rep("""                autoCorrect={false}
                maxLength={100}
                style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: border }]}
              />""", """                autoCorrect={false}
                maxLength={100}
                textContentType="emailAddress"
                onFocus={() => setFocusField('email')}
                onBlur={() => { setFocusField(null); touch('email'); setEditEmail((v) => v.trim()); }}
                style={fieldStyle('email')}
              />
              {errText('email')}""")
# about
rep("style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: border, height: 80, textAlignVertical: 'top', paddingTop: 10 }]}",
    "onFocus={() => setFocusField('about')}\n                onBlur={() => setFocusField(null)}\n                style={fieldStyle('about', { height: 80, textAlignVertical: 'top', paddingTop: 10 })}")
# block
rep("""                maxLength={HOSTEL_BLOCK_MAX}
                style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: border }]}
              />""", """                maxLength={HOSTEL_BLOCK_MAX}
                onFocus={() => setFocusField('block')}
                onBlur={() => { setFocusField(null); touch('block'); }}
                style={fieldStyle('block')}
              />
              {errText('block')}""")
rep("<Text style={{ fontSize: 12, fontWeight: '600', color: on ? '#000' : txt }}>{block}</Text>",
    "<Text style={{ fontSize: 12, fontWeight: '600', color: on ? (isDark ? '#000' : '#FFF') : txt }}>{block}</Text>")
# room
rep("""                autoCapitalize="characters"
                autoCorrect={false}
                style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: border }]}
              />""", """                autoCapitalize="characters"
                autoCorrect={false}
                onFocus={() => setFocusField('room')}
                onBlur={() => { setFocusField(null); touch('room'); touch('block'); }}
                style={fieldStyle('room')}
              />
              {errText('room')}""")
# address
rep("""                  maxLength={200}
                  style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: border }]}
                />""", """                  maxLength={200}
                  onFocus={() => setFocusField('address')}
                  onBlur={() => setFocusField(null)}
                  style={fieldStyle('address')}
                />""")
rep("<View style={[s.suggestionsBox, { backgroundColor: cardBg, borderColor: border }]}>",
    "<View style={[s.suggestionsBox, { backgroundColor: isDark ? colors.card : '#FFFFFF', borderColor: inputBorder }]}>")
# city
rep("""                placeholder="City"
                placeholderTextColor={txtSec}
                maxLength={60}
                style={[s.modalInput, { color: txt, backgroundColor: inputBg, borderColor: border }]}
              />""", """                placeholder="City"
                placeholderTextColor={txtSec}
                maxLength={60}
                autoCapitalize="words"
                onFocus={() => setFocusField('city')}
                onBlur={() => { setFocusField(null); touch('city'); }}
                style={fieldStyle('city')}
              />
              {errText('city')}
              {triedSave && Object.keys(fieldErrors).length ? (
                <Text style={[s.fieldError, { alignSelf: 'center', marginTop: 10 }]}>Fix the fields marked in red to save.</Text>
              ) : null}""")

# gallery button + save spinner colour
rep("                style={s.localUploadBtn}\n", "                style={[s.localUploadBtn, !isDark && { backgroundColor: d.soft, borderColor: d.acc }]}\n")
rep("<Text style={s.localUploadBtnText}>{isDataUriImage ? 'Choose a different photo' : 'Choose from gallery'}</Text>",
    "<Text style={[s.localUploadBtnText, !isDark && { color: d.acc }]}>{isDataUriImage ? 'Choose a different photo' : 'Choose from gallery'}</Text>")
rep("""                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Text style={s.modalSaveBtnText}>""", """                    <ActivityIndicator size="small" color={isDark ? '#000' : '#FFF'} />
                  ) : (
                    <Text style={s.modalSaveBtnText}>""")

# styles
rep("  localUploadBtnText: {", """  fieldError: {
    alignSelf: 'flex-start',
    fontSize: 11.5,
    fontWeight: '600',
    color: '#DC2626',
    marginTop: -3,
    marginBottom: 6,
    marginLeft: 2,
  },
  localUploadBtnText: {""")

open(p, 'w', encoding='utf8').write(t)
print('ok')
