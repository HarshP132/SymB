// Full-screen WebGL2 pass: the white void plus SymB's metaball body.
// Each pixel sums the field r²/d² of every ball; the surface sits at field = 1.

import type { Ball } from '../creature/body';

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
uniform vec4 uBalls[MAX_BALLS]; // xy center, z radius (css px)
uniform vec4 uBounds;   // minX, minY, maxX, maxY (css px)
uniform float uR;       // body radius (css px), for scale-free shading
uniform vec4 uFinger;   // pointer dent: xy, radius, strength
uniform float uFloor;   // floor line, css px from the top
uniform vec2 uContact;  // centre x and half-width of the part touching the floor

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
    f += v;
    g -= 2.0 * v * d / dd; // gradient of r²/d²
  }
  // The pointer carves a smooth, finite dent: f -= s·(1 - d²/S)².
  vec2 fd = p - uFinger.xy;
  float S = 4.0 * uFinger.z * uFinger.z;
  float k = max(0.0, 1.0 - dot(fd, fd) / S);
  f -= uFinger.w * 1.2 * k * k;
  g += uFinger.w * 1.2 * 4.0 * k * fd / S;
  return f;
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
  bg *= 1.0 - (0.22 * pool + 0.35 * tight) * smoothstep(-uR * 0.2, 0.0, dyF);

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

export class GooRenderer {
  private gl: WebGL2RenderingContext;
  private uRes: WebGLUniformLocation | null;
  private uDpr: WebGLUniformLocation | null;
  private uCount: WebGLUniformLocation | null;
  private uBalls: WebGLUniformLocation | null;
  private uBounds: WebGLUniformLocation | null;
  private uR: WebGLUniformLocation | null;
  private uFinger: WebGLUniformLocation | null;
  private uFloor: WebGLUniformLocation | null;
  private uContact: WebGLUniformLocation | null;
  private ballData = new Float32Array(MAX_BALLS * 4);

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

    this.uRes = gl.getUniformLocation(prog, 'uRes');
    this.uDpr = gl.getUniformLocation(prog, 'uDpr');
    this.uCount = gl.getUniformLocation(prog, 'uCount');
    this.uBalls = gl.getUniformLocation(prog, 'uBalls');
    this.uBounds = gl.getUniformLocation(prog, 'uBounds');
    this.uR = gl.getUniformLocation(prog, 'uR');
    this.uFinger = gl.getUniformLocation(prog, 'uFinger');
    this.uFloor = gl.getUniformLocation(prog, 'uFloor');
    this.uContact = gl.getUniformLocation(prog, 'uContact');
  }

  render(
    balls: readonly Ball[],
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
    radius: number,
    finger: { x: number; y: number; r: number; strength: number },
    floorY: number,
    contact: { x: number; halfWidth: number },
    dpr: number,
  ): void {
    const gl = this.gl;
    const n = Math.min(balls.length, MAX_BALLS);
    for (let i = 0; i < n; i++) {
      const b = balls[i];
      this.ballData[i * 4] = b.x;
      this.ballData[i * 4 + 1] = b.y;
      this.ballData[i * 4 + 2] = b.r;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uDpr, dpr);
    gl.uniform1i(this.uCount, n);
    gl.uniform4fv(this.uBalls, this.ballData);
    gl.uniform4f(this.uBounds, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
    gl.uniform1f(this.uR, radius);
    gl.uniform4f(this.uFinger, finger.x, finger.y, finger.r, finger.strength);
    gl.uniform1f(this.uFloor, floorY);
    gl.uniform2f(this.uContact, contact.x, contact.halfWidth);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
