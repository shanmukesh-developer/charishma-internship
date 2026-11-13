// New Home pieces (owner, 13 Nov 2026), built from the approved prototype docs/prototypes/home-combined-2026-11-13
// (v69 + v72): deliver-to picker in the header, real-deals slideshow in the diet panel, round food-type icons,
// the live fire "Hot deals today" banner, the Hot deals grid and the "Restaurants near you" banner.
// Everything reads the live store list Home already loads (fields=summary: name, price, originalPrice, photo,
// category, dietType); nothing here is sample data.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Modal, TextInput, ActivityIndicator, Dimensions, KeyboardAvoidingView, Platform, Image as RNImage } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Canvas, Fill, Shader, ImageShader, Skia, useImage } from '@shopify/react-native-skia';
import { useSharedValue, useDerivedValue, useFrameCallback } from 'react-native-reanimated';
import { CachedImage } from '../SafeImage';
import { FoodMark, type HomeTheme } from './HomeRedesign2026';
import { useAuth } from '../../context/AuthContext';
import { useCampusHostelBlocks, saveHostelToProfile, cleanBlock, cleanRoom } from '../../utils/hostel';
import { useCollege, setCollege, isCollegeKey, type CollegeKey } from '../../utils/college';

const W = Dimensions.get('window').width;
const rupees = (v: number) => `₹${Math.round(v)}`;

// ─── Dishes ───────────────────────────────────────────────────────────────────
export type HomeDish = { id: string; name: string; price: number; orig: number | null; off: number; img: string; store: string; storeId: string; logo: string | null; veg: boolean; category: string };

/** The store's own diet tag (dietType veg / nonveg / egg); egg counts as non-veg. */
export const dishIsVeg = (m: any): boolean => {
  const d = String(m?.dietType || '').toLowerCase();
  if (d) return d === 'veg';
  return m?.isVegetarian === true;
};

/** Every available dish with a photo, from the live store list (summary menus). */
export function dishesFrom(restaurants: any[]): HomeDish[] {
  const out: HomeDish[] = [];
  for (const r of restaurants || []) {
    if (!r || r.isActive === false || r.isTestData) continue;
    const storeId = String(r.id || r._id || '');
    for (const m of r.menu || []) {
      if (!m || m.isAvailable === false || !m.imageUrl || !(Number(m.price) > 0)) continue;
      const price = Number(m.price);
      const orig = Number(m.originalPrice) > price ? Number(m.originalPrice) : null;
      out.push({
        id: String(m.id || m._id), name: String(m.name || '').trim(), price, orig,
        off: orig ? Math.round((100 * (orig - price)) / orig) : 0,
        img: String(m.imageUrl), store: String(r.name || ''), storeId, logo: r.logoUrl || null,
        veg: dishIsVeg(m), category: String(m.category || ''),
      });
    }
  }
  return out;
}

/** Best real offers for this diet: biggest discount first, one per restaurant, a biryani opens the slideshow. */
export function pickDeals(dishes: HomeDish[], veg: boolean, count: number, skip: Set<string> = new Set()): HomeDish[] {
  const seenStore = new Set<string>();
  const seenImg = new Set<string>();
  const picks: HomeDish[] = [];
  for (const d of dishes.filter((x) => x.veg === veg && x.off > 0 && !skip.has(x.id)).sort((a, b) => b.off - a.off || a.price - b.price)) {
    if (seenStore.has(d.storeId) || seenImg.has(d.img)) continue;
    seenStore.add(d.storeId); seenImg.add(d.img); picks.push(d);
    if (picks.length >= count) break;
  }
  return picks;
}

// ─── Food types (round icons + food-type pages) ───────────────────────────────
const has = (...w: string[]) => (d: { name: string; category: string }) => w.some((k) => `${d.category} ${d.name}`.toLowerCase().includes(k));
export type FoodType = { label: string; match: (d: { name: string; category: string }) => boolean; icon: any };
const IC = {
  allNon: require('../../assets/home-nov13/food-all-nonveg-2026-11-13.png'),
  allVeg: require('../../assets/home-nov13/food-all-veg-2026-11-13.png'),
};
export const FOOD_TYPES: Record<'nonveg' | 'veg', FoodType[]> = {
  nonveg: [
    { label: 'Biryani', match: has('biryani'), icon: require('../../assets/home-nov13/food-biryani-nonveg-2026-11-13.png') },
    { label: 'Shawarma', match: has('shawarma'), icon: require('../../assets/home-nov13/food-shawarma-nonveg-2026-11-13.png') },
    { label: 'Burgers', match: has('burger'), icon: require('../../assets/home-nov13/food-burgers-nonveg-2026-11-13.png') },
    { label: 'Noodles', match: has('noodle'), icon: require('../../assets/home-nov13/food-noodles-nonveg-2026-11-13.png') },
    { label: 'Fried rice', match: has('fried rice', 'friedrice'), icon: require('../../assets/home-nov13/food-fried-rice-nonveg-2026-11-13.png') },
    { label: 'Starters', match: has('65', 'lollipop', 'wings', 'kebab', 'tikka'), icon: require('../../assets/home-nov13/food-starters-nonveg-2026-11-13.png') },
    { label: 'Rolls', match: has('roll', 'sandwich'), icon: require('../../assets/home-nov13/food-rolls-nonveg-2026-11-13.png') },
  ],
  veg: [
    { label: 'Biryani', match: has('biryani'), icon: require('../../assets/home-nov13/food-biryani-veg-2026-11-13.png') },
    { label: 'Dosa', match: has('dosa'), icon: require('../../assets/home-nov13/food-dosa-veg-2026-11-13.png') },
    { label: 'Burgers', match: has('burger'), icon: require('../../assets/home-nov13/food-burgers-veg-2026-11-13.png') },
    { label: 'Momos', match: has('momo'), icon: require('../../assets/home-nov13/food-momos-veg-2026-11-13.png') },
    { label: 'Noodles', match: has('noodle'), icon: require('../../assets/home-nov13/food-noodles-veg-2026-11-13.png') },
    { label: 'Pasta', match: has('pasta'), icon: require('../../assets/home-nov13/food-pasta-veg-2026-11-13.png') },
    { label: 'Paneer', match: has('paneer', 'panner'), icon: require('../../assets/home-nov13/food-paneer-veg-2026-11-13.png') },
    { label: 'Fried rice', match: has('fried rice', 'friedrice'), icon: require('../../assets/home-nov13/food-fried-rice-veg-2026-11-13.png') },
  ],
};
export const foodTypeOf = (label: string, veg: boolean) => FOOD_TYPES[veg ? 'veg' : 'nonveg'].find((f) => f.label === label);

/** Round food icons: All first (three real dishes together), then the types this diet has dishes for. */
export function FoodTypeRow({ veg, theme, isDark, dishes, onOpen }: { veg: boolean; theme: HomeTheme; isDark: boolean; dishes: HomeDish[]; onOpen: (label: string) => void }) {
  const types = FOOD_TYPES[veg ? 'veg' : 'nonveg'].filter((f) => dishes.some((d) => d.veg === veg && f.match(d)));
  const ring = isDark ? '#1F1D1B' : '#FFFFFF';
  const line = isDark ? '#2A2725' : '#ECE7E3';
  const sub = isDark ? '#A39A93' : '#7A716B';
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.catRow}>
      <View style={st.cat}>
        <View style={[st.catRing, { backgroundColor: ring, borderColor: theme.acc, borderWidth: 2 }]}><RNImage source={veg ? IC.allVeg : IC.allNon} style={st.catImg} /></View>
        <Text style={[st.catLbl, { color: theme.acc }]}>All</Text>
        <View style={[st.catUnder, { backgroundColor: theme.acc }]} />
      </View>
      {types.map((f) => (
        <Pressable key={f.label} style={st.cat} onPress={() => onOpen(f.label)} accessibilityRole="button" accessibilityLabel={`${f.label}: every dish`}>
          <View style={[st.catRing, { backgroundColor: ring, borderColor: line }]}><RNImage source={f.icon} style={st.catImg} /></View>
          <Text style={[st.catLbl, { color: sub }]} numberOfLines={1}>{f.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// ─── Deals slideshow (inside the diet panel) ─────────────────────────────────
export function DealSlideshow({ deals, theme, onOpen, active }: { deals: HomeDish[]; theme: HomeTheme; onOpen: (d: HomeDish) => void; active: boolean }) {
  const ref = useRef<ScrollView>(null);
  const [i, setI] = useState(0);
  const iRef = useRef(0);
  const touching = useRef(false);
  useEffect(() => { iRef.current = 0; setI(0); ref.current?.scrollTo({ x: 0, animated: false }); }, [deals]);
  useEffect(() => {
    if (!active || deals.length < 2) return;
    const id = setInterval(() => {
      if (touching.current) return;
      const next = (iRef.current + 1) % deals.length;
      ref.current?.scrollTo({ x: next * W, animated: true });
    }, 3500);
    return () => clearInterval(id);
  }, [active, deals.length]);
  if (!deals.length) return null;
  const tint = theme.acc2;
  return (
    <View>
      <ScrollView
        ref={ref} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={() => { touching.current = true; }}
        onScrollEndDrag={() => { touching.current = false; }}
        onMomentumScrollEnd={(e) => { const k = Math.round(e.nativeEvent.contentOffset.x / W); iRef.current = k; setI(k); }}
        scrollEventThrottle={32}
      >
        {deals.map((d) => (
          <View key={d.id} style={[st.slide, { width: W }]}>
            <View style={st.deal}>
              <View style={st.pctRow}>
                <Text style={st.pct}>{d.off}%</Text>
                <Text style={st.pctSide}>OFF{'\n'}TODAY</Text>
              </View>
              <Text style={st.dealName} numberOfLines={2}>{d.name}</Text>
              <View style={st.dealFrom}>
                {d.logo ? <CachedImage source={{ uri: d.logo }} style={st.dealLogo} maxWidth={60} /> : null}
                <Text style={st.dealStore} numberOfLines={1}>{d.store}</Text>
              </View>
              <Pressable onPress={() => onOpen(d)} style={st.order} accessibilityRole="button" accessibilityLabel={`Order ${d.name} for ${rupees(d.price)}`}>
                <Text style={[st.orderTxt, { color: theme.sel }]}>Order now</Text>
                <View style={[st.orderPrice, { backgroundColor: theme.sel }]}>
                  <Text style={st.orderNow}>{rupees(d.price)}</Text>
                  {d.orig ? <Text style={st.orderWas}>{rupees(d.orig)}</Text> : null}
                </View>
              </Pressable>
              {d.orig ? <Text style={[st.save, { color: tint }]}>You save {rupees(d.orig - d.price)}</Text> : null}
            </View>
            <Pressable onPress={() => onOpen(d)} style={st.plate} accessibilityLabel={d.name}>
              <View style={st.plateRim}>
                <CachedImage source={{ uri: d.img }} style={st.plateImg} maxWidth={360} />
              </View>
            </Pressable>
          </View>
        ))}
      </ScrollView>
      {deals.length > 1 && (
        <View style={st.dots}>
          {deals.map((d, k) => <View key={d.id} style={[st.dot, k === i && st.dotOn]} />)}
        </View>
      )}
    </View>
  );
}

// ─── Live fire "Hot deals today" banner (Skia shader, same as the prototype's WebGL fire) ─────────────
// The words are bundled masks (letters, dark outline, flame fuel) drawn from the prototype in its Anton font;
// the shader grows thin tapering flames from the letter tops every frame. Paused when Home is not on screen.
const FIRE_SKSL = `
uniform shader m; uniform shader o; uniform shader f;
uniform float t; uniform float2 r; uniform float top;
float h(float2 p){return fract(sin(dot(p,float2(127.1,311.7)))*43758.5453);}
float n(float2 p){float2 i=floor(p);float2 q=fract(p);q=q*q*(3.0-2.0*q);
  return mix(mix(h(i),h(i+float2(1,0)),q.x),mix(h(i+float2(0,1)),h(i+float2(1,1)),q.x),q.y);}
float fbm(float2 p){float s=0.0;float a=0.5;for(int i=0;i<5;i++){s+=a*n(p);p=p*2.07+float2(1.7,9.2);a*=0.5;}return s;}
float3 ramp(float x){x=clamp(x,0.0,1.6);float3 c=mix(float3(0.0),float3(0.6,0.04,0.0),smoothstep(0.0,0.2,x));
  c=mix(c,float3(1.0,0.36,0.0),smoothstep(0.16,0.45,x));c=mix(c,float3(1.0,0.76,0.14),smoothstep(0.42,0.8,x));
  return mix(c,float3(1.0,0.98,0.85),smoothstep(0.8,1.25,x));}
float sm(float2 v){return m.eval(float2(v.x*r.x,(1.0-v.y)*r.y)).r;}
float so(float2 v){return o.eval(float2(v.x*r.x,(1.0-v.y)*r.y)).r;}
float sf(float2 v){return f.eval(float2(clamp(v.x,0.0,1.0)*r.x,(1.0-clamp(v.y,0.0,1.0))*r.y)).r;}
half4 main(float2 xy){
  float2 v=float2(xy.x/r.x,1.0-xy.y/r.y);
  float2 px=float2(xy.x,r.y-xy.y)*1.6;
  float up=clamp((v.y-top)/(1.0-top),0.0,1.0);
  float2 q=float2(px.x/9.0,px.y/26.0-t*3.4);
  float2 w=float2(fbm(q+float2(0.0,t*0.6)),fbm(q+float2(5.2,1.3)));
  float tongue=fbm(q+1.6*w);
  float2 d=float2((w.x-0.5)*0.16*up,-max(v.y-top,0.0)*0.9-0.015);
  float fu=sf(v+d);
  float tall=0.72+0.6*fbm(float2(px.x/70.0,t*0.35));
  float heat=fu*(tongue*2.4-pow(up,0.85)*1.25/tall);
  float fine=n(float2(px.x/3.2,px.y/5.0-t*9.0));
  heat=max(heat,0.0)*2.3*(0.82+0.36*fine);
  heat+=fu*smoothstep(0.22,0.0,up)*0.55;
  heat*=smoothstep(0.99,0.8,v.y);
  float L=sm(v);float O=so(v);
  float flick=0.9+0.1*n(float2(t*8.0,px.x/24.0));
  float ly=clamp((v.y-(top-0.42))/0.42,0.0,1.0);
  float3 letter=mix(float3(0.8,0.1,0.02),float3(1.0,0.86,0.32),smoothstep(0.0,0.95,ly))*flick;
  float3 col=ramp(heat);float al=smoothstep(0.06,0.5,heat);
  float2 sg=float2(px.x/12.0+sin(t*1.1+px.y/23.0)*0.45,px.y/12.0-t*2.6);
  float2 id=floor(sg);float2 fp=fract(sg)-0.5;float rn=h(id);
  float2 so2=float2(h(id+3.1)-0.5,h(id+7.7)-0.5)*0.55;
  float base=sf(float2(v.x,top-0.015));
  float sp=step(0.9,rn)*smoothstep(0.07+0.10*h(id+1.9),0.0,length(fp-so2))*smoothstep(0.0,0.25,base*2.0)*step(top+0.03,v.y)*(1.0-up*0.8);
  sp*=0.6+0.4*sin(t*12.0+rn*40.0);
  col=mix(col,mix(float3(1.0,0.85,0.4),float3(1.0,0.3,0.05),up),sp*(1.0-L));al=max(al,sp);
  col=mix(col,float3(0.24,0.02,0.02),O*(1.0-L));al=max(al,O*0.95);
  col=mix(col,letter,L);al=max(al,L);
  return half4(half3(col*al),half(al));
}`;
const FIRE_EFFECT = Skia.RuntimeEffect.Make(FIRE_SKSL);
const FIRE_TOP = 0.5105; // where the letter tops sit in the masks (export-app-assets-2026-11-13.py)
const MASK_W = 280;
const MASK_H = 76;

function FireLetters({ width, active }: { width: number; active: boolean }) {
  const mk = useImage(require('../../assets/home-nov13/fire-letters-mask-2026-11-13.png'));
  const ol = useImage(require('../../assets/home-nov13/fire-outline-mask-2026-11-13.png'));
  const fu = useImage(require('../../assets/home-nov13/fire-fuel-mask-2026-11-13.png'));
  const cw = Math.min(width, MASK_W);
  const ch = (cw * MASK_H) / MASK_W;
  const t = useSharedValue(1.3);
  const frame = useFrameCallback((f) => { t.value = f.timeSinceFirstFrame / 1000; }, false);
  useEffect(() => { frame.setActive(active); }, [active, frame]);
  const uniforms = useDerivedValue(() => ({ t: t.value, r: [cw, ch], top: FIRE_TOP }), [cw, ch]);
  if (!FIRE_EFFECT || !mk || !ol || !fu) {
    return <Text style={[st.fireFallback, { width: cw }]}>HOT DEALS TODAY</Text>;
  }
  const rect = { x: 0, y: 0, width: cw, height: ch };
  return (
    <Canvas style={{ width: cw, height: ch }}>
      <Fill>
        <Shader source={FIRE_EFFECT} uniforms={uniforms}>
          <ImageShader image={mk} fit="fill" rect={rect} />
          <ImageShader image={ol} fit="fill" rect={rect} />
          <ImageShader image={fu} fit="fill" rect={rect} />
        </Shader>
      </Fill>
    </Canvas>
  );
}

export function FireDealsBanner({ veg, onSeeAll, active }: { veg: boolean; onSeeAll: () => void; active: boolean }) {
  const barW = W - 40;
  return (
    <View style={[st.fireBar, { backgroundColor: veg ? '#0C1F12' : '#2A0708' }]} accessibilityRole="header" accessibilityLabel="Hot deals today">
      <LinearGradient colors={veg ? ['#06110A', '#0C1F12', '#13291A'] : ['#160405', '#2A0708', '#3A0A0A']} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(255,110,20,0)', 'rgba(255,110,20,0.42)']} start={{ x: 0.3, y: 0.4 }} end={{ x: 0.3, y: 1.1 }} style={StyleSheet.absoluteFill} />
      <View style={st.fireCanvas}><FireLetters width={barW - 96} active={active} /></View>
      <Pressable onPress={onSeeAll} style={st.fireSeeAll} accessibilityRole="button" accessibilityLabel="See all deals">
        <Text style={st.fireSeeAllTxt}>See all</Text>
        <Ionicons name="chevron-forward" size={13} color="#FFE7C2" />
      </Pressable>
    </View>
  );
}

// ─── Hot deals grid ───────────────────────────────────────────────────────────
export function HotDealsGrid({ deals, theme, isDark, onOpen }: { deals: HomeDish[]; theme: HomeTheme; isDark: boolean; onOpen: (d: HomeDish) => void }) {
  if (!deals.length) return null;
  const card = isDark ? '#1A1817' : '#FFFFFF';
  const line = isDark ? '#2A2725' : '#ECE7E3';
  const txt = isDark ? '#F4F1EE' : '#14110F';
  const sub = isDark ? '#A39A93' : '#7A716B';
  return (
    <View style={st.grid}>
      {deals.map((d) => (
        <Pressable key={d.id} onPress={() => onOpen(d)} style={[st.card, { backgroundColor: card, borderColor: line }]} accessibilityRole="button" accessibilityLabel={`${d.name}, ${d.off}% off, ${rupees(d.price)}`}>
          <View style={st.cardArt}><CachedImage source={{ uri: d.img }} style={st.cardImg} maxWidth={200} /></View>
          <View style={st.tagRow}>
            <FoodMark veg={d.veg} size={11} />
            <View style={[st.offPill, { backgroundColor: theme.acc }]}><Text style={st.offTxt}>-{d.off}%</Text></View>
          </View>
          <Text style={[st.cardName, { color: txt }]} numberOfLines={2}>{d.name}</Text>
          <Text style={[st.cardStore, { color: sub }]} numberOfLines={1}>{d.store}</Text>
          <View style={st.cardRow}>
            <Text style={[st.cardPrice, { color: txt }]}>{rupees(d.price)}{d.orig ? <Text style={[st.cardWas, { color: sub }]}>  {rupees(d.orig)}</Text> : null}</Text>
            <View style={[st.cardAdd, { backgroundColor: theme.acc }]}><Ionicons name="add" size={17} color="#fff" /></View>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

// ─── "Restaurants near you" banner ────────────────────────────────────────────
export function RestaurantsBanner({ theme, count, logos }: { theme: HomeTheme; count: number; logos: string[] }) {
  const shown = logos.slice(0, 4);
  return (
    <LinearGradient colors={[theme.top, theme.sel]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.restBar}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.restTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>RESTAURANTS NEAR YOU</Text>
        <Text style={st.restSub}>{count} {count === 1 ? 'place' : 'places'} · deliver to campus</Text>
      </View>
      <View style={st.restLogos}>
        {shown.map((u, k) => <CachedImage key={u + k} source={{ uri: u }} style={[st.restLogo, k > 0 && { marginLeft: -9 }]} maxWidth={80} />)}
        {count > shown.length && <View style={[st.restLogo, st.restMore, { marginLeft: -9 }]}><Text style={[st.restMoreTxt, { color: theme.acc }]}>+{count - shown.length}</Text></View>}
      </View>
    </LinearGradient>
  );
}

// ─── Deliver-to (header) + picker sheet ───────────────────────────────────────
// Campus -> hostel block -> room, the same campus directory and wording as checkout ("The rider calls you at your
// hostel gate."). Signed in: saved on the profile (what checkout reads). Guest: kept on this phone.
const GUEST_DROP_KEY = 'zenwe_dropoff_guest_v1';
type Drop = { block: string; room: string };

export function useDropoff() {
  const { user, setUser } = useAuth();
  const [guest, setGuest] = useState<Drop | null>(null);
  useEffect(() => { AsyncStorage.getItem(GUEST_DROP_KEY).then((v) => { try { const p = v ? JSON.parse(v) : null; if (p && p.block) setGuest(p); } catch { /* ignore */ } }).catch(() => {}); }, []);
  const drop: Drop | null = user?.hostelBlock ? { block: cleanBlock(user.hostelBlock), room: cleanRoom((user as any).roomNumber) } : guest;
  const save = useCallback(async (d: Drop) => {
    if (user) {
      const updated = await saveHostelToProfile(d.block, d.room);
      setUser(updated);
    } else {
      setGuest(d);
      await AsyncStorage.setItem(GUEST_DROP_KEY, JSON.stringify(d)).catch(() => {});
    }
  }, [user, setUser]);
  return { drop, save };
}

export function DeliverToButton({ campusName, drop, onPress }: { campusName: string; drop: Drop | null; onPress: () => void }) {
  const line2 = drop?.block ? `${drop.block}${drop.room ? `, Room ${drop.room}` : ''}` : campusName;
  return (
    <Pressable onPress={onPress} style={st.where} accessibilityRole="button" accessibilityLabel={`Delivering to ${line2}. Change`} hitSlop={6}>
      <Text style={st.whereTop} numberOfLines={1}>{drop?.block ? `Deliver to · ${campusName}` : 'Delivering to'}</Text>
      <View style={st.whereRow}>
        <Ionicons name="location" size={12} color="#FFC9A8" />
        <Text style={st.whereMain} numberOfLines={1}>{line2}</Text>
        <Ionicons name="chevron-down" size={12} color="rgba(255,255,255,0.85)" />
      </View>
    </Pressable>
  );
}

export function DeliverySheet({ visible, onClose, theme, isDark, drop, onSave }: { visible: boolean; onClose: () => void; theme: HomeTheme; isDark: boolean; drop: Drop | null; onSave: (d: Drop) => Promise<void> }) {
  const campuses = useCampusHostelBlocks(visible).filter((c) => isCollegeKey(c.code.toLowerCase()));
  const college = useCollege();
  const [code, setCode] = useState<CollegeKey | null>(null);
  const [block, setBlock] = useState('');
  const [room, setRoom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!visible) return;
    setCode(college || (campuses[0] ? (campuses[0].code.toLowerCase() as CollegeKey) : null));
    setBlock(drop?.block || ''); setRoom(drop?.room || ''); setErr('');
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const camp = campuses.find((c) => c.code.toLowerCase() === code) || campuses[0];
  const card = isDark ? '#1A1817' : '#FFFFFF';
  const page = isDark ? '#0E0D0C' : '#F6F4F2';
  const line = isDark ? '#2A2725' : '#ECE7E3';
  const txt = isDark ? '#F4F1EE' : '#14110F';
  const sub = isDark ? '#A39A93' : '#7A716B';
  const ok = !!block.trim() && !!cleanRoom(room) && !busy;
  const save = async () => {
    if (!ok) return;
    setBusy(true); setErr('');
    try {
      if (code && code !== college) setCollege(code);
      await onSave({ block: cleanBlock(block), room: cleanRoom(room) });
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Couldn't save. Try again.");
    } finally { setBusy(false); }
  };
  const chip = (on: boolean) => [st.chip, { backgroundColor: on ? `${theme.acc}1A` : page, borderColor: on ? theme.acc : line }];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={st.scrim} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={st.sheetWrap}>
        <View style={[st.sheet, { backgroundColor: card }]}>
          <View style={[st.grab, { backgroundColor: line }]} />
          <Text style={[st.sheetTitle, { color: txt }]}>Where should we deliver?</Text>
          <Text style={[st.sheetNote, { color: sub }]}>The rider calls you at your hostel gate.</Text>
          <Text style={[st.lbl, { color: sub }]}>CAMPUS</Text>
          <View style={st.chips}>
            {campuses.length === 0 ? <ActivityIndicator color={theme.acc} /> : campuses.map((c) => {
              const k = c.code.toLowerCase() as CollegeKey;
              return (
                <Pressable key={c.code} onPress={() => { setCode(k); if (k !== code) setBlock(''); }} style={chip(k === code)} accessibilityRole="radio" accessibilityState={{ selected: k === code }}>
                  <Text style={[st.chipTxt, { color: k === code ? theme.acc : txt }]}>{c.name}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[st.lbl, { color: sub }]}>HOSTEL BLOCK</Text>
          {camp && camp.blocks.length ? (
            <View style={st.chips}>
              {camp.blocks.map((b) => (
                <Pressable key={b} onPress={() => setBlock(b)} style={chip(b === block)} accessibilityRole="radio" accessibilityState={{ selected: b === block }}>
                  <Text style={[st.chipTxt, { color: b === block ? theme.acc : txt }]}>{b}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <TextInput value={block} onChangeText={setBlock} placeholder="Hostel block, e.g. Ganga" placeholderTextColor={sub} maxLength={60} style={[st.input, { backgroundColor: page, borderColor: line, color: txt }]} />
          )}
          <Text style={[st.lbl, { color: sub }]}>ROOM NUMBER</Text>
          <TextInput value={room} onChangeText={setRoom} placeholder="e.g. 304" placeholderTextColor={sub} maxLength={20} style={[st.input, { backgroundColor: page, borderColor: line, color: txt }]} />
          {!!err && <Text style={st.err}>{err}</Text>}
          <Pressable onPress={save} disabled={!ok} style={[st.saveBtn, { backgroundColor: theme.acc, opacity: ok ? 1 : 0.45 }]} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.saveTxt}>Deliver here</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = StyleSheet.create({
  // food types
  catRow: { gap: 20, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4 },
  cat: { width: 54, alignItems: 'center' },
  catRing: { width: 54, height: 54, borderRadius: 27, borderWidth: 1, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  catImg: { width: 44, height: 44, resizeMode: 'contain' },
  catLbl: { fontSize: 11, fontWeight: '600', marginTop: 7, maxWidth: 68 },
  catUnder: { width: 18, height: 2, borderRadius: 1, marginTop: 3 },
  // slideshow
  slide: { height: 236, paddingHorizontal: 20, paddingTop: 10, flexDirection: 'row', alignItems: 'center' },
  deal: { width: '52%', zIndex: 2 },
  pctRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  pct: { fontSize: 50, fontWeight: '900', color: '#FFFFFF', letterSpacing: -2, lineHeight: 54 },
  pctSide: { fontSize: 14, fontWeight: '800', color: '#FFFFFF', lineHeight: 16, marginTop: 7, letterSpacing: 0.4 },
  dealName: { fontSize: 15, fontWeight: '800', color: '#FFFFFF', marginTop: 6, lineHeight: 19 },
  dealFrom: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  dealLogo: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)' },
  dealStore: { fontSize: 12, color: 'rgba(255,255,255,0.82)', flexShrink: 1 },
  order: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8, marginTop: 12, height: 38, paddingLeft: 14, paddingRight: 5, borderRadius: 19, backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  orderTxt: { fontSize: 12.5, fontWeight: '800' },
  orderPrice: { flexDirection: 'row', gap: 4, height: 28, paddingHorizontal: 10, borderRadius: 14, alignItems: 'center' },
  orderNow: { color: '#fff', fontSize: 13, fontWeight: '800' },
  orderWas: { color: 'rgba(255,255,255,0.65)', fontSize: 10, textDecorationLine: 'line-through', fontWeight: '600' },
  save: { fontSize: 11, fontWeight: '700', marginTop: 6 },
  plate: { position: 'absolute', right: 18, top: 28, width: 170, height: 170 },
  plateRim: { width: 170, height: 170, borderRadius: 85, padding: 8, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 18, shadowOffset: { width: 0, height: 14 }, elevation: 8 },
  plateImg: { width: '100%', height: '100%', borderRadius: 80 },
  dots: { flexDirection: 'row', gap: 6, paddingHorizontal: 20, marginTop: -14, height: 22 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotOn: { width: 20, backgroundColor: '#FFFFFF' },
  // fire banner
  fireBar: { marginHorizontal: 20, marginTop: 24, height: 76, borderRadius: 18, overflow: 'hidden', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingRight: 14, shadowColor: '#5A060A', shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  fireCanvas: { alignSelf: 'flex-end' },
  fireFallback: { color: '#FFC24A', fontSize: 24, fontWeight: '900', letterSpacing: 1, paddingLeft: 16, paddingBottom: 12 },
  fireSeeAll: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 7, paddingLeft: 13, paddingRight: 9, borderRadius: 999, marginBottom: 14, backgroundColor: 'rgba(255,120,40,0.18)', borderWidth: 1, borderColor: 'rgba(255,170,90,0.38)' },
  fireSeeAllTxt: { color: '#FFE7C2', fontSize: 12.5, fontWeight: '800' },
  // hot deals grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 54, rowGap: 40 },
  card: { width: (W - 52) / 2, borderRadius: 18, borderWidth: 1, paddingTop: 46, paddingHorizontal: 10, paddingBottom: 10, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 2 },
  cardArt: { position: 'absolute', top: -36, width: 80, height: 80, borderRadius: 40, padding: 3, backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 8 }, elevation: 5 },
  cardImg: { width: '100%', height: '100%', borderRadius: 37 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  offPill: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  offTxt: { color: '#fff', fontSize: 9.5, fontWeight: '800' },
  cardName: { fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 5 },
  cardStore: { fontSize: 10, marginTop: 2 },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', marginTop: 'auto', paddingTop: 6 },
  cardPrice: { fontSize: 13, fontWeight: '800' },
  cardWas: { fontSize: 9.5, fontWeight: '500', textDecorationLine: 'line-through' },
  cardAdd: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  // restaurants banner
  restBar: { marginHorizontal: 20, marginTop: 30, height: 76, borderRadius: 18, flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 14, gap: 10, shadowColor: '#4A0812', shadowOpacity: 0.4, shadowRadius: 14, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  restTitle: { color: '#FFD27A', fontSize: 18, fontWeight: '900', letterSpacing: 1.2, textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 0 },
  restSub: { color: 'rgba(255,255,255,0.78)', fontSize: 10.5, fontWeight: '700', marginTop: 5 },
  restLogos: { flexDirection: 'row', alignItems: 'center' },
  restLogo: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' },
  restMore: { backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  restMoreTxt: { fontSize: 11, fontWeight: '800' },
  // deliver to
  where: { alignItems: 'flex-end', maxWidth: 170 },
  whereTop: { fontSize: 10.5, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
  whereRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  whereMain: { fontSize: 12.5, fontWeight: '700', color: '#FFFFFF', flexShrink: 1 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30 },
  grab: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '800' },
  sheetNote: { fontSize: 12, marginTop: 3 },
  lbl: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.6, marginTop: 16, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12 },
  chipTxt: { fontSize: 12.5, fontWeight: '700' },
  input: { height: 46, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, fontSize: 15, fontWeight: '600' },
  err: { color: '#DC2626', fontSize: 12, marginTop: 8 },
  saveBtn: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  saveTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
