"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Tilt from '@/components/Tilt';
import Magnetic from '@/components/Magnetic';
import NexusSpin from '@/components/NexusSpin';
import { API_URL } from '@/utils/api';

export default function RewardsPage() {
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStreak = async () => {
      try {
        const res = await fetch(`${API_URL}/api/users/profile`);
        if (res.ok) {
          const data = await res.json();
          setStreak(data.streakCount || 0);
        }
      } catch (err) {
        console.error('[STREAK_FETCH_ERROR]', err);
      } finally {
        setLoading(false);
      }
    };
    fetchStreak();
  }, []);

  const getTier = (days: number) => {
    if (days >= 14) return 'Gold Protocol';
    if (days >= 7) return 'Silver Protocol';
    if (days >= 3) return 'Bronze Protocol';
    return 'Starter Protocol';
  };

  const progressPercent = Math.min(100, (streak / 14) * 100);

  return (
    <main className="min-h-screen bg-[#0A0A0B] text-white light:text-gray-900 p-8 relative overflow-x-hidden">
      {/* Cinematic Background */}
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(201,168,76,0.05)_0%,transparent_50%)] pointer-events-none" />
      <div className="fixed inset-0 bg-gradient-to-b from-black via-transparent to-black pointer-events-none light:hidden" />

      {/* Header */}
      <div className="flex items-center justify-between mb-12 relative z-10">
        <Magnetic>
          <Link href="/profile" className="w-12 h-12 bg-white/5 backdrop-blur-xl rounded-full flex items-center justify-center border border-white/10 hover:bg-white/10 transition-all">
            <svg className="w-5 h-5 text-white light:text-gray-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
        </Magnetic>
        <h1 className="text-xl font-black uppercase tracking-[0.3em] text-gold-shimmer">Elysian Rewards</h1>
        <div className="w-12" />
      </div>

      <div className="mb-12 relative z-10">
        <NexusSpin />
      </div>

      {/* Streak Card with Tilt */}
      <Tilt scale={1.02} className="mb-10 relative z-10">
        <div className="bg-black/40 backdrop-blur-3xl p-8 rounded-[48px] border border-white/10 shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
             <span className="text-4xl font-black italic">VIP</span>
          </div>
          
          <div className="flex justify-between items-end mb-8">
            <div>
              <p className="text-[10px] font-black text-primary-yellow uppercase tracking-[0.2em] mb-2 ">Authentication Streak</p>
              <h2 className="text-5xl font-black text-white light:text-gray-900 flex items-center gap-3">
                <span className="animate-pulse">🔥</span> {loading ? '...' : streak} <span className="text-xl font-bold text-white light:text-gray-900/40 uppercase tracking-tighter">Days</span>
              </h2>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-black text-white light:text-gray-900/30 uppercase tracking-widest mb-1">Status Tier</p>
              <div className="px-4 py-1.5 bg-[#C9A84C]/10 rounded-full border border-[#C9A84C]/20">
                <p className="text-[10px] font-black text-primary-yellow uppercase tracking-[0.15em]">{loading ? 'Scanning...' : getTier(streak)}</p>
              </div>
            </div>
          </div>
          
          <div className="relative h-2 w-full bg-white/5 rounded-full overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_2s_infinite] -translate-x-full" />
            <div className="h-full bg-gradient-to-r from-amber-500 to-primary-yellow rounded-full transition-all duration-1000 shadow-[0_0_20px_rgba(201,168,76,0.3)]" style={{ width: `${progressPercent}%` }} />
          </div>
          
          <p className="text-white light:text-gray-900/40 text-[10px] font-bold mt-6 leading-relaxed max-w-[80%] uppercase tracking-widest">
            Maintain daily uplink to synchronize with the <span className="text-white light:text-gray-900">Nexus Tier</span> and unlock strategic assets.
          </p>
        </div>
      </Tilt>

      {/* Reward Tiers Grid */}
      <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-white light:text-gray-900/30 mb-8 ml-2">Strategic Unlockables</h3>
      <div className="space-y-4 relative z-10">
        {[
          { icon: '🥉', title: '3 Day Sequence', desc: 'Complimentary Logistics Bypass', level: 'Bronze', dayRequirement: 3 },
          { icon: '🥈', title: '7 Day Sequence', desc: '₹50 Asset Injection', level: 'Silver', dayRequirement: 7 },
          { icon: '🥇', title: '14 Day Sequence', desc: 'Universal Sustenance Pass', level: 'Gold', dayRequirement: 14 }
        ].map((reward, i) => {
          const isUnlocked = streak >= reward.dayRequirement;
          return (
            <Tilt key={i} scale={1.01}>
              <div className="bg-white/[0.02] hover:bg-white/[0.05] p-6 rounded-[32px] border border-white/5 flex items-center gap-6 transition-all group">
                <div className="w-16 h-16 bg-white/[0.03] rounded-2xl flex items-center justify-center text-3xl border border-white/5 group-hover:border-white/10 transition-colors shadow-inner">
                  {reward.icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                     <h4 className="text-sm font-black uppercase tracking-tight text-white light:text-gray-900">{reward.title}</h4>
                     <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded-full ${isUnlocked ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/5 text-white light:text-gray-900/30'}`}>{reward.level}</span>
                  </div>
                  <p className="text-[10px] font-bold text-white light:text-gray-900/40 uppercase tracking-widest">{reward.desc}</p>
                </div>
                <div className={`px-4 py-2 rounded-xl border ${isUnlocked ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-white/5 border-white/5 text-white light:text-gray-900/20'}`}>
                   <span className="text-[9px] font-black uppercase tracking-widest">{isUnlocked ? 'Decrypted' : 'Encrypted'}</span>
                </div>
              </div>
            </Tilt>
          );
        })}
      </div>
    </main>
  );
}
