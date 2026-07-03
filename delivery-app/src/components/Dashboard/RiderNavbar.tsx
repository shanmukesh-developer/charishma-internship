"use client";
import React from 'react';
import Image from 'next/image';

interface RiderNavbarProps {
  driverName: string;
  driverPhoto?: string;
  isOnline: boolean;
  unreadCount?: number;
  toggleOnline: () => void;
  onLogout: () => void;
  onOpenProfile: () => void;
  onOpenEarnings: () => void;
  onOpenNotifications: () => void;
  currentEarnings?: number;
}

export default function RiderNavbar({ 
  driverName, 
  driverPhoto, 
  isOnline, 
  unreadCount = 0,
  toggleOnline, 
  onLogout, 
  onOpenProfile,
  onOpenEarnings,
  onOpenNotifications,
  currentEarnings = 0,
}: RiderNavbarProps) {
  return (
    <nav className="flex justify-between items-center px-1">
      {/* Identity Segment */}
      <button 
        onClick={onOpenProfile}
        className="flex items-center gap-3.5 group"
      >
        <div className="relative">
          <div className="w-12 h-12 rounded-2xl overflow-hidden border border-white/10 group-hover:border-blue-500/50 transition-all shadow-sm">
            {driverPhoto ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <Image src={driverPhoto} alt={driverName} width={48} height={48} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            ) : (
              <div className="w-full h-full bg-surface-dark flex items-center justify-center text-xl">👤</div>
            )}
          </div>
          {/* Online dot */}
          <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0A0A0B] transition-colors ${isOnline ? 'bg-emerald-500' : 'bg-slate-600'}`} />
        </div>
        <div className="text-left">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-0.5">Verified Rider</p>
          <p className="text-[15px] font-bold text-white tracking-tight">{driverName}</p>
        </div>
      </button>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        {/* Earnings Button */}
        {isOnline && (
          <button 
            onClick={onOpenEarnings}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all rounded-full"
          >
            <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">₹{currentEarnings} Today</span>
          </button>
        )}

        {/* Notification Bell */}
        <button
          onClick={onOpenNotifications}
          className="relative w-10 h-10 flex items-center justify-center rounded-2xl bg-white/[0.03] border border-white/5 hover:bg-white/8 transition-all"
          title="Notifications"
        >
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1 shadow-lg shadow-red-500/30 animate-bounce">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        <div className="flex items-center gap-2 bg-surface border border-white/5 p-1.5 rounded-2xl shadow-lg">
          <button 
            onClick={toggleOnline}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all duration-300 font-bold text-[10px] uppercase tracking-widest ${
              isOnline 
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' 
              : 'bg-white/[0.03] text-slate-500 hover:text-slate-300'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full transition-colors ${isOnline ? 'bg-white animate-pulse' : 'bg-slate-700'}`} />
            {isOnline ? 'Online' : 'Offline'}
          </button>

          <button 
            onClick={onLogout}
            className="p-2.5 text-slate-600 hover:text-red-500 transition-colors"
            title="Sign Out"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </nav>
  );
}
