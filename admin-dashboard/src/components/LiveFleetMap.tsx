"use client";
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { API_URL } from '@/lib/config';
import { MAP_TILE_URL, MAP_TILE_MAX_ZOOM, MAP_TILE_ATTRIBUTION, MAP_TILE_CLASS } from '@/lib/mapTiles';

interface RiderPosition {
  riderId: string;
  riderName: string;
  photoUrl?: string;
  currentCheckpoint?: string;
  activeOrderCount: number;
  isOnline: boolean;
  lat?: number;
  lng?: number;
  locatedAt?: number;
}

interface Checkpoint {
  name: string;
  lat: number;
  lng: number;
}

interface LiveFleetMapProps {
  riders: Record<string, RiderPosition>;
  checkpoints: Checkpoint[];
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) image URLs are allowed into the popup (blocks javascript:/data: payloads). */
function safeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    // Relative photo paths ('/uploads/..', '/api/campus/media/..') live on the backend, not the admin host.
    const u = new URL(value, `${API_URL}/`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

// One shared icon (was rebuilt on every rider update).
let riderIconCache: L.DivIcon | null = null;
const getRiderIcon = () => {
  if (!riderIconCache) {
    riderIconCache = L.divIcon({
      className: 'custom-div-icon',
      html: `<div class="w-10 h-10 bg-info-soft border-2 border-info/30 rounded-full flex items-center justify-center text-lg animate-pulse"></div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });
  }
  return riderIconCache;
};

export default function LiveFleetMap({ riders, checkpoints }: LiveFleetMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const checkpointMarkersRef = useRef<L.Marker[]>([]);
  const polylineRef = useRef<L.Polyline | null>(null);

  const CAMPUS_CENTER: [number, number] = [16.4632, 80.5064];

  // 1. Initialize Map
  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current) return;

    // Clean up any existing leaflet map instance on this DOM node
    const container = mapContainerRef.current;
    if (container && (container as any)._leaflet_id) {
      // If Leaflet already initialized on this container, destroy it first
      try {
        if (L.Map && (L as any).Map.prototype && (L as any).Map.prototype._mapId) {
          // Leaflet global cleanup
        }
      } catch (e) {
        console.warn('Map cleanup warning:', e);
      }
      container.innerHTML = '';
    }

    // Create map instance
    const map = L.map(container, {
      center: CAMPUS_CENTER,
      zoom: 14,
      zoomControl: false,
      attributionControl: true
    });

    // Attribution is required by the OpenStreetMap tile licence.
    L.tileLayer(MAP_TILE_URL, {
      maxZoom: MAP_TILE_MAX_ZOOM,
      className: MAP_TILE_CLASS,
      attribution: MAP_TILE_ATTRIBUTION,
    }).addTo(map);

    mapRef.current = map;

    // Clean up map on unmount
    return () => {
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch (e) {
          console.warn('Failed to remove map:', e);
        }
        mapRef.current = null;
      }
    };
  }, []);

  // 2. Render checkpoints and polyline
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old checkpoint markers
    checkpointMarkersRef.current.forEach(m => m.remove());
    checkpointMarkersRef.current = [];

    // Clear polyline
    if (polylineRef.current) {
      polylineRef.current.remove();
      polylineRef.current = null;
    }

    // Create polyline
    if (checkpoints.length > 1) {
      const positions = checkpoints.map(cp => [cp.lat, cp.lng] as [number, number]);
      polylineRef.current = L.polyline(positions, {
        color: '#3b82f6',
        weight: 3,
        opacity: 0.3,
        dashArray: '10, 10'
      }).addTo(map);
    }

    // Create checkpoint markers
    const nodeIcon = L.divIcon({
      className: 'custom-div-icon',
      html: `<div class="w-3 h-3 bg-surface-3 border border-line-strong rounded-full"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });

    checkpoints.forEach(cp => {
      const marker = L.marker([cp.lat, cp.lng], { icon: nodeIcon })
        .addTo(map)
        .bindPopup(`<div class="p-3"><p style="margin:0;font-size:12px;font-weight:500;color:rgb(var(--fg))">${escapeHtml(cp.name)}</p></div>`, {
          className: 'custom-popup'
        });
      checkpointMarkersRef.current.push(marker);
    });

  }, [checkpoints]);

  // 3. Render riders dynamically
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const riderIcon = getRiderIcon();

    /** Real GPS fix first, then the route checkpoint the app reported; no invented position. */
    const positionOf = (rider: RiderPosition): [number, number] | null => {
      if (Number.isFinite(rider.lat) && Number.isFinite(rider.lng)) return [rider.lat as number, rider.lng as number];
      const cpData = checkpoints.find(c => c.name === rider.currentCheckpoint);
      return cpData ? [cpData.lat, cpData.lng] : null;
    };

    // Remove riders not present, offline or without any known position
    Object.keys(markersRef.current).forEach(riderId => {
      const rider = riders[riderId];
      if (!rider || !rider.isOnline || !positionOf(rider)) {
        markersRef.current[riderId].remove();
        delete markersRef.current[riderId];
      }
    });

    // Add or update online riders
    Object.values(riders).forEach(rider => {
      if (!rider.isOnline) return;

      const pos = positionOf(rider);
      if (!pos) return;
      const located = Number.isFinite(rider.lat) && Number.isFinite(rider.lng);

      // Every rider-supplied value is escaped: these strings arrive over the socket exactly as the
      // rider client sent them and Leaflet renders popup content as HTML.
      const name = escapeHtml(rider.riderName || 'Rider');
      const initial = escapeHtml((rider.riderName || 'R').charAt(0));
      const photo = safeImageUrl(rider.photoUrl);
      const popupHtml = `
        <div class="p-4 bg-surface-2 min-w-[160px]">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-10 h-10 rounded-lg bg-accent flex items-center justify-center font-semibold overflow-hidden">
              ${photo ? `<img src="${escapeHtml(photo)}" alt="${name}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;" />` : initial}
            </div>
            <div>
              <h4 class="text-xs font-semibold text-fg">${name}</h4>
              <p class="text-xs text-fg-muted font-semibold">Captain Active</p>
            </div>
          </div>
          <div class="space-y-1">
            <div class="flex justify-between text-xs font-semibold">
              <span class="text-fg-subtle">${located ? 'GPS' : 'Sector'}</span>
              <span class="text-info-text">${located
                ? escapeHtml(`${(rider.lat as number).toFixed(4)}, ${(rider.lng as number).toFixed(4)}`)
                : escapeHtml(rider.currentCheckpoint || 'Hub')}</span>
            </div>
            <div class="flex justify-between text-xs font-semibold">
              <span class="text-fg-subtle">Orders</span>
              <span class="text-fg">${escapeHtml(String(Number(rider.activeOrderCount) || 0))}</span>
            </div>
          </div>
        </div>
      `;

      if (markersRef.current[rider.riderId]) {
        // Update position and popup
        const marker = markersRef.current[rider.riderId];
        marker.setLatLng(pos);
        marker.setPopupContent(popupHtml);
      } else {
        // Create new marker
        const marker = L.marker(pos, { icon: riderIcon })
          .addTo(map)
          .bindPopup(popupHtml, { className: 'custom-popup' });
        markersRef.current[rider.riderId] = marker;
      }
    });
  }, [riders, checkpoints]);

  return (
    <div className="w-full h-full relative group">
      <div 
        ref={mapContainerRef} 
        className="w-full h-full rounded-lg" 
        style={{ background: 'rgb(var(--surface-2))' }}
      />

      {/* Online count */}
      <div className="absolute left-3 top-3 z-[1000] pointer-events-none">
        <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-fg shadow-xs">
          <span className={`h-2 w-2 rounded-full ${Object.values(riders).some(r => r.isOnline) ? 'bg-success' : 'bg-fg-subtle'}`} aria-hidden />
          {Object.values(riders).filter(r => r.isOnline).length} riders online
        </div>
      </div>

      <style>{`
        .leaflet-container { background: rgb(var(--surface-2)) !important; }
        .custom-popup .leaflet-popup-content-wrapper {
          background: rgb(var(--surface));
          border: 1px solid rgb(var(--line));
          color: rgb(var(--fg));
          border-radius: 8px;
          padding: 0;
          overflow: hidden;
        }
        .custom-popup .leaflet-popup-content { margin: 0; }
        .custom-popup .leaflet-popup-tip { background: rgb(var(--surface)); }
      `}</style>
    </div>
  );
}
