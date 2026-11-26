import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { formatClockSeconds, useTimestampTimer } from '../useTimestampTimer';

describe('useTimestampTimer — wall-clock timing, pause/resume, 5:00 AM split & countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    useAppStore.getState().resetAllData();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('formats MM:SS and H:MM:SS cleanly', () => {
    expect(formatClockSeconds(0)).toBe('00:00');
    expect(formatClockSeconds(125)).toBe('02:05');
    expect(formatClockSeconds(3665)).toBe('1:01:05');
  });

  it('tracks exact wall-clock deltas across pause/resume and splits across 5:00 AM on finish', () => {
    // Start at 4:45 AM (logical date 2026-11-25)
    vi.setSystemTime(new Date(2026, 10, 26, 4, 45, 0));
    const { result } = renderHook(() => useTimestampTimer());

    act(() => {
      result.current.start({ subjectId: 'math', mode: 'stopwatch' });
    });
    expect(result.current.activeTimer.status).toBe('running');

    // Study 10 minutes until 4:55 AM, then pause for a 10-minute break
    act(() => {
      vi.setSystemTime(new Date(2026, 10, 26, 4, 55, 0));
      result.current.pause();
    });
    expect(result.current.activeTimer.status).toBe('paused');
    expect(result.current.displaySeconds).toBe(600);

    // Resume at 5:05 AM and study 15 minutes until 5:20 AM, then save
    act(() => {
      vi.setSystemTime(new Date(2026, 10, 26, 5, 5, 0));
      result.current.resume();
    });

    let saveResult:
      | ReturnType<typeof result.current.finishAndSave>
      | undefined;
    act(() => {
      vi.setSystemTime(new Date(2026, 10, 26, 5, 20, 0));
      saveResult = result.current.finishAndSave();
    });

    expect(saveResult?.totalLoggedSeconds).toBe(1500); // 10m + 15m = 25m (break excluded!)
    const sessions = useAppStore.getState().sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => [s.logicalDate, s.durationSeconds])).toEqual([
      ['2026-11-25', 600],
      ['2026-11-26', 900],
    ]);
    expect(result.current.activeTimer.status).toBe('idle');
  });

  it('auto-completes countdown timer cleanly without logging overrun when waking after target', () => {
    vi.setSystemTime(new Date(2026, 10, 26, 10, 0, 0));
    const { result } = renderHook(() => useTimestampTimer());

    act(() => {
      result.current.start({
        subjectId: 'cs',
        mode: 'countdown',
        countdownMinutes: 25,
      });
    });

    expect(result.current.displaySeconds).toBe(1500);

    // Jump 2 hours forward (simulating background tab/device sleep)
    act(() => {
      vi.setSystemTime(new Date(2026, 10, 26, 12, 0, 0));
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(250);
    });

    const sessions = useAppStore.getState().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].durationSeconds).toBe(1500); // Exact 25m, not 2h!
    expect(result.current.activeTimer.status).toBe('idle');
    expect(result.current.completionNotice?.kind).toBe('countdown');
    expect(result.current.completionNotice?.durationSeconds).toBe(1500);
  });
});
