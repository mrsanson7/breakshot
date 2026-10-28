import type { ShotEvent } from '@breakshot/shared';

/**
 * Synthesised sound effects (Web Audio API, no assets). Volumes scale with impact speed.
 * The AudioContext is created lazily on the first user gesture (browser autoplay policy).
 */
class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastAt = 0;
  private burst = 0;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('breakshot.muted') === '1';
    } catch {
      // storage unavailable: keep default
    }
    const unlock = () => {
      this.ensure();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem('breakshot.muted', m ? '1' : '0');
    } catch {
      // ignore
    }
  }

  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    const len = Math.floor(this.ctx.sampleRate * 0.25);
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return this.ctx;
  }

  /** Skip sounds when dozens of collisions land in the same few milliseconds (break shots). */
  private allow(): boolean {
    if (this.muted) return false;
    const c = this.ensure();
    if (!c) return false;
    const now = c.currentTime;
    if (now - this.lastAt < 0.012) {
      if (++this.burst > 3) return false;
    } else this.burst = 0;
    this.lastAt = now;
    return true;
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', bend = 1): void {
    const c = this.ctx!;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * bend), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private click(vol: number, freq: number, dur: number): void {
    const c = this.ctx!;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 2.5;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  cue(power: number): void {
    if (!this.allow()) return;
    this.click(0.25 + power * 0.6, 1800, 0.05);
    this.tone(220, 0.06, 0.15 + power * 0.2, 'triangle', 0.6);
  }

  event(e: ShotEvent): void {
    if (e.type === 'ballBall') {
      const v = Math.min(1, e.speed / 4);
      if (v < 0.02 || !this.allow()) return;
      this.click(0.15 + v * 0.85, 3200, 0.04);
      this.tone(1900, 0.03, 0.08 + v * 0.25, 'sine', 0.9);
    } else if (e.type === 'cushion') {
      const v = Math.min(1, e.speed / 4);
      if (v < 0.03 || !this.allow()) return;
      this.tone(120, 0.12, 0.1 + v * 0.45, 'sine', 0.55);
      this.click(0.05 + v * 0.2, 600, 0.06);
    } else if (e.type === 'pocket') {
      if (!this.allow()) return;
      this.tone(180, 0.25, 0.45, 'sine', 0.4);
      this.click(0.3, 400, 0.18);
    }
  }

  score(big = false): void {
    if (!this.allow()) return;
    this.tone(660, 0.12, 0.18, 'triangle');
    window.setTimeout(() => this.ctx && !this.muted && this.tone(big ? 1320 : 990, 0.18, 0.18, 'triangle'), 90);
  }

  foul(): void {
    if (!this.allow()) return;
    this.tone(200, 0.3, 0.2, 'sawtooth', 0.7);
  }

  win(): void {
    if (!this.allow()) return;
    [523, 659, 784, 1047].forEach((f, i) => window.setTimeout(() => this.ctx && !this.muted && this.tone(f, 0.25, 0.18, 'triangle'), i * 120));
  }

  tick(): void {
    if (!this.allow()) return;
    this.tone(1000, 0.05, 0.08, 'square');
  }
}

export const sound = new Sound();
