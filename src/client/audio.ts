/** Tiny synthesized sound effects (no audio files needed). */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last: Record<string, number> = {};
  muted = false;

  /** Must be called from a user gesture (mobile browsers). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private ok(key: string, gapMs: number): boolean {
    if (this.muted || !this.ctx || !this.master) return false;
    const now = performance.now();
    if (now - (this.last[key] ?? 0) < gapMs) return false;
    this.last[key] = now;
    return true;
  }

  private burst(dur: number, freq: number, endFreq: number, gain: number, type: BiquadFilterType = 'lowpass') {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, ctx.currentTime);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start();
    src.stop(ctx.currentTime + dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'square', delay = 0, slideTo = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  cannon() {
    if (!this.ok('cannon', 45)) return;
    this.burst(0.35, 900, 80, 0.7);
    this.tone(90, 0.2, 0.3, 'sine', 0, 40);
  }

  boom(big = false) {
    if (!this.ok('boom', 40)) return;
    this.burst(big ? 0.9 : 0.5, big ? 1400 : 1100, 60, big ? 0.9 : 0.6);
  }

  splash() {
    if (!this.ok('splash', 60)) return;
    this.burst(0.4, 3000, 600, 0.35, 'bandpass');
  }

  place() {
    if (!this.ok('place', 30)) return;
    this.tone(220, 0.08, 0.25, 'square');
    this.burst(0.12, 500, 100, 0.4);
  }

  bad() {
    if (!this.ok('bad', 120)) return;
    this.tone(110, 0.15, 0.2, 'sawtooth');
  }

  rotate() {
    if (!this.ok('rot', 30)) return;
    this.tone(660, 0.04, 0.12, 'square');
  }

  tick() {
    if (!this.ok('tick', 200)) return;
    this.tone(1200, 0.05, 0.12, 'square');
  }

  fanfare(kind: 'phase' | 'good' | 'bad' | 'win') {
    if (!this.ok('fanfare' + kind, 300)) return;
    const seqs = {
      phase: [523, 659, 784],
      good: [523, 659, 784, 1047],
      bad: [392, 330, 262, 196],
      win: [523, 659, 784, 1047, 784, 1047],
    };
    seqs[kind].forEach((f, i) => this.tone(f, 0.16, 0.18, 'square', i * 0.12));
  }

  castle() {
    if (!this.ok('castle', 200)) return;
    [784, 988, 1175].forEach((f, i) => this.tone(f, 0.12, 0.15, 'triangle', i * 0.07));
  }
}

export const sfx = new Sfx();

export function buzz(ms: number) {
  try {
    if (!sfx.muted && 'vibrate' in navigator) navigator.vibrate(ms);
  } catch {
    /* unsupported */
  }
}
