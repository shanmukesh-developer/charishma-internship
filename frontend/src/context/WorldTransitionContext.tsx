"use client";
import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

export type WorldType = 'food' | 'pg' | 'bikepool';

interface WorldTransitionContextType {
  isTransitioning: boolean;
  targetWorld: WorldType | null;
  phase: 'idle' | 'covering' | 'uncovering';
  triggerTransition: (path: string, world: WorldType) => void;
}

const WorldTransitionContext = createContext<WorldTransitionContextType>({
  isTransitioning: false,
  targetWorld: null,
  phase: 'idle',
  triggerTransition: () => {},
});

export const useWorldTransition = () => useContext(WorldTransitionContext);

export const WORLD_THEMES: Record<WorldType, { label: string; gradient: string; color: string }> = {
  food:     { label: 'ZENVY FOOD',     gradient: 'linear-gradient(135deg, #EF4F5F 0%, #F5A623 100%)', color: '#EF4F5F' },
  pg:       { label: 'ZENVY HOMES',    gradient: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)', color: '#6366F1' },
  bikepool: { label: 'ZENVY CO-RIDE',  gradient: 'linear-gradient(135deg, #10B981 0%, #059669 100%)', color: '#10B981' },
};

export function WorldTransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [targetWorld, setTargetWorld] = useState<WorldType | null>(null);
  const [phase, setPhase] = useState<'idle' | 'covering' | 'uncovering'>('idle');
  const lockRef = useRef(false);

  const triggerTransition = useCallback((path: string, world: WorldType) => {
    if (lockRef.current) return;
    lockRef.current = true;

    setTargetWorld(world);
    setIsTransitioning(true);
    setPhase('covering');

    // Phase 1: Cover animation runs (600ms)
    setTimeout(() => {
      router.push(path);

      // Phase 2: Small delay for page to swap, then uncover (300ms after push)
      setTimeout(() => {
        setPhase('uncovering');

        // Phase 3: Uncover animation runs (500ms), then clean up
        setTimeout(() => {
          setIsTransitioning(false);
          setPhase('idle');
          setTargetWorld(null);
          lockRef.current = false;
        }, 500);
      }, 300);
    }, 600);
  }, [router]);

  return (
    <WorldTransitionContext.Provider value={{ isTransitioning, targetWorld, phase, triggerTransition }}>
      {children}
    </WorldTransitionContext.Provider>
  );
}
