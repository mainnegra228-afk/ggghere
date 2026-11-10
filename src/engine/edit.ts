import type { Panel, Room, Vec2 } from './types';
import { dist, edge, isSimple, lerp, pointInPolygon, closestOnSegment } from './geometry';

let counter = 0;
export const uid = (p = 'p') => `${p}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Insert a vertex on wall `w` at parameter t, splitting panels that straddle the cut. */
export function splitWall(room: Room, w: number, t: number): Room {
  const [a, b] = edge(room.vertices, w);
  const vertices = [...room.vertices];
  vertices.splice(w + 1, 0, lerp(a, b, t));
  const wallMaterials = [...room.wallMaterials];
  wallMaterials.splice(w + 1, 0, room.wallMaterials[w]);
  const panels: Panel[] = [];
  for (const p of room.panels) {
    if (p.wall < w) panels.push(p);
    else if (p.wall > w) panels.push({ ...p, wall: p.wall + 1 });
    else {
      if (p.t0 < t) panels.push({ ...p, t0: p.t0 / t, t1: Math.min(p.t1, t) / t });
      if (p.t1 > t) panels.push({ ...p, id: p.t0 < t ? uid() : p.id, wall: w + 1, t0: (Math.max(p.t0, t) - t) / (1 - t), t1: (p.t1 - t) / (1 - t) });
    }
  }
  return { ...room, vertices, wallMaterials, panels: panels.filter((p) => p.t1 - p.t0 > 0.01) };
}

/** Remove vertex v; its two walls merge and panels are re-projected onto the new wall. */
export function removeVertex(room: Room, v: number): Room | null {
  const n = room.vertices.length;
  if (n <= 3) return null;
  const prev = (v - 1 + n) % n;
  const vertices = room.vertices.filter((_, i) => i !== v);
  if (!isSimple(vertices)) return null;
  const wallMaterials = room.wallMaterials.filter((_, i) => i !== v);
  const newIndex = (old: number) => (old > v ? old - 1 : old);
  const merged = newIndex(prev);
  const [na, nb] = edge(vertices, merged);
  const L = dist(na, nb);
  const panels: Panel[] = [];
  for (const p of room.panels) {
    if (p.wall !== v && p.wall !== prev) { panels.push({ ...p, wall: newIndex(p.wall) }); continue; }
    const [a, b] = edge(room.vertices, p.wall);
    const proj = (q: Vec2) => closestOnSegment(q, na, nb).t;
    const t0 = proj(lerp(a, b, p.t0)), t1 = proj(lerp(a, b, p.t1));
    if (Math.abs(t1 - t0) * L > 0.1) panels.push({ ...p, wall: merged, t0: Math.min(t0, t1), t1: Math.max(t0, t1) });
  }
  const fixed = { ...room, vertices, wallMaterials, panels };
  return ensureInside(fixed);
}

/** Polygon centroid (area-weighted). */
export function centroid(poly: Vec2[]): Vec2 {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-9) return poly[0];
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Find a point inside the polygon near `want`, falling back to a coarse search. */
export function insidePoint(poly: Vec2[], want: Vec2): Vec2 {
  if (pointInPolygon(want, poly) && marginOk(poly, want)) return want;
  const c = centroid(poly);
  if (pointInPolygon(c, poly) && marginOk(poly, c)) return c;
  let best = poly[0], bestD = Infinity;
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (let i = 1; i < 30; i++)
    for (let j = 1; j < 30; j++) {
      const p = { x: x0 + ((x1 - x0) * i) / 30, y: y0 + ((y1 - y0) * j) / 30 };
      if (!pointInPolygon(p, poly) || !marginOk(poly, p)) continue;
      const d = dist(p, want);
      if (d < bestD) { bestD = d; best = p; }
    }
  return best;
}

function marginOk(poly: Vec2[], p: Vec2, m = 0.15) {
  for (let i = 0; i < poly.length; i++) {
    const [a, b] = edge(poly, i);
    if (closestOnSegment(p, a, b).d < m) return false;
  }
  return true;
}

export function ensureInside(room: Room): Room {
  const source = insidePoint(room.vertices, room.source);
  let listener = insidePoint(room.vertices, room.listener);
  if (dist(source, listener) < 0.2) listener = insidePoint(room.vertices, { x: source.x + 0.6, y: source.y + 0.6 });
  return { ...room, source, listener };
}

export function isValidRoom(room: Room): boolean {
  return (
    isSimple(room.vertices) &&
    pointInPolygon(room.source, room.vertices) &&
    pointInPolygon(room.listener, room.vertices) &&
    room.wallMaterials.length === room.vertices.length &&
    room.height >= 2 && room.height <= 40
  );
}

/** Set the length of wall w by moving its end vertex along the wall direction. */
export function setWallLength(room: Room, w: number, length: number): Room | null {
  const n = room.vertices.length;
  const [a, b] = edge(room.vertices, w);
  const L = dist(a, b);
  if (L < 1e-6 || length < 0.2) return null;
  const k = length / L;
  const nb = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  const vertices = room.vertices.map((p, i) => (i === (w + 1) % n ? nb : p));
  const next = { ...room, vertices };
  return isValidRoom(next) ? next : null;
}

export function sanitizeRoom(input: unknown): Room | null {
  try {
    const r = input as Room;
    if (!r || !Array.isArray(r.vertices) || r.vertices.length < 3) return null;
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const vertices = r.vertices.map((p) => ({ x: num(p?.x, 0), y: num(p?.y, 0) }));
    const n = vertices.length;
    const wallMaterials = Array.from({ length: n }, (_, i) => (typeof r.wallMaterials?.[i] === 'string' ? r.wallMaterials[i] : 'drywall'));
    const panels = (Array.isArray(r.panels) ? r.panels : [])
      .filter((p) => p && Number.isInteger(p.wall) && p.wall >= 0 && p.wall < n)
      .map((p) => ({ id: String(p.id ?? uid()), wall: p.wall, t0: Math.max(0, Math.min(1, num(p.t0, 0))), t1: Math.max(0, Math.min(1, num(p.t1, 1))), material: String(p.material ?? 'absorber-50'), ...(typeof p.height === 'number' && p.height > 0 ? { height: Math.min(40, p.height) } : {}) }))
      .filter((p) => p.t1 > p.t0);
    const room: Room = {
      name: typeof r.name === 'string' ? r.name.slice(0, 80) : 'Imported room',
      vertices,
      wallMaterials,
      panels,
      floor: typeof r.floor === 'string' ? r.floor : 'wood-floor',
      ceiling: typeof r.ceiling === 'string' ? r.ceiling : 'drywall',
      height: Math.max(2, Math.min(40, num(r.height, 2.7))),
      source: { x: num(r.source?.x, 0), y: num(r.source?.y, 0) },
      listener: { x: num(r.listener?.x, 0), y: num(r.listener?.y, 0) },
    };
    if (!isSimple(room.vertices)) return null;
    return ensureInside(room);
  } catch {
    return null;
  }
}
