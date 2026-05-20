"use client";
import { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Icon, DivIcon, LeafletMouseEvent } from 'leaflet';

interface LeafletMapSubProps {
  center: [number, number];
  markerPosition: [number, number];
  onMapClick: (latlng: { lat: number, lng: number }) => void;
  icon?: Icon | DivIcon | null; // Leaflet icon instance
}

function MapEvents({ onClick }: { onClick: (latlng: { lat: number, lng: number }) => void }) {
  useMapEvents({
    click(e: LeafletMouseEvent) {
      onClick(e.latlng);
    }
  });
  return null;
}

export default function LeafletMapSub({ center, markerPosition, onMapClick, icon }: LeafletMapSubProps) {
  const [mounted, setMounted] = useState(false);
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
    setMapKey('leaflet-select-' + Math.random().toString(36).substring(7));

    return () => {
      cleanseDOM();
    };
  }, []);

  if (!mounted || !mapKey) {
    return <div className="w-full h-full bg-[#0B0B14]" />;
  }

  return (
    <div className="w-full h-full relative" key={mapKey} ref={containerRef}>
      <MapContainer
        key={mapKey}
        center={center}
        zoom={16}
        zoomControl={false}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        <MapEvents onClick={onMapClick} />
        {icon && <Marker position={markerPosition} icon={icon} />}
      </MapContainer>
    </div>
  );
}
