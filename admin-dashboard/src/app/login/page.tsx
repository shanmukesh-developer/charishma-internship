"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RecaptchaVerifier, ConfirmationResult } from 'firebase/auth';
import { motion, AnimatePresence } from 'framer-motion';

declare global {
  interface Window {
    recaptchaVerifier?: RecaptchaVerifier;
    confirmationResult?: ConfirmationResult;
  }
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!password) {
      setError('Administrative key required.');
      return;
    }

    // Administrative password check bypassed per user request

    setLoading(true);
    setError('');
    
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';
      // Use the internal admin bypass phone
      const phone = '9391955674'; 
      const response = await fetch(`${API_URL}/api/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, firebaseToken: 'E2E_MOCK_TOKEN' }),
      });
      
      const data = await response.json();
      if (response.ok) {
        if (data.role !== 'admin') {
          setError('Node Violation: Unauthorized clearance level.');
          setLoading(false);
          return;
        }
        
        localStorage.setItem('user', JSON.stringify({ id: data._id, name: data.name, role: data.role }));
        router.push('/');
      } else {
        setError(data.message || 'Authentication failed.');
      }
    } catch (err) {
      console.error('Login Error:', err);
      setError('System Error: Unable to reach authentication server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0A0A0F] text-white flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-blue-600/10 blur-[120px] rounded-full" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-amber-600/5 blur-[120px] rounded-full" />

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md glass p-10 rounded-[32px] border border-white/5 relative z-10"
      >
        <div className="text-center mb-12">
          <div className="w-16 h-16 bg-blue-600/20 border border-blue-500/30 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-6 shadow-2xl">
            ⚡
          </div>
          <h1 className="text-3xl font-black tracking-tighter uppercase italic">Nexus <span className="text-blue-500">Secure</span></h1>
          <p className="text-[10px] font-black text-gray-500 uppercase tracking-[0.4em] mt-2">Administrative Command Terminal</p>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-blue-500 uppercase tracking-widest ml-1">Administrative Entry Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="••••••••••••"
              className="w-full bg-white/[0.02] border border-white/5 rounded-2xl py-4 px-6 text-white font-bold outline-none focus:border-blue-500/40 transition-all text-center tracking-[0.3em]"
            />
          </div>
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-white text-black py-5 rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] hover:bg-gray-200 transition-all shadow-xl shadow-blue-500/5 disabled:opacity-50"
          >
            {loading ? 'Decrypting Access...' : 'Initiate Terminal Session'}
          </button>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-8 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 text-[10px] font-bold uppercase tracking-wider text-center"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="absolute bottom-10 text-[9px] font-black text-gray-700 uppercase tracking-[0.8em]">
        Nexus Protocol v4.0.5 // encrypted_stream
      </div>
    </main>
  );
}
