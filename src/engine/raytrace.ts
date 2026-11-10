import type { RayTraceSettings, Room } from './types';
import { AIR_ABSORPTION, SPEED_OF_SOUND, material } from './materials';
import { dist, materialAt, segmentIntersection, inwardNormal, EAR_HEIGHT } from './geometry';

export { EAR_HEIGHT };

export interface RayTraceResult {
  binSize: number;
  bins: number;
  /** Reflected energy fluence per band per time bin (direct sound excluded). */
  histogram: Float32Array[];
  directTime: number;
  /** Direct energy fluence 1/(4πd²); 0 when the line of sight is blocked. */
  directEnergy: number;
  stats: { rays: number; reflections: number; detections: number; ms: number };
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A handful of 3D ray paths for visualisation: points [x, y(plan), z(height)] and the
 * remaining 1 kHz energy at each vertex.
 */
export function samplePaths(room: Room, count: number, maxBounces: number, seed = 9): { points: number[]; energy: number[] }[] {
  const random = rng(seed);
  const v = room.vertices, n = v.length, H = room.height;
  const out: { points: number[]; energy: number[] }[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const z0 = Math.min(EAR_HEIGHT, H * 0.5);
  for (let r = 0; r < count; r++) {
    const zz = (1 - (2 * (r + 0.5)) / count) * 0.85;
    const rad = Math.sqrt(1 - zz * zz);
    let dx = Math.cos(r * golden) * rad, dy = Math.sin(r * golden) * rad, dz = zz;
    let px = room.source.x, py = room.source.y, pz = z0;
    let e = 1;
    const points = [px, py, pz], energy = [e];
    let last = -1;
    for (let b = 0; b < maxBounces; b++) {
      let tHit = Infinity, wall = -1, u = 0;
      for (let i = 0; i < n; i++) {
        if (i === last) continue;
        const a = v[i], c = v[(i + 1) % n];
        const hit = segmentIntersection({ x: px, y: py }, { x: px + dx * 1e4, y: py + dy * 1e4 }, a, c);
        if (hit && hit.t * 1e4 > 1e-6 && hit.t * 1e4 < tHit) { tHit = hit.t * 1e4; wall = i; u = hit.u; }
      }
      let surf = wall >= 0 ? 0 : -1;
      if (dz < -1e-9 && -pz / dz < tHit) { tHit = -pz / dz; surf = 1; }
      if (dz > 1e-9 && (H - pz) / dz < tHit) { tHit = (H - pz) / dz; surf = 2; }
      if (surf < 0) break;
      px += dx * tHit; py += dy * tHit; pz += dz * tHit;
      let nx = 0, ny = 0, nz = 0, m;
      if (surf === 0) { const nn = inwardNormal(v, wall); nx = nn.x; ny = nn.y; m = material(materialAt(room, wall, u, pz)); last = wall; }
      else { nz = surf === 1 ? 1 : -1; m = material(surf === 1 ? room.floor : room.ceiling); last = -1; pz = surf === 1 ? 0 : H; }
      e *= 1 - m.alpha[3];
      points.push(px, py, pz); energy.push(e);
      if (e < 0.01) break;
      const dn = dx * nx + dy * ny + dz * nz;
      dx -= 2 * dn * nx; dy -= 2 * dn * ny; dz -= 2 * dn * nz;
      if (random() < m.scatter) {
        // Perturb towards diffuse while staying in the inner hemisphere.
        dx += (random() - 0.5) * 1.2; dy += (random() - 0.5) * 1.2; dz += (random() - 0.5) * 1.2;
        if (dx * nx + dy * ny + dz * nz < 0.05) { dx += nx; dy += ny; dz += nz; }
        const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      }
    }
    out.push({ points, energy });
  }
  return out;
}

export function lineOfSight(room: Room): boolean {
  const v = room.vertices;
  for (let i = 0; i < v.length; i++) {
    const hit = segmentIntersection(room.source, room.listener, v[i], v[(i + 1) % v.length]);
    if (hit && hit.t > 1e-6 && hit.t < 1 - 1e-6) return false;
  }
  return true;
}

/**
 * Stochastic 3D ray tracer for a vertically extruded floor plan (walls are vertical,
 * floor at z=0, ceiling at z=height). Energy is detected with a spherical receiver.
 */
export function traceRays(room: Room, settings: RayTraceSettings, onProgress?: (p: number) => void): RayTraceResult {
  const t0 = performance.now();
  const { rays, receiverRadius: r, maxTime, seed } = settings;
  const binSize = 0.001;
  const bins = Math.ceil(maxTime / binSize) + 1;
  const histogram = Array.from({ length: 6 }, () => new Float32Array(bins));
  const random = rng(seed);
  const c = SPEED_OF_SOUND;
  const maxDist = maxTime * c;
  const H = room.height;

  const v = room.vertices;
  const n = v.length;
  const ax = new Float64Array(n), ay = new Float64Array(n), ex = new Float64Array(n), ey = new Float64Array(n);
  const nx = new Float64Array(n), ny = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = v[i], b = v[(i + 1) % n];
    ax[i] = a.x; ay[i] = a.y; ex[i] = b.x - a.x; ey[i] = b.y - a.y;
    const nn = inwardNormal(v, i);
    nx[i] = nn.x; ny[i] = nn.y;
  }

  // Pre-resolve wall materials on an (along-wall × height) grid so panels are honoured cheaply.
  const SAMPLES = 64, ZS = 16;
  const wallAlpha: Float64Array[] = [];
  const wallScatter: Float64Array[] = [];
  for (let i = 0; i < n; i++) {
    const a = new Float64Array(SAMPLES * ZS * 6), s = new Float64Array(SAMPLES * ZS);
    for (let k = 0; k < SAMPLES; k++)
      for (let q = 0; q < ZS; q++) {
        const m = material(materialAt(room, i, (k + 0.5) / SAMPLES, ((q + 0.5) / ZS) * H));
        const cell = k * ZS + q;
        for (let b = 0; b < 6; b++) a[cell * 6 + b] = m.alpha[b];
        s[cell] = m.scatter;
      }
    wallAlpha.push(a); wallScatter.push(s);
  }
  const floorM = material(room.floor), ceilM = material(room.ceiling);

  const sx = room.source.x, sy = room.source.y, sz = Math.min(EAR_HEIGHT, H * 0.5);
  const rx = room.listener.x, ry = room.listener.y, rz = sz;
  const r2 = r * r;
  const sphereVol = (4 / 3) * Math.PI * r * r * r;
  const energyFloor = 1e-8;
  const e = new Float64Array(6);
  let reflections = 0, detections = 0;
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let ray = 0; ray < rays; ray++) {
    if (onProgress && ray % 2000 === 0) onProgress(ray / rays);
    // Fibonacci sphere gives an even initial distribution; small jitter avoids aliasing.
    const zz = 1 - (2 * (ray + 0.5)) / rays;
    const rad = Math.sqrt(Math.max(0, 1 - zz * zz));
    const phi = ray * golden + random() * 0.01;
    let dx = Math.cos(phi) * rad, dy = Math.sin(phi) * rad, dz = zz;
    let px = sx, py = sy, pz = sz;
    for (let b = 0; b < 6; b++) e[b] = 1 / rays;
    let travelled = 0;
    let lastWall = -1;
    let first = true;

    for (let bounce = 0; bounce < 2000; bounce++) {
      // Nearest boundary along the ray.
      let tHit = Infinity, hitWall = -1, hitU = 0;
      for (let i = 0; i < n; i++) {
        if (i === lastWall) continue;
        const den = dx * ey[i] - dy * ex[i];
        if (Math.abs(den) < 1e-12) continue;
        const qx = ax[i] - px, qy = ay[i] - py;
        const t = (qx * ey[i] - qy * ex[i]) / den;
        if (t <= 1e-9 || t >= tHit) continue;
        const u = (qx * dy - qy * dx) / den;
        if (u < 0 || u > 1) continue;
        tHit = t; hitWall = i; hitU = u;
      }
      let surface = hitWall >= 0 ? 0 : -1; // 0 wall, 1 floor, 2 ceiling
      if (dz < -1e-12) {
        const t = -pz / dz;
        if (t < tHit) { tHit = t; surface = 1; }
      } else if (dz > 1e-12) {
        const t = (H - pz) / dz;
        if (t < tHit) { tHit = t; surface = 2; }
      }
      if (surface < 0 || !isFinite(tHit)) break; // escaped through a vertex gap

      // Receiver detection on this segment (skip the first segment = direct sound).
      if (!first) {
        const wx = rx - px, wy = ry - py, wz = rz - pz;
        const s = Math.max(0, Math.min(tHit, wx * dx + wy * dy + wz * dz));
        const cx = px + dx * s - rx, cy = py + dy * s - ry, cz = pz + dz * s - rz;
        const d2 = cx * cx + cy * cy + cz * cz;
        if (d2 < r2) {
          const along = travelled + s;
          const bin = Math.floor(along / c / binSize);
          if (bin < bins) {
            const chord = 2 * Math.sqrt(r2 - d2);
            const w = chord / sphereVol;
            for (let b = 0; b < 6; b++) histogram[b][bin] += e[b] * Math.exp(-AIR_ABSORPTION[b] * along) * w;
            detections++;
          }
        }
      }
      first = false;

      travelled += tHit;
      if (travelled > maxDist) break;
      px += dx * tHit; py += dy * tHit; pz += dz * tHit;

      // Surface interaction.
      let snx: number, sny: number, snz: number, scatter: number;
      if (surface === 0) {
        const k = Math.min(SAMPLES - 1, Math.floor(hitU * SAMPLES));
        const q = Math.min(ZS - 1, Math.max(0, Math.floor((pz / H) * ZS)));
        const cell = k * ZS + q;
        const al = wallAlpha[hitWall];
        for (let b = 0; b < 6; b++) e[b] *= 1 - al[cell * 6 + b];
        scatter = wallScatter[hitWall][cell];
        snx = nx[hitWall]; sny = ny[hitWall]; snz = 0;
        lastWall = hitWall;
      } else {
        const m = surface === 1 ? floorM : ceilM;
        for (let b = 0; b < 6; b++) e[b] *= 1 - m.alpha[b];
        scatter = m.scatter;
        snx = 0; sny = 0; snz = surface === 1 ? 1 : -1;
        pz = surface === 1 ? 0 : H;
        lastWall = -1;
      }
      reflections++;
      let emax = 0;
      for (let b = 0; b < 6; b++) if (e[b] > emax) emax = e[b];
      if (emax * rays < energyFloor) break;

      if (random() < scatter) {
        // Lambertian (cosine-weighted) reflection around the surface normal.
        const u1 = random(), u2 = random();
        const rr = Math.sqrt(u1), th = 2 * Math.PI * u2;
        const lx = rr * Math.cos(th), ly = rr * Math.sin(th), lz = Math.sqrt(Math.max(0, 1 - u1));
        // Tangent basis.
        let tx: number, ty: number, tz: number;
        if (Math.abs(snz) > 0.9) { tx = 1; ty = 0; tz = 0; } else { tx = -sny; ty = snx; tz = 0; }
        const bx = sny * tz - snz * ty, by = snz * tx - snx * tz, bz = snx * ty - sny * tx;
        dx = tx * lx + bx * ly + snx * lz;
        dy = ty * lx + by * ly + sny * lz;
        dz = tz * lx + bz * ly + snz * lz;
        // A diffuse ray may in principle head back into the same wall plane only tangentially.
        lastWall = surface === 0 ? hitWall : -1;
      } else {
        const dn = dx * snx + dy * sny + dz * snz;
        dx -= 2 * dn * snx; dy -= 2 * dn * sny; dz -= 2 * dn * snz;
      }
    }
  }
  onProgress?.(1);

  const directOk = lineOfSight(room);
  const d = Math.max(0.1, dist(room.source, room.listener));
  return {
    binSize,
    bins,
    histogram,
    directTime: d / c,
    directEnergy: directOk ? 1 / (4 * Math.PI * d * d) : 0,
    stats: { rays, reflections, detections, ms: performance.now() - t0 },
  };
}
