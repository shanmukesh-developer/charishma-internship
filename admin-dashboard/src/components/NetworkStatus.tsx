"use client";
import { useAdminSocket } from '@/components/AdminSocketProvider';

export default function NetworkStatus() {
  const { isConnected } = useAdminSocket();

  return (
    <div className="bg-surface-2/60 rounded-lg p-4 border border-line">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-fg-muted">Live Sync Status</span>
        <div className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${isConnected ? 'bg-success animate-pulse' : 'bg-accent'}`} />
      </div>
      <p className="text-xs font-semibold text-fg-muted">{isConnected ? 'LIVE REAL-TIME SYNC' : 'AUTO-POLLING STANDBY'}</p>
      <div className="mt-3 w-full h-1 bg-surface-2/60 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${isConnected ? 'w-[100%] bg-success' : 'w-[40%] bg-accent'}`} />
      </div>
    </div>
  );
}

