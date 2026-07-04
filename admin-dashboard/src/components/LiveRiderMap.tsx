"use client";
import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import io from 'socket.io-client';

// Fix for default Leaflet markers in Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

export default function LiveRiderMap() {
  const [riders, setRiders] = useState<Record<string, { lat: number, lon: number, name?: string }>>({});

  useEffect(() => {
    // Connect to WebSocket to receive RIDER_LOCATION_UPDATE
    const socket = io(API_URL);
    socket.emit('joinRoom', 'admin_room'); // Admin joins a global room

    socket.on('RIDER_LOCATION_UPDATE', (data) => {
      // data: { riderId, lat, lon }
      setRiders((prev) => ({
        ...prev,
        [data.riderId]: { lat: data.lat, lon: data.lon, name: data.riderId } // We might not have name here, but tracking works
      }));
    });

    return () => { socket.disconnect(); };
  }, []);

  // Center roughly on SRM University coordinates (12.8231, 80.0453)
  return (
    <div className="h-[600px] w-full rounded-[40px] overflow-hidden border border-white/10 shadow-[0_0_50px_rgba(37,99,235,0.15)] relative z-0">
      <MapContainer center={[12.8231, 80.0453]} zoom={15} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        {Object.entries(riders).map(([id, pos]) => (
          <Marker key={id} position={[pos.lat, pos.lon]}>
            <Popup>
              <div className="text-black font-bold">Rider ID: {id.slice(-6).toUpperCase()}</div>
              <div className="text-xs text-gray-600">Active Delivery</div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
