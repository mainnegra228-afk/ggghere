import type { Panel, Room, Vec2 } from './types';
import { material } from './materials';

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function signedArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export const area = (poly: Vec2[]) => Math.abs(signedArea(poly));

export function perimeter(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += dist(poly[i], poly[(i + 1) % poly.length]);
  return s;
}

export function edge(poly: Vec2[], i: number): [Vec2, Vec2] {
  return [poly[i], poly[(i + 1) % poly.length]];
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Closest point on segment ab to p, with its parameter t in [0,1]. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; d: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab) || 1e-12;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const point = lerp(a, b, t);
  return { point, t, d: dist(p, point) };
}

/** Intersection of segments p1p2 and p3p4. Returns params (t on first, u on second) or null. */
export function segmentIntersection(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): { t: number; u: number } | null {
  const r = sub(p2, p1);
  const s = sub(p4, p3);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const qp = sub(p3, p1);
  const t = cross(qp, s) / den;
  const u = cross(qp, r) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

/** True when the polygon has no crossing (non-adjacent) edges. */
export function isSimple(poly: Vec2[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const [a, b] = edge(poly, i);
    if (dist(a, b) < 0.05) return false;
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const [c, d] = edge(poly, j);
      const hit = segmentIntersection(a, b, c, d);
      if (hit) return false;
    }
  }
  return Math.abs(signedArea(poly)) > 0.5;
}

/** Inward unit normal of edge i (polygon is normalised to counter-clockwise). */
export function inwardNormal(poly: Vec2[], i: number): Vec2 {
  const [a, b] = edge(poly, i);
  const d = sub(b, a);
  const l = len(d) || 1;
  const ccw = signedArea(poly) > 0;
  return ccw ? { x: -d.y / l, y: d.x / l } : { x: d.y / l, y: -d.x / l };
}

export function bounds(poly: Vec2[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export const EAR_HEIGHT = 1.2;
export const DEFAULT_PANEL_HEIGHT = 0.6;

/** Vertical extent [z0, z1] of a panel: centred at ear height, clamped into the room. */
export function panelSpan(room: Room, p: Panel): [number, number] {
  const H = room.height;
  const h = Math.min(H, p.height ?? DEFAULT_PANEL_HEIGHT);
  const c = Math.min(Math.max(Math.min(EAR_HEIGHT, H / 2), h / 2), H - h / 2);
  return [c - h / 2, c + h / 2];
}

/** Material id at a position on a wall (t along it, z height), honouring treatment panels. */
export function materialAt(room: Room, wall: number, t: number, z = Math.min(EAR_HEIGHT, room.height / 2)): string {
  for (let k = room.panels.length - 1; k >= 0; k--) {
    const p = room.panels[k];
    if (p.wall !== wall || t < p.t0 || t > p.t1) continue;
    const [z0, z1] = panelSpan(room, p);
    if (z >= z0 && z <= z1) return p.material;
  }
  return room.wallMaterials[wall];
}

export function wallLength(room: Room, i: number) {
  const [a, b] = edge(room.vertices, i);
  return dist(a, b);
}

export function roomVolume(room: Room) {
  return area(room.vertices) * room.height;
}

export function roomSurface(room: Room) {
  return perimeter(room.vertices) * room.height + 2 * area(room.vertices);
}

/** Absorption area (m² Sabine) per band including panels, floor and ceiling. */
export function absorptionArea(room: Room): number[] {
  const A = [0, 0, 0, 0, 0, 0];
  const fl = area(room.vertices);
  const add = (id: string, s: number) => {
    const m = material(id);
    for (let b = 0; b < 6; b++) A[b] += m.alpha[b] * s;
  };
  add(room.floor, fl);
  add(room.ceiling, fl);
  for (let i = 0; i < room.vertices.length; i++) {
    const L = wallLength(room, i);
    // Panels on the same wall may overlap; integrate along the wall at fine resolution.
    const panels = room.panels.filter((p) => p.wall === i);
    if (panels.length === 0) {
      add(room.wallMaterials[i], L * room.height);
      continue;
    }
    // Panels may overlap and cover only part of the height; integrate over the wall face.
    const steps = 120, zs = 24;
    const counts = new Map<string, number>();
    for (let s = 0; s < steps; s++)
      for (let q = 0; q < zs; q++) {
        const id = materialAt(room, i, (s + 0.5) / steps, ((q + 0.5) / zs) * room.height);
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    for (const [id, c] of counts) add(id, (c / (steps * zs)) * L * room.height);
  }
  return A;
}

/** Normalise polygon to counter-clockwise winding, keeping per-edge data aligned. */
export function normaliseWinding(room: Room): Room {
  if (signedArea(room.vertices) >= 0) return room;
  const n = room.vertices.length;
  const vertices = [...room.vertices].reverse();
  // Reversed edge i runs from old vertex n-1-i to n-2-i, i.e. old edge (n-2-i) mod n.
  const map = (i: number) => (((n - 2 - i) % n) + n) % n;
  const wallMaterials = vertices.map((_, i) => room.wallMaterials[map(i)]);
  const inverse = new Map<number, number>();
  for (let i = 0; i < n; i++) inverse.set(map(i), i);
  const panels = room.panels.map((p) => ({ ...p, wall: inverse.get(p.wall)!, t0: 1 - p.t1, t1: 1 - p.t0 }));
  return { ...room, vertices, wallMaterials, panels };
}
