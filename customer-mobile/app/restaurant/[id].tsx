import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
  Platform,
  ActivityIndicator,
  Linking,
  Alert
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SHADOWS } from '../../constants/theme';
import { API_URL } from '../../constants/api';
import { useCart } from '../../context/CartContext';
import { useTheme } from '../../context/ThemeContext';
import BrandTakeoverSplash from '../../components/BrandTakeoverSplash';
import CustomizeDrawer from '../../components/CustomizeDrawer';
import { saveRecentlyViewed } from '../../components/RecentlyViewed';
import DopaminePressable, { CartPressable, ActionPressable, CardPressable } from '../../components/DopaminePressable';
import { StaggeredSection, BounceIn, FloatingPulse, PulseGlow } from '../../components/AnimatedSection';

const { width: SW } = Dimensions.get('window');

const BRAND_THEMES: Record<string, { bg: string; accent: string; text: string }> = {
  kfc: { bg: '#1A0000', accent: '#E4002B', text: '#FFFFFF' },
  mcdonalds: { bg: '#1A1200', accent: '#FFC72C', text: '#FFFFFF' },
  dominos: { bg: '#001A2E', accent: '#006491', text: '#FFFFFF' },
};

const BRAND_LOGOS: Record<string, { logo: string; type: 'kfc-bucket-drop' | 'dominos-flip' | 'mcd-glow' }> = {
  kfc: { logo: `${API_URL}/assets/kfc_logo.png`, type: 'kfc-bucket-drop' },
  mcdonalds: { logo: `${API_URL}/assets/mcdonalds_logo.png`, type: 'mcd-glow' },
  dominos: { logo: `${API_URL}/assets/dominos_logo.png`, type: 'dominos-flip' },
};

const seenTakeovers = new Set<string>();

export default function RestaurantDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { addToCart, totalItems, clearCart } = useCart();
  const { isDark } = useTheme();
  const [restaurant, setRestaurant] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showTakeover, setShowTakeover] = useState(false);
  const [activeCategory, setActiveCategory] = useState('All');
  const [isFavorite, setIsFavorite] = useState(false);
  const [isUserElite, setIsUserElite] = useState(false);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [customizingItem, setCustomizingItem] = useState<any>(null);

  const promoScrollRef = useRef<ScrollView>(null);
  const [promoScrollIdx, setPromoScrollIdx] = useState(0);

  useEffect(() => {
    if (!restaurant) return;
    const offers = getOffers();
    if (offers.length <= 1) return;

    const interval = setInterval(() => {
      setPromoScrollIdx((prev) => {
        const next = (prev + 1) % offers.length;
        // On web/mobile, scroll to the calculated horizontal coordinate
        // Cards have width 220 + marginRight 12 = 232 total width per item
        promoScrollRef.current?.scrollTo({ x: next * 232, animated: true });
        return next;
      });
    }, 3500);

    return () => clearInterval(interval);
  }, [restaurant]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/users/restaurants`);
        const data = await res.json();
        if (Array.isArray(data)) {
          const found = data.find((r: any) => (r._id || r.id) === id);
          if (found) {
            setRestaurant(found);
            saveRecentlyViewed({
              id: found._id || found.id,
              name: found.name,
              image: found.imageUrl || found.image || '',
              type: 'restaurant'
            });

            // Parse brandTheme and check if seen safely
            let parsedTheme = null;
            if (found.brandTheme) {
              try {
                parsedTheme = typeof found.brandTheme === 'string' ? JSON.parse(found.brandTheme) : found.brandTheme;
              } catch (err) {
                console.error('Error parsing brandTheme in useEffect:', err);
              }
            }

            if (parsedTheme && !seenTakeovers.has(id)) {
              seenTakeovers.add(id);
              setShowTakeover(true);
            } else {
              const rName = (found.name || '').toLowerCase();
              const bk = Object.keys(BRAND_LOGOS).find(k => rName.includes(k));
              if (bk && !seenTakeovers.has(id)) {
                seenTakeovers.add(id);
                setShowTakeover(true);
              }
            }
          }
        }
        const favsStr = await AsyncStorage.getItem('zenvy_favorites');
        if (favsStr) {
          try {
            const favs = JSON.parse(favsStr);
            setIsFavorite(Array.isArray(favs) ? favs.includes(id) : false);
          } catch(e) {}
        }
        const userStr = await AsyncStorage.getItem('user');
        if (userStr) {
          const u = JSON.parse(userStr);
          setIsUserElite(u.isElite || false);
        }
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [id]);

  if (loading) return <View style={[st.center, { backgroundColor: isDark ? COLORS.bgDark : COLORS.bgLight }]}><ActivityIndicator size="large" color={isDark ? COLORS.gold : COLORS.red} /></View>;
  if (!restaurant) return <View style={[st.center, { backgroundColor: isDark ? COLORS.bgDark : COLORS.bgLight }]}><Text style={{ color: isDark ? '#fff' : COLORS.textDark }}>Restaurant not found</Text></View>;

  const name = (restaurant.name || '').toLowerCase();
  const brandKey = Object.keys(BRAND_THEMES).find(k => name.includes(k));

  const brand = (() => {
    if (!restaurant?.brandTheme) return brandKey ? BRAND_THEMES[brandKey] : null;
    try {
      return typeof restaurant.brandTheme === 'string' ? JSON.parse(restaurant.brandTheme) : restaurant.brandTheme;
    } catch (err) {
      console.error('Error parsing brandTheme in render:', err);
      return brandKey ? BRAND_THEMES[brandKey] : null;
    }
  })();

  if (showTakeover && brand) {
    return (
      <BrandTakeoverSplash
        brandName={restaurant.name}
        logoAnimationType={brand.logoAnimationType || 'kfc-bucket-drop'}
        logoUrl={brand.logoUrl || (brandKey ? BRAND_LOGOS[brandKey].logo : '')}
        onComplete={() => setShowTakeover(false)}
      />
    );
  }

  const bgColor = brand ? (brand.primaryColor || '#1A0000') : (isDark ? COLORS.bgDark : COLORS.bgLight);
  const accent = brand ? (brand.accentColor || COLORS.gold) : (isDark ? COLORS.gold : COLORS.red);
  const txt = brand ? (brand.fontColor || '#fff') : (isDark ? '#fff' : COLORS.textDark);
  const txtSec = brand ? (brand.fontColor ? brand.fontColor + 'B0' : COLORS.textSecondary) : (isDark ? COLORS.textSecondary : COLORS.textDarkSecondary);
  const cardBg = brand ? 'rgba(0,0,0,0.6)' : (isDark ? COLORS.bgCard : '#fff');
  const border = brand ? 'rgba(255,255,255,0.05)' : (isDark ? COLORS.borderDark : COLORS.borderLight);
  const rating = Number(restaurant.rating) || 4.0;
  const menu = Array.isArray(restaurant.menu) ? restaurant.menu.filter(Boolean) : [];
  const heroImg = restaurant.imageUrl || restaurant.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600';

  const isLocalVendor = restaurant?.vendorType === 'LOCAL_VENDOR';

  async function toggleFavorite() {
    try {
      const favsStr = await AsyncStorage.getItem('zenvy_favorites');
      let favs = [];
      try {
        favs = favsStr ? JSON.parse(favsStr) : [];
      } catch(e) {}
      if (Array.isArray(favs) && favs.includes(id)) {
        favs = favs.filter((f: string) => f !== id);
        setIsFavorite(false);
      } else {
        favs.push(id);
        setIsFavorite(true);
      }
      await AsyncStorage.setItem('zenvy_favorites', JSON.stringify(favs));
    } catch (e) {
      console.error(e);
    }
  }

  function getWhatsAppLink(itemName?: string) {
    if (!restaurant) return '';
    const phone = restaurant.whatsappNumber || '919391955674';
    const campus = restaurant.campus || 'Campus';
    let msg = `Hi! I'd like to order from ${restaurant.name} via CampusBites (Zenvy). My campus: ${campus}.`;
    if (itemName) msg += `\n\nItem: ${itemName}`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  }

  function getCallLink() {
    if (!restaurant) return '';
    const phone = restaurant.whatsappNumber || '919391955674';
    return `tel:+${phone}`;
  }

  function getOffers() {
    if (brand && Array.isArray(brand.offers) && brand.offers.length > 0) {
      return brand.offers;
    }
    if (name.includes('kfc')) {
      return [
        { code: 'KFCSAVER', desc: 'Flat 20% OFF on buckets', sub: 'Min order ₹349 · Single use' },
        { code: 'FREEZINGER', desc: 'Free Zinger Burger', sub: 'On orders above ₹499' },
        { code: 'CAMPUSKFC', desc: 'Flat ₹50 OFF for Hostels', sub: 'Use code CAMPUSKFC' }
      ];
    }
    if (name.includes('domino')) {
      return [
        { code: 'DOMINOS50', desc: '50% OFF up to ₹100', sub: 'Valid on Cheese Burst Pizzas' },
        { code: 'FREEDIP', desc: 'Free Cheesy Dip', sub: 'On orders above ₹299' },
        { code: 'DOUBLEDEAL', desc: 'Buy 1 Get 1 Free', sub: 'On Medium Pizzas · Wed & Fri' }
      ];
    }
    if (name.includes('mcdonald')) {
      return [
        { code: 'MCDFREE', desc: 'Free Large Fries', sub: 'On orders above ₹399' },
        { code: 'MCDELITE', desc: 'Flat 15% OFF for Elite', sub: 'No minimum order required' },
        { code: 'BURGERDEAL', desc: '2 McSpicy Burgers @ ₹249', sub: 'Limited time offer' }
      ];
    }
    return [
      { code: 'WELCOME50', desc: '50% OFF up to ₹100', sub: 'On your first order' },
      { code: 'FREEDEL', desc: 'Free Delivery', sub: 'For all orders above ₹199' },
      { code: 'STUDENT10', desc: 'Flat 10% OFF', sub: 'Valid for all campus hostels' }
    ];
  }

  const handleAddToCart = (item: any) => {
    try {
      addToCart({
        id: item.id || item._id,
        name: item.name,
        price: item.price,
        basePrice: item.price,
        image: item.image || item.imageUrl || '',
        restaurantId: id,
        restaurantName: restaurant.name,
        customizations: {},
      });
      setAddedId(item.id || item._id);
      setTimeout(() => setAddedId(null), 800);
    } catch (err: any) {
      if (err.message === 'MULTIPLE_RESTAURANTS') {
        Alert.alert(
          'Clear Basket?',
          'Your basket contains items from another restaurant. Clear it to add this item?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Clear & Add',
              onPress: () => {
                clearCart();
                setTimeout(() => {
                  addToCart({
                    id: item.id || item._id,
                    name: item.name,
                    price: item.price,
                    basePrice: item.price,
                    image: item.image || item.imageUrl || '',
                    restaurantId: id,
                    restaurantName: restaurant.name,
                    customizations: {},
                  });
                  setAddedId(item.id || item._id);
                  setTimeout(() => setAddedId(null), 800);
                }, 100);
              }
            }
          ]
        );
      }
    }
  };

  const handleCustomizeConfirm = (customizations: any, finalPrice: number) => {
    if (!customizingItem) return;
    addToCart({
      id: customizingItem.id || customizingItem._id,
      name: customizingItem.name,
      price: finalPrice,
      basePrice: customizingItem.price,
      image: customizingItem.image || customizingItem.imageUrl || '',
      restaurantId: id,
      restaurantName: restaurant.name,
      customizations,
    });
    setAddedId(customizingItem.id || customizingItem._id);
    setCustomizingItem(null);
    setTimeout(() => setAddedId(null), 800);
  };

  const categoriesList = Array.isArray(restaurant.categories)
    ? restaurant.categories
    : (Array.isArray(restaurant.tags) ? restaurant.tags : []);
  const categories = ['All', ...categoriesList];

  const filteredMenu = activeCategory === 'All'
    ? menu
    : menu.filter((item: any) => {
        if (!item) return false;
        const itemCategory = (item.category || '').toLowerCase();
        const activeCatLower = activeCategory.toLowerCase();
        if (itemCategory === activeCatLower) return true;
        const tags = Array.isArray(item.tags) ? item.tags : [];
        return tags.some((t: string) => String(t).toLowerCase() === activeCatLower);
      });

  return (
    <View style={st.container}>
      {brand ? (
        <LinearGradient
          colors={[brand.primaryColor || '#1A0000', brand.secondaryColor || '#111111']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      ) : (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: isDark ? COLORS.bgDark : COLORS.bgLight }} />
      )}

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero Banner */}
        <View style={st.hero}>
          <Image source={{ uri: heroImg }} style={st.heroImg} />
          <View style={st.heroGrad} />
          
          {/* Back button */}
          <ActionPressable style={st.backBtn} onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)' as any);
            }
          }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>‹</Text>
          </ActionPressable>

          {/* Favorite Heart Button */}
          <ActionPressable 
            style={st.favoriteBtn} 
            onPress={toggleFavorite}
            sound="click"
          >
            <Text style={{ fontSize: 16 }}>{isFavorite ? '❤️' : '🤍'}</Text>
          </ActionPressable>
        </View>

        {/* Floating Info Card (Premium Web Overlap Style) */}
        <View style={[st.floatingInfoCard, { backgroundColor: cardBg, borderColor: border }]}>
          {brand && (
            <View style={[st.brandTag, { backgroundColor: accent, marginBottom: 8 }]}>
              <Text style={st.brandTagText}>{String(restaurant.name || '').toUpperCase()} TAKEOVER</Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={[st.statusBadge, { backgroundColor: '#EF4F5F' }]}>
                <Text style={st.statusBadgeText}>TOP RATED</Text>
              </View>
              <Text style={{ color: txt, fontSize: 11, fontWeight: '700' }}>⭐ {rating.toFixed(1)}</Text>
            </View>
          </View>

          <Text style={[st.infoCardName, { color: txt }]}>{restaurant.name}</Text>
          <Text style={[st.infoCardDesc, { color: txtSec }]}>
            {restaurant.description || restaurant.stallDescription || `Exquisitely prepared fresh dishes from ${restaurant.name}.`}
          </Text>

          {isLocalVendor && (
            <View style={st.localVendorBadge}>
              <Text style={st.localVendorBadgeText}>🏪 CAMPUSBITES LOCAL VENDOR</Text>
            </View>
          )}

          {/* Delivery & Time Details */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderColor: border }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Text style={{ fontSize: 9, fontWeight: '800', color: txtSec }}>
                🕐 {isLocalVendor ? (restaurant.operatingHours ? `${restaurant.operatingHours.start || '19:00'} - ${restaurant.operatingHours.end || '00:00'}` : 'Hours vary') : '30-40 MIN'}
              </Text>
              <Text style={{ fontSize: 9, fontWeight: '800', color: txtSec }}>
                {isLocalVendor ? (restaurant.campus || 'CAMPUS STALL') : 'MIN ₹99'}
              </Text>
            </View>

            {isLocalVendor && (
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity 
                  style={[st.contactBtn, { backgroundColor: '#256FEF' }]}
                  onPress={() => Linking.openURL(getCallLink())}
                >
                  <Text style={st.contactBtnText}>📞 CALL</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[st.contactBtn, { backgroundColor: '#10B981' }]}
                  onPress={() => Linking.openURL(getWhatsAppLink())}
                >
                  <Text style={st.contactBtnText}>💬 WHATSAPP</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        {/* Active Promo Codes */}
        <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
          <View style={st.promoTitleRow}>
            <Text style={[st.promoSectionTitle, { color: txtSec }]}>🎟️ ACTIVE PROMO CODES</Text>
            <Text style={[st.swipeText, { color: txtSec }]}>SWIPE TO VIEW</Text>
          </View>
          <ScrollView 
            ref={promoScrollRef}
            horizontal 
            showsHorizontalScrollIndicator={false} 
            style={{ marginBottom: 16 }}
            contentContainerStyle={{ paddingHorizontal: 4 }}
            snapToInterval={Platform.OS === 'web' ? undefined : 232}
            decelerationRate="fast"
          >
            {getOffers().map((offer: any) => (
              <CardPressable 
                key={offer.code} 
                style={[st.promoCard, { backgroundColor: cardBg, borderColor: border }]}
                onPress={() => {
                  AsyncStorage.setItem('zenvy_copied_coupon', offer.code);
                  Alert.alert('Coupon Copied', `🎟️ Coupon "${offer.code}" copied to clipboard! Use it at checkout to claim: ${offer.desc}`);
                }}
                sound="click"
                tilt={true}
              >
                <View style={[st.promoCodeBadge, { backgroundColor: brand ? `${accent}20` : 'rgba(239, 79, 95, 0.1)' }]}>
                  <Text style={[st.promoCodeText, { color: brand ? accent : '#EF4F5F' }]}>{offer.code}</Text>
                </View>
                <Text style={[st.promoDescText, { color: txt }]}>{offer.desc}</Text>
                <Text style={[st.promoSubText, { color: txtSec }]}>{offer.sub}</Text>
              </CardPressable>
            ))}
          </ScrollView>
        </View>

        {/* Category Filter Pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.categoryScroll} contentContainerStyle={{ paddingHorizontal: 16 }}>
          {categories.map(cat => {
            const isActive = activeCategory === cat;
            return (
              <DopaminePressable
                key={cat}
                style={[
                  st.categoryPill,
                  { backgroundColor: cardBg, borderColor: border },
                  isActive ? { backgroundColor: brand ? accent : '#EF4F5F', borderColor: brand ? accent : '#EF4F5F' } : {}
                ]}
                onPress={() => setActiveCategory(cat)}
                sound="tabSwitch"
                activeScale={0.94}
              >
                <Text style={[st.categoryText, { color: isActive ? '#FFF' : txt }]}>
                  {String(cat).toUpperCase()}
                </Text>
              </DopaminePressable>
            );
          })}
        </ScrollView>

        {/* Menu Items */}
        <View style={{ padding: 16, paddingBottom: 100 }}>
          <Text style={[st.menuTitle, { color: txt }]}>MENU</Text>
          <Text style={[st.menuSub, { color: txtSec }]}>{filteredMenu.length} ITEMS AVAILABLE</Text>

          {filteredMenu.map((item: any, i: number) => {
            const itemImg = item.image || item.imageUrl || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200';
            const isVeg = item.isVegetarian;
            const itemId = item._id || item.id || String(i);
            const isAdded = addedId === itemId;

            return (
              <StaggeredSection key={itemId} delay={i * 60} direction="up">
              <CardPressable
                onPress={() => router.push(`/products/${itemId}` as any)}
                style={[st.menuCard, { backgroundColor: cardBg, borderColor: border }]}
              >
                <View style={st.menuInfo}>
                  <View style={[st.vegDot, { borderColor: isVeg ? '#22C55E' : '#AF3F3F' }]}>
                    {isVeg ? (
                      <View style={[st.vegDotInner, { backgroundColor: '#22C55E' }]} />
                    ) : (
                      <View style={st.nonVegTriangle} />
                    )}
                  </View>
                  <Text style={[st.menuItemName, { color: txt }]} numberOfLines={1}>{item.name}</Text>
                  <Text style={[st.menuItemPrice, { color: brand ? accent : '#EF4F5F' }]}>₹{item.price}</Text>
                  {item.description ? <Text style={{ fontSize: 9, color: txtSec, marginTop: 4 }} numberOfLines={2}>{item.description}</Text> : null}
                </View>
                
                {/* Right image with floating ADD button */}
                <View style={st.imgBtnContainer} pointerEvents="box-none">
                  <Image source={{ uri: itemImg }} style={st.menuItemImg} />
                  <View style={st.floatingAddWrap} pointerEvents="box-none">
                    {isLocalVendor ? (
                      <ActionPressable
                        style={[st.menuAddBtn, { backgroundColor: '#10B981', borderColor: '#059669' }]}
                        onPress={() => Linking.openURL(getWhatsAppLink(item.name))}
                        sound="click"
                      >
                        <Text style={[st.menuAddBtnText, { color: '#fff' }]}>ORDER</Text>
                      </ActionPressable>
                    ) : (
                      <CartPressable
                        style={[
                          st.menuAddBtn,
                          isAdded 
                            ? { backgroundColor: '#EF4F5F', borderColor: '#EF4F5F' }
                            : { backgroundColor: '#FFF5F6', borderColor: '#EF4F5F' }
                        ]}
                        onPress={() => handleAddToCart(item)}
                        sound="addToCart"
                      >
                        <Text style={[
                          st.menuAddBtnText, 
                          isAdded ? { color: '#fff' } : { color: '#EF4F5F' }
                        ]}>
                          {isAdded ? '✓ ADDED' : 'ADD'}
                        </Text>
                      </CartPressable>
                    )}
                  </View>
                </View>
              </CardPressable>
              </StaggeredSection>
            );
          })}
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Floating Basket Bar */}
      {totalItems > 0 && (
        <FloatingPulse color={brand ? accent : '#EF4F5F'} style={st.floatingCartContainer}>
          <DopaminePressable
            style={[st.floatingCart, { backgroundColor: brand ? accent : '#EF4F5F', width: '100%' }]}
            onPress={() => router.push('/(tabs)/basket' as any)}
            sound="success"
            activeScale={0.95}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'space-between', paddingHorizontal: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={st.badgeContainer}><Text style={st.badgeText}>{totalItems}</Text></View>
                <Text style={[st.floatingCartText, { color: '#fff' }]}>VIEW BASKET</Text>
              </View>
              <Text style={[st.proceedText, { color: '#fff' }]}>Proceed →</Text>
            </View>
          </DopaminePressable>
        </FloatingPulse>
      )}

      {customizingItem && (
        <CustomizeDrawer
          isOpen={!!customizingItem}
          onClose={() => setCustomizingItem(null)}
          onConfirm={handleCustomizeConfirm}
          itemName={customizingItem.name}
          basePrice={customizingItem.price}
          tags={customizingItem.tags}
          category={customizingItem.category}
          isVegetarian={customizingItem.isVegetarian === true || String(customizingItem.isVegetarian).toLowerCase() === 'true' || Number(customizingItem.isVegetarian) === 1 || (customizingItem.tags || []).includes('veg')}
        />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { width: SW, height: 200, position: 'relative' },
  heroImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  heroGrad: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  backBtn: { position: 'absolute', top: Platform.OS === 'android' ? 36 : 50, left: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  favoriteBtn: { position: 'absolute', top: Platform.OS === 'android' ? 36 : 50, right: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center', zIndex: 2, ...SHADOWS.card },
  
  // Floating Card Overlap Style
  floatingInfoCard: { marginHorizontal: 16, marginTop: -32, borderRadius: 24, padding: 16, borderWidth: 1, ...SHADOWS.card, shadowOpacity: 0.15 },
  infoCardName: { fontSize: 20, fontWeight: '900', letterSpacing: 0.5, marginBottom: 4 },
  infoCardDesc: { fontSize: 10, fontWeight: '500', lineHeight: 14, marginBottom: 8 },
  localVendorBadge: { alignSelf: 'flex-start', backgroundColor: 'rgba(249,115,22,0.1)', borderWidth: 1, borderColor: 'rgba(249,115,22,0.2)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginVertical: 4 },
  localVendorBadgeText: { fontSize: 8, fontWeight: '900', color: '#F97316', letterSpacing: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, alignSelf: 'flex-start' },
  statusBadgeText: { fontSize: 8, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  
  contactBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  contactBtnText: { fontSize: 8, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },

  brandTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  brandTagText: { fontSize: 8, fontWeight: '900', color: '#fff', letterSpacing: 3 },
  menuTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 3, marginBottom: 2 },
  menuSub: { fontSize: 9, fontWeight: '700', letterSpacing: 2, marginBottom: 16 },
  menuCard: { flexDirection: 'row', padding: 12, borderRadius: 24, marginBottom: 12, borderWidth: 1, alignItems: 'center' },
  menuInfo: { flex: 1, paddingRight: 12 },
  vegDot: { width: 12, height: 12, borderWidth: 1.5, borderRadius: 3, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
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
  menuItemName: { fontSize: 13, fontWeight: '900', marginBottom: 2 },
  menuItemPrice: { fontSize: 14, fontWeight: '900', marginBottom: 4 },
  
  // Right Image container with floating button
  imgBtnContainer: { width: 90, height: 90, position: 'relative', alignItems: 'center', justifyContent: 'flex-end' },
  menuItemImg: { width: '100%', height: '100%', borderRadius: 16 },
  floatingAddWrap: { position: 'absolute', bottom: -8, zIndex: 10, width: '100%', alignItems: 'center' },
  menuAddBtn: { width: 72, paddingVertical: 6, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', ...SHADOWS.card },
  menuAddBtnText: { fontSize: 8, fontWeight: '900', letterSpacing: 1 },

  // Promo Codes Styles
  promoTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 12 },
  promoSectionTitle: { fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  swipeText: { fontSize: 8, fontWeight: '700' },
  promoCard: { width: 220, padding: 12, borderRadius: 16, borderStyle: 'dashed', borderWidth: 1.5, marginRight: 12 },
  promoCodeBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginBottom: 6 },
  promoCodeText: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  promoDescText: { fontSize: 11, fontWeight: '800' },
  promoSubText: { fontSize: 8, fontWeight: '600', marginTop: 4 },

  // Category Filter Pills
  categoryScroll: { marginVertical: 12 },
  categoryPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginRight: 8, borderWidth: 1 },
  categoryText: { fontSize: 9, fontWeight: '900', letterSpacing: 2 },

  // Floating Cart styles
  floatingCartContainer: {
    position: 'absolute', 
    bottom: 24, 
    left: 16, 
    right: 16, 
    zIndex: 100,
  },
  floatingCart: { 
    height: 56, 
    borderRadius: 28, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: 24,
    shadowColor: '#EF4F5F',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  badgeContainer: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFF', fontSize: 10, fontWeight: '900' },
  floatingCartText: { fontSize: 11, fontWeight: '900', letterSpacing: 2 },
  proceedText: { fontSize: 12, fontWeight: '900' },
});
