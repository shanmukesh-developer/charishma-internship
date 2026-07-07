"use client";
import { useState, useEffect, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';

const LeafletMapSub = dynamic(() => import('@/components/LeafletMapSub'), { ssr: false });

interface MapLocationPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (address: string, coords: { lat: number, lng: number }) => void;
}

export default function MapLocationPicker({ isOpen, onClose, onConfirm }: MapLocationPickerProps) {
  // Default to SRM Campus / Amaravathi
  const [center, setCenter] = useState({ lat: 16.4632, lng: 80.5064 });
  const [markerPosition, setMarkerPosition] = useState({ lat: 16.4632, lng: 80.5064 });
  const [address, setAddress] = useState('Fetching address...');
  const [isLoading, setIsLoading] = useState(false);
  const [L, setL] = useState<typeof import('leaflet') | null>(null);

  const hasLocated = useRef(false);

  // Load Leaflet instance on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      import('leaflet').then(mod => setL(mod.default));
    }
  }, []);

  const yellowIcon = useMemo(() => {
    if (!L) return null;
    return new L.DivIcon({
      html: `<div style="background-color: #facc15; width: 24px; height: 24px; border-radius: 50%; border: 3px solid black; box-shadow: 0 0 15px rgba(250, 204, 21, 0.5);"></div>`,
      className: '',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  }, [L]);
 
  const [sessionKey, setSessionKey] = useState(0);

  // Load current location on mount if permitted
  useEffect(() => {
    if (isOpen) {
      setSessionKey(prev => prev + 1);
      if (!hasLocated.current) {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const newPos = { lat: position.coords.latitude, lng: position.coords.longitude };
              setCenter(newPos);
              setMarkerPosition(newPos);
              reverseGeocode(newPos);
              hasLocated.current = true;
            },
            () => {
              reverseGeocode(center);
              hasLocated.current = true;
            }
          );
        } else {
          reverseGeocode(center);
          hasLocated.current = true;
        }
      }
    }
    
    if (!isOpen) {
      hasLocated.current = false;
    }
  }, [isOpen, center]);

  const reverseGeocode = async (pos: { lat: number, lng: number }) => {
    setIsLoading(true);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.lat}&lon=${pos.lng}&addressdetails=1`);
      const data = await response.json();
      const addr = data.address || {};
      
      const parts = [
        addr.university || addr.college || addr.school,
        data.name !== addr.road ? data.name : null,
        addr.building,
        addr.house_number,
        addr.apartment,
        addr.room,
        addr.amenity,
        addr.road || addr.pedestrian,
        addr.neighbourhood || addr.suburb || addr.village,
        addr.city_district || addr.state_district
      ].filter((v, i, a) => v && a.indexOf(v) === i);

      let finalAddr = parts.join(', ');
      // Specialized SRMAP detection logic (Aggressive)
      const isNearSRM = (pos.lat > 16.450 && pos.lat < 16.490 && pos.lng > 80.485 && pos.lng < 80.530);
      const mentionsAinavolu = finalAddr.toLowerCase().includes('ainavolu') || data.display_name.toLowerCase().includes('ainavolu');
      
      if ((isNearSRM || mentionsAinavolu) && !finalAddr.toLowerCase().includes('srm')) {
        finalAddr = parts.length > 0 ? `SRM University AP, ${finalAddr}` : 'SRM University AP, Amaravati';
      }

      // Final polish - remove redundant village names if university is present
      if (finalAddr.toLowerCase().includes('srm university')) {
        finalAddr = finalAddr.replace(/ainavolu, /gi, '').replace(/ainavolu/gi, 'Amaravati');
      }
      
      setAddress(finalAddr || data.display_name || 'Location Selected');
    } catch {
      setAddress('Custom Location Selected');
    }
    setIsLoading(false);
  };

  const handleMapClick = (latlng: { lat: number, lng: number }) => {
    const newPos = { lat: latlng.lat, lng: latlng.lng };
    setMarkerPosition(newPos);
    reverseGeocode(newPos);
  };

  const handleConfirm = () => {
    onConfirm(address, markerPosition);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex flex-col bg-black/80 backdrop-blur-md animate-fade-in">
      {/* Header */}
      <div className="bg-black/40 backdrop-blur-3xl border-b border-white/5 p-6 pt-10 flex items-center justify-between shadow-2xl z-20">
        <div>
          <h2 className="text-primary-yellow font-black text-xl tracking-tight uppercase" style={{ fontFamily: "'Syne', sans-serif" }}>Nexus Target Link</h2>
          <p className="text-white light:text-gray-900/40 text-[10px] font-black uppercase tracking-widest mt-1">Acquiring precise delivery coordinates...</p>
        </div>
        <button onClick={onClose} className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center text-white light:text-gray-900/50 hover:text-white light:text-gray-900 transition-all border border-white/10 hover:border-primary-yellow hover:scale-110">✕</button>
      </div>

      {/* Map Area */}
      <div className="flex-1 relative bg-[#0B0B14]">
        {L ? (
          <LeafletMapSub
            key={sessionKey}
            center={[center.lat, center.lng] as [number, number]}
                                markerPosition={[markerPosition.lat, markerPosition.lng] as [number, number]}
            onMapClick={handleMapClick}
            icon={yellowIcon || null}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900/50">
            <div className="w-12 h-12 border-4 border-[#facc15] border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-gray-500 font-bold uppercase tracking-widest text-[10px]">Initializing Map Engine...</p>
          </div>
        )}

        {/* Current Location Quick Button */}
        <button 
          onClick={() => {
            if (navigator.geolocation) {
              navigator.geolocation.getCurrentPosition(async (pos) => {
                const newPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                setCenter(newPos);
                setMarkerPosition(newPos);
                reverseGeocode(newPos);
              });
            }
          }}
          className="absolute bottom-6 right-6 w-14 h-14 bg-white text-black rounded-full shadow-[0_10px_40px_rgba(0,0,0,0.5)] flex items-center justify-center border-4 border-slate-900/50 hover:scale-105 transition-transform"
        >
          📍
        </button>
      </div>

      {/* Footer Info & Action */}
      <div className="bg-black/40 backdrop-blur-3xl border-t border-white/5 p-8 shadow-[0_-30px_60px_rgba(0,0,0,0.5)] z-20 pb-12">
        <div className="bg-white/5 p-5 rounded-3xl border border-white/5 mb-6 relative overflow-hidden group hover:border-primary-yellow/20 transition-colors">
            <div className="absolute top-0 left-0 w-1.5 h-full bg-primary-yellow rounded-l-3xl shadow-[0_0_15px_rgba(201,168,76,0.5)]"/>
            <p className="text-[9px] uppercase font-black text-white light:text-gray-900/40 tracking-[0.3em] mb-2">Validated Protocol Address</p>
            <p className="text-[15px] font-black text-white light:text-gray-900 line-clamp-1 pr-4 tracking-tight">{isLoading ? 'CALIBRATING GPS...' : address.toUpperCase()}</p>
        </div>
        
        <button
          onClick={handleConfirm}
          className="w-full btn-yellow py-4 rounded-2xl font-black text-sm uppercase tracking-widest disabled:"
          disabled={isLoading || !address}
        >
          Confirm Location
        </button>
      </div>
    </div>
  );
}
