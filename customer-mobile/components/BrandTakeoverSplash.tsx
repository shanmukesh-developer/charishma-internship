import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions, Animated, Easing, Image } from 'react-native';

const { width: SW, height: SH } = Dimensions.get('window');

interface BrandTakeoverSplashProps {
  brandName: string;
  logoAnimationType: 'kfc-bucket-drop' | 'dominos-flip' | 'mcd-glow';
  logoUrl: string;
  onComplete: () => void;
}

const BRAND_LORE = {
  'kfc-bucket-drop': {
    founder: 'Colonel Harland Sanders',
    foundedYear: '1952',
    tagline: "IT'S FINGER LICKIN' GOOD",
    legendaryItems: [
      { name: 'Crispy Bucket', icon: '🍗' },
      { name: 'Zinger Burger', icon: '🍔' },
      { name: 'Popcorn Chicken', icon: '🍿' },
      { name: 'Coleslaw', icon: '🥗' },
    ],
    capsule: "The Colonel's Secret Recipe of 11 herbs & spices, perfected over 70+ years."
  },
  'dominos-flip': {
    founder: 'Tom Monaghan',
    foundedYear: '1960',
    tagline: 'OH YES WE DID',
    legendaryItems: [
      { name: 'Cheese Burst', icon: '🧀' },
      { name: 'Peppy Paneer', icon: '🫑' },
      { name: 'Garlic Bread', icon: '🥖' },
      { name: 'Choco Lava', icon: '🍫' },
    ],
    capsule: '30 minutes or free — the pizza promise that changed delivery forever.'
  },
  'mcd-glow': {
    founder: 'Ray Kroc',
    foundedYear: '1955',
    tagline: "I'M LOVIN' IT",
    legendaryItems: [
      { name: 'Big Mac', icon: '🍔' },
      { name: 'McFlurry', icon: '🍦' },
      { name: 'Golden Fries', icon: '🍟' },
      { name: 'Happy Meal', icon: '🎁' },
    ],
    capsule: 'From a single drive-in to 40,000+ restaurants — the Golden Arches empire.'
  }
};

export default function BrandTakeoverSplash({
  brandName,
  logoAnimationType,
  logoUrl,
  onComplete
}: BrandTakeoverSplashProps) {
  const lore = BRAND_LORE[logoAnimationType] || BRAND_LORE['kfc-bucket-drop'];

  // Shutters
  const leftShutterX = useRef(new Animated.Value(-SW / 2)).current;
  const rightShutterX = useRef(new Animated.Value(SW / 2)).current;

  // Content scaling & opacity
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentScale = useRef(new Animated.Value(0.9)).current;
  const shockwaveScale = useRef(new Animated.Value(0.65)).current;
  const shockwaveOpacity = useRef(new Animated.Value(0)).current;

  // Items animations
  const itemAnims = useRef(lore.legendaryItems.map(() => new Animated.Value(0))).current;

  // Colors
  const accentColor = 
    logoAnimationType === 'kfc-bucket-drop' ? '#FFC72C' :
    logoAnimationType === 'dominos-flip' ? '#006491' :
    '#FFC72C';

  const primaryColor = 
    logoAnimationType === 'kfc-bucket-drop' ? '#E4002B' :
    logoAnimationType === 'dominos-flip' ? '#E31B23' :
    '#DA291C';

  useEffect(() => {
    // Shutter Entrance
    Animated.parallel([
      Animated.timing(leftShutterX, {
        toValue: 0,
        duration: 750,
        easing: Easing.bezier(0.76, 0, 0.24, 1),
        useNativeDriver: false,
      }),
      Animated.timing(rightShutterX, {
        toValue: 0,
        duration: 750,
        easing: Easing.bezier(0.76, 0, 0.24, 1),
        useNativeDriver: false,
      })
    ]).start();

    // Content entry
    Animated.parallel([
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 700,
        delay: 300,
        useNativeDriver: false,
      }),
      Animated.timing(contentScale, {
        toValue: 1,
        duration: 800,
        delay: 300,
        easing: Easing.out(Easing.back(1.5)),
        useNativeDriver: false,
      })
    ]).start();

    // Shockwave pulse
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(shockwaveScale, {
            toValue: 1.45,
            duration: 1600,
            easing: Easing.out(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.sequence([
            Animated.timing(shockwaveOpacity, {
              toValue: 0.6,
              duration: 400,
              useNativeDriver: false,
            }),
            Animated.timing(shockwaveOpacity, {
              toValue: 0,
              duration: 1200,
              useNativeDriver: false,
            })
          ])
        ]),
        Animated.delay(400)
      ])
    ).start();

    // Staggered icons entrance
    const itemTriggers = itemAnims.map((anim, idx) => 
      Animated.timing(anim, {
        toValue: 1,
        duration: 400,
        delay: 1100 + idx * 120,
        easing: Easing.out(Easing.back(1.5)),
        useNativeDriver: false,
      })
    );
    Animated.parallel(itemTriggers).start();

    // Exit timeout (3.8 seconds total duration)
    const exitTimer = setTimeout(() => {
      // Shutter Exit
      Animated.parallel([
        Animated.timing(leftShutterX, {
          toValue: -SW / 2,
          duration: 650,
          easing: Easing.bezier(0.76, 0, 0.24, 1),
          useNativeDriver: false,
        }),
        Animated.timing(rightShutterX, {
          toValue: SW / 2,
          duration: 650,
          easing: Easing.bezier(0.76, 0, 0.24, 1),
          useNativeDriver: false,
        }),
        Animated.timing(contentOpacity, {
          toValue: 0,
          duration: 350,
          useNativeDriver: false,
        })
      ]).start(() => {
        onComplete();
      });
    }, 3800);

    return () => clearTimeout(exitTimer);
  }, []);

  return (
    <View style={s.container}>
      {/* Shutters */}
      <Animated.View 
        style={[
          s.shutter, 
          s.leftShutter, 
          { transform: [{ translateX: leftShutterX }], borderRightColor: accentColor + '40' }
        ]} 
      />
      <Animated.View 
        style={[
          s.shutter, 
          s.rightShutter, 
          { transform: [{ translateX: rightShutterX }], borderLeftColor: accentColor + '40' }
        ]} 
      />

      {/* Cinematic Content overlay */}
      <Animated.View 
        style={[
          s.contentWrap, 
          { opacity: contentOpacity, transform: [{ scale: contentScale }] }
        ]}
      >
        {/* Shockwave ring */}
        <Animated.View 
          style={[
            s.shockwave, 
            { 
              borderColor: primaryColor,
              opacity: shockwaveOpacity,
              transform: [{ scale: shockwaveScale }]
            }
          ]} 
        />

        {/* Brand Logo */}
        <Image 
          source={{ uri: logoUrl }} 
          style={s.logo} 
          resizeMode="contain" 
        />

        {/* Title */}
        <Text style={s.brandTitle}>
          {brandName.toUpperCase()} <Text style={{ color: accentColor, fontWeight: '900' }}>PREMIUM</Text>
        </Text>

        {/* Divider line */}
        <View style={[s.divider, { backgroundColor: accentColor }]} />

        {/* Subtitle / Lore info */}
        <Text style={s.loreLabel}>
          Est. {lore.foundedYear} • Founded by {lore.founder}
        </Text>

        {/* Tagline */}
        <Text style={[s.tagline, { color: accentColor }]}>
          ★ {lore.tagline} ★
        </Text>

        {/* Legendary Items */}
        <View style={s.itemsRow}>
          {lore.legendaryItems.map((item, i) => (
            <Animated.View 
              key={item.name}
              style={[
                s.itemBox,
                {
                  opacity: itemAnims[i],
                  transform: [{ scale: itemAnims[i] }]
                }
              ]}
            >
              <Text style={s.itemIcon}>{item.icon}</Text>
              <Text style={s.itemName} numberOfLines={1}>{item.name}</Text>
            </Animated.View>
          ))}
        </View>

        {/* Capsule */}
        <Text style={s.capsuleText}>
          {lore.capsule}
        </Text>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 99999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  shutter: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: SW / 2,
    backgroundColor: '#000',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 20,
    elevation: 24,
  },
  leftShutter: {
    left: 0,
    borderRightWidth: 2,
  },
  rightShutter: {
    right: 0,
    borderLeftWidth: 2,
  },
  contentWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    padding: 24,
    width: '100%',
  },
  shockwave: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 2,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 16,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '300',
    color: '#FFF',
    letterSpacing: 4,
    textTransform: 'uppercase',
  },
  divider: {
    width: 120,
    height: 1.5,
    marginVertical: 12,
    opacity: 0.8,
  },
  loreLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#A0AEC0',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  tagline: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  itemsRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 8,
    width: '100%',
  },
  itemBox: {
    alignItems: 'center',
    width: (SW - 48 - 24) / 4,
  },
  itemIcon: {
    fontSize: 22,
    marginBottom: 2,
  },
  itemName: {
    fontSize: 8,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.8)',
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
  capsuleText: {
    fontSize: 9,
    color: '#A0AEC0',
    textAlign: 'center',
    letterSpacing: 1.2,
    lineHeight: 14,
    marginTop: 20,
    maxWidth: 260,
    textTransform: 'uppercase',
  }
});
