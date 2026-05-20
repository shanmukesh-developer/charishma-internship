"use client";
import { useState, useEffect } from 'react';
import { useAdminAuth } from '@/utils/useAdminAuth';

interface AuditLog {
  id: string;
  adminId: string;
  targetId: string;
  action: string;
  details: string;
  timestamp: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

export default function AuditPage() {
  const isAuthed = useAdminAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const token = 'cookie-managed';
        const res = await fetch(`${API_URL}/api/admin/audit`, {
          });
        const data = await res.json();
        if (res.ok) setLogs(data);
      } catch (error) {
        console.error('[AUDIT_FETCH_ERROR]', error);
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, []);

  if (!isAuthed) return <div className="p-20 text-center font-black text-white uppercase tracking-widest animate-pulse">Authenticating...</div>;

  return (
    <div className="space-y-8 animate-fade-in relative pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tighter text-white uppercase">Audit Intelligence</h1>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mt-1">Operational mutation ledger</p>
        </div>
        <div className="flex items-center gap-4">
           <input 
              type="text" 
              placeholder="Search Mutations..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-2xl px-4 py-2 text-sm text-white outline-none focus:border-blue-500/50 transition-all w-64"
           />
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02]">
                <th className="px-6 py-4 text-[10px] uppercase font-black tracking-widest text-gray-400">Timestamp</th>
                <th className="px-6 py-4 text-[10px] uppercase font-black tracking-widest text-gray-400">Action</th>
                <th className="px-6 py-4 text-[10px] uppercase font-black tracking-widest text-gray-400">Admin</th>
                <th className="px-6 py-4 text-[10px] uppercase font-black tracking-widest text-gray-400">Target ID</th>
                <th className="px-6 py-4 text-[10px] uppercase font-black tracking-widest text-gray-400">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {loading ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-xs text-gray-500 animate-pulse">Scanning ledger...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-xs text-gray-500">No recent mutations recorded.</td></tr>
              ) : (
                logs.filter(log => 
                  log.action.toLowerCase().includes(search.toLowerCase()) || 
                  log.adminId.toLowerCase().includes(search.toLowerCase()) || 
                  log.details.toLowerCase().includes(search.toLowerCase())
                ).map((log) => (
                  <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4 text-[11px] text-gray-400 font-medium">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[9px] font-black px-2 py-1 rounded-md uppercase border ${
                        log.action.includes('CREATE') ? 'text-emerald-400 bg-emerald-400/5 border-emerald-400/10' :
                        log.action.includes('UPDATE') ? 'text-blue-400 bg-blue-400/5 border-blue-400/10' :
                        'text-primary-yellow bg-primary-yellow/5 border-primary-yellow/10'
                      }`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs font-bold text-white/90">{log.adminId}</td>
                    <td className="px-6 py-4 text-[10px] font-mono text-gray-500">{log.targetId.slice(0, 8)}...</td>
                    <td className="px-6 py-4 text-[11px] text-gray-400 max-w-xs truncate">
                      {log.details}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

