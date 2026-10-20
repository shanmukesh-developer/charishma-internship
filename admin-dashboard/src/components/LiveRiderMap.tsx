"use client";
import React, { useEffect, useState, useMemo, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useAdminSocket } from '@/components/AdminSocketProvider';
import { MAP_TILE_URL, MAP_TILE_MAX_ZOOM, MAP_TILE_ATTRIBUTION, MAP_TILE_CLASS } from '@/lib/mapTiles';


// SRM University AP (Neerukonda / Mangalagiri) - same coordinates as the dashboard CHECKPOINTS.
const CAMPUS_HUBS = [
  { name: 'SRM AP Main Gate', lat: 16.4673, lon: 80.5002, tag: 'GATE', icon: '🏛️' },
  { name: 'Academic Block', lat: 16.4635, lon: 80.5065, tag: 'ACADEMIC', icon: '🏢' },
  { name: 'Hostel Sector', lat: 16.4618, lon: 80.5068, tag: 'HOSTELS', icon: '🛏️' },
  { name: 'Neerukonda', lat: 16.4715, lon: 80.5055, tag: 'VILLAGE', icon: '📍' },
];
const CAMPUS_CENTER: [number, number] = [16.4650, 80.5040];
/** A rider whose app has not sent a position for this long is dropped from the map (stale pin). */
const STALE_AFTER_MS = 2 * 60 * 1000;
const EXPIRY_SWEEP_MS = 20 * 1000;
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export default function LiveRiderMap() {
  const [riders, setRiders] = useState<Record<string, { lat: number; lon: number; name?: string; updatedAt: number }>>({});

  // Uses the dashboard's authenticated admin socket (already in admin-room). The server streams
  // rider positions to admin-room as `admin_rider_location`; a pin is drawn only when the event
  // carries real coordinates (lat/lng), never an invented position.
  const { socket, isConnected } = useAdminSocket();

  useEffect(() => {
    if (!socket) return;
    const onLocation = (data: { riderId?: string; riderName?: string; lat?: number; lng?: number; latitude?: number; longitude?: number; isOnline?: boolean }) => {
      const riderId = data?.riderId;
      const lat = Number(data?.lat ?? data?.latitude);
      const lon = Number(data?.lng ?? data?.longitude);
      if (!riderId || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return;
      setRiders((prev) => ({
        ...prev,
        [riderId]: { lat, lon, name: data.riderName || prev[riderId]?.name || riderId, updatedAt: Date.now() },
      }));
    };
    const onOffline = (data: { riderId?: string }) => {
      const riderId = data?.riderId;
      if (!riderId) return;
      setRiders((prev) => {
        if (!prev[riderId]) return prev;
        const next = { ...prev };
        delete next[riderId];
        return next;
      });
    };
    socket.on('admin_rider_location', onLocation);
    socket.on('admin_rider_offline', onOffline);
    return () => {
      socket.off('admin_rider_location', onLocation);
      socket.off('admin_rider_offline', onOffline);
    };
  }, [socket]);

  // Drop riders that went quiet (app killed, no signal) instead of showing a frozen pin forever.
  useEffect(() => {
    const timer = setInterval(() => {
      const cutoff = Date.now() - STALE_AFTER_MS;
      setRiders((prev) => {
        const stale = Object.keys(prev).filter((id) => prev[id].updatedAt < cutoff);
        if (!stale.length) return prev;
        const next = { ...prev };
        stale.forEach((id) => { delete next[id]; });
        return next;
      });
    }, EXPIRY_SWEEP_MS);
    return () => clearInterval(timer);
  }, []);

  // Icons are built once (they were rebuilt for every pin on every position update).
  const riderIcon = useMemo(() => L.divIcon({
      className: 'zenvy-rider-pin',
      html: `
        <div style="
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          background: linear-gradient(135deg, #2563EB, #1D4ED8);
          border: 2px solid #93C5FD;
          border-radius: 50%;
          box-shadow: 0 0 20px rgba(37, 99, 235, 0.7);
          font-size: 18px;
          cursor: pointer;
        ">
          
         <span style="
            position: absolute;
            top: -6px;
            right: -6px;
            width: 10px;
            height: 10px;
            background: #10B981;
            border: 2px solid #000;
            border-radius: 50%;
          "></span>
        </div>
      `,
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    }), []);

  const hubIcons = useMemo(() => Object.fromEntries(CAMPUS_HUBS.map((hub) => [hub.name, L.divIcon({
      className: 'zenvy-hub-pin',
      html: `
        <div style="
          display: flex;
          align-items: center;
          gap: 4px;
          background: rgba(10, 10, 12, 0.9);
          border: 1px solid rgba(255, 255, 255, 0.2);
          backdrop-filter: blur(8px);
          padding: 3px 8px;
          border-radius: 12px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
          white-space: nowrap;
          cursor: pointer;
        ">
          <span style="font-size: 11px;">${hub.icon}</span>
          <span style="font-size: 9px; font-weight: 800; color: #F3F4F6; letter-spacing: 0.5px;">${hub.tag}</span>
        </div>
      `,
      iconSize: [70, 24],
      iconAnchor: [35, 12]
    })])), []);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const riderLayerRef = useRef<L.LayerGroup | null>(null);

  // One Leaflet map per mounted container; removed on unmount (strict-mode double mounts are safe).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const map = L.map(el, { center: CAMPUS_CENTER, zoom: 15 });
    L.tileLayer(MAP_TILE_URL, { maxZoom: MAP_TILE_MAX_ZOOM, className: MAP_TILE_CLASS, attribution: MAP_TILE_ATTRIBUTION }).addTo(map);
    CAMPUS_HUBS.forEach((hub) => {
      L.marker([hub.lat, hub.lon], { icon: hubIcons[hub.name] })
        .bindPopup(`<div style="background:rgb(var(--surface));color:rgb(var(--fg));padding:8px 10px;border-radius:8px;min-width:180px"><div style="font-size:11px;color:rgb(var(--fg-muted));margin-bottom:2px">${escapeHtml(hub.tag)}</div><div style="font-size:13px;font-weight:600;color:rgb(var(--fg))">${escapeHtml(hub.name)}</div></div>`, { className: 'zenvy-dark-popup' })
        .addTo(map);
    });
    riderLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      riderLayerRef.current = null;
    };
  }, [hubIcons]);

  // Rider pins follow the live positions (names are escaped: they come from rider profiles).
  useEffect(() => {
    const layer = riderLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    Object.entries(riders).forEach(([id, pos]) => {
      L.marker([pos.lat, pos.lon], { icon: riderIcon })
        .bindPopup(`<div style="background:rgb(var(--surface));color:rgb(var(--fg));padding:8px 10px;border-radius:8px;min-width:190px"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px"><span style="font-size:11px;color:rgb(var(--success-text))">Live location</span><span style="font-size:11px;color:rgb(var(--fg-subtle))">#${escapeHtml(id.slice(-6).toUpperCase())}</span></div><div style="font-size:13px;font-weight:600;color:rgb(var(--fg));margin-bottom:2px">${escapeHtml(pos.name || 'Rider')}</div><div style="font-size:11px;color:rgb(var(--fg-muted))">Location: ${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)}</div></div>`, { className: 'zenvy-dark-popup' })
        .addTo(layer);
    });
  }, [riders, riderIcon]);

  const activeRidersCount = Object.keys(riders).length;

  return (
    <div className="h-[600px] w-full rounded-lg overflow-hidden border border-line relative z-0">
      {/* Live status */}
      <div className="absolute top-4 right-4 z-[1000] flex items-center gap-3 bg-surface px-3 py-1.5 rounded-md border border-line shadow-xs pointer-events-auto">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-success' : 'bg-warning'}`} />
          <span className="text-xs font-semibold text-fg">
            {isConnected ? 'Live' : 'Reconnecting'}
          </span>
        </div>
        <div className="h-3 w-px bg-line" />
        <span className="text-xs text-fg-muted">
          {activeRidersCount} {activeRidersCount === 1 ? 'rider' : 'riders'} on the map
        </span>
      </div>

      {/* Map Surface (plain Leaflet: react-leaflet 4 cannot run on the React 19 that Next 16 ships —
          it threw "Map container is already initialized" and the tracker tab crashed) */}
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}
