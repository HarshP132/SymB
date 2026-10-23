// A goo tendril SymB stretches out to reach things. It is a tapering chain
// of balls along a wobbling curve from the body to a springy tip; the
// metaball renderer fuses them into one strand that grows out of the body.
//
// When something is far out of reach it becomes a "tower": a thick,
// slowly climbing column that pumps goo upward and sprouts curling side
// branches, like the creature building itself a way up.

import type { Ball } from './body';

const SEGMENTS = 44;
const BRANCHES = 4;
const BRANCH_SEGMENTS = 9;
/** How far a tower may climb, in world px. */
const TOWER_REACH = 4000;

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export class Tendril {
  /** 0 = fully inside the body, 1 = fully stretched out. */
  extension = 0;
  /** 0 = nimble tendril .. 1 = thick climbing tower. */
  tower = 0;
  tipX = 0;
  tipY = 0;
  /** Strand balls first, then branch balls; unused ones have r = 0. */
  readonly balls: Ball[] = [];

  private tvx = 0;
  private tvy = 0;
  private reaching = false;
  private wantTower = false;
  private speed = 1;
  private targetX = 0;
  private targetY = 0;
  private dirX = 0;
  private dirY = -1;

  constructor() {
    const n = SEGMENTS + BRANCHES * BRANCH_SEGMENTS;
    for (let i = 0; i < n; i++) this.balls.push({ x: 0, y: 0, r: 0, sharp: true });
  }

  /** How far the nimble tendril can get from the body's edge. */
  static reach(R: number): number {
    return R * 2.6 + 40;
  }

  /** Stretch toward (x, y); `speed` scales how eagerly it extends. */
  reachFor(x: number, y: number, tower = false, speed = 1): void {
    this.reaching = true;
    this.targetX = x;
    this.targetY = y;
    this.wantTower = tower;
    this.speed = speed;
  }

  release(): void {
    this.reaching = false;
  }

  /** Whip back into the body. */
  snap(): void {
    this.reaching = false;
    this.extension *= 0.5;
  }

  update(dt: number, t: number, hx: number, hy: number, R: number): void {
    const wantTower = this.reaching && this.wantTower ? 1 : 0;
    this.tower += (wantTower - this.tower) * Math.min(1, dt * 2.5);
    const tw = this.tower;

    const want = this.reaching ? 1 : 0;
    // Towers are built slowly; tendrils flick out.
    const rate = this.reaching ? mix(2.6, 0.75, tw) * this.speed : 7;
    this.extension += (want - this.extension) * Math.min(1, dt * rate);

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
    const max = mix(Tendril.reach(R), TOWER_REACH, tw);
    if (len > max) {
      lx *= max / len;
      ly *= max / len;
    }
    if (!this.reaching) {
      lx = this.dirX * R * 0.2;
      ly = this.dirY * R * 0.2;
    }

    // The tip chases its goal on a spring, so it lags, overshoots and
    // wobbles; a tower's tip is heavier and steadier.
    const gx = bx + lx * this.extension;
    const gy = by + ly * this.extension;
    const k = mix(220, 70, tw);
    this.tvx = (this.tvx + (gx - this.tipX) * k * dt) * Math.exp(-dt * 13);
    this.tvy = (this.tvy + (gy - this.tipY) * k * dt) * Math.exp(-dt * 13);
    this.tipX += this.tvx * dt;
    this.tipY += this.tvy * dt;

    // Bend the strand with a sideways wave through a quadratic curve;
    // towers sway slowly instead of wriggling.
    const sx = this.tipX - bx;
    const sy = this.tipY - by;
    const sl = Math.hypot(sx, sy) || 1;
    const nx = -sy / sl;
    const ny = sx / sl;
    const wave = (Math.sin(t * 5.5) * mix(0.18, 0.04, tw) + Math.sin(t * 1.1) * 0.12 * tw) * sl * this.extension;
    const cx = bx + sx * 0.5 + nx * wave;
    const cy = by + sy * 0.5 + ny * wave;

    const show = Math.min(1, this.extension / 0.15);
    // Balls must overlap to read as one strand, however long it gets.
    const minR = (sl / SEGMENTS) * 0.8 * show;
    const point = (s: number, out: { x: number; y: number }) => {
      const u = 1 - s;
      out.x = u * u * bx + 2 * u * s * cx + s * s * this.tipX;
      out.y = u * u * by + 2 * u * s * cy + s * s * this.tipY;
    };

    for (let i = 0; i < SEGMENTS; i++) {
      const s = (i + 1) / SEGMENTS;
      const b = this.balls[i];
      point(s, b);
      // Tendril: thick root, thin strand, a little bulb at the tip.
      const thin = i === SEGMENTS - 1 ? 0.17 : 0.27 - 0.16 * s;
      // Tower: a broad base and bulges of goo pumping up toward the top.
      const thick = (0.55 - 0.3 * s) * (1 + 0.2 * Math.sin(s * 16 - t * 7));
      b.r = Math.max(R * mix(thin, thick, tw) * show, i < SEGMENTS - 1 ? minR : 0);
    }

    // Tower branches: curling side strands sprouting along the column.
    const root = { x: 0, y: 0 };
    for (let j = 0; j < BRANCHES; j++) {
      const s0 = 0.28 + 0.16 * j;
      point(s0, root);
      // Tangent of the curve at s0, and the side this branch grows to.
      let tx = 2 * (1 - s0) * (cx - bx) + 2 * s0 * (this.tipX - cx);
      let ty = 2 * (1 - s0) * (cy - by) + 2 * s0 * (this.tipY - cy);
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const side = j % 2 === 0 ? 1 : -1;
      const ox = -ty * side;
      const oy = tx * side;
      const a = 0.45 + 0.35 * Math.sin(t * 1.3 + j * 2.1);
      const dx = ox * Math.cos(a) + tx * Math.sin(a);
      const dy = oy * Math.cos(a) + ty * Math.sin(a);
      const grow = Math.max(0, (tw - 0.2) / 0.8) * this.extension;
      const blen = R * (1.7 + 0.5 * Math.sin(j * 3.1)) * grow;
      for (let k2 = 0; k2 < BRANCH_SEGMENTS; k2++) {
        const u = (k2 + 1) / BRANCH_SEGMENTS;
        const b = this.balls[SEGMENTS + j * BRANCH_SEGMENTS + k2];
        // Branches curl further along the column as they grow.
        b.x = root.x + dx * blen * u + tx * blen * 0.35 * u * u;
        b.y = root.y + dy * blen * u + ty * blen * 0.35 * u * u;
        // Tapering, but always thick enough to overlap its neighbours.
        b.r = Math.max(R * (0.27 - 0.15 * u), (blen / BRANCH_SEGMENTS) * 0.85) * grow;
      }
    }
  }
}
