// SymB's mind: moods that rise and fade, a slowly earned bond, and the
// stage-dependent choices that turn them into an Intent for the body.
//
// Bond (0..100) only ever moves a little at a time. It is what turns a
// shy creature hiding at the edge of the screen into one that greets you
// with excited hops.

import type { Pointer } from '../input';
import { type Body, type Box, type Intent, idleIntent } from './body';
import type { Morsel, Pantry } from '../world/food';
import { Tendril } from './tendril';

/** Emotions, each 0..1, easing back toward calm on their own. */
export interface Mood {
  joy: number;
  fear: number;
  sleepy: number;
  /** Concentration while reaching for something. */
  focus: number;
  /** Wide-eyed while airborne. */
  surprise: number;
  /** A shy SymB's nerve to approach a cursor that keeps still. */
  courage: number;
  /** Blissed out: being petted or hugged. */
  content: number;
}

export const STAGES = ['Shy', 'Curious', 'Playful', 'Friendly', 'Super friendly'] as const;
/** Bond at which each stage begins. */
export const STAGE_AT = [0, 15, 35, 60, 85];
/** Pause after a catch before hunting again, per stage, s. */
const REST = [4, 2.6, 1.6, 1.3, 1.1];
/** How much fast movement nearby frightens it, per stage. */
const SKITTISH = [1, 0.7, 0.4, 0.25, 0.15];

// Pacing: roughly 60-90 minutes of play from Shy to Super friendly.
const BOND_PER_MIN_TOGETHER = 0.25;
/** Extra bond for holding still near it while it's shy. */
const BOND_PER_MIN_TRUST = 0.6;
const BOND_PER_CATCH = 0.35;
const BOND_PER_STARTLE = -0.25;
const BOND_PER_MIN_PETTING = 1.2;
const BOND_PER_MIN_HUGGING = 1.5;
const BOND_PER_TICKLE = 0.1;
const BOND_PER_MEAL = 0.15;
/** Bond lost per hour away; never more than half the current stage. */
const BOND_DECAY_PER_HOUR = 0.25;
/** Hold a press on SymB this long for a hug (or a squirm), s. */
const PRESS_TIME = 0.35;

export class Brain {
  bond = 0;
  readonly mood: Mood = { joy: 0, fear: 0, sleepy: 0, focus: 0, surprise: 0, courage: 0, content: 0 };
  /** Something it's looking at instead of the cursor (food, where you left). */
  lookAt: { x: number; y: number } | null = null;
  readonly intent: Intent = idleIntent();

  private rest = 0;
  private flee = 0;
  private tag = 0;
  private startleWait = 0;
  private spikeTime = 0;
  private jumpWait = 0;
  private hopWait = 2;
  private greet = 0;
  private wasActive = false;
  private idleX = 0;
  private wanderSeed = Math.random() * 100;
  // Gestures on its body.
  private pet = 0;
  private tickle = 0;
  private turn = 0;
  private lastAngle = 0;
  private press = 0;
  /** The cursor is touching its body (so it's being handled, not hunted). */
  private touching = false;
  private asleep = false;
  // Where and when the cursor was last seen, for waiting by the door.
  private lastSeen = { x: 0, y: 0 };
  private leftAt = 0;

  get stage(): number {
    let s = 0;
    for (let i = 0; i < STAGE_AT.length; i++) if (this.bond >= STAGE_AT[i]) s = i;
    return s;
  }

  get stageName(): string {
    return STAGES[this.stage];
  }

  /** It bumped into the window: fun when playful, alarming when shy. */
  onImpact(strength: number): void {
    if (this.stage === 0) this.mood.fear = Math.min(1, this.mood.fear + strength * 0.3);
    else this.mood.joy = Math.max(this.mood.joy, strength * 0.5);
  }

  /** Coming back to the page after a while away. */
  welcomeBack(hoursAway: number): void {
    const st = this.stage;
    const width = (STAGE_AT[st + 1] ?? 100) - STAGE_AT[st];
    this.bond = Math.max(0, this.bond - Math.min(width / 2, hoursAway * BOND_DECAY_PER_HOUR));
  }

  /** A quick tap right on it. */
  onBoop(): void {
    if (this.stage === 0) this.mood.fear = Math.min(1, this.mood.fear + 0.35);
    else this.mood.joy = Math.max(this.mood.joy, 0.4);
  }

  /** A morsel has been swallowed. */
  onEat(): void {
    this.mood.joy = 1;
    this.bond = Math.min(100, this.bond + BOND_PER_MEAL);
  }

  /** True while the cursor is pressed and held on it as a hug. */
  get hugging(): boolean {
    return this.press > PRESS_TIME && this.stage >= 3;
  }

  /** The cursor has been swallowed. */
  onCatch(): void {
    this.mood.joy = 1;
    this.bond = Math.min(100, this.bond + BOND_PER_CATCH);
    this.rest = REST[this.stage];
    if (this.stage === 0) {
      // Thrilled and terrified at its own daring: dart back to safety.
      this.flee = 1.4;
      this.mood.courage *= 0.3;
    }
  }

  update(dt: number, t: number, body: Body, ptr: Pointer, stillFor: number, pantry: Pantry): void {
    this.rest = Math.max(0, this.rest - dt);
    this.flee = Math.max(0, this.flee - dt);
    this.tag = Math.max(0, this.tag - dt);
    this.startleWait = Math.max(0, this.startleWait - dt);
    this.spikeTime = Math.max(0, this.spikeTime - dt);
    this.jumpWait = Math.max(0, this.jumpWait - dt);
    this.hopWait = Math.max(0, this.hopWait - dt);
    this.greet = Math.max(0, this.greet - dt);
    this.tickle = Math.max(0, this.tickle - dt);

    this.sense(dt, body, ptr);
    this.feel(dt, body, ptr, stillFor);
    this.decide(t, body, ptr, stillFor, pantry);
  }

  /** Read what the cursor is doing on its body: petting, tickling, pressing. */
  private sense(dt: number, body: Body, ptr: Pointer): void {
    const R = body.radius;
    const onBody = ptr.active && ptr.y < 0 && Math.hypot(ptr.x - body.hx, ptr.y - body.hy) < R * 1.7;
    this.touching = onBody;

    // Petting: slow strokes across it, without pressing.
    const stroking = onBody && !ptr.down && ptr.speed > 40 && ptr.speed < 650;
    this.pet = Math.max(0, Math.min(1, this.pet + (stroking ? dt * 1.2 : -dt * 1.5)));

    // Tickling: the cursor keeps turning while it zips around on the body.
    if (onBody && ptr.speed > 150) {
      const a = Math.atan2(ptr.vy, ptr.vx);
      let d = a - this.lastAngle;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      this.turn += d;
      this.lastAngle = a;
    }
    this.turn *= Math.exp(-dt * 1.2);
    if (Math.abs(this.turn) > 8) {
      this.turn = 0;
      if (this.tickle === 0) this.onTickled();
      this.tickle = 1.2;
    }

    this.press = ptr.down && onBody ? this.press + dt : 0;
  }

  private onTickled(): void {
    if (this.stage === 0) {
      this.mood.fear = Math.min(1, this.mood.fear + 0.4);
    } else {
      this.mood.joy = Math.max(this.mood.joy, 0.8);
      this.bond = Math.min(100, this.bond + BOND_PER_TICKLE);
    }
  }

  private feel(dt: number, body: Body, ptr: Pointer, stillFor: number): void {
    const m = this.mood;
    const R = body.radius;
    const st = this.stage;
    m.joy *= Math.exp(-dt * 0.9);
    // The closer you are, the faster a scare wears off.
    m.fear *= Math.exp(-dt * (1.2 + this.bond / 50));

    if (ptr.active) {
      const dx = ptr.x - body.hx;
      const dy = ptr.y - body.hy;
      const d = Math.hypot(dx, dy) || 1;
      // Speed toward SymB (positive when the cursor is coming at it).
      const approach = -(ptr.vx * dx + ptr.vy * dy) / d;

      if (st === 2 && approach > 700 && d < R * 5 && this.tag === 0 && !body.engulfing) {
        // Playful: being charged at is a game of tag. Run, giggling.
        this.tag = 1.3;
        m.joy = Math.max(m.joy, 0.6);
      } else {
        const close = Math.max(0, 1 - d / (R * 5));
        const fast = Math.max(0, (ptr.speed - 1100) / 1500);
        m.fear += close * fast * dt * 12 * SKITTISH[st];
        if (st === 0) {
          // A shy SymB is wary of anything heading its way.
          m.fear += Math.max(0, (approach - 250) / 600) * Math.max(0, 1 - d / (R * 9)) * dt * 3;
        }
      }
      m.fear = Math.min(1, m.fear);

      if (m.fear > 0.55 && this.startleWait === 0) {
        this.startleWait = 4;
        this.spikeTime = 0.9;
        this.bond += BOND_PER_STARTLE;
      }

      if (d < R * 8 && m.fear < 0.3) this.bond += (dt * BOND_PER_MIN_TOGETHER) / 60;
      if (st === 0 && stillFor > 1 && d < R * 10) {
        this.bond += (dt * BOND_PER_MIN_TRUST) / 60;
        m.courage = Math.min(1, m.courage + dt / 2.5);
      }
      if (ptr.speed > 350) m.courage = Math.max(0, m.courage - dt * 1.5);
      if (m.fear > 0.4) m.courage = 0;
    } else {
      m.courage = Math.max(0, m.courage - dt * 0.2);
    }
    this.bond = Math.max(0, Math.min(100, this.bond));

    // Nobody around (or a cursor parked for ages): eyelids grow heavy.
    const idle = ptr.active ? stillFor - 20 : stillFor;
    const drowsy = Math.min(1, Math.max(0, (idle - 10) / 15));
    m.sleepy += (drowsy - m.sleepy) * Math.min(1, dt * (drowsy > m.sleepy ? 0.6 : 4));

    // Pressing on a shy or curious SymB is unnerving rather than nice.
    if (this.press > PRESS_TIME && st === 0) m.fear = Math.min(1, m.fear + dt * 2);

    const petted = this.pet > 0.5 && this.tickle === 0;
    const bliss = petted || this.hugging ? 1 : 0;
    m.content += (bliss - m.content) * Math.min(1, dt * (bliss ? 1.5 : 1));
    if (petted) this.bond += (dt * BOND_PER_MIN_PETTING) / 60;
    if (this.hugging) this.bond += (dt * BOND_PER_MIN_HUGGING) / 60;
    this.bond = Math.max(0, Math.min(100, this.bond));
    if (m.content > 0.5) m.fear *= Math.exp(-dt * 3);

    // Waking up properly: a big stretch.
    if (m.sleepy > 0.85) this.asleep = true;
    if (this.asleep && m.sleepy < 0.4) {
      this.asleep = false;
      body.stretch();
    }

    m.focus += (body.tendril.extension - m.focus) * Math.min(1, dt * 6);
    m.surprise += ((body.grounded ? 0 : 1) - m.surprise) * Math.min(1, dt * 8);
  }

  private decide(t: number, body: Body, ptr: Pointer, stillFor: number, pantry: Pantry): void {
    const it = this.intent;
    const m = this.mood;
    const st = this.stage;
    it.vx = 0;
    it.crouch = 0;
    it.reach = null;
    it.catchable = false;
    it.hold = st >= 3 ? 0.25 + (st - 3) * 0.2 : 0;
    it.spikes = this.spikeTime > 0 ? 1 : st <= 1 && m.fear > 0.7 ? 0.35 : 0;
    it.hugAt = null;
    it.food = null;
    it.purr = m.content;
    it.giggle = this.tickle > 0 ? 1 : 0;
    it.sleep = m.sleepy > 0.8 ? 1 : 0;
    this.lookAt = null;
    this.choose(t, body, ptr, stillFor, pantry);
    // Sleepy heads sink low.
    it.crouch = Math.max(it.crouch, m.sleepy * 0.35);
  }

  private choose(t: number, body: Body, ptr: Pointer, stillFor: number, pantry: Pantry): void {
    const it = this.intent;
    const m = this.mood;
    const st = this.stage;
    const R = body.radius;
    const maxSpeed = 220 + R * 3;

    // Busy swallowing: stay put and enjoy it.
    if (body.engulfing) return;

    if (!ptr.active) {
      if (this.wasActive) {
        this.wasActive = false;
        this.lastSeen = { x: ptr.x, y: ptr.y };
        this.leftAt = t;
      }
      if (this.goEat(body, pantry, maxSpeed)) return;
      if (st >= 3 && t - this.leftAt < 25 && m.sleepy < 0.5) {
        // Friends wait where you left, watching for you to come back.
        const box = body.box;
        const x = Math.max(box.left + R * 2, Math.min(box.right - R * 2, this.lastSeen.x));
        it.vx = clamp((x - body.hx) * 2, maxSpeed * 0.6);
        this.lookAt = this.lastSeen;
        this.idleX = body.hx;
        return;
      }
      this.wander(t, body, maxSpeed);
      return;
    }
    if (!this.wasActive) {
      this.wasActive = true;
      this.greetByStage(body);
    }
    this.idleX = body.hx;

    if (this.hugging) {
      // Wrap around the cursor and hold on, settling right under it.
      it.hugAt = { x: ptr.x, y: ptr.y };
      it.vx = clamp((ptr.x - body.hx) * 3, maxSpeed * 0.6);
      return;
    }
    if (this.pet > 0.5 && this.tickle === 0) {
      // Being petted: hold still and enjoy it.
      return;
    }
    if (this.tickle > 0) {
      // Wriggle and squeak with little hops.
      it.vx = Math.sin(t * 13) * maxSpeed * 0.25;
      if (body.grounded && this.hopWait === 0) {
        it.pounce = R * 0.35;
        this.hopWait = 0.4;
      }
      return;
    }
    if (this.press > PRESS_TIME && st > 0) {
      // Not ready for hugs yet: squirm out from under the press.
      it.vx = -(Math.sign(ptr.x - body.hx) || 1) * maxSpeed * 0.6;
      it.giggle = 0.5;
      return;
    }
    const shyOfYou = st === 0 && (m.fear > 0.3 || (Math.hypot(ptr.x - body.hx, ptr.y) < R * 6 && stillFor < 1.5));
    if (!shyOfYou && this.goEat(body, pantry, maxSpeed)) return;

    const dx = ptr.x - body.hx;
    const adx = Math.abs(dx);
    const dir = Math.sign(dx) || 1;
    const dist = Math.hypot(dx, ptr.y - body.hy);
    /** Approach to within `standoff` of the cursor at `speed` × max. */
    const toward = (standoff: number, speed: number) =>
      clamp((dx - dir * Math.min(adx, standoff)) * 3, maxSpeed * speed);

    // Hiding / running scared, or darting back after a daring catch.
    if (this.flee > 0 || (m.fear > 0.5 && st <= 1) || m.fear > 0.85) {
      if (st === 0) {
        this.hide(body, ptr, body.box, maxSpeed * 1.1);
        it.crouch = 0.6;
      } else {
        it.vx = -dir * maxSpeed;
        it.crouch = 0.3;
      }
      return;
    }
    if (this.tag > 0) {
      // Tag! Scamper off with little hops.
      it.vx = -dir * maxSpeed * 0.9;
      if (body.grounded && this.hopWait === 0) {
        it.pounce = R * 0.7;
        this.hopWait = 0.5;
      }
      return;
    }

    if (st === 0) {
      if (m.courage > 0.6 && stillFor > 1) {
        // Creep, low and slow, toward the cursor that's keeping still.
        it.vx = toward(R * 2.4, 0.18);
        it.crouch = 0.3;
        if (m.courage > 0.85) this.tryReach(body, ptr, false, false, 0.45);
      } else if (adx < R * 7) {
        this.hide(body, ptr, body.box, maxSpeed * 0.5);
        it.crouch = 0.5;
      } else {
        // Far enough: stay low and peek.
        it.crouch = 0.45;
      }
    } else if (st === 1) {
      const slow = ptr.speed < 350;
      if (this.rest > 0 || !slow) {
        it.vx = toward(R * 3.8, 0.5);
      } else {
        it.vx = toward(R * 2.6, 0.6);
        this.tryReach(body, ptr, false, true, 0.8);
      }
    } else {
      const eager = 1 + (st - 2) * 0.08;
      if (this.rest > 0) {
        if (st >= 3) {
          // Friends hang around close, swaying back and forth under you.
          it.vx = clamp((ptr.x + Math.sin(t * 1.6) * R * 1.4 - body.hx) * 2, maxSpeed * 0.7);
          if (st === 4 && body.grounded && this.hopWait === 0 && adx < R * 3) {
            it.pounce = R * 0.6;
            this.hopWait = 1.5 + Math.random() * 1.5;
          }
        } else {
          it.vx = toward(R * 3, 0.5);
        }
      } else {
        it.vx = toward(R * (st === 2 ? 2.6 : 2), eager);
        this.tryReach(body, ptr, true, true, 1);
      }
      if (this.greet > 0 && body.grounded && this.hopWait === 0) {
        it.pounce = R * 1.2;
        this.hopWait = 0.45;
      }
    }

    // Scoot away from pokes when it isn't trying to catch you.
    // Gentle hands are welcome once it trusts you; fast pokes never are.
    const poke = ptr.speed > 650 || st <= 1;
    if (!it.catchable && poke && dist < R * 2) it.vx -= dir * (1 - dist / (R * 2)) * maxSpeed;
  }

  /** The cursor just appeared: say hello the way this stage would. */
  private greetByStage(body: Body): void {
    const R = body.radius;
    switch (this.stage) {
      case 0:
        // Eek! Dart back into the corner.
        this.flee = 1;
        break;
      case 1:
        // Perk up.
        this.intent.pounce = R * 0.4;
        break;
      case 2:
        this.intent.pounce = R * 0.8;
        this.mood.joy = Math.max(this.mood.joy, 0.5);
        break;
      default:
        // So happy to see you: a run of excited hops.
        this.greet = 1.2;
        this.mood.joy = Math.max(this.mood.joy, 0.8);
    }
  }

  /** Waddle over to the nearest morsel and slurp it up with the tendril. */
  private goEat(body: Body, pantry: Pantry, maxSpeed: number): boolean {
    const food: Morsel | null = pantry.nearest(body.hx);
    if (!food) return false;
    const it = this.intent;
    const R = body.radius;
    const dx = food.x - body.hx;
    const standoff = R * 1.4;
    it.vx = clamp((dx - Math.sign(dx) * Math.min(Math.abs(dx), standoff)) * 3, maxSpeed * 0.8);
    this.lookAt = food;
    if (Math.hypot(dx, food.y - body.hy) < Tendril.reach(R) + R * 0.7) {
      it.reach = { x: food.x, y: food.y, tower: false, speed: 1.3 };
      it.food = food;
    }
    return true;
  }

  /**
   * Go for the cursor: a tendril when it's close, a pounce when it's above
   * but within jumping range, and a tower of goo when it's higher still.
   */
  private tryReach(body: Body, ptr: Pointer, canPounce: boolean, canTower: boolean, speed: number): void {
    // No grabbing a hand that's touching it: that's petting, not prey.
    if (this.rest > 0 || this.touching) return;
    const it = this.intent;
    const R = body.radius;
    const dx = ptr.x - body.hx;
    const above = body.hy - ptr.y;
    const dist = Math.hypot(dx, above);
    const tendril = Tendril.reach(R) + R * 0.7;
    const building = body.tendril.tower > 0.3;

    if (dist <= tendril + R * 0.6 && !building) {
      it.reach = { x: ptr.x, y: ptr.y, tower: false, speed };
      it.catchable = true;
      return;
    }
    if (above <= 0) return;
    // Once a tower is going up it keeps following the cursor.
    if (!building && Math.abs(dx) > R * 2.5) return;

    const rise = above - tendril * 0.6;
    if (canPounce && !building && rise <= body.maxRise()) {
      if (body.grounded && this.jumpWait === 0) {
        it.pounce = Math.max(R, rise);
        this.jumpWait = 1.2;
      }
      return;
    }
    if (canTower) {
      it.reach = { x: ptr.x, y: ptr.y, tower: true, speed };
      it.catchable = true;
    }
  }

  /** Retreat into the corner away from the cursor and press up against it. */
  private hide(body: Body, ptr: Pointer, box: Box, speed: number): void {
    const R = body.radius;
    const away = ptr.x > body.hx ? box.left : box.right;
    // Aim past the wall so it squashes itself into the corner.
    const push = (away - body.hx) * 3 + Math.sign(away - body.hx) * R;
    this.intent.vx = clamp(push, speed);
  }

  private wander(t: number, body: Body, maxSpeed: number): void {
    // Idle wandering around where it last was, steered by layered sines.
    const R = body.radius;
    const s = this.wanderSeed;
    const amp = R * 2 + 60;
    let tx = this.idleX + (amp * (Math.sin(t * 0.21 + s) + 0.5 * Math.sin(t * 0.53 + s * 2))) / 1.5;
    // Keep idle wandering inside the window, clear of the walls.
    const box = body.box;
    const margin = R * 2;
    if (box.right - box.left > margin * 2) tx = Math.max(box.left + margin, Math.min(box.right - margin, tx));
    this.intent.vx = clamp((tx - body.hx) * 1.2, maxSpeed * 0.4 * (1 - this.mood.sleepy));
  }
}

/** Clamp v to [-hi, hi]. */
function clamp(v: number, hi: number): number {
  return Math.max(-hi, Math.min(hi, v));
}
