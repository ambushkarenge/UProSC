import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWakeLock } from '../useWakeLock';

describe('useWakeLock — Screen Wake Lock API & visibility re-acquisition', () => {
  const originalWakeLockDescriptor = Object.getOwnPropertyDescriptor(
    Navigator.prototype,
    'wakeLock',
  );

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    if (originalWakeLockDescriptor) {
      Object.defineProperty(
        Navigator.prototype,
        'wakeLock',
        originalWakeLockDescriptor,
      );
    } else {
      // @ts-expect-error cleanup test property
      delete Navigator.prototype.wakeLock;
    }
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  it('reports unsupported cleanly when navigator.wakeLock is unavailable (e.g. older iOS Safari)', () => {
    // @ts-expect-error ensure absent
    delete Navigator.prototype.wakeLock;

    const { result } = renderHook(() => useWakeLock(true));
    expect(result.current.isSupported).toBe(false);
    expect(result.current.status).toBe('unsupported');
  });

  it('acquires wake lock when enabled, re-acquires on visibilitychange, and releases on disable', async () => {
    let released = false;
    const releaseMock = vi.fn(async () => {
      released = true;
    });
    const listeners: Record<string, Array<() => void>> = {};

    const createSentinel = () => {
      released = false;
      return {
        get released() {
          return released;
        },
        type: 'screen',
        release: releaseMock,
        addEventListener: (event: string, cb: () => void) => {
          listeners[event] = listeners[event] ?? [];
          listeners[event].push(cb);
        },
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onrelease: null,
      } as unknown as WakeLockSentinel;
    };

    const requestMock = vi.fn(async () => createSentinel());
    Object.defineProperty(Navigator.prototype, 'wakeLock', {
      configurable: true,
      value: { request: requestMock },
    });

    const { result, rerender } = renderHook(
      ({ enabled }) => useWakeLock(enabled),
      { initialProps: { enabled: true } },
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('active');

    // Simulate OS releasing wake lock while tab hidden, then returning to visible
    released = true;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('active');

    // Disabling releases the sentinel
    rerender({ enabled: false });
    await act(async () => {
      await Promise.resolve();
    });
    expect(releaseMock).toHaveBeenCalled();
    expect(result.current.status).toBe('inactive');
  });
});
