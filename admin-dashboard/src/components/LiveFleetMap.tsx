"use client";
import { useMemo, useState, useEffect, memo } from 'react';
import Image from 'next/image';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
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

const LiveFleetMap = memo(({ riders, checkpoints }: LiveFleetMapProps) => {
  const [mounted, setMounted] = useState(false);
  const CAMPUS_CENTER: [number, number] = [16.4632, 80.5064];

  useEffect(() => {
    setMounted(true);
  }, []);

  const riderIcon = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return L.divIcon({
      className: 'custom-div-icon',
      html: `<div class="w-10 h-10 bg-blue-500/20 border-2 border-blue-500 rounded-full flex items-center justify-center text-lg shadow-[0_0_20px_rgba(59,130,246,0.3)] animate-pulse">🛵</div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });
  }, []);

  const nodeIcon = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return L.divIcon({
      className: 'custom-div-icon',
      html: `<div class="w-3 h-3 bg-white/40 border border-white/60 rounded-full"></div>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });
  }, []);

  if (!mounted) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-900/50 rounded-2xl">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[10px] uppercase font-black tracking-widest text-blue-400">Initializing Radar...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative group">
      <MapContainer 
        key="nexus-radar-stable"
        center={CAMPUS_CENTER} 
        zoom={14} 
        zoomControl={false}
        className="w-full h-full rounded-2xl"
        style={{ background: '#0B0B14' }}
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
        
        {/* Corridor Route Line */}
        {checkpoints.length > 1 && (
          <Polyline 
            positions={checkpoints.map(cp => [cp.lat, cp.lng] as [number, number])} 
            pathOptions={{ color: '#3b82f6', weight: 3, opacity: 0.3, dashArray: '10, 10' }} 
          />
        )}

        {/* Checkpoint Nodes */}
        {checkpoints.map(cp => (
          nodeIcon && (
            <Marker key={cp.name} position={[cp.lat, cp.lng]} icon={nodeIcon}>
              <Popup className="custom-popup">
                <div className="p-3">
                  <p className="text-[10px] font-black uppercase text-blue-400 tracking-widest">{cp.name}</p>
                </div>
              </Popup>
            </Marker>
          )
        ))}

        {/* Riders */}
        {Object.values(riders).map(rider => {
          if (!rider.isOnline) return null;
          
          const cpData = checkpoints.find(c => c.name === rider.currentCheckpoint);
          const pos: [number, number] = cpData ? [cpData.lat, cpData.lng] : CAMPUS_CENTER;
          
          return (
            riderIcon && (
              <Marker key={rider.riderId} position={pos} icon={riderIcon}>
                <Popup className="custom-popup">
                  <div className="p-4 bg-slate-900 min-w-[160px]">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center font-black">
                        {rider.photoUrl ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <Image src={rider.photoUrl} alt={rider.riderName || 'Rider'} width={40} height={40} className="w-full h-full object-cover rounded-lg" />
                          </>
                        ) : rider.riderName?.[0] || 'R'}
                      </div>
                      <div>
                        <h4 className="text-xs font-black text-white">{rider.riderName}</h4>
                        <p className="text-[8px] text-gray-500 uppercase font-black">Captain Active</p>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[8px] font-black uppercase">
                        <span className="text-gray-600">Sector</span>
                        <span className="text-blue-400">{rider.currentCheckpoint || 'Hub'}</span>
                      </div>
                      <div className="flex justify-between text-[8px] font-black uppercase">
                        <span className="text-gray-600">Orders</span>
                        <span className="text-white">{rider.activeOrderCount}</span>
                      </div>
                    </div>
                  </div>
                </Popup>
              </Marker>
            )
          );
        })}
      </MapContainer>

      {/* HUD Overlays */}
      <div className="absolute top-6 left-6 z-[1000] pointer-events-none space-y-2">
        <div className="glass-card px-4 py-2 border-white/10 flex items-center gap-3 bg-slate-900/80 backdrop-blur-md">
           <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(37,99,235,0.8)]" />
           <span className="text-[9px] font-black text-white uppercase tracking-widest">{Object.keys(riders).length} CAPTAINS LIVE</span>
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
});

export default LiveFleetMap;
