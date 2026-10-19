/**
 * PG room tours: videos the Zenvy team posts on its YouTube channel (admin adds the links). Each shows
 * YouTube's thumbnail; tapping plays it in place (privacy-enhanced youtube-nocookie embed inside a
 * WebView). If the player cannot load, or for anyone who prefers it, "Open in YouTube" hands off to the
 * YouTube app / browser.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Linking, ActivityIndicator, Modal, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { API_URL } from '../../constants/api';
import type { PgVideo } from './pgApi';
import { usePgPalette, PgImage, Press, SectionHeading, IconPlay, IconExternalLink, IconX, s as ui } from './ui';

// The embed needs a real https origin as its referrer (YouTube refuses players without one).
const ORIGIN = (() => {
  try { return new URL(API_URL).origin; } catch { return 'https://zenvy.app'; }
})();

const playerHtml = (embedUrl: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style></head>
<body><iframe src="${embedUrl}&autoplay=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="Room tour"></iframe></body></html>`;

const openInYouTube = (v: PgVideo) => { Linking.openURL(v.watchUrl).catch(() => {}); };

function VideoCard({ video, roomTypeLabel, playing, onPlay }: { video: PgVideo; roomTypeLabel?: string; playing: boolean; onPlay: () => void }) {
  const p = usePgPalette();
  const { width } = useWindowDimensions();
  const w = width - 32;
  const h = Math.round((w * 9) / 16);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const html = useMemo(() => playerHtml(video.embedUrl), [video.embedUrl]);

  // Links tapped inside the player (YouTube logo, "Watch on YouTube") leave the app's WebView.
  const onNav = (req: WebViewNavigation & { isTopFrame?: boolean }) => {
    const url = req.url || '';
    if (url.startsWith('about:') || url.startsWith(ORIGIN) || req.isTopFrame === false) return true;
    if (/^https:\/\/(www\.)?youtube-nocookie\.com\/embed\//.test(url)) return true;
    Linking.openURL(url).catch(() => {});
    return false;
  };

  return (
    <View style={{ marginBottom: 16 }}>
      <View style={{ width: w, height: h, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' }}>
        {playing && !failed ? (
          <>
            <WebView
              source={{ html, baseUrl: ORIGIN }}
              originWhitelist={['*']}
              style={{ width: w, height: h, backgroundColor: '#000' }}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              allowsFullscreenVideo
              javaScriptEnabled
              domStorageEnabled
              setSupportMultipleWindows={false}
              onShouldStartLoadWithRequest={onNav}
              onLoadEnd={() => setLoading(false)}
              onError={() => setFailed(true)}
              onHttpError={() => setFailed(true)}
              accessibilityLabel={`Video player: ${video.title || 'Room tour'}`}
            />
            {loading ? <View style={[StyleSheet.absoluteFill, st.center]} pointerEvents="none"><ActivityIndicator color="#fff" /></View> : null}
          </>
        ) : (
          <Press onPress={failed ? () => openInYouTube(video) : onPlay} accessibilityLabel={failed ? `Open ${video.title || 'video'} in YouTube` : `Play ${video.title || 'room tour'}`} style={{ width: w, height: h }}>
            <PgImage uri={video.thumbnailUrl} style={{ width: w, height: h }} recyclingKey={`yt-${video.youtubeId}`} />
            <View style={[StyleSheet.absoluteFill, st.center, { backgroundColor: 'rgba(0,0,0,0.25)' }]}>
              <View style={st.playBtn}>
                {failed ? <IconExternalLink size={22} color="#111" strokeWidth={2} /> : <IconPlay size={22} color="#111" strokeWidth={2} fill="#111" />}
              </View>
              {failed ? <Text style={st.failText}>Couldn't play here. Tap to open in YouTube.</Text> : null}
            </View>
          </Press>
        )}
      </View>
      <View style={st.meta}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[ui.body, { color: p.text, fontWeight: '600' }]} numberOfLines={2}>{video.title || 'Room tour'}</Text>
          {roomTypeLabel ? <Text style={[ui.small, { color: p.muted, marginTop: 2 }]} numberOfLines={1}>{roomTypeLabel}</Text> : null}
        </View>
        <Press onPress={() => openInYouTube(video)} accessibilityRole="link" accessibilityLabel="Open in YouTube" style={st.ytLink}>
          <Text style={[ui.small, { color: p.sub, fontWeight: '600' }]}>Open in YouTube</Text>
        </Press>
      </View>
    </View>
  );
}

export function PgVideoSection({ videos, roomTypeLabels }: { videos: PgVideo[]; roomTypeLabels: Record<string, string> }) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  if (!videos.length) return null;
  return (
    <View>
      <SectionHeading title="Room tour" detail={videos.length > 1 ? `${videos.length} videos` : undefined} />
      {videos.map((v) => (
        <VideoCard key={v.id} video={v} roomTypeLabel={v.roomType ? roomTypeLabels[v.roomType] : undefined} playing={playingId === v.id} onPlay={() => setPlayingId(v.id)} />
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  playBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center', paddingLeft: 3 },
  failText: { color: '#fff', fontSize: 12, fontWeight: '600', marginTop: 10 },
  meta: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 8 },
  ytLink: { justifyContent: 'center', paddingHorizontal: 4 },
  modalTop: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 4, minHeight: 56 },
  modalTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
  modalClose: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  modalLink: { paddingHorizontal: 16, justifyContent: 'center' },
});

/**
 * Full-width player in a Modal (list page: promotions and the Room tours rail). Plays only when opened,
 * never on its own. Android back closes it; "Open in YouTube" is the fallback.
 */
export function VideoModal({ video, title, subtitle, onClose }: {
  video: { youtubeId: string; embedUrl: string; watchUrl: string }; title: string; subtitle?: string; onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const h = Math.round((width * 9) / 16);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const html = useMemo(() => playerHtml(video.embedUrl), [video.embedUrl]);
  const open = () => { Linking.openURL(video.watchUrl).catch(() => {}); };
  const onNav = (req: WebViewNavigation & { isTopFrame?: boolean }) => {
    const url = req.url || '';
    if (url.startsWith('about:') || url.startsWith(ORIGIN) || req.isTopFrame === false) return true;
    if (/^https:\/\/(www\.)?youtube-nocookie\.com\/embed\//.test(url)) return true;
    Linking.openURL(url).catch(() => {});
    return false;
  };
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait']}>
      <View style={{ flex: 1, backgroundColor: '#000', paddingTop: insets.top }}>
        <View style={st.modalTop}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.modalTitle} numberOfLines={1}>{title}</Text>
            {subtitle ? <Text style={st.modalSub} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
          <Press onPress={onClose} accessibilityLabel="Close video" style={st.modalClose}>
            <IconX size={24} color="#fff" strokeWidth={1.75} />
          </Press>
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ width, height: h, backgroundColor: '#000' }}>
            {failed ? (
              <Press onPress={open} accessibilityLabel="Open in YouTube" style={[{ width, height: h }, st.center]}>
                <IconExternalLink size={22} color="#fff" strokeWidth={2} />
                <Text style={st.failText}>Couldn't play here. Tap to open in YouTube.</Text>
              </Press>
            ) : (
              <>
                <WebView
                  source={{ html, baseUrl: ORIGIN }}
                  originWhitelist={['*']}
                  style={{ width, height: h, backgroundColor: '#000' }}
                  allowsInlineMediaPlayback
                  mediaPlaybackRequiresUserAction={false}
                  allowsFullscreenVideo
                  javaScriptEnabled
                  domStorageEnabled
                  setSupportMultipleWindows={false}
                  onShouldStartLoadWithRequest={onNav}
                  onLoadEnd={() => setLoading(false)}
                  onError={() => setFailed(true)}
                  onHttpError={() => setFailed(true)}
                  accessibilityLabel={`Video player: ${title}`}
                />
                {loading ? <View style={[StyleSheet.absoluteFill, st.center]} pointerEvents="none"><ActivityIndicator color="#fff" /></View> : null}
              </>
            )}
          </View>
        </View>
        <View style={{ paddingBottom: insets.bottom + 16, alignItems: 'center' }}>
          <Press onPress={open} accessibilityRole="link" accessibilityLabel="Open in YouTube" style={st.modalLink}>
            <Text style={st.modalSub}>Open in YouTube</Text>
          </Press>
        </View>
      </View>
    </Modal>
  );
}
