/**
 * Food & groceries v2: product photo gallery. Full-width, about 320 px tall, the photo fills the
 * white frame (bottom radius 20); swipe between 2–5 photos, dots plus a "1/4" counter, a thumbnail
 * strip below (tap to jump) and a full-screen viewer on tap (swipe, close). The back, share and
 * heart buttons sit on top.
 */
import React, { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { PressScale } from '../../modules/others/motion';
import { FOOD } from './foodV2Theme';
import { Icon } from './FoodV2Icons';
import { BUTTON_ROLE } from '../../utils/pressRole';

export default function FoodV2Gallery({ images, topPad, isSaved, onBack, onShare, onToggleSaved, name }: {
  images: string[]; topPad: number; isSaved: boolean; name: string;
  onBack: () => void; onShare: () => void; onToggleSaved: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const W = Math.min(width, 600);
  const H = Math.round(Math.min(340, Math.max(280, W * 0.82))) + topPad;
  const [index, setIndex] = useState(0);
  const [viewer, setViewer] = useState<number | null>(null);
  const pager = useRef<ScrollView>(null);
  const viewerPager = useRef<ScrollView>(null);
  const jump = (i: number) => { setIndex(i); pager.current?.scrollTo({ x: i * W, animated: true }); };

  return (
    <View>
      <View style={[st.frame, { height: H }]}>
        <ScrollView ref={pager} horizontal pagingEnabled showsHorizontalScrollIndicator={false} scrollEventThrottle={16}
          onMomentumScrollEnd={e => setIndex(Math.round(e.nativeEvent.contentOffset.x / W))}
          onScroll={e => { const i = Math.round(e.nativeEvent.contentOffset.x / W); if (i !== index) setIndex(i); }}>
          {images.map((uri, i) => (
            <Pressable key={`${uri}-${i}`} onPress={() => setViewer(i)} style={{ width: W, height: H }} accessibilityRole="imagebutton" accessibilityLabel={`${name}, photo ${i + 1} of ${images.length}. Open full screen`}>
              <Image source={{ uri }} style={[StyleSheet.absoluteFill, { top: topPad }]} contentFit="cover" transition={150} />
            </Pressable>
          ))}
        </ScrollView>
        <View style={[st.topRow, { top: topPad + 8 }]} pointerEvents="box-none">
          <PressScale style={st.round} onPress={onBack} accessibilityRole={BUTTON_ROLE} accessibilityLabel="Go back">
            <Icon name="arrow-back" size={22} color="#FFFFFF" />
          </PressScale>
          <View style={{ flex: 1 }} />
          <PressScale style={st.round} onPress={onShare} accessibilityRole={BUTTON_ROLE} accessibilityLabel="Share">
            <Icon name="share-outline" size={18} color="#FFFFFF" />
          </PressScale>
          <PressScale style={st.round} onPress={onToggleSaved} accessibilityRole={BUTTON_ROLE} accessibilityLabel={isSaved ? 'Remove from saved' : 'Save item'}>
            <Icon name={isSaved ? 'heart' : 'heart-outline'} size={19} color="#FFFFFF" />
          </PressScale>
        </View>
        {images.length > 1 && (
          <>
            <View style={st.dots} pointerEvents="none">
              {images.map((_, i) => <View key={i} style={[st.dot, i === index && st.dotOn]} />)}
            </View>
            <View style={st.counter} pointerEvents="none"><Text style={st.counterText}>{index + 1}/{images.length}</Text></View>
          </>
        )}
      </View>

      {images.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={st.strip}>
          {images.map((uri, i) => (
            <PressScale key={`t-${uri}-${i}`} onPress={() => jump(i)} style={[st.thumb, i === index && st.thumbOn]} accessibilityRole={BUTTON_ROLE} accessibilityLabel={`Show photo ${i + 1}`}>
              <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            </PressScale>
          ))}
        </ScrollView>
      )}

      <Modal visible={viewer !== null} transparent animationType="fade" onRequestClose={() => setViewer(null)} onShow={() => viewerPager.current?.scrollTo({ x: (viewer || 0) * width, animated: false })}>
        <View style={st.viewer}>
          <ScrollView ref={viewerPager} horizontal pagingEnabled showsHorizontalScrollIndicator={false} contentOffset={{ x: (viewer || 0) * width, y: 0 }}>
            {images.map((uri, i) => (
              <View key={`v-${uri}-${i}`} style={{ width, height }}>
                <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
              </View>
            ))}
          </ScrollView>
          <PressScale style={[st.round, st.close, { top: topPad + 8 }]} onPress={() => setViewer(null)} accessibilityRole={BUTTON_ROLE} accessibilityLabel="Close photos">
            <Icon name="close" size={22} color="#FFFFFF" />
          </PressScale>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  frame: { backgroundColor: '#FFFFFF', borderBottomLeftRadius: 20, borderBottomRightRadius: 20, overflow: 'hidden' },
  topRow: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(8,30,20,0.42)', alignItems: 'center', justifyContent: 'center' },
  dots: { position: 'absolute', bottom: 14, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.7)', borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.15)' },
  dotOn: { width: 16, backgroundColor: FOOD.primary, borderColor: FOOD.primary },
  counter: { position: 'absolute', right: 14, bottom: 10, paddingHorizontal: 8, height: 22, borderRadius: 11, backgroundColor: 'rgba(8,30,20,0.55)', justifyContent: 'center' },
  counterText: { color: '#FFFFFF', fontSize: 11.5, fontWeight: '500' },
  strip: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  thumb: { width: 52, height: 52, borderRadius: 12, overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(16,40,30,0.08)', backgroundColor: '#FFFFFF' },
  thumbOn: { borderColor: FOOD.primary },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.96)' },
  close: { position: 'absolute', right: 16 },
});
