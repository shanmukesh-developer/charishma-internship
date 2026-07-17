import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Dimensions, Platform, ActivityIndicator, Alert, Animated } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SHADOWS } from '../../constants/theme';
import { API_URL } from '../../constants/api';
import { useCart } from '../../context/CartContext';
import { useTheme } from '../../context/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import CustomizeDrawer, { summarizeCustomizations } from '../../components/CustomizeDrawer';
import { saveRecentlyViewed } from '../../components/RecentlyViewed';
import { StaggeredSection, BounceIn, FloatingPulse } from '../../components/AnimatedSection';
import DopaminePressable, { CartPressable, ActionPressable, CardPressable } from '../../components/DopaminePressable';

const { width: SW, height: SH } = Dimensions.get('window');

const MOCK_DETAILS: Record<string, any> = {
  'brand-guava': {
    id: 'brand-guava',
    name: 'B Natural Guava Fruit Beverage',
    price: 88,
    originalPrice: 115,
    discount: '23% OFF',
    weight: '1 L',
    image: 'https://images.unsplash.com/photo-1534531173927-aeb928d54385?w=600&q=80',
    description: 'Enjoy the luscious taste of pink guavas with B Natural Guava Fruit Beverage. Crafted to perfection, it brings the authentic flavour and texture of real fruits directly to your table.',
    rating: 4.3,
    ratingCount: 6802,
    reviewsBreakdown: { 5: 3450, 4: 2100, 3: 852, 2: 240, 1: 160 },
    packSizes: [
      { size: '1 L', price: 88, originalPrice: 115, discount: '23% OFF' },
      { size: '200 ml', price: 20, originalPrice: 25, discount: '20% OFF' }
    ],
    accordions: [
      { title: 'About', content: 'B Natural Guava Fruit Beverage is made from delicious pink guavas, delivering a rich, natural taste. It is packed with vitamin C and contains no added preservatives.' },
      { title: 'Ingredients', content: 'Water, Pink Guava Pulp (25%), Sugar, Acidity Regulator (INS 330), Stabilizers (INS 440, INS 466), Antioxidant (INS 300), Salt.' },
      { title: 'Nutrition', content: 'Energy: 52 kcal, Carbohydrates: 13g, Natural Fruit Sugars: 4.5g, Added Sugar: 8.5g, Vitamin C: 40mg, Sodium: 30mg per 100ml.' }
    ],
    recipes: [
      { title: 'Guava Chili Mocktail', time: '5 mins', img: 'https://images.unsplash.com/photo-1534531173927-aeb928d54385?w=300&q=80' },
      { title: 'Guava Fruit Punch', time: '10 mins', img: 'https://images.unsplash.com/photo-1534531173927-aeb928d54385?w=300&q=80' }
    ],
    brand: 'B Natural'
  },
  'bb-carrot': {
    id: 'bb-carrot',
    name: 'Carrot - Local',
    price: 39,
    originalPrice: 56.16,
    discount: '30% OFF',
    weight: '500 g',
    image: 'https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?w=600&q=80',
    description: 'Fresh, crunchy, and locally sourced carrots. Perfect for salads, juices, halwa, or cooking daily meals. Rich in Vitamin A and Beta-Carotene.',
    rating: 4.5,
    ratingCount: 14820,
    reviewsBreakdown: { 5: 9800, 4: 3100, 3: 1200, 2: 420, 1: 300 },
    packSizes: [
      { size: '500 g', price: 39, originalPrice: 56.16, discount: '30% OFF' },
      { size: '1 kg', price: 74, originalPrice: 112.32, discount: '34% OFF' }
    ],
    accordions: [
      { title: 'About', content: 'Carrots are sweet, nutritious, and extremely versatile vegetables. Local carrots are freshly plucked and delivered daily to preserve crispness.' },
      { title: 'Storage & Uses', content: 'Store carrots in a cool, dry place or in the refrigerator crisper drawer. Use them in salads, stir-fries, soups, or for making sweet carrot halwa.' },
      { title: 'Nutrition', content: 'Energy: 41 kcal, Water: 88%, Protein: 0.9g, Carbohydrates: 9.6g, Sugar: 4.7g, Fiber: 2.8g per 100g.' }
    ],
    recipes: [
      { title: 'Carrot Ginger Soup', time: '25 mins', img: 'https://images.unsplash.com/photo-1547592165-e1d17ffd763c?w=300&q=80' },
      { title: 'Classic Carrot Halwa', time: '40 mins', img: 'https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?w=300&q=80' }
    ],
    brand: 'Fresho'
  },
  'toys-monster-truck': {
    id: 'toys-monster-truck',
    name: '4x4 Monster Truck For 3+ Years',
    price: 49,
    originalPrice: 499,
    discount: '90% OFF',
    weight: '1 pc',
    image: 'https://images.unsplash.com/photo-1594787318286-3d835c1d207f?w=600&q=80',
    description: 'Friction-powered monster truck toy with large shockproof rubber tires. High-speed action toy for boys and girls aged 3 and above. Durable and crash-resistant.',
    rating: 4.1,
    ratingCount: 1540,
    reviewsBreakdown: { 5: 850, 4: 410, 3: 180, 2: 70, 1: 30 },
    packSizes: [
      { size: '1 pc', price: 49, originalPrice: 499, discount: '90% OFF' },
      { size: 'Pack of 2', price: 89, originalPrice: 998, discount: '91% OFF' }
    ],
    accordions: [
      { title: 'About', content: 'Let your child experience the thrill of monster truck stunts. Powered by simple push friction, it runs automatically without battery replacement.' },
      { title: 'Safety Guide', content: 'Made from high-quality, non-toxic ABS plastic. Smooth edges prevent scratching. Safe for toddlers 3 years and older.' },
      { title: 'Box Contents', content: '1 x Friction Powered 4x4 Monster Stunt Truck Toy (Assorted Color).' }
    ],
    recipes: [
      { title: 'Obstacle Course Play', time: '15 mins', img: 'https://images.unsplash.com/photo-1594787318286-3d835c1d207f?w=300&q=80' }
    ],
    brand: 'Kriiddaank'
  },
  'seeds-tomato': {
    id: 'seeds-tomato',
    name: 'Tomato Seeds',
    price: 40.80,
    originalPrice: 80,
    discount: '49% OFF',
    weight: '10 g',
    image: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=600&q=80',
    description: 'Premium quality organic tomato hybrid seeds. High germination rate seeds perfect for home kitchen gardens, terraces, and indoor pots.',
    rating: 4.4,
    ratingCount: 3210,
    reviewsBreakdown: { 5: 1950, 4: 820, 3: 310, 2: 90, 1: 40 },
    packSizes: [
      { size: '10 g', price: 40.80, originalPrice: 80, discount: '49% OFF' },
      { size: '25 g', price: 89.00, originalPrice: 180, discount: '50% OFF' }
    ],
    accordions: [
      { title: 'About', content: 'Grow organic, juicy tomatoes in your own balcony or backyard. These seeds are treated for high disease resistance and optimized yield.' },
      { title: 'Sowing Instructions', content: 'Sow seeds 0.5 cm deep in nutrient-rich soil mix. Water lightly. Sprouting occurs in 6-10 days. Keep in partial sunlight.' },
      { title: 'Harvesting Guide', content: 'Tomatoes are ready to harvest in 70-80 days after transplantation. Harvest when uniformly red and firm.' }
    ],
    recipes: [
      { title: 'Soil Preparation Guide', time: '20 mins', img: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=300&q=80' }
    ],
    brand: 'Bombay Seeds'
  }
};

const getRelatedProducts = (currentId: string) => {
  const allRelated = [
    { id: 'toys-monster-truck', name: '4x4 Monster Truck', price: 49, originalPrice: 499, weight: '1 pc', image: 'https://images.unsplash.com/photo-1594787318286-3d835c1d207f?w=300&q=80', brand: 'Kriiddaank' },
    { id: 'toys-tablet', name: 'LCD Writing Tablet Board', price: 149, originalPrice: 699, weight: '1 pc', image: 'https://images.unsplash.com/photo-1516627145497-ae6968895b74?w=300&q=80', brand: 'Mattel' },
    { id: 'toys-cricket', name: 'Kids Cricket Bat and Ball Set', price: 199, originalPrice: 499, weight: 'Pack of 1', image: 'https://images.unsplash.com/photo-1531565637446-32307b194362?w=300&q=80', brand: 'Sports' },
    { id: 'toys-uno-card', name: 'Uno Original Card Game', price: 119, originalPrice: 149, weight: '108 pcs', image: 'https://images.unsplash.com/photo-1606167668584-78701c57f13d?w=300&q=80', brand: 'Mattel' },
    { id: 'seeds-tomato', name: 'Tomato Seeds', price: 40.8, originalPrice: 80, weight: '10 g', image: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=300&q=80', brand: 'Bombay Seeds' },
    { id: 'seeds-cucumber', name: 'Cucumber Khira Seeds', price: 59, originalPrice: 80, weight: '10 g', image: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=300&q=80', brand: 'Bombay Seeds' },
    { id: 'seeds-chilli', name: 'Chilli Hot Pepper Seeds', price: 59, originalPrice: 80, weight: '10 g', image: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=300&q=80', brand: 'Bombay Seeds' },
    { id: 'bb-carrot', name: 'Carrot - Local', price: 39, originalPrice: 56.16, weight: '500 g', image: 'https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?w=300&q=80', brand: 'Fresho' },
    { id: 'bb-lemon', name: 'Fresh Lemon', price: 10, originalPrice: 27, weight: '3 pcs', image: 'https://images.unsplash.com/photo-1590502593747-42a996133562?w=300&q=80', brand: 'Fresho' },
    { id: 'brand-guava', name: 'B Natural Guava Beverage', price: 88, originalPrice: 115, weight: '1 L', image: 'https://images.unsplash.com/photo-1534531173927-aeb928d54385?w=300&q=80', brand: 'B Natural' },
    { id: 'cat-oil-2', name: 'Amul Pure Cow Ghee Tin', price: 680, originalPrice: 720, weight: '1 L', image: 'https://images.unsplash.com/photo-1547514701-42782101795e?w=300&q=80', brand: 'Amul' },
    { id: 'cat-atta-1', name: 'Aashirvaad Shudh Chakki Atta', price: 260, originalPrice: 290, weight: '5 kg', image: 'https://images.unsplash.com/photo-1574316071802-0d684efa7bf5?w=300&q=80', brand: 'Aashirvaad' }
  ];

  const isToy = currentId.startsWith('toys-') || currentId.includes('toys');
  const isSeed = currentId.startsWith('seeds-') || currentId.includes('seeds');

  let filtered = [];
  if (isToy) {
    filtered = allRelated.filter(p => p.id.startsWith('toys-'));
  } else if (isSeed) {
    filtered = allRelated.filter(p => p.id.startsWith('seeds-'));
  } else {
    filtered = allRelated.filter(p => !p.id.startsWith('toys-') && !p.id.startsWith('seeds-'));
  }

  return filtered.filter(p => p.id !== currentId);
};

export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { cart, addToCart, updateQuantity, removeFromCart } = useCart();
  const { isDark } = useTheme();

  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [netError, setNetError] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);
  const [selectedPackIndex, setSelectedPackIndex] = useState(0);
  const [openAccordions, setOpenAccordions] = useState<Record<string, boolean>>({
    'About': true
  });

  const scrollY = useRef(new Animated.Value(0)).current;

  const imageTranslateY = scrollY.interpolate({
    inputRange: [-150, 0, 300],
    outputRange: [-50, 0, 100],
    extrapolate: 'clamp',
  });

  const imageScale = scrollY.interpolate({
    inputRange: [-150, 0, 300],
    outputRange: [1.4, 1.0, 0.95],
    extrapolate: 'clamp',
  });

  const imageOpacity = scrollY.interpolate({
    inputRange: [0, 260],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const indicatorOpacity = scrollY.interpolate({
    inputRange: [0, 80],
    outputRange: [0.8, 0],
    extrapolate: 'clamp',
  });

  useEffect(() => {
    if (!id) return;
    const cleanId = id.replace(/\/$/, "");

    // Intercept mock details first
    if (MOCK_DETAILS[cleanId]) {
      setProduct(MOCK_DETAILS[cleanId]);
      saveRecentlyViewed({
        id: cleanId,
        name: MOCK_DETAILS[cleanId].name,
        image: MOCK_DETAILS[cleanId].image,
        type: 'product',
        price: MOCK_DETAILS[cleanId].price,
        restaurantName: MOCK_DETAILS[cleanId].brand
      });
      setLoading(false);
      return;
    }

    // Dynamic generation from any other ID starting with known prefixes
    const isLocalOther = cleanId.startsWith('toys-') || cleanId.startsWith('seeds-') || cleanId.startsWith('fruit-') || cleanId.startsWith('cat-') || cleanId.startsWith('org-') || cleanId.startsWith('elec-') || cleanId.startsWith('hyg-') || cleanId.startsWith('bb-');
    if (isLocalOther) {
      // Setup dynamic mock details
      let name = cleanId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      let price = 99;
      let img = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600';
      let brand = 'Premium Quality';

      if (cleanId.includes('uno')) { name = 'Uno Original Card Game'; price = 119; img = 'https://images.unsplash.com/photo-1606167668584-78701c57f13d?w=600&q=80'; brand = 'Mattel Games'; }
      else if (cleanId.includes('rubik')) { name = 'Speed Cube 3 x 3'; price = 89; img = 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600'; brand = 'Toy Cloud'; }
      else if (cleanId.includes('cucumber')) { name = 'Cucumber Khira Seeds'; price = 59; img = 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=600&q=80'; brand = 'Bombay Seeds'; }
      else if (cleanId.includes('chilli')) { name = 'Chilli Hot Pepper Seeds'; price = 59; img = 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=600&q=80'; brand = 'Bombay Seeds'; }
      else if (cleanId.includes('lemon')) { name = 'Fresh Lemon'; price = 10; img = 'https://images.unsplash.com/photo-1590502593747-42a996133562?w=600&q=80'; brand = 'Fresho'; }

      const dynamicDetail = {
        id: cleanId,
        name,
        price,
        originalPrice: price * 1.5,
        discount: '30% OFF',
        weight: '1 pc',
        image: img,
        description: `${name} is an premium selection, carefully curated for best standard and reliability.`,
        rating: 4.4,
        ratingCount: 1205,
        reviewsBreakdown: { 5: 750, 4: 310, 3: 90, 2: 35, 1: 20 },
        packSizes: [
          { size: '1 pc', price, originalPrice: price * 1.5, discount: '30% OFF' }
        ],
        accordions: [
          { title: 'About', content: `${name} matches our highest quality benchmarks to give complete satisfaction. Packed hygienically and shipped directly.` },
          { title: 'Storage & Care', content: 'Store in a cool, dark, dry place. Keep away from water and direct heat.' }
        ],
        recipes: [
          { title: 'Quick Demo Guide', time: '15 mins', img }
        ],
        brand
      };

      setProduct(dynamicDetail);
      saveRecentlyViewed({
        id: cleanId,
        name,
        image: img,
        type: 'product',
        price,
        restaurantName: brand
      });
      setLoading(false);
      return;
    }

    const fetchProduct = async () => {
      try {
        const res = await fetch(`${API_URL}/api/users/products/${cleanId}`);
        if (!res.ok) throw new Error('NOT_FOUND');
        const data = await res.json();
        
        if (data && (data.name || data.id)) {
          const productWithImg = {
            ...data,
            image: data.imageUrl || data.image
          };
          setProduct(productWithImg);
          saveRecentlyViewed({
            id: data.id || data._id,
            name: data.name,
            image: productWithImg.image || '',
            type: 'product',
            price: data.price,
            restaurantName: data.restaurantName
          });
        } else {
          setNetError(true);
        }
      } catch (err) {
        console.error('[FETCH_PRODUCT_ERROR]', err);
        setNetError(true);
      } finally {
        setLoading(false);
      }
    };
    fetchProduct();
  }, [id]);

  if (loading) {
    return (
      <View style={[st.center, { backgroundColor: isDark ? COLORS.bgDark : COLORS.bgLight }]}>
        <ActivityIndicator size="large" color={isDark ? COLORS.gold : COLORS.red} />
        <Text style={[st.loadingText, { color: isDark ? COLORS.textSecondary : COLORS.textDarkSecondary }]}>Accessing Product Matrix...</Text>
      </View>
    );
  }

  if (netError || !product) {
    return (
      <View style={[st.center, { backgroundColor: isDark ? COLORS.bgDark : COLORS.bgLight, padding: 20 }]}>
        <View style={st.errorIconWrap}>
          <Text style={{ fontSize: 32 }}>⚠️</Text>
        </View>
        <Text style={[st.errorTitle, { color: isDark ? '#fff' : COLORS.textDark }]}>Zenvy Servers are sleeping</Text>
        <Text style={[st.errorDesc, { color: isDark ? COLORS.textSecondary : COLORS.textDarkSecondary }]}>
          We're performing a quick system sweep. Please try refreshing in a few seconds.
        </Text>
        <TouchableOpacity 
          style={st.refreshBtn}
          onPress={() => {
            setLoading(true);
            setNetError(false);
          }}
        >
          <Text style={st.refreshBtnText}>WAKE THEM UP</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const productId = product.id || product._id;
  const isGroceryOrToy = productId.startsWith('toys-') || 
                          productId.startsWith('seeds-') || 
                          productId.startsWith('brand-') || 
                          productId.startsWith('bb-') || 
                          productId.startsWith('fruit-') || 
                          productId.startsWith('cat-') || 
                          productId.startsWith('org-') || 
                          productId.startsWith('elec-') || 
                          productId.startsWith('hyg-');

  const selectedPack = product.packSizes && product.packSizes[selectedPackIndex];
  const selectedPrice = selectedPack ? selectedPack.price : product.price;
  const selectedWeight = selectedPack ? selectedPack.size : (product.weight || '1 pc');

  const targetCartId = isGroceryOrToy ? (productId + '-' + selectedWeight.replace(/\s+/g, '')) : productId;
  const cartItem = cart.find(i => i.id === targetCartId);
  const currentQty = cartItem ? cartItem.quantity : 0;

  const handleInstantAdd = () => {
    if (isGroceryOrToy) {
      addToCart({
        id: targetCartId,
        name: product.name + ' (' + selectedWeight + ')',
        price: selectedPrice,
        image: product.image || '',
        restaurantId: 'mega-basket-vendor',
        restaurantName: 'Mega Basket Grocery'
      });
    } else {
      setShowCustomize(true);
    }
  };

  const handleCustomizeConfirm = (customizations: any, finalPrice: number) => {
    setShowCustomize(false);
    addToCart({
      id: productId,
      name: product.name,
      price: finalPrice,
      basePrice: product.price,
      image: product.image || '',
      restaurantId: product.restaurantId || 'unknown',
      restaurantName: product.restaurantName || 'Zenvy Kitchen',
      customizations,
    });
    
    Alert.alert(
      "Added to Basket",
      `${product.name} (${summarizeCustomizations(customizations) || 'default'}) added to cart.`
    );
  };

  const toggleAccordion = (title: string) => {
    setOpenAccordions(prev => ({
      ...prev,
      [title]: !prev[title]
    }));
  };

  const bg = isDark ? COLORS.bgDark : COLORS.bgLight;
  const cardBg = isDark ? COLORS.bgCard : COLORS.bgLightCard;
  const textClr = isDark ? COLORS.textPrimary : COLORS.textDark;
  const subTextClr = isDark ? COLORS.textSecondary : COLORS.textDarkSecondary;
  const borderClr = isDark ? COLORS.borderDark : COLORS.borderLight;
  const isVegetarian = product.isVegetarian === true || 
                      String(product.isVegetarian).toLowerCase() === 'true' || 
                      Number(product.isVegetarian) === 1 || 
                      (product.tags || []).includes('veg');

  const goldColor = isDark ? COLORS.gold : COLORS.red;
  const themeGreen = '#16A34A';
  const heroImg = product.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600';

  return (
    <View style={[st.container, { backgroundColor: bg }]}>
      {/* Immersive Parallax Hero Image */}
      <Animated.View 
        style={[
          st.heroAbsoluteContainer, 
          { 
            transform: [
              { translateY: imageTranslateY },
              { scale: imageScale }
            ],
            opacity: imageOpacity
          }
        ]}
      >
        <Image source={{ uri: heroImg }} style={st.heroImg} />
        
        {/* Dark overlay for contrast */}
        <View style={st.topOverlay} />
        
        {/* Premium Bottom Fade-Merge Gradient */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.45)', cardBg]}
          style={st.fadeMergeGradient}
        />
      </Animated.View>

      {/* Floating Header Actions (Fixed at Top) */}
      <View style={st.topNavRow}>
        <ActionPressable 
          style={[st.backBtn, { backgroundColor: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.9)' }]}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)/others' as any);
            }
          }}
        >
          <Text style={[st.backBtnText, { color: textClr }]}>‹</Text>
        </ActionPressable>

        <View style={[st.availableBadge, { backgroundColor: isDark ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.9)' }]}>
          <View style={st.pulseDot} />
          <Text style={[st.availableText, { color: textClr }]}>AVAILABLE NOW</Text>
        </View>
      </View>

      {/* Scrollable details wrapper */}
      <Animated.ScrollView 
        showsVerticalScrollIndicator={false} 
        contentContainerStyle={{ paddingBottom: 120 }}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
      >
        {/* Top spacer to show the background parallax image */}
        <View style={st.heroSpacer} />

        {/* Scroll Indicator overlay (Fades on scroll) */}
        {currentQty === 0 && (
          <Animated.View style={[st.exploreIndicator, { opacity: indicatorOpacity }]}>
            <View style={st.exploreBox}>
              <View style={st.exploreDot} />
            </View>
            <Text style={st.exploreText}>EXPLORE</Text>
          </Animated.View>
        )}

        {/* Product Details Content */}
        <StaggeredSection delay={100} direction="up">
          <View style={[st.detailsContent, { backgroundColor: cardBg }]}>
            {/* Ambient Breathing Orb */}
            <View style={[st.breathingOrb, { backgroundColor: isDark ? 'rgba(201,168,76,0.06)' : 'rgba(239,79,95,0.06)' }]} />

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <View style={[st.vegDot, { borderColor: isVegetarian ? '#22C55E' : '#AF3F3F' }]}>
                {isVegetarian ? (
                  <View style={[st.vegDotInner, { backgroundColor: '#22C55E' }]} />
                ) : (
                  <View style={st.nonVegTriangle} />
                )}
              </View>
              <Text style={[st.signatureLabel, { color: isGroceryOrToy ? themeGreen : goldColor, marginBottom: 0 }]}>
                {isGroceryOrToy ? 'BB DEALS EXCLUSIVE' : 'ZENVY SIGNATURE SELECTION'}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={[st.productTitle, { color: textClr, marginBottom: 4 }]}>{product.name}</Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: subTextClr, textTransform: 'uppercase', letterSpacing: 0.5 }}>{product.brand || 'ZENVY'}</Text>
              </View>
            </View>

            {/* Rating Stats Summary */}
            {product.rating && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
                <View style={{ backgroundColor: '#16A34A', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Text style={{ fontSize: 11, fontWeight: '900', color: '#fff' }}>{product.rating}</Text>
                  <Text style={{ fontSize: 9, color: '#fff' }}>★</Text>
                </View>
                <Text style={{ fontSize: 12, color: subTextClr, fontWeight: '600' }}>{product.ratingCount?.toLocaleString()} ratings</Text>
              </View>
            )}

            <Text style={[st.productDesc, { color: subTextClr, marginTop: 12, marginBottom: 20 }]}>
              {product.description || "An exquisite culinary masterpiece crafted with the finest ingredients and precision."}
            </Text>

            {/* Pack Size Selection Cards */}
            {product.packSizes && product.packSizes.length > 0 && (
              <View style={{ marginBottom: 24 }}>
                <Text style={{ fontSize: 13, fontWeight: '900', color: textClr, marginBottom: 8, letterSpacing: 0.5 }}>Select Pack Size</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {product.packSizes.map((pack: any, index: number) => {
                    const isSelected = selectedPackIndex === index;
                    return (
                      <TouchableOpacity
                        key={index}
                        onPress={() => setSelectedPackIndex(index)}
                        style={{
                          width: (SW - 48) / 2,
                          padding: 12,
                          borderRadius: 12,
                          borderWidth: 1.5,
                          borderColor: isSelected ? themeGreen : borderClr,
                          backgroundColor: isSelected ? (isDark ? '#14532D' : '#F0FDF4') : cardBg,
                          position: 'relative'
                        }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '900', color: textClr }}>{pack.size}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
                          <Text style={{ fontSize: 13, fontWeight: '900', color: textClr }}>₹{pack.price}</Text>
                          {pack.originalPrice > pack.price && (
                            <Text style={{ fontSize: 10, color: subTextClr, textDecorationLine: 'line-through' }}>₹{pack.originalPrice}</Text>
                          )}
                        </View>
                        {pack.discount && (
                          <View style={{
                            position: 'absolute',
                            top: 6,
                            right: 6,
                            backgroundColor: '#FCD34D',
                            paddingHorizontal: 4,
                            paddingVertical: 1,
                            borderRadius: 4
                          }}>
                            <Text style={{ fontSize: 7, fontWeight: '900', color: '#78350F' }}>{pack.discount}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Elite Attributes Grid (Only show if not grocery, or as a general premium badge row) */}
            <View style={st.attributesGrid}>
              {[
                { icon: '🌟', label: 'Premium\nQuality' },
                { icon: '🌿', label: 'Made\nFresh' },
                { icon: '🛡️', label: 'Elite\nStandard' }
              ].map((attr, i) => (
                <CardPressable 
                  key={i} 
                  style={[st.attributeCard, { backgroundColor: cardBg, borderColor: borderClr }]}
                  tilt={true}
                  sound="click"
                >
                  <Text style={st.attributeIcon}>{attr.icon}</Text>
                  <Text style={[st.attributeLabel, { color: textClr }]}>{attr.label}</Text>
                </CardPressable>
              ))}
            </View>

            {/* Gold separator line */}
            <View style={[st.goldLine, { backgroundColor: isGroceryOrToy ? themeGreen : goldColor }]} />

            {/* Collapsible Accordion Sections */}
            {product.accordions && product.accordions.length > 0 && (
              <View style={{ marginBottom: 24 }}>
                {product.accordions.map((acc: any, index: number) => {
                  const isOpen = openAccordions[acc.title];
                  return (
                    <View key={index} style={{ borderBottomWidth: 1, borderBottomColor: borderClr, paddingVertical: 12 }}>
                      <TouchableOpacity
                        onPress={() => toggleAccordion(acc.title)}
                        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '900', color: textClr }}>{acc.title}</Text>
                        <Text style={{ fontSize: 16, color: subTextClr, fontWeight: '700' }}>{isOpen ? '−' : '+'}</Text>
                      </TouchableOpacity>
                      {isOpen && (
                        <Text style={{ fontSize: 12, color: subTextClr, lineHeight: 18, marginTop: 8 }}>{acc.content}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* Ratings & Reviews breakdown bar graph */}
            {product.reviewsBreakdown && (
              <View style={{ marginBottom: 24 }}>
                <Text style={{ fontSize: 13, fontWeight: '900', color: textClr, marginBottom: 12, letterSpacing: 0.5 }}>Rating & Reviews breakdown</Text>
                <View style={{ gap: 8 }}>
                  {[5, 4, 3, 2, 1].map(star => {
                    const count = product.reviewsBreakdown[star] || 0;
                    const totalReviews = Object.values(product.reviewsBreakdown).reduce((a: any, b: any) => a + b, 0) as number || 1;
                    const pct = (count / totalReviews) * 100;
                    return (
                      <View key={star} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: textClr, width: 35 }}>{star} Star</Text>
                        <View style={{ flex: 1, height: 6, backgroundColor: isDark ? '#3F3F46' : '#E4E4E7', borderRadius: 3, overflow: 'hidden' }}>
                          <View style={{ width: `${pct}%`, height: '100%', backgroundColor: themeGreen }} />
                        </View>
                        <Text style={{ fontSize: 10, color: subTextClr, width: 45, textAlign: 'right', fontWeight: '700' }}>{pct.toFixed(0)}%</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Related Recipes Slider */}
            {product.recipes && product.recipes.length > 0 && (
              <View style={{ marginBottom: 24 }}>
                <Text style={{ fontSize: 13, fontWeight: '900', color: textClr, marginBottom: 12, letterSpacing: 0.5 }}>Recipes with this item</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                  {product.recipes.map((rec: any, index: number) => (
                    <View key={index} style={{ width: 140, borderRadius: 12, borderWidth: 1, borderColor: borderClr, overflow: 'hidden', backgroundColor: cardBg }}>
                      <Image source={{ uri: rec.img }} style={{ width: '100%', height: 90, resizeMode: 'cover' }} />
                      <View style={{ padding: 8 }}>
                        <Text style={{ fontSize: 11, fontWeight: '900', color: textClr }} numberOfLines={2}>{rec.title}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                          <Text style={{ fontSize: 9 }}>⏱️</Text>
                          <Text style={{ fontSize: 9, color: subTextClr, fontWeight: '600' }}>{rec.time}</Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Related Products Slider */}
            {/* Related Products Slider */}
            {getRelatedProducts(productId).length > 0 && (
              <View style={{ marginBottom: 24, marginTop: 12 }}>
                <Text style={{ fontSize: 13, fontWeight: '900', color: textClr, marginBottom: 12, letterSpacing: 0.5 }}>Related Products</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
                  {getRelatedProducts(productId).map((relProduct: any) => (
                    <TouchableOpacity
                      key={relProduct.id}
                      onPress={() => {
                        router.push({
                          pathname: '/products/[id]',
                          params: { id: relProduct.id }
                        });
                      }}
                      style={{
                        width: 130,
                        borderRadius: 16,
                        borderWidth: 1.5,
                        borderColor: borderClr,
                        backgroundColor: cardBg,
                        overflow: 'hidden',
                        padding: 8,
                        justifyContent: 'space-between',
                      }}
                    >
                      <View style={{ width: '100%', height: 90, borderRadius: 10, overflow: 'hidden', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                        <Image source={{ uri: relProduct.image }} style={{ width: '90%', height: '90%', resizeMode: 'contain' }} />
                      </View>
                      <View>
                        <Text style={{ fontSize: 7, fontWeight: '900', color: subTextClr, textTransform: 'uppercase' }}>{relProduct.brand}</Text>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: textClr, height: 26, marginTop: 2 }} numberOfLines={2}>{relProduct.name}</Text>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                          <Text style={{ fontSize: 11, fontWeight: '900', color: textClr }}>₹{relProduct.price}</Text>
                          {relProduct.originalPrice > relProduct.price && (
                            <Text style={{ fontSize: 8, color: '#999', textDecorationLine: 'line-through' }}>₹{relProduct.originalPrice}</Text>
                          )}
                        </View>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Pricing & Quantity Selector */}
            <View style={st.priceRow}>
              <View>
                <Text style={[st.totalPriceLabel, { color: subTextClr }]}>TOTAL PRICE</Text>
                <Text style={[st.totalPriceText, { color: isGroceryOrToy ? themeGreen : goldColor }]}>
                  ₹{(selectedPrice * (currentQty || 1)).toFixed(2)}
                </Text>
              </View>

              <View style={[st.qtySelector, { backgroundColor: cardBg, borderColor: borderClr }]}>
                <ActionPressable
                  style={st.qtyBtn}
                  onPress={() => {
                    if (currentQty > 1) updateQuantity(targetCartId, currentQty - 1);
                    else if (currentQty === 1) removeFromCart(targetCartId);
                  }}
                  sound="click"
                >
                  <Text style={[st.qtyBtnText, { color: textClr }]}>−</Text>
                </ActionPressable>
                
                <Text style={[st.qtyValue, { color: textClr }]}>{currentQty}</Text>
                
                <ActionPressable
                  style={[st.qtyBtn, st.qtyBtnAdd, { backgroundColor: isGroceryOrToy ? themeGreen : goldColor }]}
                  onPress={() => {
                    if (currentQty === 0) handleInstantAdd();
                    else updateQuantity(targetCartId, currentQty + 1);
                  }}
                  sound="click"
                >
                  <Text style={[st.qtyBtnTextAdd, { color: '#fff' }]}>+</Text>
                </ActionPressable>
              </View>
            </View>
          </View>
        </StaggeredSection>
      </Animated.ScrollView>

      {/* Sticky Bottom Action Bar */}
      <View style={[st.bottomBar, { borderTopColor: borderClr, backgroundColor: isDark ? 'rgba(10,10,11,0.95)' : 'rgba(248,249,250,0.95)' }]}>
        <View style={st.bottomBarRow}>
          {currentQty === 0 ? (
            <CartPressable 
              style={[st.addToCartBtn, st.btnShadow, { backgroundColor: isGroceryOrToy ? themeGreen : goldColor }, !isDark && { shadowColor: isGroceryOrToy ? themeGreen : COLORS.red }]} 
              onPress={handleInstantAdd}
              sound="addToCart"
            >
              <Text style={[st.addToCartBtnText, { color: '#fff' }]}>ADD TO BASKET</Text>
              <View style={[st.btnDivider, { backgroundColor: 'rgba(255,255,255,0.4)' }]} />
              <Text style={[st.addToCartPrice, { color: '#fff' }]}>₹{selectedPrice}</Text>
            </CartPressable>
          ) : (
            <ActionPressable 
              style={[st.addToCartBtn, st.btnShadow, { backgroundColor: themeGreen }, !isDark && { shadowColor: themeGreen }]} 
              onPress={() => router.push('/(tabs)/basket' as any)}
              sound="success"
            >
              <Text style={[st.addToCartBtnText, { color: '#fff' }]}>VIEW BASKET</Text>
              <View style={[st.btnDivider, { backgroundColor: 'rgba(255,255,255,0.4)' }]} />
              <Text style={[st.addToCartPrice, { color: '#fff' }]}>
                {currentQty} in basket (₹{(selectedPrice * currentQty).toFixed(2)})
              </Text>
            </ActionPressable>
          )}

          <ActionPressable 
            style={[st.basketIconBtn, { backgroundColor: cardBg, borderColor: borderClr }]}
            onPress={() => router.push('/(tabs)/basket' as any)}
            sound="click"
          >
            <Text style={{ fontSize: 20 }}>🛒</Text>
          </ActionPressable>
        </View>
      </View>

      <CustomizeDrawer
        isOpen={showCustomize}
        onClose={() => setShowCustomize(false)}
        onConfirm={handleCustomizeConfirm}
        itemName={product.name}
        basePrice={product.price}
        tags={product.tags}
        category={product.category}
        isVegetarian={isVegetarian}
      />
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: 11, fontWeight: '800', letterSpacing: 2, marginTop: 12 },
  
  errorIconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  errorTitle: { fontSize: 20, fontWeight: '900', color: '#fff', marginBottom: 8 },
  errorDesc: { fontSize: 12, fontWeight: '500', textAlign: 'center', maxWidth: 280, lineHeight: 18, marginBottom: 20 },
  refreshBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 30, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.03)' },
  refreshBtnText: { color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 2 },

  heroAbsoluteContainer: { width: SW, height: 350, position: 'absolute', top: 0, left: 0, right: 0, zIndex: 0 },
  heroImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  topOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  fadeMergeGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 220,
  },
  
  topNavRow: { position: 'absolute', top: Platform.OS === 'ios' ? 50 : 36, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 },
  backBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', ...SHADOWS.card },
  backBtnText: { fontSize: 22, fontWeight: '900' },
  
  availableBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, ...SHADOWS.card },
  pulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#10B981' },
  availableText: { fontSize: 8, fontWeight: '900', letterSpacing: 2 },

  exploreIndicator: { position: 'absolute', bottom: 20, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  exploreBox: { width: 16, height: 26, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', borderRadius: 8, alignItems: 'center', paddingVertical: 4 },
  exploreDot: { width: 3, height: 6, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.8)' },
  exploreText: { fontSize: 7, fontWeight: '900', color: '#fff', letterSpacing: 3, marginTop: 4 },

  heroSpacer: { height: 280 },
  detailsContent: { paddingHorizontal: 20, paddingTop: 32, position: 'relative' },
  breathingOrb: { position: 'absolute', top: -40, left: SW / 2 - 100, width: 200, height: 200, borderRadius: 100, transform: [{ scale: 1.2 }] },
  
  signatureLabel: { fontSize: 9, fontWeight: '900', color: COLORS.gold, letterSpacing: 4, marginBottom: 12 },
  vegDot: { width: 12, height: 12, borderWidth: 1.5, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  vegDotInner: { width: 5, height: 5, borderRadius: 2.5 },
  nonVegTriangle: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 3.5,
    borderRightWidth: 3.5,
    borderBottomWidth: 6.5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#AF3F3F',
  },
  productTitle: { fontSize: 28, fontWeight: '900', letterSpacing: -0.5, marginBottom: 12 },
  productDesc: { fontSize: 13, fontWeight: '500', lineHeight: 20, marginBottom: 24 },

  attributesGrid: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginBottom: 28 },
  attributeCard: { flex: 1, paddingVertical: 16, paddingHorizontal: 8, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 8, ...SHADOWS.card },
  attributeIcon: { fontSize: 22 },
  attributeLabel: { fontSize: 8, fontWeight: '900', textAlign: 'center', letterSpacing: 1.5, lineHeight: 12, textTransform: 'uppercase' },

  goldLine: { height: 1, backgroundColor: COLORS.gold, opacity: 0.15, marginBottom: 24 },

  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  totalPriceLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 2, marginBottom: 4 },
  totalPriceText: { fontSize: 32, fontWeight: '900', color: COLORS.gold, letterSpacing: -0.5 },

  qtySelector: { flexDirection: 'row', alignItems: 'center', borderRadius: 30, borderWidth: 1, padding: 4 },
  qtyBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  qtyBtnText: { fontSize: 18, fontWeight: '800' },
  qtyBtnAdd: { backgroundColor: COLORS.gold },
  qtyBtnTextAdd: { fontSize: 18, fontWeight: '800', color: '#fff' },
  qtyValue: { fontSize: 16, fontWeight: '900', width: 24, textAlign: 'center', marginHorizontal: 8 },

  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 16, paddingBottom: Platform.OS === 'ios' ? 34 : 20, borderTopWidth: 1 },
  bottomBarRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  addToCartBtn: { flex: 1, backgroundColor: COLORS.gold, height: 56, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  addToCartBtnText: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 2 },
  btnDivider: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.4)' },
  addToCartPrice: { color: '#fff', fontSize: 12, fontWeight: '900' },
  btnShadow: {
    shadowColor: COLORS.gold,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 4,
  },
  basketIconBtn: { width: 56, height: 56, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center', ...SHADOWS.card }
});
