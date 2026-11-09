"""Profile restyle follow-up (10 Nov 2026): leftovers of the old gold styling after the diet-accent switch.
Badge name was white on the now-light card, accent buttons kept black text, section bars stayed gold, and the web
Switch drew its default green thumb. Run once."""
import re
p = 'app/(tabs)/profile.tsx'
t = open(p, encoding='utf8').read()
assert 'restyle-fixes-2026-11-10' not in t

def rep(old, new, count=1):
    global t
    assert t.count(old) >= count, old[:70]
    t = t.replace(old, new, count)

rep("<Text style={s.badgeTitle}>{badgeName}</Text>", "<Text style={[s.badgeTitle, { color: txt }]}>{badgeName}</Text>")
for label in ['Spin the wheel', 'Try again', 'Order now']:
    rep("<Text style={{ color: '#000', fontSize: 12, fontWeight: '700', letterSpacing: 0.2 }}>%s</Text>" % label,
        "<Text style={{ color: isDark ? '#000' : '#FFF', fontSize: 12, fontWeight: '700', letterSpacing: 0.2 }}>%s</Text>" % label)
n = t.count("[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]")
t = t.replace("[s.sectionTitleText, { color: isDark ? goldColor : '#111' }]", "[s.sectionTitleText, { color: isDark ? goldColor : '#111', borderLeftColor: goldColor }]")
print('section titles', n)
t = t.replace('thumbColor="#FFFFFF"', 'thumbColor="#FFFFFF"\n                  {...({ activeThumbColor: "#FFFFFF" } as any)}')
# accent-background button texts: white on the diet accent (dark mode keeps black on gold)
for name in ['allergyAddBtnText', 'buddyShareBtnText', 'modalSaveBtnText']:
    m = re.search(r'(\n  %s: \{[^}]*?)color: \'#000\',' % name, t)
    if m:
        t = t[:m.start()] + m.group(1) + "color: '#FFF', // restyle-fixes-2026-11-10: white on the diet accent" + t[m.end():]
        print('fixed', name)
open(p, 'w', encoding='utf8').write(t)
print('ok')
