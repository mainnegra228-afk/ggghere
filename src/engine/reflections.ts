import type { ReflectionPath, Room, Vec2 } from './types';
import { material } from './materials';
import { dist, dot, edge, inwardNormal, materialAt, segmentIntersection, sub } from './geometry';

function mirror(p: Vec2, a: Vec2, n: Vec2): Vec2 {
  const d = dot(sub(p, a), n);
  return { x: p.x - 2 * d * n.x, y: p.y - 2 * d * n.y };
}

/** Point where segment p→q crosses wall w, as {point, t along wall}, or null. */
function crossWall(room: Room, w: number, p: Vec2, q: Vec2) {
  const [a, b] = edge(room.vertices, w);
  const hit = segmentIntersection(p, q, a, b);
  if (!hit || hit.u < 0.001 || hit.u > 0.999) return null;
  return { point: { x: p.x + (q.x - p.x) * hit.t, y: p.y + (q.y - p.y) * hit.t }, t: hit.u };
}

function visible(room: Room, p: Vec2, q: Vec2, ignore: number[]): boolean {
  for (let i = 0; i < room.vertices.length; i++) {
    if (ignore.includes(i)) continue;
    const [a, b] = edge(room.vertices, i);
    const hit = segmentIntersection(p, q, a, b);
    if (hit && hit.t > 1e-6 && hit.t < 1 - 1e-6) return false;
  }
  return true;
}

/** Specular wall reflections up to second order in plan view (image-source method). */
export function earlyReflections(room: Room, maxOrder = 2): ReflectionPath[] {
  const S = room.source, R = room.listener;
  const n = room.vertices.length;
  const direct = Math.max(0.1, dist(S, R));
  const paths: ReflectionPath[] = [];
  const atten = (wall: number, t: number) => 1 - material(materialAt(room, wall, t)).alpha[3];
  const normals = Array.from({ length: n }, (_, i) => inwardNormal(room.vertices, i));
  const facing = (p: Vec2, w: number) => dot(sub(p, room.vertices[w]), normals[w]) > 1e-6;

  for (let i = 0; i < n; i++) {
    if (!facing(S, i) || !facing(R, i)) continue;
    const img = mirror(S, room.vertices[i], normals[i]);
    const q = crossWall(room, i, img, R);
    if (!q) continue;
    if (!visible(room, S, q.point, [i]) || !visible(room, q.point, R, [i])) continue;
    const L = dist(img, R);
    paths.push({
      order: 1,
      points: [S, q.point, R],
      walls: [i],
      delayMs: ((L - direct) / 343) * 1000,
      levelDb: 20 * Math.log10(direct / L) + 10 * Math.log10(Math.max(1e-6, atten(i, q.t))),
    });
  }
  if (maxOrder >= 2) {
    for (let i = 0; i < n; i++) {
      if (!facing(S, i)) continue;
      const img1 = mirror(S, room.vertices[i], normals[i]);
      for (let j = 0; j < n; j++) {
        if (j === i || !facing(R, j)) continue;
        // The first image must lie on the front side of the second wall.
        if (dot(sub(img1, room.vertices[j]), normals[j]) <= 0) continue;
        const img2 = mirror(img1, room.vertices[j], normals[j]);
        const q2 = crossWall(room, j, img2, R);
        if (!q2) continue;
        const q1 = crossWall(room, i, img1, q2.point);
        if (!q1) continue;
        if (!visible(room, S, q1.point, [i]) || !visible(room, q1.point, q2.point, [i, j]) || !visible(room, q2.point, R, [j])) continue;
        const L = dist(img2, R);
        paths.push({
          order: 2,
          points: [S, q1.point, q2.point, R],
          walls: [i, j],
          delayMs: ((L - direct) / 343) * 1000,
          levelDb: 20 * Math.log10(direct / L) + 10 * Math.log10(Math.max(1e-6, atten(i, q1.t) * atten(j, q2.t))),
        });
      }
    }
  }
  return paths.sort((a, b) => a.delayMs - b.delayMs);
}

/** Wall parameter of the first-order reflection point on wall `w`, if it exists. */
export function firstReflectionPoint(room: Room, w: number): number | null {
  for (const p of earlyReflections(room, 1)) if (p.walls[0] === w) {
    const [a, b] = edge(room.vertices, w);
    const q = p.points[1];
    const L = dist(a, b);
    return dist(a, q) / L;
  }
  return null;
}
