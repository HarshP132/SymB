// SymB's soft body: a cloud of spring-anchored particles around a moving
// "heart". The renderer turns the particles into one metaball surface, so
// particles that lag, drift apart or overlap read as liquid goo.
//
// Everything here is in world space: the floor is y = 0 and up is -y.

import type { Pointer } from '../input';
import type { Morsel } from '../world/food';
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
/** How close the heart may get to a wall or the ceiling, in body radii. */
const WALL_INSET = 1.25;
/** How long a wake-up stretch lasts, s. */
const STRETCH_TIME = 1.1;
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
  /** Extra time the bubble holds a caught cursor (a squeeze), s. */
  hold: number;
  /** Wrap around the cursor here and hold on (a hug), or null. */
  hugAt: { x: number; y: number } | null;
  /** A morsel it's going for; the tendril may grab this one. */
  food: Morsel | null;
  /** 0..1: contented vibration while being petted or hugged. */
  purr: number;
  /** 0..1: wriggly jiggle while being tickled. */
  giggle: number;
  /** 0..1: slow, deep sleeping breaths. */
  sleep: number;
  /** 0..1: reshape into a heart. */
  heart: number;
}

export function idleIntent(): Intent {
  return {
    vx: 0, crouch: 0, spikes: 0, reach: null, catchable: false, pounce: 0, hold: 0,
    hugAt: null, food: null, purr: 0, giggle: 0, sleep: 0, heart: 0,
  };
}

/** The window's edges in world space: SymB's walls and ceiling. */
export interface Box {
  left: number;
  right: number;
  top: number;
}

/** A catch in progress: the cursor wrapped in goo, travelling home. */
interface Engulf {
  age: number;
  /** Where the cursor was caught. */
  x: number;
  y: number;
  hold: number;
  travel: number;
  /** Set when it's a morsel being eaten rather than the cursor. */
  food: Morsel | null;
}

/** A dream bubble drifting up from a sleeping SymB. */
interface Dream {
  ball: Ball;
  vx: number;
  age: number;
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
  /** Called when a morsel has been swallowed. */
  onEat?: () => void;
  /** Called the moment the goo closes on the cursor (or grabs a morsel). */
  onGrab?: (food: boolean) => void;
  /** True while it's wrapped around the cursor in a hug. */
  hugging = false;
  /** Called when it bumps into a wall or the ceiling; strength 0..1. */
  onImpact?: (strength: number) => void;
  /** Where the walls are; set each step from the window. */
  readonly box: Box = { left: -Infinity, right: Infinity, top: -Infinity };

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
  private impactWait = 0;
  /** Seconds into a wake-up stretch, or < 0 when not stretching. */
  private stretchT = -1;
  private dreams: Dream[] = [];
  private nextDream = 0;
  private purr = 0;
  private giggle = 0;
  private sleep = 0;
  /** 0..1: how far it has become a heart (drawn crisply by the renderer). */
  heart = 0;
  private budWait = 8;
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

  /** True while a catch (or a morsel) is being wrapped up and swallowed. */
  get engulfing(): boolean {
    return this.engulf !== null;
  }

  /** True while the cursor itself is inside the goo, caught or hugged. */
  get holdingCursor(): boolean {
    return (this.engulf !== null && this.engulf.food === null) || this.hugging;
  }

  /** A wobble that runs through the whole body. */
  jiggle(strength: number): void {
    this.gulp = Math.max(this.gulp, strength);
    this.gulpAge = 0;
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
    this.impactWait = Math.max(0, this.impactWait - dt);
    this.crouch += (intent.crouch - this.crouch) * Math.min(1, dt * 8);
    // Spikes shoot out fast and melt back slowly.
    const sk = intent.spikes > this.spikes ? 18 : 2.5;
    this.spikes += (intent.spikes - this.spikes) * Math.min(1, dt * sk);

    const ease = Math.min(1, dt * 6);
    this.purr += (intent.purr - this.purr) * ease;
    this.giggle += (intent.giggle - this.giggle) * ease;
    this.sleep += (intent.sleep - this.sleep) * Math.min(1, dt * 2);
    this.heart += (intent.heart - this.heart) * Math.min(1, dt * 4);
    this.bud(dt, R);
    if (this.stretchT >= 0) {
      this.stretchT += dt;
      if (this.stretchT > STRETCH_TIME) this.stretchT = -1;
    }

    this.moveHeart(dt, ptr, intent);
    this.updateParticles(dt, t, ptr, R);
    this.hugging = !this.engulf && intent.hugAt !== null;
    if (this.engulf) {
      this.updateEngulf(dt, t, R);
    } else if (intent.hugAt) {
      this.hug(t, R, intent.hugAt);
    } else {
      this.steerTendril(intent);
      this.checkCatch(ptr, R, intent);
      this.checkFood(R, intent);
      // Let a finished hug's bubble melt away.
      for (const b of this.bubble) b.r *= Math.exp(-dt * 10);
    }
    this.tendril.update(dt, t, this.hx, this.hy, R);
    this.prey.alpha *= this.engulf || this.hugging ? 1 : Math.exp(-dt * 3);
    this.updateDreams(dt, R);
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

    // As a heart it floats up a little so the tip clears the floor.
    let squash = this.crouch * R * 0.5 - this.heart * R * 0.35;
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

    // The window is SymB's world: bump off its sides and its top.
    const box = this.box;
    const inset = R * WALL_INSET;
    if (box.right - box.left < inset * 2) {
      this.hx = (box.left + box.right) / 2;
    } else if (this.hx < box.left + inset) {
      this.hx = box.left + inset;
      if (this.hvx < 0) {
        this.impact(-this.hvx);
        this.hvx *= -0.25;
      }
    } else if (this.hx > box.right - inset) {
      this.hx = box.right - inset;
      if (this.hvx > 0) {
        this.impact(this.hvx);
        this.hvx *= -0.25;
      }
    }
    if (this.hy < box.top + inset) {
      this.hy = box.top + inset;
      if (this.hvy < 0) {
        this.impact(-this.hvy);
        this.hvy *= -0.2;
      }
    }
  }

  /** A bump against the window: a jiggle, and a reaction from the brain. */
  private impact(speed: number): void {
    const strength = Math.min(1, Math.max(0, (speed - 250) / 900));
    if (strength < 0.05 || this.impactWait > 0) return;
    this.impactWait = 0.3;
    this.gulp = Math.max(this.gulp, strength * 0.6);
    this.gulpAge = 0;
    this.onImpact?.(strength);
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
    // Breathing: slow, slightly irregular swell of the whole body, slower
    // and deeper in its sleep.
    const sl = this.sleep;
    const breath =
      1 + (0.035 + 0.035 * sl) * Math.sin(t * (1.6 - 0.85 * sl)) + 0.015 * Math.sin(t * 0.67 + 1.3) + this.gulp * 0.1;
    // Waking up: a long, tall stretch.
    const st = this.stretchT >= 0 ? Math.sin((this.stretchT / STRETCH_TIME) * Math.PI) : 0;
    const wide = 1.1 * (1 - st * 0.2);
    const tall = 0.9 * (1 + st * 0.45);
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
        const purr = this.purr * 0.03 * Math.sin(t * 42 + p.phase);
        const giggle = this.giggle * 0.09 * Math.sin(t * 17 + p.angle * 2);
        const s = R * breath * (1 + wob + ripple + purr + giggle);
        const ox = p.ox * cs - p.oy * sn;
        const oy = p.ox * sn + p.oy * cs;
        // Gravity settles the shape: a little wider, a little lower.
        let tx = this.hx + ox * s * wide;
        let ty = this.hy + oy * s * tall;
        if (this.heart > 0.01) {
          // Love: every particle slides to its place on a heart outline
          // (scaled by how far out it sits), tip pointing at the floor.
          const th = p.angle;
          const d = (Math.hypot(p.ox, p.oy) / 0.6) * R * 1.35 * breath;
          const hx = Math.sin(th) ** 3;
          const hy = -(13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th)) / 16 - 0.35;
          tx += (this.hx + hx * d - tx) * this.heart;
          ty += (this.hy + hy * d - ty) * this.heart;
        }
        ax = (tx - p.x) * p.k;
        ay = (ty - p.y) * p.k + SAG * R * (1 - st * 0.6) * (1 - 0.8 * this.heart);
      }

      // Pointer pokes push the goo aside and drag it along.
      if (ptr.active) {
        const dx = p.x - ptr.x;
        const dy = p.y - ptr.y;
        const d = Math.hypot(dx, dy) + 1e-3;
        if (d < pr) {
          const near = 1 - d / pr;
          // A stroking hand presses gently; a poke pushes hard.
          const gentle = 1 - 0.7 * Math.max(this.purr, this.giggle);
          const push = near * (1400 + Math.min(ptr.speed, 2500) * 1.2) * scale * gentle;
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
      // The window's sides and top squash it flat the same way.
      const pad = p.r * R * 1.25;
      if (p.x < this.box.left + pad) {
        p.x = this.box.left + pad;
        if (p.vx < 0) p.vx *= -0.1;
      } else if (p.x > this.box.right - pad) {
        p.x = this.box.right - pad;
        if (p.vx > 0) p.vx *= -0.1;
      }
      if (p.y < this.box.top + pad) {
        p.y = this.box.top + pad;
        if (p.vy < 0) p.vy *= -0.1;
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
    this.engulf = { age: 0, x: ptr.x, y: ptr.y, hold: intent.hold, travel: 0.45 + d / 1400, food: null };
    this.prey.x = ptr.x;
    this.prey.y = ptr.y;
    this.prey.alpha = 1;
    this.onGrab?.(false);
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
    if (e.food) {
      // A morsel needs no bubble: it simply rides the tendril home.
      e.food.x = p.x;
      e.food.y = p.y;
      p.alpha = 0;
      if (home >= 1) this.swallow(R);
      return;
    }

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
    const food = this.engulf?.food;
    this.engulf = null;
    for (const b of this.bubble) b.r = 0;
    this.mass += 1;
    this.gulp = 1;
    this.gulpAge = 0;
    this.tendril.snap();
    // A happy little hop.
    if (this.grounded) this.leap(R * 0.8);
    if (food) {
      food.eaten = true;
      this.onEat?.();
    } else {
      this.catches += 1;
      this.onCatch?.();
    }
  }

  /** Grab the morsel the brain is after once the tendril touches it. */
  private checkFood(R: number, intent: Intent): void {
    const m = intent.food;
    const td = this.tendril;
    if (!m || m.held || td.extension < 0.6) return;
    if (Math.hypot(td.tipX - m.x, td.tipY - m.y) > m.r + R * 0.25) return;
    m.held = true;
    const d = Math.hypot(m.x - this.hx, m.y - this.hy);
    // Skip the wrapping: start straight on the way home.
    this.engulf = { age: WRAP_TIME, x: m.x, y: m.y, hold: 0, travel: 0.35 + d / 1400, food: m };
    this.onGrab?.(true);
  }

  /** Once it's big, little drops now and then pinch off and float away. */
  private bud(dt: number, R: number): void {
    this.budWait -= dt;
    if (this.budWait > 0 || this.mass < 10 || this.engulf) return;
    this.budWait = 7 + Math.random() * 7;
    const drops = this.particles.filter((p) => p.droplet);
    const p = drops[Math.floor(Math.random() * drops.length)];
    const a = Math.PI + Math.random() * Math.PI; // somewhere on the upper half
    p.x = this.hx + Math.cos(a) * R * 0.9;
    p.y = this.hy + Math.sin(a) * R * 0.9;
    p.vx = Math.cos(a) * R * 7;
    p.vy = Math.sin(a) * R * 7;
  }

  /** Make an entrance: fall from the top of the window and splat. */
  dropIn(top: number): void {
    const dy = top + this.radius * 1.6 - this.hy;
    this.hy += dy;
    for (const p of this.particles) p.y += dy;
    this.hvy = 0;
    this.grounded = false;
  }

  /** Wrap around the cursor and hold it, squeezing gently, for as long as it stays. */
  private hug(t: number, R: number, at: { x: number; y: number }): void {
    this.tendril.reachFor(at.x, at.y, false, 2);
    const p = this.prey;
    p.x = at.x;
    p.y = at.y;
    p.r = R * 0.09;
    p.alpha = 0.9;
    const ring = R * 0.38 * (1 + 0.1 * Math.sin(t * 6));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + t * 1.5;
      const b = this.bubble[i];
      b.x = at.x + Math.cos(a) * ring;
      b.y = at.y + Math.sin(a) * ring;
      b.r += (R * 0.3 - b.r) * 0.2;
    }
    const core = this.bubble[8];
    core.x = at.x;
    core.y = at.y;
    core.r += (R * 0.36 - core.r) * 0.2;
  }

  /** Start a waking-up stretch. */
  stretch(): void {
    this.stretchT = 0;
  }

  /** Dream bubbles: tiny drops of goo that float up from it while it sleeps. */
  private updateDreams(dt: number, R: number): void {
    this.nextDream -= dt;
    if (this.sleep > 0.85 && this.nextDream <= 0) {
      this.nextDream = 1.3 + Math.random();
      this.dreams.push({
        ball: { x: this.hx + (Math.random() - 0.3) * R * 0.5, y: this.hy - R * 1.2, r: R * 0.06 },
        vx: (Math.random() - 0.5) * 12,
        age: 0,
      });
    }
    for (const d of this.dreams) {
      d.age += dt;
      d.ball.y -= (22 + R * 0.4) * dt;
      d.ball.x += (d.vx + Math.sin(d.age * 2.4) * 14) * dt;
      // Swell as they rise, then shrink away to nothing.
      d.ball.r = R * (0.06 + 0.06 * Math.min(1, d.age / 1.5)) * Math.min(1, Math.max(0, (3.2 - d.age) / 0.6));
    }
    this.dreams = this.dreams.filter((d) => d.age < 3.2);
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
    for (const d of this.dreams) if (d.ball.r > 0.5) this.balls.push(d.ball);
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
