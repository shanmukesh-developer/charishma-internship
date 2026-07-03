"use client";
import React, { useEffect, useState } from 'react';

interface NavigatorConnection {
  effectiveType?: string;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

const WMO_CODES: Record<number, { label: string; icon: string }> = {
  0: { label: 'Clear Sky', icon: '☀️' },
  1: { label: 'Mainly Clear', icon: '🌤️' },
  2: { label: 'Partly Cloudy', icon: '⛅' },
  3: { label: 'Overcast', icon: '☁️' },
  45: { label: 'Foggy', icon: '🌫️' },
  48: { label: 'Depositing Rime Fog', icon: '🌫️' },
  51: { label: 'Light Drizzle', icon: '🌦️' },
  53: { label: 'Moderate Drizzle', icon: '🌦️' },
  55: { label: 'Dense Drizzle', icon: '🌦️' },
  56: { label: 'Light Freezing Drizzle', icon: '🌦️' },
  57: { label: 'Dense Freezing Drizzle', icon: '🌦️' },
  61: { label: 'Slight Rain', icon: '🌧️' },
  63: { label: 'Moderate Rain', icon: '🌧️' },
  65: { label: 'Heavy Rain', icon: '🌧️' },
  66: { label: 'Light Freezing Rain', icon: '🌧️' },
  67: { label: 'Heavy Freezing Rain', icon: '🌧️' },
  71: { label: 'Slight Snowfall', icon: '❄️' },
  73: { label: 'Moderate Snowfall', icon: '❄️' },
  75: { label: 'Heavy Snowfall', icon: '❄️' },
  77: { label: 'Snow Grains', icon: '❄️' },
  80: { label: 'Slight Rain Showers', icon: '🌦️' },
  81: { label: 'Moderate Rain Showers', icon: '🌦️' },
  82: { label: 'Violent Rain Showers', icon: '🌦️' },
  85: { label: 'Slight Snow Showers', icon: '❄️' },
  86: { label: 'Heavy Snow Showers', icon: '❄️' },
  95: { label: 'Thunderstorm', icon: '⛈️' },
  96: { label: 'Thunderstorm with Slight Hail', icon: '⛈️' },
  99: { label: 'Thunderstorm with Heavy Hail', icon: '⛈️' },
};

function getNetworkQuality(): { label: string; color: string; bars: number } {
  const conn = (navigator as unknown as { connection?: NavigatorConnection }).connection;
  if (!conn) return { label: 'Unknown', color: 'text-gray-500', bars: 2 };
  const type = conn.effectiveType;
  if (type === '4g') return { label: '4G', color: 'text-emerald-400', bars: 4 };
  if (type === '3g') return { label: '3G', color: 'text-yellow-400', bars: 3 };
  if (type === '2g') return { label: '2G', color: 'text-orange-400', bars: 2 };
  return { label: 'Slow', color: 'text-red-400', bars: 1 };
}

export default function WeatherSignal() {
  const [weather, setWeather] = useState<{ temp: number; code: number } | null>(null);
  const [network, setNetwork] = useState(getNetworkQuality());

  useEffect(() => {
    const fetchWeatherForCoords = async (lat: number, lng: number) => {
      try {
        const r = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`
        );
        const d = await r.json();
        setWeather({
          temp: Math.round(d.current_weather.temperature),
          code: d.current_weather.weathercode
        });
      } catch {}
    };

    const refreshWeather = () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            fetchWeatherForCoords(pos.coords.latitude, pos.coords.longitude);
          },
          () => {
            // Fallback to SRM AP campus
            fetchWeatherForCoords(16.4632, 80.5064);
          }
        );
      } else {
        fetchWeatherForCoords(16.4632, 80.5064);
      }
    };

    // Fetch immediately on mount
    refreshWeather();

    // Re-fetch every 15 minutes to match the API's 900s update interval
    const weatherInterval = setInterval(refreshWeather, 15 * 60 * 1000);

    const conn = (navigator as unknown as { connection?: NavigatorConnection }).connection;
    let cleanupNetwork: (() => void) | undefined;
    if (conn) {
      const update = () => setNetwork(getNetworkQuality());
      conn.addEventListener('change', update);
      cleanupNetwork = () => conn.removeEventListener('change', update);
    }

    return () => {
      clearInterval(weatherInterval);
      cleanupNetwork?.();
    };
  }, []);

  const wInfo = weather ? (WMO_CODES[weather.code] || { label: 'Unknown', icon: '🌡️' }) : null;

  return (
    <div className="bg-[#111113] border border-white/5 rounded-[24px] p-4 flex items-center justify-between mb-4">
      {/* Weather */}
      <div className="flex items-center gap-3">
        <span className="text-2xl">{wInfo?.icon ?? '🌡️'}</span>
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">Conditions</p>
          <p className="text-sm font-black text-white">
            {weather ? `${weather.temp}°C · ${wInfo?.label}` : 'Loading...'}
          </p>
        </div>
      </div>
      {/* Network */}
      <div className="flex items-center gap-2">
        <div className="flex items-end gap-[2px] h-5">
          {[1,2,3,4].map(b => (
            <div
              key={b}
              className={`w-1.5 rounded-sm transition-all ${b <= network.bars ? network.color.replace('text-', 'bg-') : 'bg-white/10'}`}
              style={{ height: `${b * 5}px` }}
            />
          ))}
        </div>
        <span className={`text-[10px] font-black ${network.color}`}>{network.label}</span>
      </div>
    </div>
  );
}
