"use client";
import { useState, useEffect, useRef, useCallback } from 'react';
import { API_URL } from '@/utils/api';

interface NetworkStatus {
  isSlow: boolean;
  isOffline: boolean;
  latency: number | null;        // ms round-trip to API
  effectiveType: string | null;  // '4g' | '3g' | '2g' | 'slow-2g' | null
  downlink: number | null;       // Mbps estimate
  dismiss: () => void;           // Manual dismiss — auto-recovers anyway
}

const LATENCY_THRESHOLD_MS = 3000;   // API round-trip > 3s = slow
const PING_INTERVAL_NORMAL = 30000;  // Check every 30s when OK
const PING_INTERVAL_SLOW = 15000;    // Check every 15s when slow (to detect recovery)
const LATENCY_SAMPLES = 3;          // Average over 3 pings for stability
const RECOVERY_STREAK = 2;          // Need 2 consecutive fast pings to dismiss

export function useNetworkStatus(): NetworkStatus {
  const [isSlow, setIsSlow] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [effectiveType, setEffectiveType] = useState<string | null>(null);
  const [downlink, setDownlink] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const latencyHistory = useRef<number[]>([]);
  const recoveryCount = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Measure actual round-trip latency to our API health endpoint
  const measureLatency = useCallback(async (): Promise<number> => {
    const start = performance.now();
    try {
      // Use a lightweight endpoint with cache-busting
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000); // 8s hard timeout

      await fetch(`${API_URL}/api/health?_t=${Date.now()}`, {
        method: 'HEAD',
        cache: 'no-store',
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const elapsed = Math.round(performance.now() - start);
      return elapsed;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return 8000; // Timed out = very slow
      }
      // Network error — could be offline
      return -1; // Signal offline
    }
  }, []);

  // Run a latency probe cycle
  const runProbe = useCallback(async () => {
    if (!mountedRef.current) return;

    // Check browser online status first
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (mountedRef.current) {
        setIsOffline(true);
        setIsSlow(true);
        setDismissed(false); // Reset dismiss on offline
      }
      return;
    }

    const ping = await measureLatency();

    if (!mountedRef.current) return;

    if (ping === -1) {
      // Network error — likely offline
      setIsOffline(true);
      setIsSlow(true);
      setDismissed(false);
      recoveryCount.current = 0;
      return;
    }

    setIsOffline(false);
    setLatency(ping);

    // Rolling average for stability
    latencyHistory.current.push(ping);
    if (latencyHistory.current.length > LATENCY_SAMPLES) {
      latencyHistory.current.shift();
    }
    const avgLatency = latencyHistory.current.reduce((a, b) => a + b, 0) / latencyHistory.current.length;

    // Check Network Information API if available
    let connectionSlow = false;
    if (typeof navigator !== 'undefined' && (navigator as any).connection) {
      const conn = (navigator as any).connection;
      const et = conn.effectiveType;
      setEffectiveType(et);
      setDownlink(conn.downlink ?? null);
      if (et === '2g' || et === 'slow-2g' || (et === '3g' && (conn.downlink ?? 10) < 1)) {
        connectionSlow = true;
      }
    }

    const latencySlow = avgLatency > LATENCY_THRESHOLD_MS;
    const networkIsSlow = latencySlow || connectionSlow;

    if (networkIsSlow) {
      recoveryCount.current = 0;
      if (mountedRef.current) {
        setIsSlow(true);
        setDismissed(false); // New slow detection resets any dismiss
      }
    } else {
      recoveryCount.current++;
      // Require consecutive fast readings to recover (prevents flapping)
      if (recoveryCount.current >= RECOVERY_STREAK) {
        if (mountedRef.current) {
          setIsSlow(false);
          setDismissed(false);
        }
      }
    }
  }, [measureLatency]);

  // Start periodic monitoring
  useEffect(() => {
    mountedRef.current = true;

    // Initial probe after short delay (let page load first)
    const initialTimeout = setTimeout(() => {
      runProbe();
    }, 2000);

    // Set up periodic probing with adaptive interval
    const startInterval = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      const interval = isSlow ? PING_INTERVAL_SLOW : PING_INTERVAL_NORMAL;
      intervalRef.current = setInterval(runProbe, interval);
    };
    // Start after initial probe
    const intervalStart = setTimeout(startInterval, 3000);

    // Listen for online/offline events
    const handleOnline = () => {
      if (mountedRef.current) {
        setIsOffline(false);
        // Immediately probe when coming back online
        runProbe();
      }
    };
    const handleOffline = () => {
      if (mountedRef.current) {
        setIsOffline(true);
        setIsSlow(true);
        setDismissed(false);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Listen for Network Info API changes
    if (typeof navigator !== 'undefined' && (navigator as any).connection) {
      const conn = (navigator as any).connection;
      const handleChange = () => {
        const et = conn.effectiveType;
        if (mountedRef.current) {
          setEffectiveType(et);
          setDownlink(conn.downlink ?? null);
        }
        // Trigger immediate probe on connection change
        runProbe();
      };
      conn.addEventListener('change', handleChange);
    }

    return () => {
      mountedRef.current = false;
      clearTimeout(initialTimeout);
      clearTimeout(intervalStart);
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [runProbe, isSlow]);

  // Adaptive interval — reconfigure when slow/fast state changes
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const interval = isSlow ? PING_INTERVAL_SLOW : PING_INTERVAL_NORMAL;
    intervalRef.current = setInterval(runProbe, interval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isSlow, runProbe]);

  const dismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  return {
    isSlow: isSlow && !dismissed,
    isOffline,
    latency,
    effectiveType,
    downlink,
    dismiss,
  };
}
