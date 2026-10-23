// Maps SymB's world (floor at y = 0, x unbounded) onto the screen.
// It follows SymB lazily and zooms out as SymB grows, forever.

/** The floor sits this far down the screen. */
const FLOOR_AT = 0.68;
/** SymB's visible width never exceeds this share of the smaller screen side. */
const MAX_SHARE = 0.3;
/** Visible silhouette diameter, in body radii (see Body). */
const SILHOUETTE = 3.3;

export class Camera {
  x = 0;
  zoom = 1;
  floorScreen = 0;
  private viewW = 0;
  private viewH = 0;

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    this.floorScreen = Math.round(h * FLOOR_AT);
  }

  update(dt: number, focusX: number, radius: number): void {
    // Only pan once SymB leaves the middle of the screen, so chasing the
    // cursor around the visible area doesn't drag the world along.
    const deadZone = (this.viewW / 2 / this.zoom) * 0.45;
    const off = focusX - this.x;
    if (Math.abs(off) > deadZone) {
      this.x += (off - Math.sign(off) * deadZone) * Math.min(1, dt * 3);
    }
    const fit = (MAX_SHARE * Math.min(this.viewW, this.viewH)) / (SILHOUETTE * radius);
    const target = Math.min(1, fit);
    this.zoom += (target - this.zoom) * Math.min(1, dt * 1.5);
  }

  toScreenX(wx: number): number {
    return (wx - this.x) * this.zoom + this.viewW / 2;
  }

  toScreenY(wy: number): number {
    return wy * this.zoom + this.floorScreen;
  }

  toWorldX(sx: number): number {
    return (sx - this.viewW / 2) / this.zoom + this.x;
  }

  toWorldY(sy: number): number {
    return (sy - this.floorScreen) / this.zoom;
  }
}
