// Ink drops you can feed SymB: click empty space and one falls, bounces
// and rolls along the floor until SymB comes over and slurps it up.

import type { Ball, Box } from '../creature/body';

const GRAVITY = 1800;
/** Only a few treats at a time; it's a snack, not a buffet. */
const MAX_MORSELS = 3;

export class Morsel {
  vx = 0;
  vy = 0;
  /** Picked up by a tendril and being carried home. */
  held = false;
  eaten = false;
  readonly ball: Ball;

  constructor(
    public x: number,
    public y: number,
    public r: number,
  ) {
    this.ball = { x, y, r };
  }
}

export class Pantry {
  readonly morsels: Morsel[] = [];

  /** Drop a morsel at (x, y), sized for a SymB of radius R. */
  drop(x: number, y: number, R: number): boolean {
    if (this.morsels.length >= MAX_MORSELS) return false;
    const m = new Morsel(x, Math.min(y, -R * 0.3), R * 0.24);
    m.vx = (Math.random() - 0.5) * 60;
    this.morsels.push(m);
    return true;
  }

  update(dt: number, box: Box): void {
    for (const m of this.morsels) {
      if (m.held) continue;
      m.vy += GRAVITY * dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const floor = -m.r * 0.8;
      if (m.y > floor) {
        m.y = floor;
        m.vy = m.vy > 120 ? -m.vy * 0.35 : 0; // a couple of small bounces
        m.vx *= Math.exp(-dt * 3); // then it rolls to a stop
      }
      if (m.x < box.left + m.r) {
        m.x = box.left + m.r;
        m.vx = Math.abs(m.vx) * 0.4;
      } else if (m.x > box.right - m.r) {
        m.x = box.right - m.r;
        m.vx = -Math.abs(m.vx) * 0.4;
      }
    }
    for (let i = this.morsels.length - 1; i >= 0; i--) {
      if (this.morsels[i].eaten) this.morsels.splice(i, 1);
    }
    for (const m of this.morsels) {
      m.ball.x = m.x;
      m.ball.y = m.y;
      m.ball.r = m.r;
    }
  }

  /** The uneaten morsel nearest to x, if any. */
  nearest(x: number): Morsel | null {
    let best: Morsel | null = null;
    for (const m of this.morsels) {
      if (m.held || m.eaten) continue;
      if (!best || Math.abs(m.x - x) < Math.abs(best.x - x)) best = m;
    }
    return best;
  }
}
