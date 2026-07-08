"use client";
import { motion } from 'framer-motion';
import { useWorldTransition, WorldType } from '@/context/WorldTransitionContext';

const WORLDS: { id: WorldType; label: string; icon: string; path: string; activeColor: string; activeBg: string }[] = [
  {
    id: 'food',
    label: 'Food',
    icon: '🍛',
    path: '/',
    activeColor: '#EF4F5F',
    activeBg: 'rgba(239,79,95,0.12)',
  },
  {
    id: 'pg',
    label: 'PG & Homes',
    icon: '🏠',
    path: '/pg',
    activeColor: '#6366F1',
    activeBg: 'rgba(99,102,241,0.12)',
  },
  {
    id: 'bikepool',
    label: 'Co-Ride',
    icon: '🏍️',
    path: '/bikepool',
    activeColor: '#10B981',
    activeBg: 'rgba(16,185,129,0.12)',
  },
];

interface WorldSwitcherProps {
  activeWorld: WorldType;
}

export default function WorldSwitcher({ activeWorld }: WorldSwitcherProps) {
  const { triggerTransition, isTransitioning } = useWorldTransition();

  return (
    <div className="my-5">
      <div className="flex gap-2 p-1.5 bg-white/5 light:bg-gray-50 border border-white/10 light:border-gray-200 rounded-2xl relative">
        {WORLDS.map((world) => {
          const isActive = world.id === activeWorld;
          return (
            <button
              key={world.id}
              disabled={isTransitioning}
              onClick={() => {
                if (!isActive) {
                  triggerTransition(world.path, world.id);
                }
              }}
              className="flex-1 relative z-10 flex items-center justify-center gap-1.5 py-3 px-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed"
              style={{
                color: isActive ? world.activeColor : undefined,
              }}
            >
              {isActive && (
                <motion.div
                  layoutId="world-switcher-pill"
                  className="absolute inset-0 rounded-xl border shadow-lg"
                  style={{
                    background: world.activeBg,
                    borderColor: `${world.activeColor}33`,
                    boxShadow: `0 4px 20px ${world.activeColor}15`,
                  }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative z-10 text-sm">{world.icon}</span>
              <span
                className={`relative z-10 ${
                  isActive ? 'text-white light:text-black' : 'text-gray-400'
                }`}
              >
                {world.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
