"use client";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Magnetic from '@/components/Magnetic';
import SuccessOverlay from '@/components/SuccessOverlay';
import Navigation from '@/components/Navigation';

export default function SupportPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewTicketForm, setShowNewTicketForm] = useState(false);
  const [formData, setFormData] = useState({ subject: '', description: '', priority: 'Medium' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [overlay, setOverlay] = useState<{ isOpen: boolean; title: string; message: string; type?: 'success' | 'error' }>({
    isOpen: false, title: '', message: '',
  });

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

  const fetchTickets = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return router.push('/login');

      const res = await fetch(`${API_URL}/api/tickets`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTickets(data);
      }
    } catch (error) {
      console.error('Error fetching tickets:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.subject || !formData.description) {
      setOverlay({ isOpen: true, title: 'Validation Error', message: 'Subject and description are required.', type: 'error' });
      return;
    }
    
    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(formData)
      });
      
      if (response.ok) {
        setOverlay({ isOpen: true, title: 'TICKET CREATED', message: 'Your support request has been filed. Our team will review it shortly.', type: 'success' });
        setShowNewTicketForm(false);
        setFormData({ subject: '', description: '', priority: 'Medium' });
        fetchTickets();
      } else {
        const err = await response.json();
        setOverlay({ isOpen: true, title: 'SUBMISSION FAILED', message: err.message || 'Error creating ticket', type: 'error' });
      }
    } catch (error) {
      setOverlay({ isOpen: true, title: 'NETWORK ERROR', message: 'Failed to connect to support servers.', type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#020203] text-white p-4 md:p-8 pb-32 overflow-x-hidden relative">
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(201,168,76,0.05)_0%,transparent_50%)]" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto mt-6">
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-4">
             <Link href="/profile" className="w-10 h-10 bg-white/5 backdrop-blur-xl rounded-full flex items-center justify-center border border-white/10 hover:bg-white/10 transition-all">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
                </svg>
             </Link>
             <h1 className="text-2xl font-black uppercase tracking-[0.3em] text-white">Support Center</h1>
          </div>
          <button 
             onClick={() => setShowNewTicketForm(!showNewTicketForm)}
             className="btn-yellow px-6 py-3 rounded-full text-[10px] font-black uppercase tracking-widest shadow-[0_0_20px_rgba(201,168,76,0.2)] hover:scale-105 transition-all"
          >
             {showNewTicketForm ? 'Cancel' : 'New Ticket'}
          </button>
        </div>

        {showNewTicketForm && (
           <form onSubmit={handleSubmit} className="glass-card-extreme p-6 md:p-8 rounded-3xl border border-primary-yellow/20 mb-10 animate-fade-in relative overflow-hidden">
             <div className="absolute inset-0 bg-gradient-to-r from-primary-yellow/5 to-transparent pointer-events-none" />
             <h2 className="text-xs font-black uppercase tracking-widest text-primary-yellow mb-6">File A Support Request</h2>
             
             <div className="space-y-6 relative z-10">
               <div>
                 <label className="text-[10px] text-white/50 uppercase tracking-widest font-bold ml-2">Issue Subject</label>
                 <input 
                    type="text" 
                    value={formData.subject}
                    onChange={e => setFormData({...formData, subject: e.target.value})}
                    placeholder="E.g., Order Delayed, Payment Failed"
                    className="w-full mt-2 bg-black/50 border border-white/10 rounded-2xl h-14 px-4 text-sm focus:border-primary-yellow outline-none transition-all"
                 />
               </div>
               
               <div className="grid grid-cols-2 gap-4">
                 <div>
                   <label className="text-[10px] text-white/50 uppercase tracking-widest font-bold ml-2">Priority Level</label>
                   <select 
                      value={formData.priority}
                      onChange={e => setFormData({...formData, priority: e.target.value})}
                      className="w-full mt-2 bg-black/50 border border-white/10 rounded-2xl h-14 px-4 text-sm focus:border-primary-yellow outline-none transition-all appearance-none"
                   >
                     <option value="Low">Low</option>
                     <option value="Medium">Medium</option>
                     <option value="High">High</option>
                     <option value="Critical">Critical</option>
                   </select>
                 </div>
               </div>

               <div>
                 <label className="text-[10px] text-white/50 uppercase tracking-widest font-bold ml-2">Detailed Description</label>
                 <textarea 
                    value={formData.description}
                    onChange={e => setFormData({...formData, description: e.target.value})}
                    placeholder="Describe the issue in detail..."
                    className="w-full mt-2 bg-black/50 border border-white/10 rounded-2xl p-4 text-sm h-32 focus:border-primary-yellow outline-none transition-all resize-none"
                 />
               </div>

               <button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="w-full h-14 bg-primary-yellow text-black font-black uppercase tracking-widest text-xs rounded-2xl hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50"
               >
                  {isSubmitting ? 'Submitting...' : 'Submit Ticket'}
               </button>
             </div>
           </form>
        )}

        <div className="space-y-4">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-4 ml-2 border-b border-white/10 pb-2">Your Tickets</h3>
          
          {loading ? (
             <div className="flex justify-center py-20">
               <div className="w-10 h-10 border-4 border-primary-yellow border-t-transparent rounded-full animate-spin" />
             </div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-20 bg-white/5 rounded-3xl border border-white/5 border-dashed">
              <span className="text-4xl block mb-4 grayscale opacity-50">🎫</span>
              <p className="text-white/40 text-sm font-bold uppercase tracking-widest">No support tickets found</p>
            </div>
          ) : (
            tickets.map(ticket => (
              <div key={ticket.id} className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-primary-yellow/30 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 group">
                 <div>
                    <div className="flex items-center gap-3 mb-2">
                       <span className={`px-2 py-1 rounded-[6px] text-[8px] font-black uppercase tracking-widest ${ticket.status === 'Resolved' || ticket.status === 'Closed' ? 'bg-green-500/20 text-green-400' : 'bg-primary-yellow/20 text-primary-yellow'}`}>
                         {ticket.status}
                       </span>
                       <span className={`px-2 py-1 rounded-[6px] text-[8px] font-black uppercase tracking-widest bg-white/10 text-white/60`}>
                         {ticket.priority}
                       </span>
                       <span className="text-[10px] text-white/40 font-mono">#{ticket.id.slice(0,8)}</span>
                    </div>
                    <h4 className="text-base font-bold text-white group-hover:text-primary-yellow transition-colors">{ticket.subject}</h4>
                    <p className="text-xs text-white/60 mt-2 line-clamp-2">{ticket.description}</p>
                 </div>

                 {ticket.adminResponse && (
                    <div className="md:w-1/3 w-full bg-black/40 border border-white/5 p-4 rounded-xl">
                       <p className="text-[9px] text-green-400 font-black uppercase tracking-widest mb-1">Admin Response:</p>
                       <p className="text-xs text-white/80 italic">{ticket.adminResponse}</p>
                    </div>
                 )}
              </div>
            ))
          )}
        </div>
      </div>

      <Navigation />
      <SuccessOverlay 
        isOpen={overlay.isOpen} 
        onClose={() => setOverlay(prev => ({ ...prev, isOpen: false }))} 
        title={overlay.title} 
        message={overlay.message} 
        type={overlay.type} 
      />
    </main>
  );
}
