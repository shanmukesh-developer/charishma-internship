"use client";
import { useEffect, useRef, useCallback } from 'react';

/**
 * Android-accurate scroll restoration hook.
 * 
 * Saves scroll position on every scroll (debounced), freezes the saved value
 * when the user taps a link/card (to prevent unmount reflow from resetting it),
 * and restores the exact position when returning to the page — even if the
 * dynamic content hasn't fully rendered yet (layout-aware retry loop).
 * 
 * @param key - unique sessionStorage key for this page (e.g. 'zenvy_home_scroll')
 * @param options.ready - set to true once the page content is loaded and ready
 * @param options.disabled - set to true to skip restoration (e.g. explicit "Home" click)
 */
export function useScrollRestoration(
  key: string,
  options: { ready: boolean; disabled?: boolean }
) {
  const { ready, disabled } = options;
  const frozenRef = useRef(false);
  const restoredRef = useRef(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Save scroll position (debounced) ──
  useEffect(() => {
    if (!ready) return;

    const saveScroll = () => {
      if (frozenRef.current) return;
      const y = window.scrollY;
      if (y > 0) {
        try {
          sessionStorage.setItem(key, y.toString());
        } catch { /* quota exceeded — ignore */ }
      }
    };

    // Debounced scroll handler — saves at most every 100ms
    const handleScroll = () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(saveScroll, 100);
    };

    // Freeze scroll saving when user clicks anything interactive
    // This prevents the unmount reflow (scroll → 0) from overwriting the saved position
    const handleInteraction = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      // Only freeze on navigating interactions (links, cards, buttons that route)
      const anchor = target.closest('a[href]');
      const clickableCard = target.closest('[data-navigate], [onclick]');
      
      if (anchor || clickableCard) {
        // Save current position immediately before freeze
        const y = window.scrollY;
        if (y > 0) {
          try {
            sessionStorage.setItem(key, y.toString());
          } catch {}
        }
        frozenRef.current = true;
        // Unfreeze after 2s if they didn't actually navigate away
        setTimeout(() => { frozenRef.current = false; }, 2000);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('click', handleInteraction, { capture: true });
    window.addEventListener('touchend', handleInteraction, { capture: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('click', handleInteraction, { capture: true });
      window.removeEventListener('touchend', handleInteraction, { capture: true });
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, [ready, key]);

  // ── Restore scroll position ──
  useEffect(() => {
    if (!ready || disabled || restoredRef.current) return;

    const saved = sessionStorage.getItem(key);
    if (!saved) return;

    const target = Number(saved);
    if (target <= 0 || isNaN(target)) return;

    restoredRef.current = true;

    // Layout-aware restoration loop:
    // The page may still be rendering dynamic content (restaurants, PG cards, etc.)
    // We retry scrolling until the document is tall enough to reach the target position,
    // or we've tried long enough (1.5s max).
    let attempts = 0;
    const maxAttempts = 30; // 30 × 50ms = 1.5s

    const restore = () => {
      const docHeight = document.documentElement.scrollHeight;
      const viewportHeight = window.innerHeight;

      // Can we reach the target? (document must be at least target + viewport tall)
      const canReach = docHeight >= target + viewportHeight * 0.5;

      if (canReach || attempts >= maxAttempts) {
        // Use 'instant' to avoid smooth scroll animation — Android doesn't animate on back
        window.scrollTo({ top: target, behavior: 'instant' as ScrollBehavior });
        clearInterval(interval);
      } else {
        // Try scrolling anyway — this helps trigger lazy-loaded content
        window.scrollTo({ top: Math.min(target, docHeight - viewportHeight), behavior: 'instant' as ScrollBehavior });
      }
      attempts++;
    };

    // Start immediately, then retry
    restore();
    const interval = setInterval(restore, 50);

    return () => clearInterval(interval);
  }, [ready, disabled, key]);

  // ── Clear saved position (call on explicit "Home" navigation) ──
  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(key);
    } catch {}
    restoredRef.current = false;
  }, [key]);

  return { clear };
}
