import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { DEFAULT_LOCAL_USER_ID } from '../store/idbStorage';
import { useAppStore } from '../store/useAppStore';
import { syncEngine } from '../sync/syncEngine';
import { getLogicalStudyDate } from '../utils/date';

interface PlatformProfile {
  name: string;
  os: 'macOS' | 'Windows' | 'iOS' | 'Android';
  orientation: 'portrait' | 'landscape';
  width: number;
  height: number;
  platform: string;
  userAgent: string;
}

const PLATFORM_PROFILES: readonly PlatformProfile[] = [
  {
    name: 'macOS Portrait (Split / Vertical Display)',
    os: 'macOS',
    orientation: 'portrait',
    width: 900,
    height: 1440,
    platform: 'MacIntel',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15',
  },
  {
    name: 'macOS Landscape (Desktop)',
    os: 'macOS',
    orientation: 'landscape',
    width: 1440,
    height: 900,
    platform: 'MacIntel',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15',
  },
  {
    name: 'Windows Portrait (Tablet / Vertical Monitor)',
    os: 'Windows',
    orientation: 'portrait',
    width: 768,
    height: 1280,
    platform: 'Win32',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
  },
  {
    name: 'Windows Landscape (Laptop / Desktop)',
    os: 'Windows',
    orientation: 'landscape',
    width: 1366,
    height: 768,
    platform: 'Win32',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
  },
  {
    name: 'iOS Portrait (iPhone)',
    os: 'iOS',
    orientation: 'portrait',
    width: 390,
    height: 844,
    platform: 'iPhone',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  },
  {
    name: 'iOS Landscape (iPhone)',
    os: 'iOS',
    orientation: 'landscape',
    width: 844,
    height: 390,
    platform: 'iPhone',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  },
  {
    name: 'Android Portrait (Phone)',
    os: 'Android',
    orientation: 'portrait',
    width: 360,
    height: 800,
    platform: 'Linux armv8l',
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36',
  },
  {
    name: 'Android Landscape (Phone)',
    os: 'Android',
    orientation: 'landscape',
    width: 800,
    height: 360,
    platform: 'Linux armv8l',
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36',
  },
];

const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;
const originalMatchMedia = window.matchMedia;
const originalUserAgentDescriptor = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  'userAgent',
);
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  'platform',
);

function evaluateMediaQuery(
  query: string,
  width: number,
  height: number,
  colorScheme: 'light' | 'dark',
): boolean {
  const normalized = query.toLowerCase();
  if (normalized.includes('orientation: portrait')) {
    return height >= width;
  }
  if (normalized.includes('orientation: landscape')) {
    const landscapeMatches = width > height;
    const maxHeightMatch = normalized.match(/max-height:\s*(\d+)px/);
    if (maxHeightMatch) {
      return landscapeMatches && height <= Number(maxHeightMatch[1]);
    }
    return landscapeMatches;
  }
  if (normalized.includes('prefers-color-scheme: dark')) {
    return colorScheme === 'dark';
  }
  if (normalized.includes('prefers-color-scheme: light')) {
    return colorScheme === 'light';
  }
  const minWidthMatch = normalized.match(/min-width:\s*(\d+)px/);
  if (minWidthMatch) {
    return width >= Number(minWidthMatch[1]);
  }
  return false;
}

function applyEnvironment(
  profile: PlatformProfile,
  colorScheme: 'light' | 'dark' = 'light',
) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: profile.width,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: profile.height,
  });
  Object.defineProperty(Navigator.prototype, 'userAgent', {
    configurable: true,
    get: () => profile.userAgent,
  });
  Object.defineProperty(Navigator.prototype, 'platform', {
    configurable: true,
    get: () => profile.platform,
  });
  window.matchMedia = (query: string) =>
    ({
      matches: evaluateMediaQuery(
        query,
        profile.width,
        profile.height,
        colorScheme,
      ),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 26, 14, 0, 0));
  syncEngine.resetInternalStateForTests();
  localStorage.clear();
  useAppStore.getState().resetAllData();
});

afterEach(() => {
  syncEngine.resetInternalStateForTests();
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: originalInnerWidth,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: originalInnerHeight,
  });
  window.matchMedia = originalMatchMedia;
  if (originalUserAgentDescriptor) {
    Object.defineProperty(
      Navigator.prototype,
      'userAgent',
      originalUserAgentDescriptor,
    );
  }
  if (originalPlatformDescriptor) {
    Object.defineProperty(
      Navigator.prototype,
      'platform',
      originalPlatformDescriptor,
    );
  }
});

describe('Cross-Platform Portrait & Landscape Layout Matrix', () => {
  describe.each(PLATFORM_PROFILES)('$name ($width x $height)', (profile) => {
    it('renders strict 3-tab shell, safe-area guards, and landscape compact rules in light & dark themes', async () => {
      for (const scheme of ['light', 'dark'] as const) {
        useAppStore.getState().resetAllData();
        applyEnvironment(profile, scheme);
        expect(
          window.matchMedia(`(orientation: ${profile.orientation})`).matches,
        ).toBe(true);
        expect(
          window.matchMedia(`(prefers-color-scheme: ${scheme})`).matches,
        ).toBe(true);

        const { unmount } = render(<App />);

        // Strict 3-tab navigation & header presence
        const tabs = screen.getAllByRole('tab');
        expect(tabs.map((t) => t.textContent)).toEqual([
          'Timer',
          'To-Do',
          'Habits',
        ]);
        expect(
          screen.getByLabelText('Daily activity rings summary'),
        ).toBeInTheDocument();

        // Safe-area inset & landscape layout guards on shell landmarks
        const header = document.querySelector('header');
        const nav = screen.getByRole('navigation', {
          name: 'Primary navigation',
        });
        const main = screen.getByRole('main');

        expect(header?.className).toContain('env(safe-area-inset-top)');
        expect(header?.firstElementChild?.className).toContain(
          'env(safe-area-inset-left)',
        );
        expect(header?.firstElementChild?.className).toContain(
          'env(safe-area-inset-right)',
        );
        expect(nav.className).toContain('env(safe-area-inset-bottom)');
        expect(nav.className).toContain('env(safe-area-inset-left)');
        expect(nav.className).toContain('env(safe-area-inset-right)');
        expect(main.className).toContain('orientation:landscape');

        // Phase 3: Focus Timer, Subject quick-add, Full-Screen Clock & Landscape safe-area checks
        expect(
          screen.getByRole('heading', {
            name: 'Focus Timer & Study Analytics',
          }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole('heading', { name: 'Subjects' }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole('heading', { name: 'D-Day Study Goal' }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole('heading', { name: 'Focus Analytics' }),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '+ Coding' }));
        fireEvent.click(screen.getByRole('button', { name: 'Start Focus' }));
        expect(screen.getByTestId('timer-status-pill')).toHaveTextContent(
          'Focusing',
        );

        fireEvent.click(
          screen.getByRole('button', { name: 'Open full-screen focus clock' }),
        );
        const fsDialog = screen.getByRole('dialog', {
          name: 'Full-screen focus clock',
        });
        expect(fsDialog.className).toContain('inset-0');
        expect(fsDialog.className).toContain('env(safe-area-inset-top)');
        expect(fsDialog.className).toContain('env(safe-area-inset-bottom)');
        expect(fsDialog.className).toContain('env(safe-area-inset-left)');
        expect(fsDialog.className).toContain('env(safe-area-inset-right)');
        expect(fsDialog.innerHTML).toContain('orientation:landscape');

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(
          screen.queryByRole('dialog', { name: 'Full-screen focus clock' }),
        ).not.toBeInTheDocument();

        act(() => {
          vi.advanceTimersByTime(60000);
        });
        fireEvent.click(screen.getByRole('button', { name: 'Finish & Save' }));
        expect(useAppStore.getState().sessions).toHaveLength(1);

        // Interactive tab switching works across all 3 tabs
        fireEvent.click(screen.getByRole('tab', { name: 'To-Do' }));
        expect(screen.getByRole('tab', { name: 'To-Do' })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        expect(
          screen.getByRole('heading', {
            name: 'Daily Tasks, Multi-Day Split & Calendar',
          }),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', { name: 'Habits' }));
        expect(
          screen.getByRole('heading', {
            name: 'Daily Habits, Streaks & 5-Step Heatmap',
          }),
        ).toBeInTheDocument();

        // Launcher popover stays viewport-bounded on narrow portrait & short landscape
        fireEvent.click(
          screen.getByRole('button', { name: 'Open app launcher' }),
        );
        const dialog = screen.getByRole('dialog', {
          name: 'Sub-App Launcher preview',
        });
        expect(dialog.className).toContain('max-w-[calc(100vw-2rem)]');
        expect(dialog.className).toContain('max-h-[calc(100dvh-4.5rem)]');

        // Phase 2: Interactive 3-Ring Header live updates & breakdown popover across portrait & landscape
        const ringsButton = screen.getByRole('button', {
          name: 'Daily activity rings summary',
        });

        act(() => {
          useAppStore.getState().resetAllData();
        });
        expect(
          screen.getByTestId('productivity-score-value'),
        ).toHaveTextContent('0');

        act(() => {
          const today = getLogicalStudyDate(Date.now());
          const now = Date.now();
          useAppStore
            .getState()
            .logStudySession('focus-test', now - 60 * 60 * 1000, now);
          const task = useAppStore.getState().addTask({
            title: 'Cross-platform task',
            logicalDate: today,
            priority: 'high',
          });
          useAppStore.getState().toggleTask(task.id);
        });

        // 50% Focus (22.5) + 100% To-Do (35) + 0% Habits (0) = 58
        expect(
          screen.getByTestId('productivity-score-value'),
        ).toHaveTextContent('58');

        fireEvent.click(ringsButton);
        const ringsDialog = screen.getByRole('dialog', {
          name: 'Daily activity rings breakdown',
        });
        expect(ringsDialog.className).toContain('max-w-[calc(100vw-2rem)]');
        expect(ringsDialog.className).toContain('max-h-[calc(100dvh-4.5rem)]');
        expect(ringsDialog.className).toContain('overflow-y-auto');

        // Updating goal inside popover recalculates score live
        fireEvent.click(screen.getByRole('button', { name: '1h' }));
        // 100% Focus (45) + 100% To-Do (35) = 80
        expect(
          screen.getByTestId('productivity-score-value'),
        ).toHaveTextContent('80');

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(ringsButton).toHaveAttribute('aria-expanded', 'false');

        // Phase 3B: Header Account/Sync Pill, viewport-bounded modal & isolated user switching
        vi.useRealTimers();
        const accountButton = screen.getByTestId('account-sync-pill');
        expect(accountButton).toBeInTheDocument();
        fireEvent.click(accountButton);

        const accountDialog = screen.getByRole('dialog', {
          name: 'Accounts and cloud sync',
        });
        expect(accountDialog.className).toContain('max-h-[calc(100dvh-2rem)]');
        expect(accountDialog.className).toContain('overflow-y-auto');

        fireEvent.change(screen.getByLabelText('Local Profile Name'), {
          target: { value: 'Study Buddy' },
        });
        fireEvent.click(
          screen.getByRole('button', { name: 'Create Isolated Local Profile' }),
        );
        await waitFor(() => {
          expect(useAppStore.getState().activeUserId).not.toBe(
            DEFAULT_LOCAL_USER_ID,
          );
        });
        // New user profile starts clean without leaking User 1's tasks or sessions
        expect(useAppStore.getState().sessions).toHaveLength(0);
        expect(useAppStore.getState().tasks).toHaveLength(0);

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(
          screen.queryByRole('dialog', { name: 'Accounts and cloud sync' }),
        ).not.toBeInTheDocument();

        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 10, 26, 14, 0, 0));
        localStorage.clear();
        syncEngine.resetInternalStateForTests();
        useAppStore.getState().resetAllData();

        unmount();
      }
    });
  });
});
