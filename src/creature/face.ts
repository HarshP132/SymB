// SymB's face: two white, pupil-less eyes painted on the goo. All emotion
// lives in their shape (size, lids, a happy crescent) and in where they
// sit on the body, which is how it shows what it's looking at.

import type { Pointer } from '../input';
import type { Body } from './body';

/** One eye, in world space. Local +x points away from the face's centre. */
export interface Eye {
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** Rotation, radians; positive tilts the outer corner up. */
  tilt: number;
  /** -1 for the left eye, 1 for the right; mirrors the local x axis. */
  side: number;
  /** 0 closed .. 1 open. */
  open: number;
  /** 0 none .. 1 full ^ crescent. */
  happy: number;
  /** How far the upper lid has come down, 0..1. */
  lid: number;
  /** Lid slope: positive raises the inner end (worried). */
  lidTilt: number;
}

export type Expression = 'auto' | 'happy' | 'scared' | 'sleepy' | 'curious';

/** Emotions that drive the face, each 0..1; they ease back to calm. */
interface Mood {
  joy: number;
  fear: number;
  sleepy: number;
  focus: number;
  surprise: number;
}

export class Face {
  readonly eyes: [Eye, Eye] = [makeEye(-1), makeEye(1)];
  /** Debug override to preview a single expression. */
  forced: Expression = 'auto';

  mood: Mood = { joy: 0, fear: 0, sleepy: 0, focus: 0, surprise: 0 };
  // Smoothed gaze, a vector of length <= 1 in face space.
  private lookX = 0;
  private lookY = 0;
  private gazeX = 0;
  private gazeY = 0;
  private nextSaccade = 1;
  private blinking = false;
  private blinkT = 0;
  private blinkGap = 0;
  private nextBlink = 2;
  private doubleBlink = false;
  // Eased, displayed expression parameters.
  private shown = { open: 1, happy: 0, lid: 0, lidTilt: 0, size: 1 };

  /** A catch: pure joy. */
  delight(): void {
    this.mood.joy = 1;
  }

  update(dt: number, t: number, body: Body, ptr: Pointer, stillFor: number): void {
    this.feel(dt, body, ptr, stillFor);
    this.look(dt, t, body, ptr);
    this.blink(dt);
    this.place(dt, body);
  }

  private feel(dt: number, body: Body, ptr: Pointer, stillFor: number): void {
    const m = this.mood;
    const R = body.radius;
    m.joy *= Math.exp(-dt * 0.9);
    m.fear *= Math.exp(-dt * 1.4);

    // A sudden fast swipe close by is startling.
    if (ptr.active) {
      const d = Math.hypot(ptr.x - body.hx, ptr.y - body.hy);
      const close = Math.max(0, 1 - d / (R * 4));
      const fast = Math.max(0, (ptr.speed - 1400) / 1600);
      m.fear = Math.min(1, m.fear + close * fast * dt * 12);
    }

    // Nobody around for a while: eyelids grow heavy.
    const drowsy = Math.min(1, Math.max(0, (stillFor - 10) / 15));
    m.sleepy += (drowsy - m.sleepy) * Math.min(1, dt * (drowsy > m.sleepy ? 0.6 : 4));

    m.focus += (body.tendril.extension - m.focus) * Math.min(1, dt * 6);
    const airborne = body.grounded ? 0 : 1;
    m.surprise += (airborne - m.surprise) * Math.min(1, dt * 8);

    switch (this.forced) {
      case 'happy': Object.assign(m, { joy: 1, fear: 0, sleepy: 0, focus: 0 }); break;
      case 'scared': Object.assign(m, { joy: 0, fear: 1, sleepy: 0, focus: 0 }); break;
      case 'sleepy': Object.assign(m, { joy: 0, fear: 0, sleepy: 1, focus: 0 }); break;
      case 'curious': Object.assign(m, { joy: 0, fear: 0, sleepy: 0, focus: 0 }); break;
    }
  }

  private look(dt: number, t: number, body: Body, ptr: Pointer): void {
    const R = body.radius;
    let tx: number;
    let ty: number;
    if (ptr.active && this.mood.sleepy < 0.8) {
      // Look at the cursor (or the tendril tip chasing it).
      const dx = ptr.x - body.hx;
      const dy = ptr.y - body.hy;
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / (R * 3));
      tx = (dx / d) * k;
      ty = (dy / d) * k;
    } else {
      // Nobody to watch: glance around now and then.
      this.nextSaccade -= dt;
      if (this.nextSaccade <= 0) {
        this.nextSaccade = 1.2 + Math.random() * 2.5;
        this.gazeX = (Math.random() * 2 - 1) * 0.8;
        this.gazeY = -Math.random() * 0.4;
      }
      tx = this.gazeX * (1 - this.mood.sleepy);
      ty = this.gazeY * (1 - this.mood.sleepy) + this.mood.sleepy * 0.3;
    }
    // Eyes dart quickly, like real ones, with a hint of idle drift.
    const k = Math.min(1, dt * 12);
    this.lookX += (tx + Math.sin(t * 0.7) * 0.03 - this.lookX) * k;
    this.lookY += (ty - this.lookY) * k;
  }

  private blink(dt: number): void {
    if (this.blinking) {
      this.blinkT += dt;
      if (this.blinkT > this.blinkLength()) {
        this.blinking = false;
        if (this.doubleBlink) {
          this.doubleBlink = false;
          this.blinkGap = 0.08;
        }
      }
    } else if (this.blinkGap > 0) {
      this.blinkGap -= dt;
      if (this.blinkGap <= 0) this.startBlink();
    } else {
      this.nextBlink -= dt;
      if (this.nextBlink <= 0) {
        // Sleepy eyes blink slowly and often; some blinks come in pairs.
        this.nextBlink = 2 + Math.random() * 3.5 - this.mood.sleepy * 1.5;
        this.doubleBlink = Math.random() < 0.2;
        this.startBlink();
      }
    }
  }

  private startBlink(): void {
    this.blinking = true;
    this.blinkT = 0;
  }

  private blinkLength(): number {
    return 0.16 + this.mood.sleepy * 0.25;
  }

  /** 0..1 eyelid closure from the current blink. */
  private blinkAmount(): number {
    if (!this.blinking) return 0;
    return Math.sin(Math.min(1, this.blinkT / this.blinkLength()) * Math.PI);
  }

  private place(dt: number, body: Body): void {
    const m = this.mood;
    const R = body.radius;
    const s = this.shown;

    // Blend the moods into eye-shape targets.
    const calm = 1 - Math.max(m.joy, m.fear, m.sleepy);
    const sleepyLid = m.sleepy * (0.55 + 0.45 * Math.max(0, m.sleepy - 0.7) / 0.3);
    const target = {
      // Scared eyes shrink to small, wide-open, worried ovals.
      size: 1 + m.surprise * 0.18 + calm * 0.06 - m.fear * 0.3 - m.focus * 0.05,
      open: 1,
      happy: m.joy,
      // Never fully shut: a closed eye keeps a thin smile-like sliver.
      lid: Math.min(0.9, Math.max(sleepyLid, m.fear * 0.22, m.focus * 0.25)),
      lidTilt: m.fear * 0.9,
    };
    const k = Math.min(1, dt * 10);
    s.size += (target.size - s.size) * k;
    s.open += (target.open - s.open) * k;
    s.happy += (target.happy - s.happy) * k;
    s.lid += (target.lid - s.lid) * k;
    s.lidTilt += (target.lidTilt - s.lidTilt) * k;

    // The face sits on the body's core and slides toward where it looks.
    const core = body.particles[0];
    const fx = core.x + this.lookX * R * 0.38;
    const fy = core.y - R * 0.3 + this.lookY * R * 0.25;
    // Stretch with the body in the air, squash on landing.
    const stretch = Math.max(-0.6, Math.min(0.6, -body.hvy / 1800));
    const spread = R * 0.5 * (1 - Math.abs(this.lookX) * 0.22) * (1 - stretch * 0.25);
    const blink = this.blinkAmount();

    // Fear makes the eyes tremble.
    const shiver = m.fear * R * 0.025;

    for (const e of this.eyes) {
      // The eye on the side it's looking toward gets a touch bigger.
      const near = 1 + this.lookX * e.side * 0.12;
      e.x = fx + e.side * spread + (Math.random() - 0.5) * shiver;
      e.y = fy + (Math.random() - 0.5) * shiver;
      e.rx = R * 0.27 * s.size * near * (1 - stretch * 0.2);
      e.ry = R * 0.38 * s.size * near * (1 + stretch * 0.3);
      // Tilted outward like a symbiote's, relaxing when happy, scared or
      // sleepy so closed eyes rest level.
      e.tilt = (0.32 - m.fear * 0.2 - s.happy * 0.2) * (1 - m.sleepy);
      e.open = s.open * (1 - blink);
      e.happy = s.happy * (1 - blink);
      e.lid = s.lid;
      e.lidTilt = s.lidTilt;
    }
  }
}

function makeEye(side: number): Eye {
  return { x: 0, y: 0, rx: 0, ry: 0, tilt: 0, side, open: 1, happy: 0, lid: 0, lidTilt: 0 };
}
