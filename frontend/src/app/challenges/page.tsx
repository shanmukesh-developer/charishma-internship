"use client";
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Magnetic from '@/components/Magnetic';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

export default function ChallengesPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchChallenges = async () => {
      try {
        const res = await fetch(`${API_URL}/api/features/challenges/active`);
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (e) {
        console.error('Fetch error:', e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchChallenges();
  }, []);

  return (
    <main className="min-h-screen bg-[#0A0A0B] text-white p-4 md:p-8 relative overflow-x-hidden">
      {/* Background */}
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(139,90,43,0.1)_0%,transparent_50%)] pointer-events-none" />
      <div className="fixed inset-0 bg-gradient-to-b from-black via-transparent to-black pointer-events-none opacity-40" />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-8">
          <Magnetic>
            <Link href="/" className="w-12 h-12 bg-white/5 backdrop-blur-xl rounded-full flex items-center justify-center border border-white/10 hover:bg-white/10 transition-all">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
          </Magnetic>
          <h1 className="text-xl font-black uppercase tracking-[0.3em] text-[#C9A84C]">BlockWars</h1>
          <div className="w-12" />
        </div>

        {isLoading ? (
          <div className="flex justify-center mt-32">
            <div className="w-10 h-10 border-4 border-white/10 border-t-[#C9A84C] rounded-full animate-spin" />
          </div>
        ) : !data || !data.challenge ? (
          <div className="text-center mt-32 text-white/50">
            <p>No active challenges at the moment.</p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="text-center mb-10">
              <div className="inline-block px-4 py-1.5 bg-white/5 border border-white/10 rounded-full text-[10px] font-black uppercase tracking-widest text-[#C9A84C] mb-4">
                Weekly Challenge
              </div>
              <h2 className="text-4xl md:text-5xl font-black italic tracking-tighter mb-2">
                {data.challenge.title} {data.challenge.emoji}
              </h2>
              <p className="text-sm font-bold text-white/60">{data.challenge.description}</p>
            </div>

            <div className="glass-card p-6 border-white/5 rounded-[30px] bg-black/40 backdrop-blur-2xl">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-6 border-b border-white/5 pb-4">Live Leaderboard</h3>
              
              <div className="space-y-3">
                {data.leaderboard.length === 0 ? (
                  <p className="text-center text-sm font-bold text-white/30 py-8">No data for this week yet.</p>
                ) : (
                  data.leaderboard.map((block: any, idx: number) => (
                    <div 
                      key={block.block} 
                      className={`relative overflow-hidden p-4 rounded-2xl flex items-center justify-between border transition-all ${
                        idx === 0 
                          ? 'border-[#C9A84C]/50 bg-[#C9A84C]/10 shadow-[0_0_30px_rgba(201,168,76,0.15)]' 
                          : idx === 1 
                            ? 'border-gray-400/30 bg-gray-400/5' 
                            : idx === 2 
                              ? 'border-amber-700/30 bg-amber-700/5' 
                              : 'border-white/5 bg-white/[0.02]'
                      }`}
                    >
                      <div className="flex items-center gap-4 relative z-10">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black ${idx === 0 ? 'bg-[#C9A84C] text-black' : 'bg-white/10 text-white'}`}>
                          {idx + 1}
                        </div>
                        <div>
                          <p className="font-black text-lg uppercase tracking-wider">{block.block}</p>
                          <p className="text-[9px] font-bold text-white/40 uppercase tracking-widest">
                            {block.participants} participants
                          </p>
                        </div>
                      </div>
                      <div className="text-right relative z-10">
                        <p className={`font-black text-2xl ${idx === 0 ? 'text-[#C9A84C]' : 'text-white'}`}>
                          {data.challenge.metric === 'spend' ? `₹${block.spend}` : 
                           data.challenge.metric === 'orders' ? block.orders : block.participants}
                        </p>
                        <p className="text-[9px] font-bold text-white/40 uppercase tracking-widest">
                          Score: {block.score}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <p className="text-center text-[10px] font-bold text-white/30 uppercase tracking-widest pt-4">
              Resets every Monday. Winning block gets an exclusive campus-wide discount code!
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
