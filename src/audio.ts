// SymB's voice: every sound is synthesised on the fly with Web Audio, no
// files. Muted until the person turns it on (browsers only allow audio to
// start from a click anyway).

export type Cue = 'grab' | 'gulp' | 'slurp' | 'boop' | 'bump' | 'giggle' | 'spikes' | 'chime';

export class Sound {
  enabled = false;
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private purrGain: GainNode | null = null;

  /** Turn sound on or off; returns the new state. Call from a click. */
  toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.enabled && !this.ctx) this.start();
    if (this.ctx) {
      if (this.enabled) void this.ctx.resume();
      else void this.ctx.suspend();
    }
    return this.enabled;
  }

  private start(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.out = ctx.createGain();
    this.out.gain.value = 0.6;
    this.out.connect(comp);

    // One second of white noise, reused for every wet, squishy sound.
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // The purr: a low sawtooth, muffled and wobbling, faded in by setPurr().
    const purr = ctx.createOscillator();
    purr.type = 'sawtooth';
    purr.frequency.value = 26;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140;
    const wobble = ctx.createGain();
    wobble.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4.5;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.5;
    lfo.connect(lfoDepth).connect(wobble.gain);
    this.purrGain = ctx.createGain();
    this.purrGain.gain.value = 0;
    purr.connect(lp).connect(wobble).connect(this.purrGain).connect(this.out);
    purr.start();
    lfo.start();
  }

  /** Continuous purring, 0..1. */
  setPurr(level: number): void {
    if (!this.ctx || !this.purrGain || !this.enabled) return;
    this.purrGain.gain.setTargetAtTime(level * 0.55, this.ctx.currentTime, 0.15);
  }

  play(cue: Cue, strength = 1): void {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    switch (cue) {
      case 'grab': // a wet squelch as the goo closes round the cursor
        this.sweep('bandpass', 1400, 300, 0.28, 0.5, t);
        this.tone('sine', 320, 90, 0.22, 0.35, t);
        break;
      case 'gulp':
        this.tone('sine', 230, 70, 0.2, 0.5, t);
        break;
      case 'slurp':
        this.sweep('bandpass', 350, 1800, 0.32, 0.4, t);
        this.tone('sine', 180, 80, 0.15, 0.3, t + 0.28);
        break;
      case 'boop':
        this.tone('triangle', 620, 940, 0.09, 0.35, t);
        break;
      case 'bump':
        this.tone('sine', 120, 45, 0.18, 0.7 * strength, t);
        this.sweep('lowpass', 500, 120, 0.1, 0.4 * strength, t);
        break;
      case 'giggle':
        for (let i = 0; i < 4; i++) {
          const f = 700 + Math.random() * 450;
          this.tone('triangle', f, f * 1.15, 0.05, 0.22, t + i * 0.07);
        }
        break;
      case 'spikes':
        this.sweep('highpass', 3000, 6000, 0.14, 0.35, t);
        break;
      case 'chime': // a stage moment: a soft rising arpeggio
        [523, 659, 784, 1046].forEach((f, i) => this.tone('sine', f, f, 0.5, 0.18, t + i * 0.12));
        break;
    }
  }

  /** A pitch-gliding blip. */
  private tone(type: OscillatorType, from: number, to: number, dur: number, vol: number, at: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(to, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.out!);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  /** A burst of filtered noise whose filter glides: squelches, slurps, crackles. */
  private sweep(type: BiquadFilterType, from: number, to: number, dur: number, vol: number, at: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = type === 'bandpass' ? 6 : 1;
    f.frequency.setValueAtTime(from, at);
    f.frequency.exponentialRampToValueAtTime(to, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.05);
  }
}
