// For devices without WebGL2: the same scene drawn with plain Canvas 2D.
// The goo uses the classic "gooey" trick: black circles, blurred, then an
// SVG filter turns the soft alpha into a hard edge so circles melt together
// like metaballs. Eyes and shadows are drawn on a second canvas on top.

import type { Ball } from '../creature/body';
import type { Frame } from './goo';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FILTER_ID = 'symb-goo';

export class FallbackRenderer {
  private goo: CanvasRenderingContext2D;
  private overlay: HTMLCanvasElement;
  private top: CanvasRenderingContext2D;
  private blur: SVGFEGaussianBlurElement;
  private floorY = -1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.goo = ctx;

    // Blur, then crank alpha contrast: soft blobs become one crisp surface.
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    const filter = document.createElementNS(SVG_NS, 'filter');
    filter.id = FILTER_ID;
    this.blur = document.createElementNS(SVG_NS, 'feGaussianBlur');
    this.blur.setAttribute('stdDeviation', '8');
    const matrix = document.createElementNS(SVG_NS, 'feColorMatrix');
    matrix.setAttribute('values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7');
    filter.append(this.blur, matrix);
    svg.append(filter);
    document.body.append(svg);
    canvas.style.filter = `url(#${FILTER_ID})`;
    canvas.style.background = 'transparent';

    this.overlay = document.createElement('canvas');
    Object.assign(this.overlay.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    });
    canvas.after(this.overlay);
    this.top = this.overlay.getContext('2d')!;
  }

  render(f: Frame, dpr: number): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (this.overlay.width !== w || this.overlay.height !== h) {
      this.overlay.width = w;
      this.overlay.height = h;
    }
    this.paintBackground(f.floorY);
    this.blur.setAttribute('stdDeviation', String(Math.max(3, f.radius * 0.28)));

    // The goo: plain black circles (and spike triangles), kept above the floor.
    // Clear in device pixels, before scaling, so the whole canvas is wiped.
    const g = this.goo;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.save();
    g.beginPath();
    g.rect(0, 0, w / dpr, f.floorY);
    g.clip();
    g.fillStyle = '#08080b';
    g.beginPath();
    for (const b of f.balls) {
      const r = this.inflate(b, f.radius);
      g.moveTo(b.x + r, b.y);
      g.arc(b.x, b.y, r, 0, Math.PI * 2);
    }
    g.fill();
    if (f.spike.amount > 0.03) {
      const { x, y, r, amount } = f.spike;
      g.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = Math.PI + (i + 0.5) * (Math.PI / 7);
        const len = r * (1.9 + 0.45 * ((i * 0.618) % 1)) * amount;
        const side = 0.18;
        g.moveTo(x + Math.cos(a - side) * r, y + Math.sin(a - side) * r * 0.9);
        g.lineTo(x + Math.cos(a) * (r + len), y + Math.sin(a) * (r + len) * 0.9);
        g.lineTo(x + Math.cos(a + side) * r, y + Math.sin(a + side) * r * 0.9);
      }
      g.fill();
    }
    g.restore();

    // On top: the contact shadow, the swallowed-cursor glint and the eyes.
    const t = this.top;
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.clearRect(0, 0, w, h);
    t.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = f.contact;
    if (c.halfWidth > 0) {
      t.fillStyle = `rgba(0, 0, 0, ${0.18 * c.strength})`;
      t.beginPath();
      t.ellipse(c.x, f.floorY + 2, c.halfWidth * 1.05, Math.max(2, f.radius * 0.12), 0, 0, Math.PI * 2);
      t.fill();
    }
    if (f.prey.alpha > 0.02) {
      t.fillStyle = `rgba(248, 248, 246, ${f.prey.alpha})`;
      t.beginPath();
      t.arc(f.prey.x, f.prey.y, f.prey.r, 0, Math.PI * 2);
      t.fill();
    }
    // Keep the eyes on the goo: clip to roughly its silhouette.
    t.save();
    t.beginPath();
    for (const b of f.balls) {
      const r = this.inflate(b, f.radius) * 0.9;
      t.moveTo(b.x + r, b.y);
      t.arc(b.x, b.y, r, 0, Math.PI * 2);
    }
    t.clip();
    t.fillStyle = '#f7f7f4';
    t.strokeStyle = '#f7f7f4';
    for (const e of f.eyes) {
      t.save();
      t.translate(e.x, e.y);
      t.scale(e.side, 1);
      t.rotate(e.tilt);
      const open = e.open * (1 - e.lid * 0.8);
      if (e.happy > 0.5) {
        // A happy ^ arc.
        t.lineWidth = Math.max(1.5, e.rx * 0.45);
        t.lineCap = 'round';
        t.beginPath();
        t.arc(0, e.ry * 0.35, e.rx * 0.9, Math.PI * 1.15, Math.PI * 1.85);
        t.stroke();
      } else {
        t.beginPath();
        t.ellipse(0, e.ry * (1 - open) * 0.3, e.rx, Math.max(0.8, e.ry * open), 0, 0, Math.PI * 2);
        t.fill();
      }
      t.restore();
    }
    t.restore();
  }

  /**
   * Overlapping metaball fields swell well past their balls; plain circles
   * don't, so grow them (big ones most) to match the WebGL silhouette.
   */
  private inflate(b: Ball, R: number): number {
    if (b.sharp) return b.r * 1.1;
    return b.r * 1.3 + R * 0.5 * Math.min(1, b.r / (R * 0.3));
  }

  /** The void and the floor, as a page background (repainted on resize). */
  private paintBackground(floorY: number): void {
    if (floorY === this.floorY) return;
    this.floorY = floorY;
    document.body.style.background =
      `linear-gradient(to bottom, #fafaf8 0, #fafaf8 ${floorY}px, #f1f1ec ${floorY}px, #f7f7f3 100%)`;
  }
}
