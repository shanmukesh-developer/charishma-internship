"use client";
import { motion, AnimatePresence } from 'framer-motion';
import { useWorldTransition, WORLD_THEMES } from '@/context/WorldTransitionContext';

export default function WorldTransitionOverlay() {
  const { isTransitioning, targetWorld, phase } = useWorldTransition();
  const theme = targetWorld ? WORLD_THEMES[targetWorld] : null;

  return (
    <AnimatePresence>
      {isTransitioning && theme && (
        <motion.div
          key="world-transition-overlay"
          className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-auto"
          initial={{ clipPath: 'circle(0% at 50% 50%)' }}
          animate={
            phase === 'covering'
              ? { clipPath: 'circle(150% at 50% 50%)' }
              : phase === 'uncovering'
              ? { clipPath: 'circle(0% at 50% 50%)' }
              : {}
          }
          exit={{ clipPath: 'circle(0% at 50% 50%)' }}
          transition={{
            duration: phase === 'covering' ? 0.6 : 0.5,
            ease: [0.76, 0, 0.24, 1],
          }}
          style={{ background: theme.gradient }}
        >
          {/* Inner content: world label */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: phase === 'covering' ? 1 : 0, scale: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.4, ease: 'easeOut' }}
            className="text-center"
          >
            <div className="text-[10px] font-black uppercase tracking-[0.5em] text-white/60 mb-3">
              Entering
            </div>
            <div
              className="text-3xl md:text-5xl font-black text-white uppercase tracking-tighter italic"
              style={{ fontFamily: "'Syne', sans-serif" }}
            >
              {theme.label}
            </div>
            <div className="mt-4 flex justify-center">
              <div className="w-8 h-8 border-3 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
          </motion.div>

          {/* Decorative particles */}
          {[...Array(6)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute rounded-full bg-white/10"
              style={{
                width: 8 + i * 6,
                height: 8 + i * 6,
                left: `${15 + i * 14}%`,
                top: `${20 + (i % 3) * 25}%`,
              }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: [0, 1.5, 0], opacity: [0, 0.4, 0] }}
              transition={{
                duration: 1.2,
                delay: 0.1 + i * 0.08,
                ease: 'easeOut',
              }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
