import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { useAppStore } from '../store/useAppStore';

beforeEach(() => {
  localStorage.clear();
  useAppStore.getState().resetAllData();
});

afterEach(() => {
  cleanup();
});

describe('UProSC Phase 1 App Shell', () => {
  it('renders strictly 3 primary navigation tabs plus the 3-ring header', () => {
    render(<App />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Timer',
      'To-Do',
      'Habits',
    ]);

    expect(
      screen.getByLabelText('Daily activity rings summary'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open app launcher' }),
    ).toBeInTheDocument();
  });

  it('switches cleanly between Timer, To-Do, and Habits workspaces', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Focus Timer & Study Analytics' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'To-Do' }));
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
  });

  it('toggles the 9-dot app launcher preview popover without affecting the active tab', () => {
    render(<App />);

    const launcherButton = screen.getByRole('button', {
      name: 'Open app launcher',
    });
    expect(launcherButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(launcherButton);
    expect(launcherButton).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('dialog', { name: 'Sub-App Launcher preview' }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(launcherButton).toHaveAttribute('aria-expanded', 'false');
  });
});
