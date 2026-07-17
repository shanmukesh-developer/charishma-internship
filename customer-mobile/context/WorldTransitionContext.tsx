import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import { playSound, resumeAudio } from '../utils/sounds';

export type WorldType = 'food' | 'pg' | 'bikepool' | 'others' | 'comms' | 'mega-basket';

interface WorldTheme {
  label: string;
  colors: string[];
}

export const WORLD_THEMES: Record<WorldType, WorldTheme> = {
  food: { label: 'ZENVY FOOD', colors: ['#EF4F5F', '#F5A623'] },
  pg: { label: 'ZENVY HOMES', colors: ['#6366F1', '#4F46E5'] },
  bikepool: { label: 'ZENVY CO-RIDE', colors: ['#10B981', '#059669'] },
  others: { label: 'ZENVY OTHERS', colors: ['#8B5CF6', '#EC4899'] },
  comms: { label: 'ZENVY COMMS', colors: ['#F43F5E', '#FB923C'] },
  'mega-basket': { label: 'MEGA BASKET', colors: ['#10B981', '#C9A84C'] }
};

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
  triggerTransition: () => {}
});

export const useWorldTransition = () => useContext(WorldTransitionContext);

export function WorldTransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [targetWorld, setTargetWorld] = useState<WorldType | null>(null);
  const [phase, setPhase] = useState<'idle' | 'covering' | 'uncovering'>('idle');
  const lockRef = useRef(false);

  const triggerTransition = useCallback((path: string, world: WorldType) => {
    if (lockRef.current) return;
    lockRef.current = true;

    // Resume audio on first user interaction (browser policy)
    resumeAudio();
    
    // Play dynamic transition sound based on target world
    if (world === 'pg') {
      playSound('pgTransition');
    } else if (world === 'bikepool') {
      playSound('rideTransition');
    } else {
      playSound('worldTransition');
    }

    setTargetWorld(world);
    setIsTransitioning(true);
    setPhase('covering');

    // Phase 1: Cover animation (450ms — faster for snappy feel)
    setTimeout(() => {
      router.replace(path as any);

      // Phase 2: Small delay for page swap, then uncover
      setTimeout(() => {
        setPhase('uncovering');

        // Phase 3: Uncover (400ms)
        setTimeout(() => {
          setIsTransitioning(false);
          setPhase('idle');
          setTargetWorld(null);
          lockRef.current = false;
        }, 400);
      }, 150);  // Reduced from 300ms — much snappier
    }, 450);    // Reduced from 600ms
  }, [router]);

  return (
    <WorldTransitionContext.Provider value={{ isTransitioning, targetWorld, phase, triggerTransition }}>
      {children}
    </WorldTransitionContext.Provider>
  );
}
