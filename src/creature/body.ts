// SymB's soft body: a cloud of spring-anchored particles around a moving
// "heart". The renderer turns the particles into one metaball surface, so
// particles that lag, drift apart or overlap read as liquid goo.
//
// Everything here is in world space: the floor is y = 0 and up is -y.

import type { Pointer } from '../input';
import { Tendril } from './tendril';

export interface Ball {
  x: number;
  y: number;
  r: number;
  /** Sharper falloff: stays a thin strand instead of fusing into a cone. */
  sharp?: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Rest offset from the heart, in body radii. */
  ox: number;
  oy: number;
  /** Direction of the rest offset, for ripples that travel around the body. */
  angle: number;
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
/** Gravity on the flesh, in body radii/s²: enough to sag into a dome. */
const SAG = 26;
/** Gravity on loose droplets, in body radii/s²: they fall and roll home. */
const DROP_FALL = 30;
/** Resting height of the heart above the floor, in body radii. */
const REST_HEIGHT = 1.25;
/** Gravity on the whole creature while it is in the air, px/s². */
const GRAVITY = 2600;
/** How long the bubble takes to close around a catch, s. */
const WRAP_TIME = 0.35;

/** What the brain asks the body to do this step. */
export interface Intent {
  /** Desired horizontal speed, world px/s. */
  vx: number;
  /** 0..1: hunker down (hiding, winding up a pounce). */
  crouch: number;
  /** 0..1: puff out spikes. */
  spikes: number;
  /** Stretch toward something, or null to pull the tendril in. */
  reach: { x: number; y: number; tower: boolean; speed: number } | null;
  /** May the tendril catch the cursor right now? */
  catchable: boolean;
  /** Set to a rise height (px) to pounce; the body clears it once used. */
  pounce: number;
  /** Extra time the bubble holds the catch (a hug), s. */
  hug: number;
}

export function idleIntent(): Intent {
  return { vx: 0, crouch: 0, spikes: 0, reach: null, catchable: false, pounce: 0, hug: 0 };
}

/** A catch in progress: the cursor wrapped in goo, travelling home. */
interface Engulf {
  age: number;
  /** Where the cursor was caught. */
  x: number;
  y: number;
  hold: number;
  travel: number;
}

export class Body {
  hx: number;
  hy: number;
  hvx = 0;
  hvy = 0;
  grounded = true;
  /** Grows forever; radius scales with log(mass). */
  mass = 0;
  catches = 0;
  /** Called when a caught cursor has been swallowed. */
  onCatch?: () => void;

  readonly particles: Particle[] = [];
  readonly balls: Ball[] = [];
  readonly bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  /** The stretch of floor the body is touching, for the contact shadow. */
  readonly contact = { x: 0, halfWidth: 0, strength: 1 };
  /** Where the pointer carves into the goo; strength eases in and out. */
  readonly finger = { x: 0, y: 0, r: 0, strength: 0 };
  readonly tendril = new Tendril();
  /** The swallowed cursor, glinting white inside the goo. */
  readonly prey = { x: 0, y: 0, r: 0, alpha: 0 };
  /** 0..1: how far its spikes are out (drawn by the renderer). */
  spikes = 0;

  /** Mass as currently shown; eases toward `mass` so growth swells in. */
  private shownMass = 0;
  private engulf: Engulf | null = null;
  private crouch = 0;
  /** Counts down a pounce's wind-up crouch, then leaps `pounceRise`. */
  private windUp = 0;
  private pounceRise = 0;
  /** Strength and age of the ripple that runs through it after a catch. */
  private gulp = 0;
  private gulpAge = 0;
  private readonly bubble: Ball[] = [];

  constructor(x: number) {
    this.hx = x;
    this.hy = -BASE_RADIUS * REST_HEIGHT;
    this.build();
    for (let i = 0; i < 9; i++) this.bubble.push({ x: 0, y: 0, r: 0, sharp: true });
  }

  get radius(): number {
    return BASE_RADIUS * (1 + GROWTH * Math.log(1 + this.shownMass));
  }

  /** True while a caught cursor is being wrapped up and swallowed. */
  get engulfing(): boolean {
    return this.engulf !== null;
  }

  /** Jump straight to a size, e.g. when restoring a saved SymB. */
  setMass(mass: number): void {
    this.mass = this.shownMass = mass;
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
        angle: Math.atan2(oy, ox),
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

  update(dt: number, t: number, ptr: Pointer, intent: Intent): void {
    this.shownMass += (this.mass - this.shownMass) * Math.min(1, dt * 2.5);
    const R = this.radius;
    this.gulp *= Math.exp(-dt * 2.2);
    this.gulpAge += dt;
    this.crouch += (intent.crouch - this.crouch) * Math.min(1, dt * 8);
    // Spikes shoot out fast and melt back slowly.
    const sk = intent.spikes > this.spikes ? 18 : 2.5;
    this.spikes += (intent.spikes - this.spikes) * Math.min(1, dt * sk);

    this.moveHeart(dt, ptr, intent);
    this.updateParticles(dt, t, ptr, R);
    if (this.engulf) {
      this.updateEngulf(dt, t, R);
    } else {
      this.steerTendril(intent);
      this.checkCatch(ptr, R, intent);
    }
    this.tendril.update(dt, t, this.hx, this.hy, R);
    this.prey.alpha *= this.engulf ? 1 : Math.exp(-dt * 3);
    this.updateFinger(dt, ptr);
    this.collectBalls(R);
  }

  get fingerRadius(): number {
    return this.radius * 0.45 + 6;
  }

  private moveHeart(dt: number, ptr: Pointer, intent: Intent): void {
    const R = this.radius;
    const restY = -R * REST_HEIGHT;
    const maxSpeed = 220 + R * 3;
    let desiredVx = clamp(intent.vx, maxSpeed * 1.2);
    // Rooted while swallowing, or while building a tower.
    if (this.engulf || this.tendril.tower > 0.5) desiredVx *= 0.15;

    let squash = this.crouch * R * 0.5;
    if (ptr.active) {
      const dx = this.hx - ptr.x;
      const dy = this.hy - ptr.y;
      const d = Math.hypot(dx, dy) + 1e-3;
      // Squash down when pressed from above.
      if (d < R * 2 && dy > 0) squash = Math.max(squash, (1 - d / (R * 2)) * R * 0.45);
    }

    // Steering is snappy on the ground and floaty in the air.
    const grip = this.grounded ? 4 : 1;
    this.hvx += (desiredVx - this.hvx) * Math.min(1, dt * grip);

    if (this.grounded) {
      if (intent.pounce > 0 && this.windUp === 0) {
        // Crouch first: the wind-up is what makes a pounce read as one.
        this.windUp = 0.22;
        this.pounceRise = intent.pounce;
      }
      intent.pounce = 0;
      if (this.windUp > 0) {
        squash = Math.max(squash, R * 0.55);
        this.windUp = Math.max(0, this.windUp - dt);
        if (this.windUp === 0) this.leap(this.pounceRise);
      }
      if (this.grounded) {
        this.hvy = (this.hvy + (restY + squash - this.hy) * 40 * dt) * Math.exp(-dt * 8);
      }
    } else {
      this.hvy += GRAVITY * dt;
    }
    this.hx += this.hvx * dt;
    this.hy += this.hvy * dt;
    if (!this.grounded && this.hy >= restY && this.hvy > 0) {
      // Land: the flesh splats on its own; the heart just stops falling.
      this.grounded = true;
      this.hy = restY;
      this.hvy *= 0.15;
    }
    // Never let the heart sink through the floor, however hard it's pressed.
    this.hy = Math.min(this.hy, -R * 0.6);
  }

  /** The highest a pounce can lift the heart, px. */
  maxRise(): number {
    return this.radius * 4 + 80;
  }

  private leap(rise: number): void {
    this.hvy = -Math.sqrt(2 * GRAVITY * Math.min(rise, this.maxRise()));
    this.grounded = false;
  }

  private updateParticles(dt: number, t: number, ptr: Pointer, R: number): void {
    // Breathing: slow, slightly irregular swell of the whole body.
    const breath = 1 + 0.035 * Math.sin(t * 1.6) + 0.015 * Math.sin(t * 0.67 + 1.3) + this.gulp * 0.1;
    // The flesh slowly swirls so the silhouette never repeats exactly.
    const swirl = t * 0.12;
    const cs = Math.cos(swirl);
    const sn = Math.sin(swirl);
    // Pointer forces were tuned at the starting size; keep them in proportion.
    const scale = R / BASE_RADIUS;

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
        // Held loosely nearby, but yanked back hard if left far behind.
        const far = Math.max(0, d / want - 1.4);
        const pull = (d - want) * p.k * (1 + far * far * 12);
        const orbit = R * 5;
        ax = (-dx / d) * pull - (dy / d) * orbit;
        ay = (-dy / d) * pull + (dx / d) * orbit + DROP_FALL * R;
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
        // Anchor = heart + rotated rest offset + organic wobble, plus the
        // gulp ripple that runs around the body after a catch.
        const wob = 0.07 * Math.sin(t * (1.1 + p.k * 0.004) + p.phase);
        const ripple = this.gulp * 0.25 * Math.sin(p.angle * 3 - this.gulpAge * 14);
        const s = R * breath * (1 + wob + ripple);
        const ox = p.ox * cs - p.oy * sn;
        const oy = p.ox * sn + p.oy * cs;
        // Gravity settles the shape: a little wider, a little lower.
        ax = (this.hx + ox * s * 1.1 - p.x) * p.k;
        ay = (this.hy + oy * s * 0.9 - p.y) * p.k + SAG * R;
      }

      // Pointer pokes push the goo aside and drag it along.
      if (ptr.active) {
        const dx = p.x - ptr.x;
        const dy = p.y - ptr.y;
        const d = Math.hypot(dx, dy) + 1e-3;
        if (d < pr) {
          const near = 1 - d / pr;
          const push = near * (1400 + Math.min(ptr.speed, 2500) * 1.2) * scale;
          ax += (dx / d) * push;
          ay += (dy / d) * push;
          const drag = near * 10;
          ax += (ptr.vx - p.vx) * drag;
          ay += (ptr.vy - p.vy) * drag;
        }
      }

      p.vx = (p.vx + ax * dt) * Math.exp(-dt * 6);
      p.vy = (p.vy + ay * dt) * Math.exp(-dt * 6);
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // The floor: goo can't pass it, so the underside flattens and spreads.
      const lowest = -p.r * R * 1.25;
      if (p.y > lowest) {
        p.y = lowest;
        if (p.vy > 0) p.vy *= -0.1;
        if (!p.droplet) p.vx *= Math.exp(-dt * 10); // sticky friction; droplets roll
      }

      // The finger is solid: goo can't sit inside it, so it visibly dents.
      if (ptr.active && this.finger.strength > 0.5) {
        const dx = p.x - ptr.x;
        const dy = p.y - ptr.y;
        const d = Math.hypot(dx, dy) + 1e-3;
        const fr = this.fingerRadius + p.r * R * 0.5;
        if (d < fr) {
          const out = (fr - d) * 0.35;
          p.x += (dx / d) * out;
          p.y += (dy / d) * out;
        }
      }
    }
  }

  private steerTendril(intent: Intent): void {
    const r = intent.reach;
    if (r) this.tendril.reachFor(r.x, r.y, r.tower, r.speed);
    else this.tendril.release();
  }

  private checkCatch(ptr: Pointer, R: number, intent: Intent): void {
    const td = this.tendril;
    if (!ptr.active || !intent.catchable || td.extension < 0.75) return;
    if (Math.hypot(td.tipX - ptr.x, td.tipY - ptr.y) > R * 0.25 + 8 + td.tower * R * 0.3) return;

    // Got it: wrap the cursor in a bubble of goo, then reel it home.
    const d = Math.hypot(ptr.x - this.hx, ptr.y - this.hy);
    this.engulf = { age: 0, x: ptr.x, y: ptr.y, hold: intent.hug, travel: 0.45 + d / 1400 };
    this.prey.x = ptr.x;
    this.prey.y = ptr.y;
    this.prey.alpha = 1;
  }

  private updateEngulf(dt: number, t: number, R: number): void {
    const e = this.engulf!;
    e.age += dt;
    const closeAt = WRAP_TIME + e.hold;
    // 0..1 as the bubble closes, then 0..1 along the way home.
    const wrap = Math.min(1, e.age / WRAP_TIME);
    const home = Math.min(1, Math.max(0, (e.age - closeAt) / e.travel));
    const ease = home * home * (3 - 2 * home);

    const p = this.prey;
    p.x = e.x + (this.hx - e.x) * ease;
    p.y = e.y + (this.hy - e.y) * ease;
    p.r = R * 0.09;
    this.tendril.reachFor(p.x, p.y, this.tendril.tower > 0.5, 3);

    // A ring of goo closes around the catch, squeezing while it's hugged.
    const squeeze = e.age < closeAt && e.age > WRAP_TIME ? Math.sin((e.age - WRAP_TIME) * 9) * 0.08 : 0;
    const ring = R * (0.8 - 0.5 * wrap * wrap) * (1 + squeeze);
    const fade = 1 - Math.max(0, (home - 0.75) / 0.25);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + t * 2;
      const b = this.bubble[i];
      b.x = p.x + Math.cos(a) * ring;
      b.y = p.y + Math.sin(a) * ring;
      b.r = R * 0.3 * Math.min(1, wrap * 2) * fade;
    }
    const core = this.bubble[8];
    core.x = p.x;
    core.y = p.y;
    core.r = R * 0.36 * wrap * fade;

    if (home >= 1) this.swallow(R);
  }

  private swallow(R: number): void {
    this.engulf = null;
    for (const b of this.bubble) b.r = 0;
    this.mass += 1;
    this.catches += 1;
    this.gulp = 1;
    this.gulpAge = 0;
    this.tendril.snap();
    // A happy little hop.
    if (this.grounded) this.leap(R * 0.8);
    this.onCatch?.();
  }

  private updateFinger(dt: number, ptr: Pointer): void {
    const f = this.finger;
    // While the tendril is out, the cursor is its prey, not a poking finger.
    const target = ptr.active && !this.engulf && this.tendril.extension < 0.2 ? 1 : 0;
    f.strength += (target - f.strength) * Math.min(1, dt * 14);
    if (ptr.active) {
      f.x = ptr.x;
      f.y = ptr.y;
    }
    f.r = this.fingerRadius;
  }

  private collectBalls(R: number): void {
    const b = this.bounds;
    b.minX = b.minY = Infinity;
    b.maxX = b.maxY = -Infinity;
    let cMin = Infinity;
    let cMax = -Infinity;
    this.balls.length = 0;
    for (const p of this.particles) {
      const r = p.r * R;
      this.balls.push({ x: p.x, y: p.y, r });
      if (!p.droplet && p.y > -R * 0.9) {
        cMin = Math.min(cMin, p.x - r);
        cMax = Math.max(cMax, p.x + r);
      }
    }
    for (const list of [this.tendril.balls, this.bubble]) {
      for (const tb of list) if (tb.r > 0.5) this.balls.push(tb);
    }
    for (const ball of this.balls) {
      b.minX = Math.min(b.minX, ball.x - ball.r);
      b.minY = Math.min(b.minY, ball.y - ball.r);
      b.maxX = Math.max(b.maxX, ball.x + ball.r);
      b.maxY = Math.max(b.maxY, ball.y + ball.r);
    }
    // Leave room for the soft halo the shader draws around the goo.
    const m = R * (2.4 + this.spikes * 1.5);
    b.minX -= m;
    b.minY -= m;
    b.maxX += m;
    b.maxY += m;

    // In the air the shadow shrinks and fades the higher it goes.
    const lift = Math.min(1, Math.max(0, -this.hy / R - REST_HEIGHT) / 8);
    if (cMin > cMax) {
      cMin = this.hx - R * (1 - lift * 0.6);
      cMax = this.hx + R * (1 - lift * 0.6);
    }
    this.contact.strength = 1 - lift * 0.75;
    this.contact.x = (cMin + cMax) / 2;
    this.contact.halfWidth = (cMax - cMin) / 2;
  }
}

/** Clamp v to [-hi, hi], or to [lo, hi] when lo is given. */
function clamp(v: number, hi: number, lo = -hi): number {
  return Math.max(lo, Math.min(hi, v));
}
