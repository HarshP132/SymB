// Unified pointer tracking for mouse, pen and touch.
// A touch only counts as a "cursor" while the finger is on the screen.

/** What SymB can know about the cursor, in whichever space it lives in. */
export interface Pointer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  /** True while there is a cursor/finger SymB can see. */
  active: boolean;
  /** True while the button / finger is pressed. */
  down: boolean;
}

/** A quick press-and-release without dragging: a click or a tap. */
export interface Tap {
  x: number;
  y: number;
}

/** Longest press, s, and furthest drag, px, that still count as a tap. */
const TAP_TIME = 0.3;
const TAP_SLOP = 10;

export class Input implements Pointer {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  active = false;
  down = false;
  /** Seconds since the pointer last moved. */
  stillFor = 0;
  /** Taps since the last call to takeTaps(). */
  private taps: Tap[] = [];
  private pressAt = 0;
  private pressX = 0;
  private pressY = 0;

  private lastEventTime = 0;
  private moved = false;

  constructor(el: HTMLElement) {
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture?.(e.pointerId);
      this.down = true;
      this.active = true;
      this.place(e);
      this.pressAt = e.timeStamp;
      this.pressX = e.clientX;
      this.pressY = e.clientY;
    });
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.active = false;
    });
    window.addEventListener('blur', () => {
      this.active = false;
      this.down = false;
    });
  }

  /** Hand over (and forget) the taps that happened since last time. */
  takeTaps(): Tap[] {
    const t = this.taps;
    this.taps = [];
    return t;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  update(dt: number): void {
    if (this.moved) {
      this.stillFor = 0;
      this.moved = false;
    } else {
      this.stillFor += dt;
      // No events means the pointer is resting; let velocity fade out.
      const k = Math.exp(-dt * 12);
      this.vx *= k;
      this.vy *= k;
    }
  }

  private place(e: PointerEvent): void {
    this.x = e.clientX;
    this.y = e.clientY;
    this.lastEventTime = e.timeStamp;
    this.vx = this.vy = 0;
    // Appearing (or touching down) counts as movement.
    this.moved = true;
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerType !== 'mouse' && !this.down) return;
    if (!this.active) {
      this.active = true;
      this.place(e);
      return;
    }
    const dt = Math.max((e.timeStamp - this.lastEventTime) / 1000, 1 / 240);
    const ivx = (e.clientX - this.x) / dt;
    const ivy = (e.clientY - this.y) / dt;
    // Smooth instantaneous velocity; raw pointer deltas are very noisy.
    const a = Math.min(1, dt * 20);
    this.vx += (ivx - this.vx) * a;
    this.vy += (ivy - this.vy) * a;
    this.x = e.clientX;
    this.y = e.clientY;
    this.lastEventTime = e.timeStamp;
    this.moved = true;
  }

  private onUp(e: PointerEvent): void {
    if (this.down && e.type === 'pointerup') {
      const quick = (e.timeStamp - this.pressAt) / 1000 < TAP_TIME;
      const still = Math.hypot(e.clientX - this.pressX, e.clientY - this.pressY) < TAP_SLOP;
      if (quick && still) this.taps.push({ x: e.clientX, y: e.clientY });
    }
    this.down = false;
    if (e.pointerType !== 'mouse') this.active = false;
  }
}
