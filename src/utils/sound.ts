type AudioContextConstructor = typeof AudioContext;

interface ChimeNote {
  frequency: number;
  delaySeconds: number;
  durationSeconds: number;
  gain: number;
}

const CHIME_PATTERNS: Record<'complete' | 'celebrate', readonly ChimeNote[]> = {
  complete: [
    { frequency: 523.25, delaySeconds: 0, durationSeconds: 0.28, gain: 0.14 },
    { frequency: 659.25, delaySeconds: 0.12, durationSeconds: 0.32, gain: 0.14 },
    { frequency: 783.99, delaySeconds: 0.24, durationSeconds: 0.45, gain: 0.16 },
  ],
  celebrate: [
    { frequency: 523.25, delaySeconds: 0, durationSeconds: 0.22, gain: 0.13 },
    { frequency: 659.25, delaySeconds: 0.09, durationSeconds: 0.24, gain: 0.13 },
    { frequency: 783.99, delaySeconds: 0.18, durationSeconds: 0.28, gain: 0.14 },
    { frequency: 1046.5, delaySeconds: 0.28, durationSeconds: 0.55, gain: 0.16 },
  ],
};

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const win = window as Window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  return window.AudioContext ?? win.webkitAudioContext ?? null;
}

let sharedAudioContext: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
  const Ctor = getAudioContextConstructor();
  if (!Ctor) return null;

  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new Ctor();
  }
  return sharedAudioContext;
}

/**
 * Synthesizes a soft offline Web Audio chime without external audio assets.
 * Gracefully no-ops in environments where Web Audio is unavailable or blocked.
 */
export function playChime(variant: 'complete' | 'celebrate' = 'complete'): boolean {
  const ctx = getSharedAudioContext();
  if (!ctx) return false;

  try {
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const baseTime = ctx.currentTime;
    const notes = CHIME_PATTERNS[variant];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(note.frequency, baseTime + note.delaySeconds);

      gainNode.gain.setValueAtTime(0.0001, baseTime + note.delaySeconds);
      gainNode.gain.exponentialRampToValueAtTime(
        note.gain,
        baseTime + note.delaySeconds + 0.02,
      );
      gainNode.gain.exponentialRampToValueAtTime(
        0.0001,
        baseTime + note.delaySeconds + note.durationSeconds,
      );

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(baseTime + note.delaySeconds);
      osc.stop(baseTime + note.delaySeconds + note.durationSeconds + 0.02);
    }

    return true;
  } catch {
    return false;
  }
}
