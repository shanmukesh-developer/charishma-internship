/**
 * Screen 4 · PG Location: an OpenStreetMap / Leaflet map (free tiles, OSM attribution) in a WebView
 * (an iframe on web), the PG's pin, a card for the PG and "Get Directions" (the phone's maps app via a
 * geo: / Google Maps URL, no keys). When the PG has no lat / lon the map is hidden and the address shown.
 */
import React from 'react';
import { View, Text, StyleSheet, Platform, Linking, Share } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PG2, R, GUTTER, W, shadow } from './pgV2Theme';
import { Header, Tap, Photo, EmptyState, Loading, OutlineButton, k } from './PgV2Kit';
import { IShare, INavigation, IMapPin, IBuilding, STROKE } from './PgV2Icons';
import { buildingPhoto } from './pgV2Photos';
import { usePgDetail, kmText, placeText } from './pgV2Data';
import { useNav, usePgIdFor } from './pgV2Nav';
import { mapsUrl, type PgDetail } from '../../modules/pg/pgApi';
import { themedSheet } from '../../utils/themeNow';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Self-contained Leaflet page: one violet pin, a zoom button, OSM attribution. */
export const leafletHtml = (lat: number, lng: number, name: string, zoomBottom = 150) => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#m{margin:0;height:100%;background:#EEF0F6}
.leaflet-control-attribution{font:10px -apple-system,Roboto,sans-serif;background:rgba(255,255,255,.8)!important}
.zcs-zoom{position:absolute;right:14px;bottom:${zoomBottom}px;z-index:500;width:46px;height:46px;border-radius:14px;background:#fff;
box-shadow:0 6px 18px rgba(40,32,110,.14);display:flex;align-items:center;justify-content:center;font:300 26px sans-serif;color:${PG2.primary};border:0}
</style></head><body><div id="m"></div><button class="zcs-zoom" aria-label="Zoom in" onclick="map.zoomIn()">+</button><script>
var map=L.map('m',{zoomControl:false,attributionControl:true}).setView([${lat},${lng}],15);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
var pin='<svg xmlns="http://www.w3.org/2000/svg" width="40" height="52" viewBox="0 0 40 52"><path d="M20 51C20 51 38 31 38 19A18 18 0 0 0 2 19C2 31 20 51 20 51Z" fill="${PG2.primary}"/><circle cx="20" cy="19" r="7" fill="#fff"/></svg>';
L.marker([${lat},${lng}],{title:'${esc(name)}',icon:L.divIcon({html:pin,className:'',iconSize:[40,52],iconAnchor:[20,51]})}).addTo(map);
</script></body></html>`;

export function MapFrame({ html }: { html: string }) {
  if (Platform.OS === 'web') {
    return React.createElement('iframe', { srcDoc: html, title: 'Map', style: { border: 0, width: '100%', height: '100%' } });
  }
  return <WebView originWhitelist={['*']} source={{ html }} style={{ flex: 1 }} javaScriptEnabled />;
}

export const openDirections = (pg: PgDetail) => {
  const loc = pg.location;
  const label = encodeURIComponent(pg.name);
  const url = loc
    ? Platform.select({
      android: `geo:${loc.lat},${loc.lng}?q=${loc.lat},${loc.lng}(${label})`,
      ios: `http://maps.apple.com/?daddr=${loc.lat},${loc.lng}&q=${label}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`,
    })
    : mapsUrl(pg);
  if (url) Linking.openURL(url).catch(() => { const web = mapsUrl(pg); if (web) Linking.openURL(web).catch(() => {}); });
};

function PgCard({ pg, floating }: { pg: PgDetail; floating?: boolean }) {
  const km = kmText(pg.distanceFromCollege);
  return (
    <View style={[st.card, floating && st.cardFloat, shadow(2)]}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <Photo photo={buildingPhoto(pg)} style={{ width: 62, height: 62 }} radius={10} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.name} numberOfLines={1}>{pg.name}</Text>
          <Text style={st.meta} numberOfLines={2}>{[km ? `${km} from campus` : '', placeText(pg)].filter(Boolean).join('  |  ')}</Text>
        </View>
      </View>
      <OutlineButton label="Get Directions" icon={INavigation} onPress={() => openDirections(pg)} style={st.dir} textStyle={{ color: PG2.ink }} border={PG2.line} />
    </View>
  );
}

export default function PgV2Map() {
  const nav = useNav();
  const id = usePgIdFor();
  const insets = useSafeAreaInsets();
  const { pg, state } = usePgDetail(id);
  const share = () => { if (pg) Share.share({ message: `${pg.name}, ${pg.address}${mapsUrl(pg) ? `\n${mapsUrl(pg)}` : ''}` }).catch(() => {}); };
  const right = <Tap onPress={share} label="Share location" style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><IShare size={19} color={PG2.ink} strokeWidth={STROKE} /></Tap>;

  return (
    <View style={{ flex: 1, backgroundColor: PG2.page, paddingBottom: insets.bottom }}>
      <Header title="PG Location" onBack={nav.back} right={right} />
      {state === 'loading' ? <Loading /> : !pg ? (
        <EmptyState icon={IBuilding} title="This PG isn't available" action="Back" onAction={nav.back} />
      ) : pg.location ? (
        <View style={{ flex: 1 }}>
          <View style={st.mapWrap}><MapFrame html={leafletHtml(pg.location.lat, pg.location.lng, pg.name)} /></View>
          <PgCard pg={pg} floating />
        </View>
      ) : (
        <View style={{ padding: GUTTER, gap: 14 }}>
          <View style={st.addr}>
            <View style={st.addrIcon}><IMapPin size={22} color={PG2.primary} strokeWidth={STROKE} /></View>
            <Text style={st.addrLabel}>Address</Text>
            <Text style={st.addrText}>{pg.address}</Text>
            {kmText(pg.distanceFromCollege) ? <Text style={[k.small, { marginTop: 6 }]}>{kmText(pg.distanceFromCollege)} from campus</Text> : null}
          </View>
          <PgCard pg={pg} />
        </View>
      )}
    </View>
  );
}

const st = themedSheet(() => ({
  mapWrap: { flex: 1, marginHorizontal: 8, borderRadius: R.xl, overflow: 'hidden', marginBottom: 8 },
  card: { backgroundColor: PG2.card, borderRadius: R.xl, padding: 14 },
  cardFloat: { position: 'absolute', left: GUTTER + 8, right: GUTTER + 8, bottom: 28 },
  name: { fontSize: 15.5, fontWeight: W.title, color: PG2.ink },
  meta: { marginTop: 4, fontSize: 12.5, color: PG2.muted, lineHeight: 18 },
  dir: { marginTop: 14, height: 48, backgroundColor: PG2.page },
  addr: { backgroundColor: PG2.card, borderRadius: 14, padding: 16, alignItems: 'flex-start', borderWidth: StyleSheet.hairlineWidth, borderColor: PG2.line },
  addrIcon: { marginBottom: 10 },
  addrLabel: { fontSize: 12.5, color: PG2.lavenderInk, fontWeight: W.label },
  addrText: { marginTop: 4, fontSize: 15, color: PG2.ink, lineHeight: 22, fontWeight: W.label },
}));
