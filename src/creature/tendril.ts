// A goo tendril SymB stretches out to reach things. It is a tapering chain
// of balls along a wobbling curve from the body to a springy tip; the
// metaball renderer fuses them into one strand that grows out of the body.

import type { Ball } from './body';

const SEGMENTS = 22;

export class Tendril {
  /** 0 = fully inside the body, 1 = fully stretched out. */
  extension = 0;
  tipX = 0;
  tipY = 0;
  readonly balls: Ball[] = [];

  private tvx = 0;
  private tvy = 0;
  private reaching = false;
  private targetX = 0;
  private targetY = 0;
  private dirX = 0;
  private dirY = -1;

  constructor() {
    for (let i = 0; i < SEGMENTS; i++) this.balls.push({ x: 0, y: 0, r: 0, sharp: true });
  }

  /** How far the tip can get from the body's edge. */
  static reach(R: number): number {
    return R * 2.6 + 40;
  }

  reachFor(x: number, y: number): void {
    this.reaching = true;
    this.targetX = x;
    this.targetY = y;
  }

  release(): void {
    this.reaching = false;
  }

  /** Whip back into the body, e.g. right after catching something. */
  snap(): void {
    this.reaching = false;
    this.extension *= 0.5;
  }

  update(dt: number, t: number, hx: number, hy: number, R: number): void {
    const want = this.reaching ? 1 : 0;
    this.extension += (want - this.extension) * Math.min(1, dt * (this.reaching ? 2.6 : 7));

    if (this.reaching) {
      const dx = this.targetX - hx;
      const dy = this.targetY - hy;
      const d = Math.hypot(dx, dy) || 1;
      this.dirX = dx / d;
      this.dirY = dy / d;
    }

    // Root sits just inside the body's surface, facing the target.
    const bx = hx + this.dirX * R * 0.7;
    const by = hy + this.dirY * R * 0.7;
    let lx = this.targetX - bx;
    let ly = this.targetY - by;
    const len = Math.hypot(lx, ly) || 1;
    const max = Tendril.reach(R);
    if (len > max) {
      lx *= max / len;
      ly *= max / len;
    }
    if (!this.reaching) {
      lx = this.dirX * R * 0.2;
      ly = this.dirY * R * 0.2;
    }

    // The tip chases its goal on a spring, so it lags, overshoots and wobbles.
    const gx = bx + lx * this.extension;
    const gy = by + ly * this.extension;
    this.tvx = (this.tvx + (gx - this.tipX) * 220 * dt) * Math.exp(-dt * 13);
    this.tvy = (this.tvy + (gy - this.tipY) * 220 * dt) * Math.exp(-dt * 13);
    this.tipX += this.tvx * dt;
    this.tipY += this.tvy * dt;

    // Bend the strand with a slow sideways wave through a quadratic curve.
    const sx = this.tipX - bx;
    const sy = this.tipY - by;
    const sl = Math.hypot(sx, sy);
    const wave = Math.sin(t * 5.5) * sl * 0.18 * this.extension;
    const cx = bx + sx * 0.5 + (-sy / (sl || 1)) * wave;
    const cy = by + sy * 0.5 + (sx / (sl || 1)) * wave;

    const show = Math.min(1, this.extension / 0.15);
    for (let i = 0; i < SEGMENTS; i++) {
      const s = (i + 1) / SEGMENTS;
      const u = 1 - s;
      const b = this.balls[i];
      b.x = u * u * bx + 2 * u * s * cx + s * s * this.tipX;
      b.y = u * u * by + 2 * u * s * cy + s * s * this.tipY;
      // Thick at the root, thin along the strand, a little bulb at the tip.
      const taper = i === SEGMENTS - 1 ? 0.17 : 0.27 - 0.16 * s;
      b.r = R * taper * show;
    }
  }
}
