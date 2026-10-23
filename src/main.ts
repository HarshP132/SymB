import { Body } from './creature/body';
import { Input } from './input';
import { GooRenderer } from './render/goo';

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

let dpr = 1;
let viewW = 0;
let viewH = 0;
let floorY = 0;
function resize(): void {
  // Capped so huge phone DPRs don't melt the fragment shader.
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  // The ground sits a little below the middle, leaving room to play above it.
  floorY = Math.round(viewH * 0.68);
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
}
resize();
window.addEventListener('resize', resize);

const input = new Input(canvas);
const body = new Body(viewW / 2, floorY - 40);

let debugEl: HTMLElement | null = null;
if (debug) {
  debugEl = document.createElement('div');
  debugEl.id = 'debug';
  document.body.appendChild(debugEl);
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
    body.update(STEP, time, input, viewW, floorY);
    time += STEP;
    acc -= STEP;
    steps++;
  }
  if (steps === MAX_STEPS) acc = 0;

  renderer.render(body.balls, body.bounds, body.radius, body.finger, floorY, body.contact, dpr);

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
      `mass ${body.mass} · radius ${body.radius.toFixed(1)}px\n` +
      `g / G grow · r reset`;
  }

  requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  // Don't let a hidden tab come back to one giant catch-up step.
  last = performance.now();
});

requestAnimationFrame(frame);
