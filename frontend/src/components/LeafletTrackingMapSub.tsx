"use client";
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

interface Checkpoint {
  name: string;
  lat: number;
  lng: number;
}

interface LeafletTrackingMapSubProps {
  currentCheckpoint: string;
  checkpoints: Checkpoint[];
  homeCoord: { lat: number; lng: number };
}

// Smoothly pans the existing map instance — no remount needed
function MapPanner({ center }: { center: [number, number] }) {
  const map = useMap();
  const prevCenter = useRef<[number, number] | null>(null);
  useEffect(() => {
    if (
      prevCenter.current &&
      prevCenter.current[0] === center[0] &&
      prevCenter.current[1] === center[1]
    ) return;
    prevCenter.current = center;
    map.setView(center, map.getZoom(), { animate: true });
  }, [center, map]);
  return null;
}

function LeafletTrackingMapSubContent({
  currentCheckpoint,
  checkpoints,
  homeCoord,
}: LeafletTrackingMapSubProps) {
  const [mounted, setMounted] = useState(false);
  // Track whether we've already destroyed a stale Leaflet instance from the same container
  const containerRef = useRef<HTMLDivElement | null>(null);

  const CAMPUS_CENTER: [number, number] = [16.4632, 80.5064];

  useEffect(() => {
    setMounted(true);
  }, []);

  // Destroy any stale Leaflet instance that may linger in the container (caused by
  // Strict Mode double-invoke or Tilt wrapper re-parenting the DOM node)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Leaflet stamps "_leaflet_id" on the container div when it initialises.
    // If a stale id is present but no live Leaflet map owns it, remove the stamp
    // so the next MapContainer can initialise cleanly.
    const leafletContainer = el.querySelector('.leaflet-container') as HTMLElement | null;
    if (leafletContainer && (leafletContainer as any)._leaflet_id) {
      try {
        // Only clean up if there is no live map instance attached
        if (!(leafletContainer as any)._leaflet_map) {
          delete (leafletContainer as any)._leaflet_id;
        }
      } catch (_) { /* ignore */ }
    }
  });

  const riderIcon = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return L.divIcon({
      className: '',
      html: `<div style="width:40px;height:40px;background:rgba(59,130,246,0.2);border:2px solid #3b82f6;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 0 20px rgba(59,130,246,0.3)">🛸</div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }, []);

  const activeNodeIcon = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return L.divIcon({
      className: '',
      html: `<div style="width:12px;height:12px;background:#60a5fa;border:1px solid rgba(255,255,255,0.4);border-radius:50%;box-shadow:0 0 10px rgba(59,130,246,0.8)"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
  }, []);

  const inactiveNodeIcon = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return L.divIcon({
      className: '',
      html: `<div style="width:12px;height:12px;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);border-radius:50%"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
  }, []);

  const homeMarkerIcon = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return L.divIcon({
      className: '',
      html: `<div style="width:32px;height:32px;background:rgba(16,185,129,0.1);border:2px solid #10b981;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px">🏠</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  }, []);

  const cpData = checkpoints.find((c) => c.name === currentCheckpoint);
  const riderPos: [number, number] = cpData
    ? [cpData.lat, cpData.lng]
    : [checkpoints[0]?.lat ?? CAMPUS_CENTER[0], checkpoints[0]?.lng ?? CAMPUS_CENTER[1]];

  if (!mounted) {
    return <div className="w-full h-full bg-[#0B0B14]" />;
  }

  if (!activeNodeIcon || !inactiveNodeIcon || !homeMarkerIcon || !riderIcon) return null;

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <MapContainer
        center={riderPos}
        zoom={15}
        zoomControl={false}
        className="w-full h-full"
        style={{ background: '#0B0B14' }}
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
        <MapPanner center={riderPos} />

        {/* Full route dashed line */}
        <Polyline
          positions={checkpoints.map((cp) => [cp.lat, cp.lng] as [number, number])}
          pathOptions={{ color: '#3b82f6', weight: 3, opacity: 0.2, dashArray: '10, 10' }}
        />

        {/* Rider → Home connector */}
        <Polyline
          positions={[riderPos, [homeCoord.lat, homeCoord.lng]]}
          pathOptions={{ color: '#C9A84C', weight: 2, opacity: 0.4, dashArray: '5, 5' }}
        />

        {/* Checkpoint nodes */}
        {checkpoints.map((cp) => (
          <Marker
            key={cp.name}
            position={[cp.lat, cp.lng]}
            icon={currentCheckpoint === cp.name ? activeNodeIcon : inactiveNodeIcon}
          />
        ))}

        {/* Home marker */}
        <Marker position={[homeCoord.lat, homeCoord.lng]} icon={homeMarkerIcon} />

        {/* Rider marker */}
        <Marker position={riderPos} icon={riderIcon} />
      </MapContainer>

      <style>{`
        .leaflet-container { background: #0B0B14 !important; outline: none; }
      `}</style>
    </div>
  );
}

const LeafletTrackingMapSub = React.memo(LeafletTrackingMapSubContent);
export default LeafletTrackingMapSub;
