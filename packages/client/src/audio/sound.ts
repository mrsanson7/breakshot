import type { ShotEvent } from '@breakshot/shared';
import { MUSIC } from '../config';

const midiHz = (n: number) => 440 * 2 ** ((n - 69) / 12);

/** Calm generative background music: slow pad chords plus an occasional soft bell note through a delay. */
class Music {
  private out: GainNode;
  private pads: GainNode;
  private bells: GainNode;
  private timer: number | null = null;
  private nextBeat = 0;
  private beat = 0;

  constructor(private readonly ctx: AudioContext, destination: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = MUSIC.padLowpassHz;
    this.pads = ctx.createGain();
    this.pads.connect(lp).connect(this.out);
    this.bells = ctx.createGain();
    this.bells.connect(this.out);
    const delay = ctx.createDelay(2);
    delay.delayTime.value = MUSIC.delaySeconds;
    const fb = ctx.createGain();
    fb.gain.value = MUSIC.delayFeedback;
    this.bells.connect(delay).connect(fb).connect(delay);
    fb.connect(this.out);
  }

  start(): void {
    if (this.timer !== null) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(MUSIC.volume, t + MUSIC.fadeSeconds);
    this.nextBeat = t + 0.1;
    this.beat = 0;
    this.timer = window.setInterval(() => this.schedule(), MUSIC.schedulerIntervalMs);
    this.schedule();
  }

  stop(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + MUSIC.fadeSeconds);
  }

  private schedule(): void {
    const beatLen = 60 / MUSIC.bpm;
    while (this.nextBeat < this.ctx.currentTime + MUSIC.lookaheadSeconds) {
      if (this.beat % MUSIC.beatsPerChord === 0) {
        const chord = MUSIC.chords[(this.beat / MUSIC.beatsPerChord) % MUSIC.chords.length];
        for (const n of chord) this.pad(midiHz(n), this.nextBeat, beatLen * MUSIC.beatsPerChord);
      }
      if (this.beat % 2 === 1 && Math.random() < MUSIC.melodyChance) {
        this.bell(midiHz(MUSIC.melody[Math.floor(Math.random() * MUSIC.melody.length)]), this.nextBeat);
      }
      this.nextBeat += beatLen;
      this.beat++;
    }
  }

  private pad(freq: number, t: number, len: number): void {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + MUSIC.padAttackSeconds);
    g.gain.setValueAtTime(0.18, t + len - MUSIC.padAttackSeconds / 2);
    // Overlap into the next chord a little so the change is seamless.
    g.gain.linearRampToValueAtTime(0, t + len + MUSIC.padAttackSeconds / 2);
    g.connect(this.pads);
    for (const cents of [-MUSIC.padDetuneCents, MUSIC.padDetuneCents]) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      o.detune.value = cents;
      o.connect(g);
      o.start(t);
      o.stop(t + len + MUSIC.padAttackSeconds);
    }
  }

  private bell(freq: number, t: number): void {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + MUSIC.noteDecaySeconds);
    g.connect(this.bells);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    o.connect(g);
    o.start(t);
    o.stop(t + MUSIC.noteDecaySeconds + 0.05);
  }
}

/**
 * Synthesised sound effects (Web Audio API, no assets) and background music, each with its own
 * on/off switch. Volumes scale with impact speed.
 * The AudioContext is created lazily on the first user gesture (browser autoplay policy).
 */
class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastAt = 0;
  private burst = 0;
  private music: Music | null = null;
  /** Sound effects off. */
  muted = false;
  musicOn = true;

  constructor() {
    try {
      this.muted = localStorage.getItem('breakshot.muted') === '1';
      this.musicOn = localStorage.getItem('breakshot.music') !== '0';
    } catch {
      // storage unavailable: keep default
    }
    // Pause everything while the tab is hidden.
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
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

  setMusic(on: boolean): void {
    this.musicOn = on;
    try {
      localStorage.setItem('breakshot.music', on ? '1' : '0');
    } catch {
      // ignore
    }
    if (on) this.ensure();
    if (on) this.music?.start();
    else this.music?.stop();
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
    this.music = new Music(this.ctx, this.ctx.destination);
    if (this.musicOn) this.music.start();
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
