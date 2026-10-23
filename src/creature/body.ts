// SymB's soft body: a cloud of spring-anchored particles around a moving
// "heart". The renderer turns the particles into one metaball surface, so
// particles that lag, drift apart or overlap read as liquid goo.

import type { Input } from '../input';

export interface Ball {
  x: number;
  y: number;
  r: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Rest offset from the heart, in body radii. */
  ox: number;
  oy: number;
  /** Ball radius, in body radii. */
  r: number;
  /** Spring stiffness toward the anchor; softer particles trail more. */
  k: number;
  phase: number;
  /** Free droplets orbit loosely instead of holding a rest offset. */
  droplet: boolean;
}

// Particle radii overlap, so the visible silhouette is ~1.65× this.
const BASE_RADIUS = 26;
const GROWTH = 0.35;

const TAU = Math.PI * 2;

export class Body {
  hx: number;
  hy: number;
  hvx = 0;
  hvy = 0;
  /** Grows forever; radius scales with log(mass). */
  mass = 0;

  readonly particles: Particle[] = [];
  readonly balls: Ball[] = [];
  readonly bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  private wanderSeed = Math.random() * 100;

  /** Where the pointer carves into the goo; strength eases in and out. */
  readonly finger = { x: 0, y: 0, r: 0, strength: 0 };

  constructor(x: number, y: number) {
    this.hx = x;
    this.hy = y;
    this.build();
  }

  get radius(): number {
    return BASE_RADIUS * (1 + GROWTH * Math.log(1 + this.mass));
  }

  private build(): void {
    const add = (ox: number, oy: number, r: number, k: number, droplet = false) => {
      this.particles.push({
        x: this.hx + ox * BASE_RADIUS,
        y: this.hy + oy * BASE_RADIUS,
        vx: 0,
        vy: 0,
        ox,
        oy,
        r,
        k,
        phase: Math.random() * TAU,
        droplet,
      });
    };

    // Core: one big ball plus an inner ring, stiff so the body holds together.
    add(0, 0, 0.62, 160);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      add(Math.cos(a) * 0.28, Math.sin(a) * 0.28, 0.42, 120);
    }
    // Flesh: an outer ring of softer, smaller balls that trail and bulge.
    const outer = 14;
    for (let i = 0; i < outer; i++) {
      const a = (i / outer) * TAU + Math.random() * 0.2;
      const d = 0.5 + Math.random() * 0.12;
      add(Math.cos(a) * d, Math.sin(a) * d, 0.26 + Math.random() * 0.1, 45 + Math.random() * 35);
    }
    // A few loose droplets that wander off and get pulled back in.
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * TAU;
      add(Math.cos(a) * 1.1, Math.sin(a) * 1.1, 0.13 + Math.random() * 0.05, 6, true);
    }
  }

  update(dt: number, t: number, input: Input, viewW: number, viewH: number): void {
    const R = this.radius;
    this.moveHeart(dt, t, input, viewW, viewH);

    // Breathing: slow, slightly irregular swell of the whole body.
    const breath = 1 + 0.035 * Math.sin(t * 1.6) + 0.015 * Math.sin(t * 0.67 + 1.3);
    // The flesh slowly swirls so the silhouette never repeats exactly.
    const swirl = t * 0.12;
    const cs = Math.cos(swirl);
    const sn = Math.sin(swirl);

    const pr = R * 1.8 + 20; // pointer influence radius
    for (const p of this.particles) {
      let ax: number;
      let ay: number;
      if (p.droplet) {
        // Orbit around the heart at a breathing distance, loosely held.
        const dx = p.x - this.hx;
        const dy = p.y - this.hy;
        const d = Math.hypot(dx, dy) + 1e-3;
        const want = R * (1.75 + 0.45 * Math.sin(t * 0.5 + p.phase));
        const pull = (d - want) * p.k;
        const orbit = R * 5;
        ax = (-dx / d) * pull - (dy / d) * orbit;
        ay = (-dy / d) * pull + (dx / d) * orbit;
        // Droplets shy away from each other so they don't clump.
        for (const q of this.particles) {
          if (q === p || !q.droplet) continue;
          const ex = p.x - q.x;
          const ey = p.y - q.y;
          const e = Math.hypot(ex, ey) + 1e-3;
          if (e < R * 1.5) {
            const rep = (1 - e / (R * 1.5)) * R * 20;
            ax += (ex / e) * rep;
            ay += (ey / e) * rep;
          }
        }
      } else {
        // Anchor = heart + rotated rest offset + organic wobble.
        const wob = 0.07 * Math.sin(t * (1.1 + p.k * 0.004) + p.phase);
        const s = R * breath * (1 + wob);
        const ox = p.ox * cs - p.oy * sn;
        const oy = p.ox * sn + p.oy * cs;
        ax = (this.hx + ox * s - p.x) * p.k;
        ay = (this.hy + oy * s - p.y) * p.k;
      }

      // Pointer pokes push the goo aside and drag it along.
      if (input.active) {
        const dx = p.x - input.x;
        const dy = p.y - input.y;
        const d = Math.hypot(dx, dy) + 1e-3;
        if (d < pr) {
          const near = 1 - d / pr;
          const push = near * (1400 + Math.min(input.speed, 2500) * 1.2);
          ax += (dx / d) * push;
          ay += (dy / d) * push;
          const drag = near * 10;
          ax += (input.vx - p.vx) * drag;
          ay += (input.vy - p.vy) * drag;
        }
      }

      p.vx = (p.vx + ax * dt) * Math.exp(-dt * 6);
      p.vy = (p.vy + ay * dt) * Math.exp(-dt * 6);
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // The finger is solid: goo can't sit inside it, so it visibly dents.
      if (input.active) {
        const dx = p.x - input.x;
        const dy = p.y - input.y;
        const d = Math.hypot(dx, dy) + 1e-3;
        const fr = this.fingerRadius + p.r * R * 0.5;
        if (d < fr) {
          const out = (fr - d) * 0.35;
          p.x += (dx / d) * out;
          p.y += (dy / d) * out;
        }
      }
    }

    this.updateFinger(dt, input);

    this.collectBalls(R);
  }

  get fingerRadius(): number {
    return this.radius * 0.45 + 6;
  }

  private updateFinger(dt: number, input: Input): void {
    const f = this.finger;
    const target = input.active ? 1 : 0;
    f.strength += (target - f.strength) * Math.min(1, dt * 14);
    if (input.active) {
      f.x = input.x;
      f.y = input.y;
    }
    f.r = this.fingerRadius;
  }

  private moveHeart(dt: number, t: number, input: Input, viewW: number, viewH: number): void {
    // Idle drift around the middle of the screen, steered by layered sines.
    const s = this.wanderSeed;
    const amp = Math.min(viewW, viewH) * 0.12;
    let tx = viewW / 2 + amp * (Math.sin(t * 0.21 + s) + 0.5 * Math.sin(t * 0.53 + s * 2));
    let ty = viewH / 2 + amp * 0.7 * (Math.sin(t * 0.17 + s * 3) + 0.5 * Math.sin(t * 0.41 + s));

    // Shrink away a little when poked in the middle.
    if (input.active) {
      const dx = this.hx - input.x;
      const dy = this.hy - input.y;
      const d = Math.hypot(dx, dy) + 1e-3;
      const R = this.radius;
      if (d < R * 2) {
        const f = (1 - d / (R * 2)) * R * 1.6;
        tx += (dx / d) * f;
        ty += (dy / d) * f;
      }
    }

    const k = 3;
    this.hvx = (this.hvx + (tx - this.hx) * k * dt) * Math.exp(-dt * 2.2);
    this.hvy = (this.hvy + (ty - this.hy) * k * dt) * Math.exp(-dt * 2.2);
    this.hx += this.hvx * dt;
    this.hy += this.hvy * dt;
  }

  private collectBalls(R: number): void {
    const b = this.bounds;
    b.minX = b.minY = Infinity;
    b.maxX = b.maxY = -Infinity;
    this.balls.length = 0;
    for (const p of this.particles) {
      const r = p.r * R;
      this.balls.push({ x: p.x, y: p.y, r });
      b.minX = Math.min(b.minX, p.x - r);
      b.minY = Math.min(b.minY, p.y - r);
      b.maxX = Math.max(b.maxX, p.x + r);
      b.maxY = Math.max(b.maxY, p.y + r);
    }
    // Leave room for the soft halo the shader draws around the goo.
    const m = R * 2.4;
    b.minX -= m;
    b.minY -= m;
    b.maxX += m;
    b.maxY += m;
  }
}
