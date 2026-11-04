/**
 * PG v2 media: a full-screen photo viewer with swipe and thumbnails, and room-tour videos (the PG's
 * YouTube tours, played in place through the privacy-enhanced youtube-nocookie embed; "Open in
 * YouTube" hands off to the app). Replaces modules/pg PgGallery's viewer and PgVideos.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, Platform, Linking, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { WebView } from 'react-native-webview';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import IX from 'lucide-react-native/icons/x';
import IPlay from 'lucide-react-native/icons/play';
import { PG2, R, GUTTER, W } from './pgV2Theme';
import { Tap, Photo } from './PgV2Kit';
import type { V2Photo } from './pgV2Photos';
import type { PgVideo } from '../pg/pgApi';
import { themedSheet } from '../../utils/themeNow';

export function PhotoViewer({ photos, index, onClose }: { photos: V2Photo[]; index: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const ref = useRef<ScrollView>(null);
  const thumbs = useRef<ScrollView>(null);
  const [at, setAt] = useState(index);
  useEffect(() => { const t = setTimeout(() => ref.current?.scrollTo({ x: index * width, animated: false }), 0); return () => clearTimeout(t); }, [index, width]);
  const go = (i: number) => { setAt(i); ref.current?.scrollTo({ x: i * width, animated: true }); };
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => setAt(Math.round(e.nativeEvent.contentOffset.x / width));
  const p = photos[at];
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={st.viewer}>
        <View style={[st.viewerTop, { paddingTop: insets.top + 8 }]}>
          <Text style={st.viewerCount}>{at + 1} / {photos.length}{p?.caption ? `  ·  ${p.caption}` : ''}</Text>
          <Tap onPress={onClose} label="Close photos" style={st.close}><IX size={22} color="#FFFFFF" strokeWidth={1.6} /></Tap>
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <ScrollView ref={ref} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onEnd} onScroll={(e) => { if (Platform.OS === 'web') onEnd(e); }} scrollEventThrottle={64} style={{ flexGrow: 0, height: Math.round(height * 0.6) }}>
            {photos.map((ph) => (
              <View key={ph.key} style={{ width, height: Math.round(height * 0.6), justifyContent: 'center' }}>
                <Image source={ph.source as any} style={{ width, height: Math.round(height * 0.6) }} contentFit="contain" accessibilityLabel={ph.caption} />
              </View>
            ))}
          </ScrollView>
        </View>
        <ScrollView ref={thumbs} horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={[st.viewerThumbs, { paddingBottom: insets.bottom + 16 }]}>
          {photos.map((ph, i) => (
            <Tap key={ph.key} onPress={() => go(i)} label={`Photo ${i + 1}`} selected={i === at} style={[st.vThumb, i === at && { borderColor: '#FFFFFF' }]}>
              <Photo photo={ph} style={StyleSheet.absoluteFill} radius={6} />
            </Tap>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Player({ video, onClose }: { video: PgVideo; onClose: () => void }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const h = Math.round(width * 0.5625);
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#000}iframe{border:0;width:100%;height:100vh}</style></head><body><iframe src="${video.embedUrl}?autoplay=1&playsinline=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></body></html>`;
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[st.viewer, { justifyContent: 'center' }]}>
        <View style={[st.viewerTop, { paddingTop: insets.top + 8, position: 'absolute', top: 0, left: 0, right: 0 }]}>
          <Text style={st.viewerCount} numberOfLines={1}>{video.title || 'Room tour'}</Text>
          <Tap onPress={onClose} label="Close video" style={st.close}><IX size={22} color="#FFFFFF" strokeWidth={1.6} /></Tap>
        </View>
        <View style={{ width, height: h }}>
          {Platform.OS === 'web'
            ? React.createElement('iframe', { src: `${video.embedUrl}?autoplay=1&rel=0`, title: video.title || 'Room tour', allow: 'autoplay; encrypted-media; picture-in-picture', allowFullScreen: true, style: { border: 0, width: '100%', height: '100%' } })
            : <WebView source={{ html, baseUrl: 'https://www.youtube-nocookie.com' }} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} style={{ flex: 1, backgroundColor: '#000' }}
                onShouldStartLoadWithRequest={(req) => {
                  if (req.url.startsWith('about:') || /^https:\/\/(www\.)?youtube-nocookie\.com\/embed\//.test(req.url) || req.url.startsWith('https://www.youtube-nocookie.com')) return true;
                  Linking.openURL(req.url).catch(() => {}); return false;
                }} />}
        </View>
        <Tap onPress={() => Linking.openURL(video.watchUrl).catch(() => {})} label="Open in YouTube" role="link" style={st.openYt}>
          <Text style={st.openYtText}>Open in YouTube</Text>
        </Tap>
      </View>
    </Modal>
  );
}

/** Room tour cards; tapping one plays it. Nothing renders when the PG has no tours. */
export function ToursRow({ videos }: { videos: PgVideo[] }) {
  const { width } = useWindowDimensions();
  const [playing, setPlaying] = useState<PgVideo | null>(null);
  if (!videos.length) return null;
  const cardW = Math.round(Math.min(260, width * 0.62));
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
        {videos.map((v) => (
          <Tap key={v.id} onPress={() => setPlaying(v)} label={`Play ${v.title || 'room tour'}`} style={{ width: cardW }}>
            <View style={[st.tourThumb, { height: Math.round(cardW * 0.5625) }]}>
              <Image source={{ uri: v.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
              <View style={st.play}><IPlay size={18} color="#FFFFFF" fill="#FFFFFF" strokeWidth={1.6} /></View>
            </View>
            <Text style={st.tourTitle} numberOfLines={1}>{v.title || 'Room tour'}</Text>
          </Tap>
        ))}
      </ScrollView>
      {playing ? <Player video={playing} onClose={() => setPlaying(null)} /> : null}
    </View>
  );
}

const st = themedSheet(() => ({
  viewer: { flex: 1, backgroundColor: '#0B0A14' },
  viewerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: GUTTER, zIndex: 2 },
  viewerCount: { color: 'rgba(255,255,255,0.85)', fontSize: 13.5, fontWeight: W.label, flex: 1 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  viewerThumbs: { gap: 8, paddingHorizontal: GUTTER, paddingTop: 10 },
  vThumb: { width: 64, height: 48, borderRadius: 8, borderWidth: 2, borderColor: 'transparent', overflow: 'hidden' },
  tourThumb: { borderRadius: R.md, overflow: 'hidden', backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  play: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
  tourTitle: { marginTop: 8, fontSize: 13.5, fontWeight: W.label, color: PG2.ink },
  openYt: { alignSelf: 'center', marginTop: 18, minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  openYtText: { color: '#FFFFFF', fontSize: 14, fontWeight: W.label },
}));
