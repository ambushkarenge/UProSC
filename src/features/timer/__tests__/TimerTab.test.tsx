import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../App';
import { useAppStore } from '../../../store/useAppStore';
import { TimerTab } from '../TimerTab';

describe('TimerTab — Phase 3 Focus Timer, Subjects, D-Day, Analytics & Full-Screen', () => {
  const originalWakeLockDescriptor = Object.getOwnPropertyDescriptor(
    Navigator.prototype,
    'wakeLock',
  );

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 26, 14, 0, 0));
    localStorage.clear();
    useAppStore.getState().resetAllData();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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
  });

  it('supports subject CRUD (add, edit, archive, restore, delete)', () => {
    render(<TimerTab />);

    // Add custom subject
    fireEvent.click(screen.getByRole('button', { name: 'Add Subject' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Organic Chemistry'), {
      target: { value: 'Biology' },
    });
    fireEvent.change(screen.getByLabelText('Daily goal (min)'), {
      target: { value: '90' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Color Emerald' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Subject' }));

    expect(useAppStore.getState().subjects).toHaveLength(1);
    expect(useAppStore.getState().subjects[0].name).toBe('Biology');
    expect(useAppStore.getState().subjects[0].color).toBe('#10b981');

    // Edit subject
    fireEvent.click(screen.getByRole('button', { name: 'Edit Biology' }));
    const nameInput = screen.getByDisplayValue('Biology');
    fireEvent.change(nameInput, { target: { value: 'Cell Biology' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(useAppStore.getState().subjects[0].name).toBe('Cell Biology');

    // Archive and restore
    fireEvent.click(
      screen.getByRole('button', { name: 'Archive Cell Biology' }),
    );
    expect(useAppStore.getState().subjects[0].archived).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show Archived (1)' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Restore Cell Biology' }),
    );
    expect(useAppStore.getState().subjects[0].archived).toBe(false);

    // Delete
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete Cell Biology' }),
    );
    expect(useAppStore.getState().subjects).toHaveLength(0);
  });

  it('runs stopwatch, logs session on finish, and updates header Ring 1 + SVG analytics', () => {
    render(<App />);

    // Quick-add Mathematics subject
    fireEvent.click(screen.getByRole('button', { name: '+ Mathematics' }));
    const subjectId = useAppStore.getState().subjects[0].id;

    // Start stopwatch
    fireEvent.click(screen.getByRole('button', { name: 'Start Focus' }));
    expect(screen.getByTestId('timer-status-pill')).toHaveTextContent(
      'Focusing',
    );

    // Advance 30 minutes via wall clock
    act(() => {
      vi.setSystemTime(new Date(2026, 10, 26, 14, 29, 59));
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('timer-clock-readout')).toHaveTextContent(
      '30:00',
    );

    // Header Ring 1 reflects live 30m / 2h = 25% => score 11
    expect(
      screen.getByTestId('productivity-score-value'),
    ).toHaveTextContent('11');

    // Finish & Save commits session and populates Donut + Timeline
    fireEvent.click(screen.getByRole('button', { name: 'Finish & Save' }));
    expect(useAppStore.getState().sessions).toHaveLength(1);
    expect(screen.getByTestId(`donut-slice-${subjectId}`)).toBeInTheDocument();
    expect(
      screen.getByTestId(`timeline-block-${useAppStore.getState().sessions[0].id}`),
    ).toBeInTheDocument();
  });

  it('runs countdown presets and opens full-screen clock with Wake Lock status', async () => {
    const releaseMock = vi.fn(async () => {});
    const requestMock = vi.fn(
      async () =>
        ({
          released: false,
          type: 'screen',
          release: releaseMock,
          addEventListener: vi.fn(),
        }) as unknown as WakeLockSentinel,
    );
    Object.defineProperty(Navigator.prototype, 'wakeLock', {
      configurable: true,
      value: { request: requestMock },
    });

    render(<TimerTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Countdown' }));
    fireEvent.click(screen.getByRole('button', { name: '50m' }));
    expect(screen.getByTestId('timer-clock-readout')).toHaveTextContent(
      '50:00',
    );

    // Open full-screen clock
    fireEvent.click(
      screen.getByRole('button', { name: 'Open full-screen focus clock' }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    const dialog = screen.getByRole('dialog', {
      name: 'Full-screen focus clock',
    });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId('wakelock-status-badge')).toHaveTextContent(
      'Screen Awake',
    );
    expect(screen.getByTestId('fullscreen-clock-readout')).toHaveTextContent(
      '50:00',
    );

    // Escape closes full-screen clock and releases Wake Lock
    fireEvent.keyDown(window, { key: 'Escape' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.queryByRole('dialog', { name: 'Full-screen focus clock' }),
    ).not.toBeInTheDocument();
    expect(releaseMock).toHaveBeenCalled();
  });

  it('tracks D-Day countdown + hours and shows behavioral streak-at-risk sprint CTA', () => {
    // Seed a session yesterday so today has a 1-day streak at risk
    const yStart = new Date(2026, 10, 25, 19, 0, 0).getTime();
    useAppStore
      .getState()
      .logStudySession('general', yStart, yStart + 3600 * 1000); // 1h yesterday

    render(<TimerTab />);

    // Behavioral companion warns streak is at risk & allows 1-tap quick sprint
    expect(
      screen.getByText(/Protect Your 1-Day Streak|1-Day Streak At Risk/),
    ).toBeInTheDocument();

    // Configure D-Day goal 10 days ahead for 21h total (1h already logged => 20h left => 2.0h/day)
    fireEvent.click(screen.getByRole('button', { name: 'Set D-Day Goal' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. Finals Week'), {
      target: { value: 'Gate Exam' },
    });
    fireEvent.change(screen.getByLabelText('Target Date'), {
      target: { value: '2026-12-06' },
    });
    fireEvent.change(screen.getByLabelText('Target Study Hours'), {
      target: { value: '21' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save D-Day' }));

    expect(screen.getByTestId('dday-badge')).toHaveTextContent('D-10');
    expect(screen.getByText('Need 2.0h/day')).toBeInTheDocument();

    // Quick sprint button starts countdown immediately
    fireEvent.click(screen.getByRole('button', { name: /Start 25m Sprint/ }));
    expect(screen.getByTestId('timer-status-pill')).toHaveTextContent(
      'Focusing',
    );
  });
});
