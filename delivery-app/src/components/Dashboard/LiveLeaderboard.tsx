"use client";
import React, { useState, useEffect, useCallback } from 'react';

interface LeaderboardEntry {
  name: string;
  orders: number;
  earnings: number;
  isMe?: boolean;
}

interface LiveLeaderboardProps {
  apiUrl: string;
  token: string;
  driverId: string;
}

export default function LiveLeaderboard({ apiUrl, token, driverId }: LiveLeaderboardProps) {
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRank, setMyRank] = useState<number | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/delivery/leaderboard`, {
        });
      if (res.ok) {
        const data: LeaderboardEntry[] = await res.json();
        const rank = data.findIndex((e: LeaderboardEntry & { id?: string }) => e.id === driverId);
        setMyRank(rank >= 0 ? rank + 1 : null);
        setBoard(data.slice(0, 5));
      }
    } catch {}
    setLoading(false);
  }, [apiUrl, token, driverId]);

  useEffect(() => {
    fetchLeaderboard();
    const id = setInterval(fetchLeaderboard, 30000); // refresh every 30s
    return () => clearInterval(id);
  }, [fetchLeaderboard]);

  if (loading) return null;
  if (board.length === 0) return null;

  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];

  return (
    <div className="bg-[#111113] border border-white/5 rounded-[28px] p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">City Radar</p>
          <p className="text-sm font-black text-white">Today&apos;s Top Riders</p>
        </div>
        {myRank && (
          <span className="text-[10px] font-black bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-3 py-1.5 rounded-xl">
            Rank #{myRank}
          </span>
        )}
      </div>
      <div className="space-y-2">
        {board.map((entry, i) => (
          <div
            key={i}
            className={`flex items-center justify-between py-2 px-3 rounded-2xl transition-all ${
              entry.isMe ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-white/3'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-lg">{medals[i]}</span>
              <div>
                <p className={`text-xs font-black ${entry.isMe ? 'text-emerald-400' : 'text-white'}`}>
                  {entry.name} {entry.isMe ? '(You)' : ''}
                </p>
                <p className="text-[9px] text-gray-500 font-black">{entry.orders} deliveries</p>
              </div>
            </div>
            <p className="text-sm font-black text-emerald-400">₹{entry.earnings}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
