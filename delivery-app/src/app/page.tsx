"use client";
import React, { useState, useEffect } from 'react';
import LoginForm from '@/components/Auth/LoginForm';
import DashboardContainer from '@/components/Dashboard/DashboardContainer';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

interface Driver {
  _id: string;
  name: string;
  token: string;
}

export default function Home() {
  const [driver, setDriver] = useState<Driver | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    // Check for existing session
    const savedToken = localStorage.getItem('driverToken');
    const savedDriver = localStorage.getItem('driver');

    if (savedToken && savedDriver) {
      try {
        const driverData = JSON.parse(savedDriver);
        setDriver({ ...driverData, token: savedToken });
      } catch (err) {
        console.error('Failed to parse saved driver:', err);
        localStorage.removeItem('driverToken');
        localStorage.removeItem('driver');
      }
    }
    setInitializing(false);
  }, []);

  const handleLogout = async () => {
    try {
      const savedToken = localStorage.getItem('driverToken');
      if (savedToken) {
        await fetch(`${API_URL}/api/delivery/online`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${savedToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ isOnline: false })
        }).catch(() => {});
      }
    } catch (err) {
      console.error('Failed to set offline on logout:', err);
    }
    localStorage.removeItem('driverToken');
    localStorage.removeItem('driver');
    setDriver(null);
  };

  if (initializing) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B]">
      {!driver ? (
        <LoginForm onLogin={setDriver} apiUrl={API_URL} />
      ) : (
        <DashboardContainer 
          driver={driver} 
          onLogout={handleLogout} 
          apiUrl={API_URL} 
        />
      )}
    </div>
  );
}
