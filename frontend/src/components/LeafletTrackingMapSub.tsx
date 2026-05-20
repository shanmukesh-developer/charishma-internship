"use client";
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline } from 'react-leaflet';
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

function LeafletTrackingMapSubContent({ currentCheckpoint, checkpoints, homeCoord }: LeafletTrackingMapSubProps) {
  const [mounted, setMounted] = useState(false);
  
  const CAMPUS_CENTER: [number, number] = [16.4632, 80.5064];

  const riderIcon = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return L.divIcon({
      className: 'custom-div-icon',
      html: `<div class="w-10 h-10 bg-blue-500/20 border-2 border-blue-500 rounded-full flex items-center justify-center text-lg shadow-[0_0_20px_rgba(59,130,246,0.3)] animate-pulse">🛸</div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });
  }, []);

  const getNodeIcon = useMemo(() => {
    if (typeof window === 'undefined') return () => undefined;
    
    const activeIcon = L.divIcon({
      className: 'custom-div-icon',
      html: `<div class="w-3 h-3 bg-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.8)] border border-white/40 rounded-full"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });

    const inactiveIcon = L.divIcon({
      className: 'custom-div-icon',
      html: `<div class="w-3 h-3 bg-white/20 border border-white/40 rounded-full"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });

    return (isActive: boolean) => isActive ? activeIcon : inactiveIcon;
  }, []);

  const homeMarkerIcon = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return L.divIcon({
      className: 'home-icon',
      html: `<div class="w-8 h-8 bg-emerald-500/10 border-2 border-emerald-500 rounded-lg flex items-center justify-center text-lg">🏠</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
  }, []);

  const [mapKey, setMapKey] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cleanseDOM = () => {
      if (typeof window !== 'undefined') {
        if (containerRef.current) {
          (containerRef.current as any)._leaflet_id = null;
          const children = containerRef.current.getElementsByTagName('*');
          for (let i = 0; i < children.length; i++) {
            (children[i] as any)._leaflet_id = null;
          }
        }
        const staleContainers = document.querySelectorAll('.leaflet-container');
        staleContainers.forEach((el: any) => {
          el._leaflet_id = null;
          if (el.parentNode) (el.parentNode as any)._leaflet_id = null;
        });
      }
    };

    cleanseDOM();
    setMounted(true);
    setMapKey('leaflet-map-' + Math.random().toString(36).substring(7));

    return () => {
      cleanseDOM();
    };
  }, []);

  if (!mounted || !mapKey) {
    return <div className="w-full h-full bg-[#0B0B14]" />;
  }

  const cpData = checkpoints.find(c => c.name === currentCheckpoint);
  const riderPos: [number, number] = cpData ? [cpData.lat, cpData.lng] : [checkpoints[0]?.lat || CAMPUS_CENTER[0], checkpoints[0]?.lng || CAMPUS_CENTER[1]];

  return (
    <div className="w-full h-full relative" key={mapKey} ref={containerRef}>
      <MapContainer
        key={mapKey}
        center={riderPos}
        zoom={15}
        zoomControl={false}
        className="w-full h-full"
        style={{ background: '#0B0B14' }}
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
        
        {/* Route Line */}
        <Polyline 
          positions={checkpoints.map(cp => [cp.lat, cp.lng] as [number, number])}
          pathOptions={{ color: '#3b82f6', weight: 3, opacity: 0.2, dashArray: '10, 10' }}
        />

        {/* Home Connector */}
        <Polyline 
          positions={[riderPos, [homeCoord.lat, homeCoord.lng]] as [number, number][]}
          pathOptions={{ color: '#C9A84C', weight: 2, opacity: 0.4, dashArray: '5, 5' }}
        />

        {/* Nodes */}
        {checkpoints.map((cp) => (
          <Marker 
            key={cp.name} 
            position={[cp.lat, cp.lng]} 
            icon={getNodeIcon(currentCheckpoint === cp.name) as L.DivIcon} 
          />
        ))}

        {/* Home */}
        {homeMarkerIcon && (
          <Marker position={[homeCoord.lat, homeCoord.lng]} icon={homeMarkerIcon} />
        )}

        {/* Rider */}
        {riderIcon && (
          <Marker position={riderPos} icon={riderIcon} />
        )}
      </MapContainer>

      <style>{`
        .leaflet-container { background: #0B0B14 !important; outline: none; }
      `}</style>
    </div>
  );
}

const LeafletTrackingMapSub = React.memo(LeafletTrackingMapSubContent);
export default LeafletTrackingMapSub;
