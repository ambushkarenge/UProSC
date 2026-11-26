import { useCallback, useEffect, useRef, useState } from 'react';

export type WakeLockStatus = 'unsupported' | 'active' | 'inactive' | 'error';

function isWakeLockSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'wakeLock' in navigator &&
    typeof navigator.wakeLock?.request === 'function'
  );
}

/**
 * Acquires and maintains the Screen Wake Lock API while `enabled` is true,
 * automatically re-acquiring on `visibilitychange` when returning to the tab.
 * Falls back cleanly to `'unsupported'` on browsers without Wake Lock (e.g., older iOS Safari).
 */
export function useWakeLock(enabled: boolean) {
  const supported = isWakeLockSupported();
  const [status, setStatus] = useState<WakeLockStatus>(
    supported ? 'inactive' : 'unsupported',
  );
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const releaseWakeLock = useCallback(async () => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    if (sentinel && !sentinel.released) {
      try {
        await sentinel.release();
      } catch {
        // Ignore errors releasing an already-revoked sentinel
      }
    }
    if (isWakeLockSupported()) {
      setStatus('inactive');
    } else {
      setStatus('unsupported');
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (!isWakeLockSupported()) {
      setStatus('unsupported');
      return false;
    }

    if (sentinelRef.current && !sentinelRef.current.released) {
      setStatus('active');
      return true;
    }

    try {
      const sentinel = await navigator.wakeLock.request('screen');
      if (!enabledRef.current) {
        await sentinel.release().catch(() => {});
        setStatus('inactive');
        return false;
      }

      sentinelRef.current = sentinel;
      setStatus('active');

      const handleRelease = () => {
        if (sentinelRef.current === sentinel) {
          sentinelRef.current = null;
          if (enabledRef.current && document.visibilityState === 'visible') {
            setStatus('inactive');
          } else if (!enabledRef.current) {
            setStatus('inactive');
          }
        }
      };

      sentinel.addEventListener?.('release', handleRelease);
      return true;
    } catch {
      setStatus('error');
      return false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      void releaseWakeLock();
      return;
    }

    void requestWakeLock();

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        enabledRef.current &&
        (!sentinelRef.current || sentinelRef.current.released)
      ) {
        void requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      void releaseWakeLock();
    };
  }, [enabled, releaseWakeLock, requestWakeLock]);

  return {
    status,
    isSupported: supported,
    isActive: status === 'active',
    requestWakeLock,
    releaseWakeLock,
  };
}
