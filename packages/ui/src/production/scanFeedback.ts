/**
 * Shop-floor scan feedback tones (F089 / #240).
 * WebAudio only — no audio assets; no-ops where AudioContext is unavailable
 * (jsdom, old browsers, muted tablets).
 */

export type ScanFeedbackKind = 'hit' | 'advance' | 'miss';

type AudioContextCtor = typeof AudioContext;

let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (sharedCtx) return sharedCtx;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    sharedCtx = new Ctor();
  } catch {
    return null;
  }
  return sharedCtx;
}

function tone(
  ctx: AudioContext,
  freq: number,
  startAt: number,
  durationMs: number,
  volume: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, startAt);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + durationMs / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationMs / 1000);
}

/** Short ok/miss/advance beep for scanner feedback. Never throws. */
export function playScanFeedback(kind: ScanFeedbackKind): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    if (kind === 'hit') {
      tone(ctx, 880, t, 90, 0.08);
    } else if (kind === 'advance') {
      tone(ctx, 660, t, 70, 0.08);
      tone(ctx, 990, t + 0.09, 110, 0.08);
    } else {
      tone(ctx, 220, t, 180, 0.09);
    }
  } catch {
    /* audio is best-effort feedback */
  }
}
