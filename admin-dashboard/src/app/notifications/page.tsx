"use client";
import { useState } from 'react';
import api from '@/lib/api';

export default function NotificationsPage() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const handleSendNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !body) {
      setStatus({ type: 'error', message: 'Title and Body are required.' });
      return;
    }

    try {
      setSending(true);
      setStatus(null);
      const res = await api.post('/admin/broadcast-push', { title, body });
      setStatus({ type: 'success', message: res.data.message || 'Push notification broadcasted successfully!' });
      setTitle('');
      setBody('');
    } catch (err: any) {
      console.error('Failed to send notification:', err);
      setStatus({ 
        type: 'error', 
        message: err.response?.data?.message || err.message || 'Failed to send broadcast push notification.' 
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto text-white">
      <div className="mb-8">
        <h1 className="text-3xl font-black uppercase tracking-widest text-emerald-400">Push Notifications</h1>
        <p className="text-gray-400 text-sm mt-1">Broadcast direct notifications to all active resident devices.</p>
      </div>

      <div className="bg-[#141416] border border-white/10 rounded-3xl p-8">
        <form onSubmit={handleSendNotification} className="flex flex-col gap-6">
          {status && (
            <div className={`p-4 rounded-xl border font-bold text-sm ${status.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
              {status.message}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-sm font-bold text-gray-300 tracking-wider">Notification Title</label>
            <input 
              type="text" 
              placeholder="e.g., Midnight Craving Alert! 🍔" 
              value={title} 
              onChange={(e) => setTitle(e.target.value)} 
              className="bg-black/50 border border-white/10 p-4 rounded-xl text-white outline-none focus:border-emerald-500 transition-colors placeholder:text-gray-600"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-bold text-gray-300 tracking-wider">Notification Body</label>
            <textarea 
              placeholder="e.g., Use code MIDNIGHT50 for 50% off on your next order. Valid for next 2 hours." 
              value={body} 
              onChange={(e) => setBody(e.target.value)} 
              className="bg-black/50 border border-white/10 p-4 rounded-xl text-white outline-none focus:border-emerald-500 transition-colors min-h-[120px] placeholder:text-gray-600"
              required
            />
          </div>

          <div className="pt-4 border-t border-white/10 mt-2 flex justify-end">
            <button 
              type="submit" 
              disabled={sending}
              className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 px-8 py-3 rounded-xl font-bold uppercase tracking-widest text-sm shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
            >
              {sending ? 'Broadcasting...' : 'Broadcast to All Devices 🚀'}
            </button>
          </div>
        </form>
      </div>
      
      <div className="mt-8 bg-blue-500/10 border border-blue-500/20 rounded-3xl p-6 text-sm text-blue-200">
        <h3 className="font-bold text-blue-400 mb-2 flex items-center gap-2">
          <span>ℹ️</span> How it works
        </h3>
        <p className="opacity-80">
          This feature uses Firebase Cloud Messaging (FCM) to instantly push notifications to all users who have an active session (valid FCM Token). Users must have the app installed and notifications enabled on their devices to receive the broadcast.
        </p>
      </div>
    </div>
  );
}
