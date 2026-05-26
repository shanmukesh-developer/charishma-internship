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
  user?: { name: string; phone: string };
}

export default function SupportTickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);

  useEffect(() => {
    fetchTickets();
  }, []);

  const fetchTickets = async () => {
    try {
      const res = await api.get('/tickets/admin');
      setTickets(res.data);
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

  const getSlaStatus = (breachAt: string | null) => {
    if (!breachAt) return { text: 'No SLA', color: 'text-zinc-500' };
    
    const now = new Date();
    const breachDate = new Date(breachAt);
    const diffMs = breachDate.getTime() - now.getTime();
    
    if (diffMs < 0) {
      return { text: 'BREACHED', color: 'text-red-500 font-bold bg-red-500/10 px-2 py-1 rounded border border-red-500/20' };
    }
    
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours < 2) return { text: `${hours}h ${mins}m left`, color: 'text-amber-500' };
    return { text: `${hours}h ${mins}m left`, color: 'text-emerald-500' };
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-black tracking-tighter">Support Tickets</h1>
      </div>

      <div className="grid gap-4">
        {tickets.map(ticket => {
          const sla = getSlaStatus(ticket.slaBreachAt);
          return (
            <div key={ticket.id} className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl flex flex-col gap-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-bold">{ticket.subject}</h3>
                  <p className="text-sm text-zinc-400">User: {ticket.user?.name || 'Unknown'} • {ticket.user?.phone}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`text-[10px] uppercase tracking-widest font-black ${ticket.priority === 'Critical' ? 'text-red-500' : 'text-blue-500'}`}>
                    Priority: {ticket.priority}
                  </span>
                  {ticket.status !== 'Resolved' && ticket.status !== 'Closed' && (
                    <span className={`text-[12px] uppercase tracking-widest ${sla.color}`}>
                      SLA: {sla.text}
                    </span>
                  )}
                </div>
              </div>
              
              <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800/50">
                <p className="text-sm text-zinc-300">{ticket.description}</p>
              </div>

              <div className="flex gap-2 items-center">
                <span className="text-xs font-bold text-zinc-500">Status: {ticket.status}</span>
                <div className="flex-1" />
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
