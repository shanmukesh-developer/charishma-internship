"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';

interface Ticket {
  id: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  slaBreachAt: string | null;
  createdAt: string;
  adminResponse?: string;
  user?: { name: string; phone: string };
}

export default function SupportTickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    fetchTickets();
  }, []);

  const fetchTickets = async () => {
    try {
      const res = await api.get('/tickets/admin');
      setTickets(res.data);
      // Pre-fill reply boxes with existing admin responses
      const prefilled: Record<string, string> = {};
      res.data.forEach((t: Ticket) => {
        if (t.adminResponse) prefilled[t.id] = t.adminResponse;
      });
      setReplies(prefilled);
    } catch (err) {
      console.error(err);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.put(`/tickets/${id}`, { status });
      fetchTickets();
    } catch (err) {
      console.error(err);
    }
  };

  const sendReply = async (id: string) => {
    const reply = replies[id]?.trim();
    if (!reply) return;
    setSavingId(id);
    try {
      await api.put(`/tickets/${id}`, { adminResponse: reply, status: 'In Progress' });
      fetchTickets();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingId(null);
    }
  };

  const getSlaStatus = (breachAt: string | null) => {
    if (!breachAt) return { text: 'No SLA', color: 'text-zinc-500' };
    const now = new Date();
    const breachDate = new Date(breachAt);
    const diffMs = breachDate.getTime() - now.getTime();
    if (diffMs < 0) return { text: 'BREACHED', color: 'text-red-500 font-bold bg-red-500/10 px-2 py-1 rounded border border-red-500/20' };
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (hours < 2) return { text: `${hours}h ${mins}m left`, color: 'text-amber-500' };
    return { text: `${hours}h ${mins}m left`, color: 'text-emerald-500' };
  };

  const priorityColors: Record<string, string> = {
    Critical: 'text-red-500',
    High: 'text-orange-400',
    Medium: 'text-amber-400',
    Low: 'text-emerald-500',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tighter text-white">Support Tickets</h1>
          <p className="text-[11px] text-gray-500 uppercase tracking-widest mt-1">
            {tickets.filter(t => t.status === 'Open' || t.status === 'In Progress').length} Active &middot; {tickets.length} Total
          </p>
        </div>
      </div>

      <div className="grid gap-4">
        {tickets.map(ticket => {
          const sla = getSlaStatus(ticket.slaBreachAt);
          return (
            <div key={ticket.id} className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl flex flex-col gap-4 hover:border-zinc-700 transition-colors">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-bold text-white">{ticket.subject}</h3>
                  <p className="text-sm text-zinc-400 mt-0.5">
                    <span className="font-bold">{ticket.user?.name || 'Unknown'}</span>
                    {ticket.user?.phone && <span className="text-zinc-600"> &middot; {ticket.user.phone}</span>}
                    <span className="text-zinc-700 font-mono ml-2 text-[10px]">#{ticket.id.slice(0, 8)}</span>
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`text-[10px] uppercase tracking-widest font-black ${priorityColors[ticket.priority] || 'text-blue-500'}`}>
                    {ticket.priority} Priority
                  </span>
                  {ticket.status !== 'Resolved' && ticket.status !== 'Closed' && (
                    <span className={`text-[12px] uppercase tracking-widest ${sla.color}`}>
                      SLA: {sla.text}
                    </span>
                  )}
                </div>
              </div>

              {/* Description */}
              <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800/50">
                <p className="text-sm text-zinc-300">{ticket.description}</p>
              </div>

              {/* Admin Reply Box */}
              <div className="bg-zinc-950/60 border border-blue-500/20 rounded-xl p-4 space-y-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-blue-400">Admin Reply (visible to customer)</p>
                <textarea
                  rows={2}
                  value={replies[ticket.id] || ''}
                  onChange={e => setReplies(prev => ({ ...prev, [ticket.id]: e.target.value }))}
                  placeholder="Type your response to the customer..."
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-blue-500/60 resize-none transition-all"
                />
                <button
                  onClick={() => sendReply(ticket.id)}
                  disabled={savingId === ticket.id || !replies[ticket.id]?.trim()}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-black uppercase tracking-widest rounded-lg transition-all"
                >
                  {savingId === ticket.id ? 'Saving...' : 'Send Reply \u2192'}
                </button>
              </div>

              {/* Status Controls */}
              <div className="flex gap-2 items-center flex-wrap">
                <span className="text-xs font-bold text-zinc-500">Status:</span>
                {['Open', 'In Progress', 'Resolved', 'Closed'].map(status => (
                  <button
                    key={status}
                    onClick={() => updateStatus(ticket.id, status)}
                    disabled={ticket.status === status}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      ticket.status === status
                        ? 'bg-blue-600 text-white'
                        : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {tickets.length === 0 && (
          <div className="p-12 text-center text-zinc-500 bg-zinc-900/50 rounded-2xl border border-zinc-800/50">
            No active support tickets.
          </div>
        )}
      </div>
    </div>
  );
}
