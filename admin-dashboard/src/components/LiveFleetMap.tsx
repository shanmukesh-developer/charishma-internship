"use client";
import { useMemo, useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface RiderPosition {
  riderId: string;
  riderName: string;
  photoUrl?: string;
  currentCheckpoint?: string;
  activeOrderCount: number;
  isOnline: boolean;
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
        const leafletId = (container as any)._leaflet_id;
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
      attributionControl: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20
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
      html: `<div class="w-3 h-3 bg-white/40 border border-white/60 rounded-full"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });

    checkpoints.forEach(cp => {
      const marker = L.marker([cp.lat, cp.lng], { icon: nodeIcon })
        .addTo(map)
        .bindPopup(`<div class="p-3"><p class="text-[10px] font-black uppercase text-blue-400 tracking-widest">${cp.name}</p></div>`, {
          className: 'custom-popup'
        });
      checkpointMarkersRef.current.push(marker);
    });

  }, [checkpoints]);

  // 3. Render riders dynamically
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const riderIcon = L.divIcon({
      className: 'custom-div-icon',
      html: `<div class="w-10 h-10 bg-blue-500/20 border-2 border-blue-500 rounded-full flex items-center justify-center text-lg shadow-[0_0_20px_rgba(59,130,246,0.3)] animate-pulse">🛵</div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });

    // Remove riders not present or offline
    Object.keys(markersRef.current).forEach(riderId => {
      const rider = riders[riderId];
      if (!rider || !rider.isOnline) {
        markersRef.current[riderId].remove();
        delete markersRef.current[riderId];
      }
    });

    // Add or update online riders
    Object.values(riders).forEach(rider => {
      if (!rider.isOnline) return;

      const cpData = checkpoints.find(c => c.name === rider.currentCheckpoint);
      const pos: [number, number] = cpData ? [cpData.lat, cpData.lng] : CAMPUS_CENTER;

      const popupHtml = `
        <div class="p-4 bg-slate-900 min-w-[160px]">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center font-black overflow-hidden">
              ${rider.photoUrl ? `<img src="${rider.photoUrl}" alt="${rider.riderName}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;" />` : rider.riderName?.[0] || 'R'}
            </div>
            <div>
              <h4 class="text-xs font-black text-white">${rider.riderName}</h4>
              <p class="text-[8px] text-gray-500 uppercase font-black">Captain Active</p>
            </div>
          </div>
          <div class="space-y-1">
            <div class="flex justify-between text-[8px] font-black uppercase">
              <span class="text-gray-600">Sector</span>
              <span class="text-blue-400">${rider.currentCheckpoint || 'Hub'}</span>
            </div>
            <div class="flex justify-between text-[8px] font-black uppercase">
              <span class="text-gray-600">Orders</span>
              <span class="text-white">${rider.activeOrderCount}</span>
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
        className="w-full h-full rounded-2xl" 
        style={{ background: '#0B0B14' }}
      />

      {/* HUD Overlays */}
      <div className="absolute top-6 left-6 z-[1000] pointer-events-none space-y-2">
        <div className="glass-card px-4 py-2 border-white/10 flex items-center gap-3 bg-slate-900/80 backdrop-blur-md">
           <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(37,99,235,0.8)]" />
           <span className="text-[9px] font-black text-white uppercase tracking-widest">
             {Object.values(riders).filter(r => r.isOnline).length} CAPTAINS LIVE
           </span>
        </div>
      </div>

      <div className="absolute bottom-6 right-6 z-[1000] font-mono text-[8px] opacity-30 bg-black/50 p-2 rounded-xl backdrop-blur-md pointer-events-none">
        HUB: SRM_ALPHA_COMMAND <br />
        CORRIDOR: MANGALAGIRI_TRANSIT <br />
        SYNC: OPERATIONAL
      </div>

      <style>{`
        .leaflet-container { background: #0B0B14 !important; }
        .custom-popup .leaflet-popup-content-wrapper {
          background: rgba(13, 13, 18, 0.95);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: white;
          border-radius: 12px;
          padding: 0;
          overflow: hidden;
        }
        .custom-popup .leaflet-popup-content { margin: 0; }
        .custom-popup .leaflet-popup-tip { background: rgba(13, 13, 18, 0.95); }
      `}</style>
    </div>
  );
}
