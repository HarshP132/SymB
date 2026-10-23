import { Body, type Ball } from './creature/body';
import { Input, type Pointer } from './input';
import { GooRenderer, type Frame } from './render/goo';
import { Camera } from './world/camera';

const STEP = 1 / 120; // fixed physics step
const MAX_STEPS = 8;

const canvas = document.getElementById('stage') as HTMLCanvasElement;
// Debug tools: add ?debug or #debug to the URL.
const debug = new URLSearchParams(location.search).has('debug') || location.hash === '#debug';

let renderer: GooRenderer;
try {
  renderer = new GooRenderer(canvas);
} catch (err) {
  console.error(err);
  document.getElementById('fallback')!.style.display = 'flex';
  throw err;
}

const camera = new Camera();
let dpr = 1;
function resize(): void {
  // Capped so huge phone DPRs don't melt the fragment shader.
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  camera.resize(window.innerWidth, window.innerHeight);
}
resize();
window.addEventListener('resize', resize);

const input = new Input(canvas);
const body = new Body(0);

/** The cursor as SymB sees it: in world space. */
const pointer: Pointer = { x: 0, y: 0, vx: 0, vy: 0, speed: 0, active: false };
function syncPointer(): void {
  pointer.active = input.active;
  pointer.x = camera.toWorldX(input.x);
  pointer.y = camera.toWorldY(input.y);
  pointer.vx = input.vx / camera.zoom;
  pointer.vy = input.vy / camera.zoom;
  pointer.speed = input.speed / camera.zoom;
}

// Screen-space copy of the world for the renderer, reused every frame.
const screenBalls: Ball[] = [];
const frameData: Frame = {
  balls: screenBalls,
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  radius: 0,
  finger: { x: 0, y: 0, r: 0, strength: 0 },
  floorY: 0,
  contact: { x: 0, halfWidth: 0, strength: 1 },
  camX: 0,
  zoom: 1,
  time: 0,
};

function buildFrame(time: number): Frame {
  const z = camera.zoom;
  const sx = (x: number) => camera.toScreenX(x);
  const sy = (y: number) => camera.toScreenY(y);
  const f = frameData;

  screenBalls.length = body.balls.length;
  for (let i = 0; i < body.balls.length; i++) {
    const b = body.balls[i];
    const s = (screenBalls[i] ??= { x: 0, y: 0, r: 0 });
    s.x = sx(b.x);
    s.y = sy(b.y);
    s.r = b.r * z;
    s.sharp = b.sharp;
  }
  const wb = body.bounds;
  f.bounds.minX = sx(wb.minX);
  f.bounds.minY = sy(wb.minY);
  f.bounds.maxX = sx(wb.maxX);
  f.bounds.maxY = sy(wb.maxY);
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
  f.time = time;
  return f;
}

let debugEl: HTMLElement | null = null;
if (debug) {
  debugEl = document.createElement('div');
  debugEl.id = 'debug';
  document.body.appendChild(debugEl);
  (window as unknown as { symb: unknown }).symb = { body, camera, pointer };
  window.addEventListener('keydown', (e) => {
    // Match physical keys so layout and Caps Lock don't matter.
    if (e.code === 'KeyG') body.mass += e.shiftKey ? 25 : 1;
    if (e.code === 'KeyR') body.mass = 0;
  });
}

let time = 0;
let acc = 0;
let last = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let fps = 0;

function frame(now: number): void {
  const elapsed = Math.min((now - last) / 1000, 0.1);
  last = now;
  acc += elapsed;

  let steps = 0;
  while (acc >= STEP && steps < MAX_STEPS) {
    input.update(STEP);
    syncPointer();
    body.update(STEP, time, pointer);
    camera.update(STEP, body.hx, body.radius);
    time += STEP;
    acc -= STEP;
    steps++;
  }
  if (steps === MAX_STEPS) acc = 0;

  renderer.render(buildFrame(time), dpr);

  if (debugEl) {
    fpsFrames++;
    fpsTime += elapsed;
    if (fpsTime >= 0.5) {
      fps = fpsFrames / fpsTime;
      fpsFrames = 0;
      fpsTime = 0;
    }
    debugEl.textContent =
      `${fps.toFixed(0)} fps · dpr ${dpr}\n` +
      `mass ${body.mass} · catches ${body.catches} · radius ${body.radius.toFixed(1)}px · zoom ${camera.zoom.toFixed(2)}\n` +
      `g / G grow · r reset`;
  }

  requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  // Don't let a hidden tab come back to one giant catch-up step.
  last = performance.now();
});

requestAnimationFrame(frame);
