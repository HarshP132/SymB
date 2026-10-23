// Full-screen WebGL2 pass: the white void plus SymB's metaball body.
// Each pixel sums the field r²/d² of every ball; the surface sits at field = 1.

import type { Ball } from '../creature/body';
import type { Eye } from '../creature/face';

export const MAX_BALLS = 96;

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;

#define MAX_BALLS ${MAX_BALLS}

uniform vec2 uRes;      // canvas size, device px
uniform float uDpr;
uniform int uCount;
uniform vec4 uBalls[MAX_BALLS]; // xy center, z radius (css px), w 1 = sharp falloff
uniform vec4 uBounds;   // minX, minY, maxX, maxY (css px)
uniform float uR;       // body radius (css px), for scale-free shading
uniform vec4 uFinger;   // pointer dent: xy, radius, strength
uniform float uFloor;   // floor line, css px from the top
uniform vec3 uContact;  // centre x, half-width and strength of the floor contact
uniform float uCamX;    // camera x in world px, for dust parallax
uniform float uZoom;
uniform float uTime;
uniform vec4 uEyeA[2]; // x, y, rx, ry (css px)
uniform vec4 uEyeB[2]; // tilt, open, happy, lid
uniform vec2 uEyeC[2]; // lidTilt, side

out vec4 outColor;

const vec3 INK = vec3(0.028, 0.028, 0.036);

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Metaball field at p, with its gradient in g. The surface is f = 1.
float field(vec2 p, out vec2 g) {
  g = vec2(0.0);
  if (p.x < uBounds.x || p.y < uBounds.y || p.x > uBounds.z || p.y > uBounds.w) return 0.0;
  float f = 0.0;
  for (int i = 0; i < MAX_BALLS; i++) {
    if (i >= uCount) break;
    vec2 d = p - uBalls[i].xy;
    float dd = dot(d, d) + 1e-3;
    float v = uBalls[i].z * uBalls[i].z / dd;
    if (uBalls[i].w > 0.5) {
      f += v * v;
      g -= 4.0 * v * v * d / dd; // gradient of (r²/d²)²
    } else {
      f += v;
      g -= 2.0 * v * d / dd; // gradient of r²/d²
    }
  }
  // The pointer carves a smooth, finite dent: f -= s·(1 - d²/S)².
  vec2 fd = p - uFinger.xy;
  float S = 4.0 * uFinger.z * uFinger.z;
  float k = max(0.0, 1.0 - dot(fd, fd) / S);
  f -= uFinger.w * 1.2 * k * k;
  g += uFinger.w * 1.2 * 4.0 * k * fd / S;
  return f;
}

// Sparse dust drifting through the void in three parallax layers. Near
// layers pan with the camera and shrink as it zooms out to fit SymB, so
// the specks keep telling you how big SymB has become.
float dust(vec2 p, float viewW) {
  float a = 0.0;
  for (int i = 0; i < 3; i++) {
    float l = float(i);
    float par = 0.35 + 0.3 * l;
    float zl = pow(uZoom, par);
    float cell = 70.0 + 45.0 * l;
    vec2 q = vec2((p.x - 0.5 * viewW) / zl + uCamX * par, (p.y - uFloor) / zl);
    q += vec2(uTime * (3.0 + 2.0 * l), -uTime * (1.5 + l)) + l * 137.0;
    vec2 id = floor(q / cell);
    float h = hash(id + l * 17.0);
    if (h > 0.45) continue;
    vec2 c = (0.2 + 0.6 * vec2(hash(id + 3.1), hash(id + 7.7))) * cell;
    float r = (0.8 + 1.6 * hash(id + 11.3)) * zl * (0.7 + 0.3 * l);
    float d = length(q - id * cell - c) * zl;
    float twinkle = 0.75 + 0.25 * sin(uTime * 0.9 + h * 40.0);
    a += (0.18 + 0.14 * l) * twinkle * (1.0 - smoothstep(r - 0.6, r + 0.6, d));
  }
  return a;
}

// Cheap signed distance to an ellipse (good near the edge, which is all
// anti-aliasing needs).
float sdEllipse(vec2 p, vec2 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-5);
}

// One of SymB's eyes: a tilted oval, optionally cut into a happy crescent
// from below and covered by a (possibly slanted) upper lid. Returns
// coverage, and a 0..1 shade that darkens under the lid line.
vec2 eye(vec2 p, vec4 a, vec4 b, vec2 c) {
  float side = c.y;
  vec2 q = p - a.xy;
  q.x *= side; // local +x points away from the face's centre
  float cs = cos(b.x), sn = sin(b.x);
  vec2 e = vec2(q.x * cs + q.y * sn, -q.x * sn + q.y * cs);

  float open = b.y;
  float ry = max(a.w * open, 0.9 / uDpr);
  // Lids meet a little below the middle, like real ones.
  e.y -= (1.0 - open) * a.w * 0.3;
  float d = sdEllipse(e, vec2(a.z, ry));

  // Happy: a bigger oval rises from below and bites the eye into a ^.
  float happy = b.z;
  if (happy > 0.001) {
    vec2 hc = vec2(0.0, ry * (0.62 + 1.9 * (1.0 - happy)));
    d = max(d, -sdEllipse(e - hc, vec2(a.z * 1.12, ry * 1.08)));
  }

  // Upper lid: comes down by "lid", its inner end raised by "lidTilt".
  float lid = b.w;
  if (lid > 0.001) {
    float slope = c.x * ry / a.z;
    float y0 = -ry + 2.0 * ry * lid;
    d = max(d, (y0 + slope * e.x - e.y) / sqrt(1.0 + slope * slope));
  }

  float cover = clamp(-d * uDpr + 0.5, 0.0, 1.0);
  float shade = smoothstep(-ry, ry * 0.2, e.y);
  return vec2(cover, shade);
}

// Anti-aliased coverage of the surface, from an approximate distance.
float coverage(float f, vec2 g) {
  float sd = (f - 1.0) / max(length(g), 1e-4);
  float a = clamp(sd * uDpr + 0.5, 0.0, 1.0);
  return max(a, smoothstep(1.3, 1.6, f)); // sd is unreliable deep inside
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 p = frag / uDpr;
  vec2 uv = frag / uRes;
  float viewH = uRes.y / uDpr;

  // The void above, a pale endless floor below, joined by a soft horizon.
  vec3 sky = vec3(0.980, 0.980, 0.972);
  float depth = clamp((p.y - uFloor) / max(viewH - uFloor, 1.0), 0.0, 1.0);
  vec3 ground = mix(vec3(0.950, 0.950, 0.942), vec3(0.972, 0.972, 0.964), depth);
  float below = smoothstep(uFloor - 0.75, uFloor + 0.75, p.y);
  vec3 bg = mix(sky, ground, below);
  bg = mix(bg, vec3(0.62, 0.62, 0.6), dust(p, uRes.x / uDpr) * (1.0 - below)
      * smoothstep(0.0, 24.0, uFloor - p.y));
  bg *= 1.0 - 0.05 * smoothstep(0.35, 0.95, length(uv - 0.5));
  bg += (hash(frag) - 0.5) * 0.012;

  vec2 g;
  float f = field(p, g);

  // Soft ambient shadow so the goo sits in the void, not on top of it.
  bg *= 1.0 - 0.09 * smoothstep(0.35, 1.0, f) * (1.0 - below);

  // Contact shadow: a broad soft pool plus a tight dark line where it touches.
  float cx = (p.x - uContact.x) / max(uContact.y, 1.0);
  float dyF = p.y - uFloor;
  float pool = exp(-(cx * cx * 1.2 + pow(dyF / (uR * 0.45), 2.0)));
  float tight = exp(-(cx * cx * 2.5 + pow(dyF / (uR * 0.1), 2.0)));
  float cs = uContact.z;
  bg *= 1.0 - (0.22 * pool * cs + 0.35 * tight * cs * cs * cs) * smoothstep(-uR * 0.2, 0.0, dyF);

  // Glossy floor: a faded mirror image of the goo.
  if (dyF > 0.0) {
    vec2 gr;
    float fr = field(vec2(p.x, 2.0 * uFloor - p.y), gr);
    float fade = exp(-dyF / (uR * 0.6));
    bg = mix(bg, INK, coverage(fr, gr) * 0.16 * fade);
  }

  // The goo itself, cut flat where it rests on the floor.
  float gl = max(length(g), 1e-4);
  float sd = (f - 1.0) / gl; // approx. distance inside the surface, css px
  float alpha = coverage(f, g) * (1.0 - below);

  // Fake a glossy dome: normals tilt outward near the edge.
  vec2 outward = -g / gl;
  // Near ball centres the gradient is singular and sd collapses, so also
  // flatten the dome wherever the field is deep inside the surface.
  float tilt = exp(-max(sd, 0.0) / (uR * 0.32)) * (1.0 - smoothstep(1.4, 3.5, f)) * 0.96;
  vec3 n = normalize(vec3(outward * tilt, sqrt(1.0 - tilt * tilt)));

  vec3 L = normalize(vec3(-0.45, -0.6, 0.66)); // light from upper left
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float nh = max(dot(n, H), 0.0);
  float spec = pow(nh, 70.0) * 0.85 + pow(nh, 10.0) * 0.05;
  // A black gloss in a white world reflects white at grazing angles.
  float fres = pow(1.0 - n.z, 3.0) * 0.32;
  // The pale floor bounces a little light onto the underside.
  float bounce = smoothstep(uFloor - uR * 0.6, uFloor, p.y) * 0.05;

  vec3 col = INK + vec3(spec) + vec3(fres) * vec3(0.93, 0.93, 0.95) + vec3(bounce);

  // Eyes, painted on the goo (so a dent or a stretch takes them along).
  for (int i = 0; i < 2; i++) {
    vec2 ev = eye(p, uEyeA[i], uEyeB[i], uEyeC[i]);
    vec3 white = mix(vec3(0.80, 0.80, 0.82), vec3(0.975, 0.975, 0.965), ev.y);
    col = mix(col, white, ev.x);
  }

  outColor = vec4(mix(bg, col, alpha), 1.0);
}
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) ?? 'shader compile failed');
  }
  return sh;
}

/** Everything the renderer needs for one frame, in screen (css px) space. */
export interface Frame {
  balls: readonly Ball[];
  eyes: readonly Eye[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  radius: number;
  finger: { x: number; y: number; r: number; strength: number };
  floorY: number;
  contact: { x: number; halfWidth: number; strength: number };
  camX: number;
  zoom: number;
  time: number;
}

const UNIFORMS = [
  'uRes', 'uDpr', 'uCount', 'uBalls', 'uBounds', 'uR', 'uFinger',
  'uFloor', 'uContact', 'uCamX', 'uZoom', 'uTime', 'uEyeA', 'uEyeB', 'uEyeC',
] as const;

export class GooRenderer {
  private gl: WebGL2RenderingContext;
  private u = {} as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private ballData = new Float32Array(MAX_BALLS * 4);
  private eyeA = new Float32Array(8);
  private eyeB = new Float32Array(8);
  private eyeC = new Float32Array(4);

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) ?? 'program link failed');
    }
    gl.useProgram(prog);

    // One triangle that covers the whole screen.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    for (const name of UNIFORMS) this.u[name] = gl.getUniformLocation(prog, name);
  }

  render(f: Frame, dpr: number): void {
    const gl = this.gl;
    const u = this.u;
    const n = Math.min(f.balls.length, MAX_BALLS);
    for (let i = 0; i < n; i++) {
      const b = f.balls[i];
      this.ballData[i * 4] = b.x;
      this.ballData[i * 4 + 1] = b.y;
      this.ballData[i * 4 + 2] = b.r;
      this.ballData[i * 4 + 3] = b.sharp ? 1 : 0;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform1i(u.uCount, n);
    gl.uniform4fv(u.uBalls, this.ballData);
    gl.uniform4f(u.uBounds, f.bounds.minX, f.bounds.minY, f.bounds.maxX, f.bounds.maxY);
    gl.uniform1f(u.uR, f.radius);
    gl.uniform4f(u.uFinger, f.finger.x, f.finger.y, f.finger.r, f.finger.strength);
    gl.uniform1f(u.uFloor, f.floorY);
    gl.uniform3f(u.uContact, f.contact.x, f.contact.halfWidth, f.contact.strength);
    gl.uniform1f(u.uCamX, f.camX);
    gl.uniform1f(u.uZoom, f.zoom);
    gl.uniform1f(u.uTime, f.time);
    for (let i = 0; i < 2; i++) {
      const e = f.eyes[i];
      this.eyeA.set([e.x, e.y, e.rx, e.ry], i * 4);
      this.eyeB.set([e.tilt, e.open, e.happy, e.lid], i * 4);
      this.eyeC.set([e.lidTilt, e.side], i * 2);
    }
    gl.uniform4fv(u.uEyeA, this.eyeA);
    gl.uniform4fv(u.uEyeB, this.eyeB);
    gl.uniform2fv(u.uEyeC, this.eyeC);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
