/**
 * PG photos: the swipeable hero at the top of the detail screen, the "Photos" section (category chips +
 * thumbnail grid) and a full-screen viewer (swipe between photos, pinch or double-tap to zoom, drag
 * when zoomed). Gestures use react-native-gesture-handler + reanimated, both already in the app.
 * The viewer is a Modal: Android back closes it.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, Modal, StyleSheet, useWindowDimensions, StatusBar, ScrollView, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PHOTO_CATEGORY_LABEL, type PgPhoto, type PhotoCategory } from './pgApi';
import { usePgPalette, PgImage, Press, SectionHeading, IconX, IconImageOff, ICON, s as ui } from './ui';

const HERO_RATIO = 3 / 4; // height / width; fixed so nothing jumps while photos load

// ── Hero ──────────────────────────────────────────────────────────────────────────────────────
export function PgHero({ photos, onOpen, topInset }: { photos: PgPhoto[]; onOpen: (list: PgPhoto[], index: number) => void; topInset: number }) {
  const p = usePgPalette();
  const { width } = useWindowDimensions();
  const height = Math.round(width * HERO_RATIO);
  const [index, setIndex] = useState(0);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    setIndex((cur) => (cur === i ? cur : i));
  }, [width]);

  if (!photos.length) {
    return (
      <View style={{ width, height, backgroundColor: p.sunken, alignItems: 'center', justifyContent: 'center', paddingTop: topInset }} accessibilityLabel="No photos yet">
        <IconImageOff size={24} color={p.muted} strokeWidth={ICON.stroke} />
        <Text style={[ui.small, { color: p.muted, marginTop: 8 }]}>No photos yet</Text>
      </View>
    );
  }
  const current = photos[Math.min(index, photos.length - 1)];
  return (
    <View style={{ width, height }}>
      <FlatList
        data={photos}
        keyExtractor={(x) => x.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={32}
        initialNumToRender={2}
        windowSize={3}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item, index: i }) => (
          <Press onPress={() => onOpen(photos, i)} accessibilityRole="imagebutton" accessibilityLabel={`Photo ${i + 1} of ${photos.length}${item.caption ? `, ${item.caption}` : ''}. Opens full screen`} style={{ width, height }}>
            <PgImage uri={item.url} style={{ width, height }} recyclingKey={item.id} priority={i === 0 ? 'high' : 'normal'} />
          </Press>
        )}
      />
      {photos.length > 1 ? (
        <View style={[st.counter, { backgroundColor: p.overlay }]} pointerEvents="none">
          <Text style={st.counterText}>{index + 1} / {photos.length}</Text>
        </View>
      ) : null}
      {current?.caption ? (
        <View style={[st.heroCaption, { backgroundColor: p.overlay }]} pointerEvents="none">
          <Text style={st.counterText} numberOfLines={1}>{current.caption}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Photos section: category chips + grid ────────────────────────────────────────────────────
const GRID_GAP = 4;
const GRID_PREVIEW = 9;
export function PgPhotoSection({ photos, onOpen }: { photos: PgPhoto[]; onOpen: (list: PgPhoto[], index: number) => void }) {
  const p = usePgPalette();
  const { width } = useWindowDimensions();
  const [cat, setCat] = useState<PhotoCategory | 'ALL'>('ALL');
  const [expanded, setExpanded] = useState(false);
  const counts = useMemo(() => {
    const m = new Map<PhotoCategory, number>();
    photos.forEach((x) => m.set(x.category, (m.get(x.category) || 0) + 1));
    return m;
  }, [photos]);
  const cats = (Object.keys(PHOTO_CATEGORY_LABEL) as PhotoCategory[]).filter((c) => counts.has(c));
  const list = cat === 'ALL' ? photos : photos.filter((x) => x.category === cat);
  const shown = expanded ? list : list.slice(0, GRID_PREVIEW);
  const tile = Math.floor((width - 32 - GRID_GAP * 2) / 3);

  if (!photos.length) return null;
  return (
    <View>
      <SectionHeading title="Photos" detail={`${photos.length} photo${photos.length === 1 ? '' : 's'}`} />
      {cats.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }} accessibilityRole="tablist">
          {[['ALL', `All ${photos.length}`] as const, ...cats.map((c) => [c, `${PHOTO_CATEGORY_LABEL[c]} ${counts.get(c)}`] as const)].map(([key, label]) => {
            const on = cat === key;
            return (
              <Press key={key} hitSlop={4} onPress={() => { setCat(key as any); setExpanded(false); }} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}
                style={[st.chip, { borderColor: on ? p.text : p.line, backgroundColor: on ? p.text : 'transparent' }]}>
                <Text style={[st.chipText, { color: on ? p.bg : p.sub }]}>{label}</Text>
              </Press>
            );
          })}
        </ScrollView>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP }}>
        {shown.map((ph, i) => (
          <Press key={ph.id} onPress={() => onOpen(list, i)} accessibilityRole="imagebutton" accessibilityLabel={`${PHOTO_CATEGORY_LABEL[ph.category]} photo${ph.caption ? `, ${ph.caption}` : ''}`} style={{ width: tile, height: tile }}>
            <PgImage uri={ph.url} style={{ width: tile, height: tile, borderRadius: 6 }} recyclingKey={`g-${ph.id}`} priority="low" />
          </Press>
        ))}
      </View>
      {list.length > GRID_PREVIEW ? (
        <Press onPress={() => setExpanded((v) => !v)} style={[ui.secondaryBtn, { borderColor: p.line, marginTop: 12 }]} accessibilityLabel={expanded ? 'Show fewer photos' : `Show all ${list.length} photos`}>
          <Text style={[ui.btnLabel, { color: p.text }]}>{expanded ? 'Show fewer' : `Show all ${list.length}`}</Text>
        </Press>
      ) : null}
    </View>
  );
}

// ── Full-screen viewer ───────────────────────────────────────────────────────────────────────
const MAX_SCALE = 4;
function ZoomableImage({ uri, width, height, zoomed, onZoomChange }: { uri: string; width: number; height: number; zoomed: boolean; onZoomChange: (zoomed: boolean) => void }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const clamp = (v: number, lim: number) => {
    'worklet';
    return Math.min(lim, Math.max(-lim, v));
  };
  const reset = () => {
    'worklet';
    scale.value = withTiming(1, { duration: 200 });
    savedScale.value = 1;
    tx.value = withTiming(0, { duration: 200 });
    ty.value = withTiming(0, { duration: 200 });
    savedTx.value = 0;
    savedTy.value = 0;
    runOnJS(onZoomChange)(false);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(0.8, savedScale.value * e.scale));
    })
    .onEnd(() => {
      if (scale.value <= 1.02) { reset(); return; }
      savedScale.value = scale.value;
      runOnJS(onZoomChange)(true);
    });
  // Only while zoomed: otherwise a one-finger drag belongs to the list (swipe to the next photo).
  const pan = Gesture.Pan()
    .enabled(zoomed)
    .averageTouches(true)
    .onUpdate((e) => {
      if (savedScale.value <= 1) return;
      const limX = (width * (scale.value - 1)) / 2;
      const limY = (height * (scale.value - 1)) / 2;
      tx.value = clamp(savedTx.value + e.translationX, limX);
      ty.value = clamp(savedTy.value + e.translationY, limY);
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (savedScale.value > 1) { reset(); return; }
      scale.value = withTiming(2.5, { duration: 200 });
      savedScale.value = 2.5;
      runOnJS(onZoomChange)(true);
    });
  const gesture = Gesture.Simultaneous(pinch, Gesture.Exclusive(doubleTap, pan));

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }] }));
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[{ width, height }, style]}>
        <Image source={{ uri }} style={{ width, height }} contentFit="contain" transition={120} cachePolicy="memory-disk" />
      </Animated.View>
    </GestureDetector>
  );
}

export function PhotoViewer({ photos, index, onClose }: { photos: PgPhoto[]; index: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(index);
  const [zoomed, setZoomed] = useState(false);
  const listRef = useRef<FlatList<PgPhoto>>(null);
  const visible = photos.length > 0 && index >= 0;
  const ph = photos[Math.min(current, photos.length - 1)];

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent={false} supportedOrientations={['portrait']}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
        <FlatList
          ref={listRef}
          data={photos}
          keyExtractor={(x) => `v-${x.id}`}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          extraData={zoomed}
          initialScrollIndex={Math.min(index, Math.max(0, photos.length - 1))}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          showsHorizontalScrollIndicator={false}
          windowSize={3}
          initialNumToRender={1}
          onMomentumScrollEnd={(e) => setCurrent(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)))}
          renderItem={({ item }) => (
            <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
              <ZoomableImage uri={item.url} width={width} height={height} zoomed={zoomed} onZoomChange={setZoomed} />
            </View>
          )}
        />
        <View style={[st.viewerTop, { paddingTop: insets.top + 4 }]}>
          <Text style={st.viewerCount} accessibilityLiveRegion="polite">{Math.min(current, photos.length - 1) + 1} of {photos.length}</Text>
          <Press onPress={onClose} accessibilityLabel="Close photos" style={st.viewerClose}>
            <IconX size={24} color="#fff" strokeWidth={ICON.stroke} />
          </Press>
        </View>
        {ph ? (
          <View style={[st.viewerBottom, { paddingBottom: insets.bottom + 16 }]} pointerEvents="none">
            <Text style={st.viewerCat}>{PHOTO_CATEGORY_LABEL[ph.category]}</Text>
            {ph.caption ? <Text style={st.viewerCaption} numberOfLines={3}>{ph.caption}</Text> : null}
          </View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

const st = StyleSheet.create({
  counter: { position: 'absolute', right: 16, bottom: 16, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  heroCaption: { position: 'absolute', left: 16, bottom: 16, maxWidth: '65%', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  counterText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, fontWeight: '600' },
  viewerTop: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, backgroundColor: 'rgba(0,0,0,0.35)' },
  viewerCount: { color: '#fff', fontSize: 14, fontWeight: '600' },
  viewerClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  viewerBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: 'rgba(0,0,0,0.45)' },
  viewerCat: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600' },
  viewerCaption: { color: '#fff', fontSize: 14, lineHeight: 20, marginTop: 2 },
});
