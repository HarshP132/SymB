// Remembers SymB between visits, in this browser only.

const KEY = 'symb.v1';

export interface Saved {
  bond: number;
  mass: number;
  catches: number;
  /** Stages it has reached (each one's moment plays only once). */
  reached: number[];
  /** When it was saved, ms since epoch. */
  at: number;
}

export function load(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Saved>;
    if (typeof s.bond !== 'number' || typeof s.mass !== 'number') return null;
    return {
      bond: s.bond,
      mass: s.mass,
      catches: s.catches ?? 0,
      reached: Array.isArray(s.reached) ? s.reached : [],
      at: s.at ?? Date.now(),
    };
  } catch {
    return null; // storage blocked or corrupt: start fresh
  }
}

export function save(s: Omit<Saved, 'at'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, at: Date.now() }));
  } catch {
    // Private mode or storage full: SymB just won't remember this visit.
  }
}

export function forget(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
