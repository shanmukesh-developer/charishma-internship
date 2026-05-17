"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import NetworkStatus from '@/components/NetworkStatus';
import { useState, useEffect } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

export default function NexusLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";
  const [systemHealth, setSystemHealth] = useState<{ database: string, persistence: string }>({ database: '...', persistence: '...' });

  useEffect(() => {
    if (isLoginPage) return;
    const fetchHealth = async () => {
      try {
        const res = await fetch(`${API_URL}/api/admin/health`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const data = await res.json();
        setSystemHealth(data);
      } catch { /* ignore */ }
    };
    fetchHealth();
    const timer = setInterval(fetchHealth, 30000); // Check every 30s
    return () => clearInterval(timer);
  }, [isLoginPage]);

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <div className="relative z-10 flex min-h-screen">
      {/* Nexus Sidebar */}
      <aside className="w-72 border-r border-white/5 p-8 flex flex-col glass scrollbar-hide">
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-gradient-to-tr from-blue-600 to-blue-400 rounded-xl shadow-[0_0_20px_rgba(37,99,235,0.4)] flex items-center justify-center text-xl">
              ⚡
            </div>
            <h1 className="text-2xl font-black tracking-tighter text-white">NEXUS</h1>
          </div>
          <p className="text-[12px] font-black text-blue-500 uppercase tracking-[0.3em] px-1">SRM AP Command</p>
        </div>

        <nav className="flex-1 space-y-1.5">
          {[
            { href: '/', icon: '🏠', label: 'Dashboard' },
            { href: '/fleet', icon: '🛵', label: 'Fleet Management' },
            { href: '/restaurants', icon: '🍕', label: 'Gourmet Terminal' },
            { href: '/orders', icon: '📦', label: 'Live Orders' },
            { href: '/vault', icon: '🕯️', label: 'Zenvy Vault' },
            { href: '/finance', icon: '💰', label: 'Finance Trace' },
            { href: '/users', icon: '👥', label: 'Elite Residents' },
            { href: '/analytics', icon: '📈', label: 'Performance Intel' },
            { href: '/analytics/rewards', icon: '🎡', label: 'Rewards Intel' },
            { href: '/audit', icon: '📋', label: 'Audit Logs' },
            { href: '/config', icon: '⚙️', label: 'Nexus Config' },
          ].map(({ href, icon, label }) => {
            const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href) && (href !== '/analytics' || pathname === '/analytics');
            return (
              <Link
                key={href}
                href={href}
                className={`sidebar-link ${isActive ? 'sidebar-active' : ''}`}
              >
                <span>{icon}</span> {label}
                {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.6)]" />}
              </Link>
            );
          })}
        </nav>

        {/* System Status */}
        <div className="mt-auto pt-8 border-t border-white/5">
          <NetworkStatus />
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-auto bg-transparent relative">
        {/* Header Bar */}
        <header className="h-20 border-b border-white/5 px-10 flex items-center justify-between sticky top-0 bg-[#0A0A0F]/50 backdrop-blur-md z-40">
          <div className="flex items-center gap-4">
            <div className="w-2 h-2 bg-blue-500 rounded-full shadow-[0_0_10px_rgba(37,99,235,0.8)]" />
            <span className="text-[12px] font-black text-gray-500 uppercase tracking-[0.2em]">Operational HUD</span>
            
            {/* 🛡️ Global Persistence Shield */}
            <div className={`ml-4 px-3 py-1 rounded-full border text-[8px] font-black uppercase tracking-widest flex items-center gap-2 ${systemHealth.persistence === 'VOLATILE' ? 'bg-red-500/10 border-red-500/30 text-red-500' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${systemHealth.persistence === 'VOLATILE' ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
                {systemHealth.persistence} STORAGE
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-xs font-black text-white">SRM Admin</p>
              <p className="text-[11px] text-emerald-500 font-bold uppercase tracking-wider">Root Access Active</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#C9A84C] to-[#E5C973] p-[1px]">
              <div className="w-full h-full rounded-full bg-[#0A0A0F] flex items-center justify-center text-lg">
                👤
              </div>
            </div>
          </div>
        </header>
        <div className="p-10">
          {children}
        </div>
      </main>
    </div>
  );
}
