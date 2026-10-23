import { Body, type Ball } from './creature/body';
import { Brain, STAGES, STAGE_AT } from './creature/brain';
import { Face, type Eye, type Expression } from './creature/face';
import { Input, type Pointer } from './input';
import { GooRenderer, type Frame } from './render/goo';
import { FallbackRenderer } from './render/fallback';
import { Camera } from './world/camera';
import { Pantry } from './world/food';
import { forget, load, save } from './save';
import { Sound } from './audio';

const STEP = 1 / 120; // fixed physics step
const MAX_STEPS = 8;

let canvas = document.getElementById('stage') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);
// Debug tools: add ?debug or #debug to the URL. ?nogl forces the 2D fallback.
const debug = params.has('debug') || location.hash === '#debug';

interface Renderer {
  render(f: Frame, dpr: number): void;
}
let renderer!: Renderer;
let useFallback = params.has('nogl');
if (!useFallback) {
  try {
    renderer = new GooRenderer(canvas);
  } catch (err) {
    console.warn('WebGL2 unavailable; using the 2D fallback.', err);
    useFallback = true;
    // A canvas that already handed out a WebGL context can't give a 2D one.
    const fresh = canvas.cloneNode() as HTMLCanvasElement;
    canvas.replaceWith(fresh);
    canvas = fresh;
  }
}
if (useFallback) {
  try {
    renderer = new FallbackRenderer(canvas);
  } catch (err) {
    document.getElementById('fallback')!.style.display = 'flex';
    throw err;
  }
}

const camera = new Camera();
let dpr = 1;
/** Render resolution relative to the screen; lowered on slow devices. */
let quality = 1;
function resize(): void {
  // Capped so huge phone DPRs don't melt the fragment shader.
  dpr = Math.min(window.devicePixelRatio || 1, 2) * quality;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  camera.resize(window.innerWidth, window.innerHeight);
}
resize();
window.addEventListener('resize', resize);

const input = new Input(canvas);
const body = new Body(0);
// Calmer wobbles for people who ask their device for less motion.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
body.calm = reducedMotion.matches;
reducedMotion.addEventListener('change', () => (body.calm = reducedMotion.matches));
const face = new Face();
const brain = new Brain();
const pantry = new Pantry();
body.onCatch = () => {
  brain.onCatch();
  sound.play('gulp');
};
body.onEat = () => {
  brain.onEat();
  sound.play('gulp');
};

// Pick up where we left off.
const saved = load();
if (saved) {
  brain.bond = saved.bond;
  body.setMass(saved.mass);
  body.catches = saved.catches;
  // Older saves didn't track moments: don't replay ones it lived through.
  const reached = saved.reached.length ? saved.reached : [...Array(brain.stage + 1).keys()];
  for (const s of reached) brain.reached.add(s);
  brain.welcomeBack((Date.now() - saved.at) / 3_600_000);
} else {
  // First meeting: a little drop falls into the world.
  camera.box(body.box);
  body.dropIn(body.box.top);
}
const remember = () =>
  save({ bond: brain.bond, mass: body.mass, catches: body.catches, reached: [...brain.reached] });
setInterval(remember, 5000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) remember();
});
window.addEventListener('pagehide', remember);

/** The cursor as SymB sees it: in world space. */
const pointer: Pointer = { x: 0, y: 0, vx: 0, vy: 0, speed: 0, active: false, down: false };
function syncPointer(): void {
  pointer.active = input.active;
  pointer.down = input.down;
  pointer.x = camera.toWorldX(input.x);
  pointer.y = camera.toWorldY(input.y);
  pointer.vx = input.vx / camera.zoom;
  pointer.vy = input.vy / camera.zoom;
  pointer.speed = input.speed / camera.zoom;
}

// Screen-space copy of the world for the renderer, reused every frame.
const screenBalls: Ball[] = [];
const screenEyes: Eye[] = face.eyes.map((e) => ({ ...e }));
const frameData: Frame = {
  balls: screenBalls,
  eyes: screenEyes,
  prey: { x: 0, y: 0, r: 0, alpha: 0 },
  spike: { x: 0, y: 0, r: 0, amount: 0 },
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  radius: 0,
  finger: { x: 0, y: 0, r: 0, strength: 0 },
  floorY: 0,
  contact: { x: 0, halfWidth: 0, strength: 1 },
  camX: 0,
  zoom: 1,
  time: 0,
};

/** Taps on SymB are boops; taps anywhere else drop a morsel of food. */
function handleTaps(): void {
  for (const tap of input.takeTaps()) {
    const x = camera.toWorldX(tap.x);
    const y = camera.toWorldY(tap.y);
    const R = body.radius;
    if (y < 0 && Math.hypot(x - body.hx, y - body.hy) < R * 1.6) {
      brain.onBoop();
      body.jiggle(0.5);
      face.wince();
      sound.play('boop');
    } else {
      pantry.drop(x, y, R);
    }
  }
}

function buildFrame(time: number): Frame {
  const z = camera.zoom;
  const sx = (x: number) => camera.toScreenX(x);
  const sy = (y: number) => camera.toScreenY(y);
  const f = frameData;

  const all = body.balls.concat(pantry.morsels.map((m) => m.ball));
  screenBalls.length = all.length;
  for (let i = 0; i < all.length; i++) {
    const b = all[i];
    const s = (screenBalls[i] ??= { x: 0, y: 0, r: 0 });
    s.x = sx(b.x);
    s.y = sy(b.y);
    s.r = b.r * z;
    s.sharp = b.sharp;
  }
  for (let i = 0; i < 2; i++) {
    const e = face.eyes[i];
    Object.assign(screenEyes[i], e, { x: sx(e.x), y: sy(e.y), rx: e.rx * z, ry: e.ry * z });
  }
  f.prey.x = sx(body.prey.x);
  f.prey.y = sy(body.prey.y);
  f.prey.r = body.prey.r * z;
  f.prey.alpha = body.prey.alpha;
  f.spike.x = sx(body.hx);
  f.spike.y = sy(body.hy);
  f.spike.r = body.radius * z;
  f.spike.amount = body.spikes;
  const wb = body.bounds;
  f.bounds.minX = sx(wb.minX);
  f.bounds.minY = sy(wb.minY);
  f.bounds.maxX = sx(wb.maxX);
  f.bounds.maxY = sy(wb.maxY);
  // Food lies outside the body's bounds; widen them to take it in.
  for (const m of pantry.morsels) {
    const pad = (m.r + body.radius) * z;
    f.bounds.minX = Math.min(f.bounds.minX, sx(m.x) - pad);
    f.bounds.minY = Math.min(f.bounds.minY, sy(m.y) - pad);
    f.bounds.maxX = Math.max(f.bounds.maxX, sx(m.x) + pad);
    f.bounds.maxY = Math.max(f.bounds.maxY, sy(m.y) + pad);
  }
  f.radius = body.radius * z;
  f.finger.x = sx(body.finger.x);
  f.finger.y = sy(body.finger.y);
  f.finger.r = body.finger.r * z;
  f.finger.strength = body.finger.strength;
  f.floorY = camera.floorScreen;
  f.contact.x = sx(body.contact.x);
  f.contact.halfWidth = body.contact.halfWidth * z;
  f.contact.strength = body.contact.strength;
  f.camX = camera.x;
  f.zoom = z;
  f.time = body.calm ? time * 0.3 : time;
  return f;
}

// Sound, help and captions: the only interface, kept quiet in a corner.
const sound = new Sound();
const soundBtn = document.getElementById('sound') as HTMLButtonElement;
soundBtn.addEventListener('click', () => {
  const on = sound.toggle();
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
  soundBtn.querySelector('.on')!.toggleAttribute('hidden', !on);
  soundBtn.querySelector('.off')!.toggleAttribute('hidden', on);
});
const helpBtn = document.getElementById('help-toggle') as HTMLButtonElement;
const help = document.getElementById('help')!;
helpBtn.addEventListener('click', () => {
  help.hidden = !help.hidden;
  helpBtn.setAttribute('aria-expanded', String(!help.hidden));
});
canvas.addEventListener('pointerdown', () => {
  help.hidden = true;
  helpBtn.setAttribute('aria-expanded', 'false');
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const captionEl = document.getElementById('caption')!;
let captionTimer = 0;
/** A line of text that fades in under the floor, then away. */
function caption(text: string, delay = 0, hold = 4500): void {
  window.setTimeout(() => {
    captionEl.textContent = text;
    captionEl.classList.add('show');
    window.clearTimeout(captionTimer);
    captionTimer = window.setTimeout(() => captionEl.classList.remove('show'), hold);
  }, delay);
}
const MOMENT_LINES = ['', 'SymB is curious about you', 'SymB wants to play', 'SymB trusts you', 'SymB adores you'];
if (!saved) caption('move gently…', 1800, 5000);

body.onGrab = (food) => sound.play(food ? 'slurp' : 'grab');
body.onImpact = (strength) => {
  brain.onImpact(strength);
  face.wince();
  sound.play('bump', strength);
};
brain.onEvent = (e, stage) => {
  if (e === 'tickle') sound.play('giggle');
  if (e === 'startle') sound.play('spikes');
  if (e === 'moment') {
    sound.play('chime');
    caption(MOMENT_LINES[stage]);
  }
};

let debugEl: HTMLElement | null = null;
let bondSlider: HTMLInputElement | null = null;

/** Debug: a slider to jump between personality stages. */
function makeBondSlider(): HTMLInputElement {
  const wrap = document.createElement('label');
  wrap.id = 'bond';
  wrap.textContent = 'bond ';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '0.5';
  slider.addEventListener('input', () => (brain.bond = Number(slider.value)));
  const marks = document.createElement('span');
  marks.textContent = STAGES.map((s, i) => `${STAGE_AT[i]} ${s}`).join(' · ');
  wrap.append(slider, marks);
  document.body.appendChild(wrap);
  return slider;
}
if (debug) {
  debugEl = document.createElement('div');
  debugEl.id = 'debug';
  document.body.appendChild(debugEl);
  (window as unknown as { symb: unknown }).symb = { body, face, brain, camera, pointer, pantry };
  bondSlider = makeBondSlider();
  window.addEventListener('keydown', (e) => {
    // Match physical keys so layout and Caps Lock don't matter.
    if (e.code === 'KeyG') body.mass += e.shiftKey ? 25 : 1;
    if (e.code === 'KeyR' && !e.shiftKey) body.setMass(0);
    if (e.code === 'KeyR' && e.shiftKey) {
      // Start over completely: a brand-new, tiny, shy SymB.
      forget();
      brain.bond = 0;
      body.setMass(0);
      body.catches = 0;
    }
    if (e.code === 'BracketLeft') brain.bond = Math.max(0, brain.bond - 5);
    if (e.code === 'BracketRight') brain.bond = Math.min(100, brain.bond + 5);
    const faces: Record<string, Expression> = {
      Digit0: 'auto', Digit1: 'curious', Digit2: 'happy', Digit3: 'scared', Digit4: 'sleepy',
    };
    if (e.code in faces) face.forced = faces[e.code];
  });
}

let time = 0;
let acc = 0;
let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let fps = 0;

// Keep the frame rate up by trading resolution for speed, and back again.
let perfTime = 0;
let perfFrames = 0;
let fastSeconds = 0;
function adaptQuality(elapsed: number): void {
  perfTime += elapsed;
  perfFrames++;
  if (perfTime < 1) return;
  const avg = perfTime / perfFrames;
  perfTime = perfFrames = 0;
  if (avg > 1 / 45 && quality > 0.5) {
    quality = Math.max(0.5, quality - 0.15);
    fastSeconds = 0;
    resize();
  } else if (avg < 1 / 55 && quality < 1) {
    if (++fastSeconds >= 3) {
      quality = Math.min(1, quality + 0.1);
      fastSeconds = 0;
      resize();
    }
  } else {
    fastSeconds = 0;
  }
}

function frame(now: number): void {
  const elapsed = Math.min((now - last) / 1000, 0.1);
  last = now;
  acc += elapsed;

  let steps = 0;
  while (acc >= STEP && steps < MAX_STEPS) {
    input.update(STEP);
    syncPointer();
    camera.box(body.box);
    handleTaps();
    pantry.update(STEP, body.box);
    brain.update(STEP, time, body, pointer, input.stillFor, pantry);
    body.update(STEP, time, pointer, brain.intent);
    face.update(STEP, time, body, pointer, brain.mood, brain.lookAt);
    camera.update(STEP, body.radius);
    time += STEP;
    acc -= STEP;
    steps++;
  }
  if (steps === MAX_STEPS) acc = 0;

  renderer.render(buildFrame(time), dpr);
  adaptQuality(elapsed);
  // While it's swallowing your cursor, your cursor is gone.
  sound.setPurr(brain.mood.content);
  const cursor = body.holdingCursor ? 'none' : '';
  if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;

  if (debugEl) {
    fpsFrames++;
    fpsTime += elapsed;
    if (fpsTime >= 0.5) {
      fps = fpsFrames / fpsTime;
      fpsFrames = 0;
      fpsTime = 0;
    }
    debugEl.textContent =
      `${brain.stageName} · bond ${brain.bond.toFixed(1)} · ` +
      Object.entries(brain.mood).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' ') + '\n' +
      `${fps.toFixed(0)} fps · dpr ${dpr.toFixed(2)} · ${useFallback ? '2D fallback' : 'WebGL2'}\n` +
      `mass ${body.mass} · catches ${body.catches} · radius ${body.radius.toFixed(1)}px · zoom ${camera.zoom.toFixed(2)}\n` +
      `g / G grow · r reset size · R start over · [ ] bond ±5 · 1–4 face (curious, happy, scared, sleepy) · 0 auto`;
    if (bondSlider && document.activeElement !== bondSlider) bondSlider.value = String(brain.bond);
  }

  requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  // Don't let a hidden tab come back to one giant catch-up step.
  last = performance.now();
  perfTime = perfFrames = 0;
});

requestAnimationFrame(frame);
