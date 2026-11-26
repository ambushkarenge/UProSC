import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import { getLogicalStudyDate } from '../../../utils/date';
import { AppHeader } from '../AppHeader';

describe('AppHeader — Interactive 3-Ring Header & SVG Geometry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 26, 14, 0, 0));
    localStorage.clear();
    useAppStore.getState().resetAllData();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders 0% rings and 0/100 score initially under the zero-item rule', () => {
    render(<AppHeader />);

    expect(screen.getByTestId('productivity-score-value')).toHaveTextContent(
      '0',
    );
    expect(
      screen.getByRole('img', {
        name: 'Activity rings: Focus 0%, To-Do 0%, Habits 0%',
      }),
    ).toBeInTheDocument();

    const focusArc = screen.getByTestId('ring-progress-focus');
    const circumference = Number(focusArc.getAttribute('stroke-dasharray'));
    const offset = Number(focusArc.getAttribute('stroke-dashoffset'));
    expect(circumference).toBeCloseTo(2 * Math.PI * 17, 2);
    expect(offset).toBeCloseTo(circumference, 2);
  });

  it('updates SVG stroke-dashoffset and score live when store sessions, tasks, and habits change', () => {
    const today = getLogicalStudyDate(Date.now());
    render(<AppHeader />);

    act(() => {
      const store = useAppStore.getState();
      // 60m logged out of 120m goal => 50% Focus (22.5 pts)
      const end = Date.now();
      const start = end - 60 * 60 * 1000;
      store.logStudySession('math', start, end);

      // 1 of 2 tasks done => 50% To-Do (17.5 pts)
      const t1 = store.addTask({
        title: 'Problem set',
        logicalDate: today,
        priority: 'high',
      });
      store.addTask({
        title: 'Reading',
        logicalDate: today,
        priority: 'medium',
      });
      store.toggleTask(t1.id);

      // 1 of 1 habits done => 100% Habits (20 pts)
      const h1 = store.addHabit({
        name: 'Review flashcards',
        icon: 'flame',
        color: '#0ea5e9',
      });
      store.toggleHabitDate(h1.id, today);
    });

    expect(screen.getByTestId('productivity-score-value')).toHaveTextContent(
      '60',
    );

    const focusArc = screen.getByTestId('ring-progress-focus');
    const focusCirc = Number(focusArc.getAttribute('stroke-dasharray'));
    const focusOffset = Number(focusArc.getAttribute('stroke-dashoffset'));
    expect(focusOffset).toBeCloseTo(focusCirc * 0.5, 2);

    const habitsArc = screen.getByTestId('ring-progress-habits');
    const habitsOffset = Number(habitsArc.getAttribute('stroke-dashoffset'));
    expect(habitsOffset).toBeCloseTo(0, 2);
  });

  it('opens breakdown popover on click, hover, and touch long-press and allows updating daily goal', () => {
    render(<AppHeader />);

    const summaryButton = screen.getByRole('button', {
      name: 'Daily activity rings summary',
    });
    expect(summaryButton).toHaveAttribute('aria-expanded', 'false');

    // Click toggles popover open and lets user update daily goal
    fireEvent.click(summaryButton);
    expect(summaryButton).toHaveAttribute('aria-expanded', 'true');
    const dialog = screen.getByRole('dialog', {
      name: 'Daily activity rings breakdown',
    });
    expect(dialog).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '4h' }));
    expect(useAppStore.getState().dailyStudyGoalMinutes).toBe(240);

    fireEvent.click(
      screen.getByRole('button', { name: 'Increase daily study goal' }),
    );
    expect(useAppStore.getState().dailyStudyGoalMinutes).toBe(255);

    // Escape dismisses popover
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(summaryButton).toHaveAttribute('aria-expanded', 'false');

    // Mouse hover opens preview and mouse leave closes after short delay
    fireEvent.mouseEnter(summaryButton);
    expect(summaryButton).toHaveAttribute('aria-expanded', 'true');
    fireEvent.mouseLeave(summaryButton);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(summaryButton).toHaveAttribute('aria-expanded', 'false');

    // Touch-hold long-press opens popover and stays open after finger lift
    fireEvent.pointerDown(summaryButton, { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(summaryButton).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerUp(summaryButton, { pointerType: 'touch' });
    fireEvent.click(summaryButton);
    expect(summaryButton).toHaveAttribute('aria-expanded', 'true');
  });
});
