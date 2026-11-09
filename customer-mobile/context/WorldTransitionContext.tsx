import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { playSound, resumeAudio } from '../utils/sounds';
import { fixedDietTokens } from '../utils/themeNow';

export type WorldType = 'food' | 'pg' | 'bikepool' | 'others' | 'comms';

interface WorldTheme {
  label: string;
  colors: string[];
}

// Owner, 10 Nov 2026: one look - PG and Co-Ride open on the diet accent (was indigo / emerald), Groceries on its own
// green header colour (was violet -> pink). Food and Campus keep their warm art gradients.
export const WORLD_THEMES: Record<WorldType, WorldTheme> = fixedDietTokens(false, (d): Record<WorldType, WorldTheme> => ({
  food: { label: 'Food', colors: ['#EF4F5F', '#F5A623'] },
  pg: { label: 'PG stays', colors: [d.acc, d.accDeep] },
  bikepool: { label: 'Co-Ride', colors: [d.acc, d.accDeep] },
  others: { label: 'Groceries', colors: ['#1E8E3E', '#146C2E'] },
  comms: { label: 'Campus', colors: ['#F43F5E', '#FB923C'] },
}));

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

/** The trigger alone, in its own context: it never changes, so a screen that only starts transitions
 *  (Home) is not re-rendered 3 times (covering / uncovering / idle) while the overlay animates. */
const WorldTransitionTriggerContext = createContext<(path: string, world: WorldType) => void>(() => {});

export const useWorldTransition = () => useContext(WorldTransitionContext);
export const useWorldTransitionTrigger = () => useContext(WorldTransitionTriggerContext);

export function WorldTransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [targetWorld, setTargetWorld] = useState<WorldType | null>(null);
  const [phase, setPhase] = useState<'idle' | 'covering' | 'uncovering'>('idle');
  const lockRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => { timersRef.current.push(setTimeout(fn, ms)); };

  // Clear pending phase timers if the provider ever unmounts (no setState after unmount).
  useEffect(() => () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; }, []);

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
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    later(() => {
      // A failed navigation must not leave the overlay (and the lock) stuck on screen.
      try { router.replace(path as any); } catch (e) { console.warn('[WORLD_TRANSITION]', e); }

      // Phase 2: Small delay for page swap, then uncover
      later(() => {
        setPhase('uncovering');

        // Phase 3: Uncover (400ms)
        later(() => {
          setIsTransitioning(false);
          setPhase('idle');
          setTargetWorld(null);
          lockRef.current = false;
        }, 400);
      }, 150);  // Reduced from 300ms — much snappier
    }, 450);    // Reduced from 600ms
  }, [router]);

  const value = useMemo(() => ({ isTransitioning, targetWorld, phase, triggerTransition }), [isTransitioning, targetWorld, phase, triggerTransition]);

  return (
    <WorldTransitionTriggerContext.Provider value={triggerTransition}>
      <WorldTransitionContext.Provider value={value}>
        {children}
      </WorldTransitionContext.Provider>
    </WorldTransitionTriggerContext.Provider>
  );
}
