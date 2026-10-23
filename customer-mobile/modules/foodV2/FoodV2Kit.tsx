/**
 * Food & groceries (owner reference v2, 23 Oct): shared pictures and small drawn graphics.
 *  - FOOD_IMG: Unsplash photos (Unsplash licence: free for commercial use, no attribution needed),
 *    requested at about 2x their on-screen size. Placeholders until the owner supplies own art.
 *  - StorefrontArt / ShoppingBasketArt / WaveArt: drawn here with react-native-svg (no licence needed).
 *  - LoadingDots: three green dots for "Loading products…" (still when reduce motion is on).
 */
import React, { memo, useEffect, useId, useRef } from 'react';
import { Animated, Easing, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient as SvgLinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useReducedMotion } from '../../modules/others/motion';
import { FOOD } from './foodV2Theme';

const U = (id: string, w: number) => `https://images.unsplash.com/photo-${id}?w=${w}&q=80&auto=format&fit=crop`;

/** Hero, tile and banner photos (all Unsplash; see the report for the list to replace). */
export const FOOD_IMG = {
  // Home hero: vegetables on a dark background, faded into the dark-green card.
  homeHero: U('1518843875459-f738682238a6', 640),
  // Category tiles (shown about 110-175 px wide)
  tileGroceries: U('1609842947419-ba4f04d5d60f', 360),
  tileFresh: U('1597362925123-77861d3fbac7', 360),
  tileSnacks: U('1708746333830-6a40a841e810', 360),
  tileBakery: U('1709798288301-719572ca8e98', 480),
  tileHealth: U('1517278862943-719c3d4315b3', 480),
  tileToys: U('1594787318286-3d835c1d207f', 360),
  // Listing banners (shown about 190 x 120)
  heroGroceries: U('1787287247567-940708347940', 480),
  heroFresh: U('1590779033100-9f60a05a013d', 480),
  heroSnacks: U('1621939514649-280e2ee25f60', 480),
  heroBakery: U('1709798289100-7b46217e0325', 480),
  heroHealth: U('1517278862943-719c3d4315b3', 480),
  heroToys: U('1594787318286-3d835c1d207f', 480),
  heroDeals: U('1610832958506-aa56368176cf', 480),
  heroSeeds: U('1592924357228-91a4daadcfea', 480),
  heroElectronics: U('1583863788434-e58a36330cf0', 480),
  heroAll: U('1542838132-92c53300491e', 480),
  // Home "Daily essentials, snacks and home needs" banner
  essentials: U('1534723452862-4c874018d66d', 800),
};

/** useId gives ":r1:"-style ids; SVG url(#id) references need plain characters. */
const useSvgId = (name: string) => `${name}${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

/** Green storefront with a striped awning and leaves ("The store is stocking up"). */
export const StorefrontArt = memo(({ width = 200 }: { width?: number }) => {
  const id = useSvgId('sf');
  const h = Math.round(width * 0.78);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Svg width={width} height={h} viewBox="0 0 200 156">
      <Defs>
        <RadialGradient id={`${id}glow`} cx="50%" cy="58%" r="55%">
          <Stop offset="0" stopColor="#3BC671" stopOpacity="0.42" />
          <Stop offset="1" stopColor="#3BC671" stopOpacity="0" />
        </RadialGradient>
        <SvgLinearGradient id={`${id}body`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#28B15F" />
          <Stop offset="1" stopColor="#0F6A35" />
        </SvgLinearGradient>
        <SvgLinearGradient id={`${id}leaf`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#5FD68A" />
          <Stop offset="1" stopColor="#11713A" />
        </SvgLinearGradient>
        <SvgLinearGradient id={`${id}win`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#7EE0A2" />
          <Stop offset="1" stopColor="#2E9C59" />
        </SvgLinearGradient>
      </Defs>
      <Ellipse cx="100" cy="88" rx="96" ry="66" fill={`url(#${id}glow)`} />
      {/* leaves behind the store */}
      <G fill={`url(#${id}leaf)`}>
        <Path d="M30 132 C 6 112, 8 76, 30 62 C 40 86, 44 110, 30 132 Z" />
        <Path d="M40 136 C 22 128, 10 104, 18 88 C 34 100, 44 118, 40 136 Z" opacity={0.85} />
        <Path d="M170 132 C 194 112, 192 76, 170 62 C 160 86, 156 110, 170 132 Z" />
        <Path d="M160 136 C 178 128, 190 104, 182 88 C 166 100, 156 118, 160 136 Z" opacity={0.85} />
      </G>
      <G stroke="#0B5A2E" strokeWidth={1.2} opacity={0.5} fill="none">
        <Path d="M30 128 C 26 104, 28 84, 30 66" />
        <Path d="M170 128 C 174 104, 172 84, 170 66" />
      </G>
      {/* store body */}
      <Rect x="50" y="62" width="100" height="74" rx="6" fill={`url(#${id}body)`} />
      {/* awning: white and green stripes with a scalloped edge */}
      <Path d="M44 40 L 156 40 L 162 64 L 38 64 Z" fill="#FFFFFF" />
      <G fill="#22A04F">
        <Path d="M58 40 L 74 40 L 72 64 L 54 64 Z" />
        <Path d="M90 40 L 106 40 L 106 64 L 89 64 Z" />
        <Path d="M122 40 L 138 40 L 143 64 L 124 64 Z" />
      </G>
      <G fill="#FFFFFF">
        <Circle cx="46" cy="64" r="8" /><Circle cx="63" cy="64" r="8" /><Circle cx="80" cy="64" r="8" />
        <Circle cx="97" cy="64" r="8" /><Circle cx="114" cy="64" r="8" /><Circle cx="131" cy="64" r="8" /><Circle cx="148" cy="64" r="8" />
      </G>
      <G fill="#22A04F">
        <Circle cx="63" cy="64" r="8" /><Circle cx="97" cy="64" r="8" /><Circle cx="131" cy="64" r="8" />
      </G>
      <Rect x="42" y="34" width="116" height="8" rx="4" fill="#0E6B36" />
      {/* windows and door */}
      <Rect x="60" y="82" width="26" height="22" rx="3" fill={`url(#${id}win)`} />
      <Rect x="114" y="82" width="26" height="22" rx="3" fill={`url(#${id}win)`} />
      <Path d="M73 82 L 73 104 M 60 93 L 86 93 M 127 82 L 127 104 M 114 93 L 140 93" stroke="#0F6A35" strokeWidth={2} />
      <Rect x="90" y="88" width="20" height="48" rx="3" fill="#0B5A2E" />
      <Rect x="93" y="92" width="14" height="20" rx="2" fill="#2E9C59" opacity={0.85} />
      <Circle cx="106" cy="116" r="1.6" fill="#BFF2CF" />
      {/* ground */}
      <Rect x="40" y="134" width="120" height="5" rx="2.5" fill="#0B5A2E" opacity={0.7} />
    </Svg>
    </View>
  );
});

/** Basket of groceries on leaves ("Can't find something?" shopping list page). */
export const ShoppingBasketArt = memo(({ width = 220 }: { width?: number }) => {
  const id = useSvgId('sb');
  const h = Math.round(width * 0.62);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Svg width={width} height={h} viewBox="0 0 220 136">
      <Defs>
        <SvgLinearGradient id={`${id}bk`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#E9D3A8" />
          <Stop offset="1" stopColor="#B99460" />
        </SvgLinearGradient>
        <RadialGradient id={`${id}tm`} cx="35%" cy="30%" r="70%">
          <Stop offset="0" stopColor="#FF8C73" /><Stop offset="0.5" stopColor="#EE3B29" /><Stop offset="1" stopColor="#A91B10" />
        </RadialGradient>
        <RadialGradient id={`${id}or`} cx="35%" cy="30%" r="70%">
          <Stop offset="0" stopColor="#FFD37A" /><Stop offset="0.55" stopColor="#FF9F1C" /><Stop offset="1" stopColor="#D06A08" />
        </RadialGradient>
        <RadialGradient id={`${id}gr`} cx="35%" cy="30%" r="70%">
          <Stop offset="0" stopColor="#B4EB7A" /><Stop offset="0.55" stopColor="#4DB33D" /><Stop offset="1" stopColor="#23752A" />
        </RadialGradient>
        <SvgLinearGradient id={`${id}lf`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#5FD68A" /><Stop offset="1" stopColor="#0E6B33" />
        </SvgLinearGradient>
      </Defs>
      <G fill={`url(#${id}lf)`}>
        <Path d="M30 124 C 6 108, 8 78, 28 64 C 40 86, 44 106, 30 124 Z" />
        <Path d="M190 124 C 214 108, 212 78, 192 64 C 180 86, 176 106, 190 124 Z" />
        <Path d="M48 128 C 30 122, 20 102, 26 90 C 40 100, 50 114, 48 128 Z" opacity={0.85} />
        <Path d="M172 128 C 190 122, 200 102, 194 90 C 180 100, 170 114, 172 128 Z" opacity={0.85} />
      </G>
      {/* handle */}
      <Path d="M68 66 C 68 18, 152 18, 152 66" stroke="#2B2B2B" strokeWidth={7} fill="none" strokeLinecap="round" />
      {/* produce */}
      <Path d="M92 54 L 100 22 Q 103 16 108 22 L 112 54 Z" fill="#E23D2E" />
      <Rect x="114" y="28" width="22" height="30" rx="4" fill="#F2C230" />
      <Circle cx="84" cy="60" r="15" fill={`url(#${id}or)`} />
      <Circle cx="112" cy="62" r="14" fill={`url(#${id}tm)`} />
      <Circle cx="138" cy="60" r="15" fill={`url(#${id}gr)`} />
      <Ellipse cx="80" cy="55" rx="5" ry="3" fill="#FFFFFF" opacity={0.5} />
      <Ellipse cx="108" cy="57" rx="4.5" ry="2.6" fill="#FFFFFF" opacity={0.5} />
      <Ellipse cx="134" cy="55" rx="5" ry="3" fill="#FFFFFF" opacity={0.45} />
      {/* basket */}
      <Path d="M56 66 L 164 66 L 156 120 Q 155 126 148 126 L 72 126 Q 65 126 64 120 Z" fill={`url(#${id}bk)`} />
      <Rect x="52" y="62" width="116" height="10" rx="5" fill="#CFAE78" />
      <G stroke="#8E6B3A" strokeWidth={1.2} opacity={0.35}>
        <Path d="M60 86 L 160 86 M 62 102 L 158 102" />
      </G>
      <Ellipse cx="110" cy="130" rx="74" ry="5" fill="#000000" opacity={0.25} />
    </Svg>
    </View>
  );
});

/** Soft green hills along the bottom of a listing page (decorative, sits behind the list). */
export const WaveArt = memo(({ width, height = 90, style }: { width: number; height?: number; style?: StyleProp<ViewStyle> }) => {
  const id = useSvgId('wv');
  return (
    <View style={style} pointerEvents="none">
      <Svg width={width} height={height} viewBox="0 0 400 90" preserveAspectRatio="none">
        <Defs>
          <SvgLinearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#2FA35B" stopOpacity="0.55" />
            <Stop offset="1" stopColor="#0E6B33" stopOpacity="0.9" />
          </SvgLinearGradient>
          <SvgLinearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#5FC983" stopOpacity="0.35" />
            <Stop offset="1" stopColor="#1E8E3E" stopOpacity="0.55" />
          </SvgLinearGradient>
        </Defs>
        <Path d="M0 40 C 60 10, 110 10, 170 38 C 230 66, 300 22, 400 30 L 400 90 L 0 90 Z" fill={`url(#${id}b)`} />
        <Path d="M0 62 C 70 34, 130 48, 190 62 C 260 78, 320 44, 400 54 L 400 90 L 0 90 Z" fill={`url(#${id}a)`} />
      </Svg>
    </View>
  );
});

/** Three green dots that pulse in turn ("Loading products…"). */
export function LoadingDots({ color = FOOD.primary }: { color?: string }) {
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.timing(v, { toValue: 3, duration: 1200, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduce, v]);
  return (
    <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center' }} accessibilityElementsHidden>
      {[0, 1, 2].map(i => (
        <Animated.View
          key={i}
          style={{
            width: 8, height: 8, borderRadius: 4, backgroundColor: color,
            opacity: reduce ? (i === 2 ? 1 : 0.45) : v.interpolate({ inputRange: [0, i, i + 0.5, i + 1, 3], outputRange: [0.35, 0.35, 1, 0.35, 0.35], extrapolate: 'clamp' }),
          }}
        />
      ))}
    </View>
  );
}
