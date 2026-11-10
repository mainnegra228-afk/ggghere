import type { Room, Vec2 } from './types';
import { material, SPEED_OF_SOUND } from './materials';
import { bounds, closestOnSegment, edge, materialAt, pointInPolygon } from './geometry';
import { fft, nextPow2 } from './fft';

const LAMBDA = 1 / Math.SQRT2; // Courant number at the 2D stability limit
const L2 = LAMBDA * LAMBDA;

export interface GridSpec {
  dx: number;
  /** Band index used to convert wall absorption to boundary admittance. */
  band: number;
  /** Override admittance for every boundary (1 = matched, ~anechoic). */
  forceBeta?: number;
  padCells?: number;
}

/**
 * 2D FDTD (standard leapfrog scheme) of the floor plan at ear height, with frequency-
 * independent locally-reacting walls (Kowalczyk & van Walstijn formulation).
 */
export class WaveGrid {
  readonly nx: number;
  readonly ny: number;
  readonly dx: number;
  readonly dt: number;
  readonly ox: number;
  readonly oy: number;
  p: Float32Array;
  prev: Float32Array;
  next: Float32Array;
  readonly air: Uint8Array;
  readonly cells: Int32Array;
  private a: Float32Array;
  private cn: Float32Array;
  private cp: Float32Array;
  time = 0;
  steps = 0;

  constructor(room: Room, spec: GridSpec) {
    const pad = spec.padCells ?? 2;
    const bb = bounds(room.vertices);
    this.dx = spec.dx;
    this.dt = (LAMBDA * spec.dx) / SPEED_OF_SOUND;
    this.ox = bb.minX - pad * spec.dx;
    this.oy = bb.minY - pad * spec.dx;
    this.nx = Math.ceil(bb.w / spec.dx) + 2 * pad + 1;
    this.ny = Math.ceil(bb.h / spec.dx) + 2 * pad + 1;
    const N = this.nx * this.ny;
    this.p = new Float32Array(N);
    this.prev = new Float32Array(N);
    this.next = new Float32Array(N);
    this.air = new Uint8Array(N);
    for (let j = 0; j < this.ny; j++)
      for (let i = 0; i < this.nx; i++)
        if (pointInPolygon(this.center(i, j), room.vertices)) this.air[j * this.nx + i] = 1;

    const list: number[] = [];
    for (let k = 0; k < N; k++) if (this.air[k]) list.push(k);
    this.cells = Int32Array.from(list);
    this.a = new Float32Array(N);
    this.cn = new Float32Array(N);
    this.cp = new Float32Array(N);
    const nx = this.nx;
    for (const k of this.cells) {
      const K = this.air[k - 1] + this.air[k + 1] + this.air[k - nx] + this.air[k + nx];
      let beta = 0;
      if (K < 4) {
        if (spec.forceBeta !== undefined) beta = spec.forceBeta;
        else {
          const c = this.center(k % nx, Math.floor(k / nx));
          let best = Infinity, wall = 0, t = 0;
          for (let w = 0; w < room.vertices.length; w++) {
            const [p0, p1] = edge(room.vertices, w);
            const h = closestOnSegment(c, p0, p1);
            if (h.d < best) { best = h.d; wall = w; t = h.t; }
          }
          const alpha = Math.min(0.999, material(materialAt(room, wall, t)).alpha[spec.band]);
          const R = Math.sqrt(1 - alpha);
          beta = (1 - R) / (1 + R);
        }
      }
      const bk = ((4 - K) * LAMBDA * beta) / 2;
      this.a[k] = (2 - K * L2) / (1 + bk);
      this.cn[k] = L2 / (1 + bk);
      this.cp[k] = (1 - bk) / (1 + bk);
    }
  }

  center(i: number, j: number): Vec2 {
    return { x: this.ox + (i + 0.5) * this.dx, y: this.oy + (j + 0.5) * this.dx };
  }

  index(p: Vec2): number {
    const i = Math.floor((p.x - this.ox) / this.dx);
    const j = Math.floor((p.y - this.oy) / this.dx);
    if (i < 1 || j < 1 || i >= this.nx - 1 || j >= this.ny - 1) return -1;
    const k = j * this.nx + i;
    return this.air[k] ? k : this.nearestAir(i, j);
  }

  private nearestAir(i: number, j: number): number {
    for (let r = 1; r < 6; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.ny) continue;
          const k = jj * this.nx + ii;
          if (this.air[k]) return k;
        }
    return -1;
  }

  step() {
    const { p, prev, next, a, cn, cp, cells, nx } = this;
    for (let n = 0; n < cells.length; n++) {
      const k = cells[n];
      next[k] = a[k] * p[k] + cn[k] * (p[k - 1] + p[k + 1] + p[k - nx] + p[k + nx]) - cp[k] * prev[k];
    }
    this.prev = p;
    this.p = next;
    this.next = prev;
    this.time += this.dt;
    this.steps++;
  }

  /** Gaussian pressure blob released at rest. */
  pulse(at: Vec2, amplitude = 1, sigmaCells = 1.6) {
    const ci = (at.x - this.ox) / this.dx - 0.5, cj = (at.y - this.oy) / this.dx - 0.5;
    const R = Math.ceil(sigmaCells * 3);
    for (let dj = -R; dj <= R; dj++)
      for (let di = -R; di <= R; di++) {
        const i = Math.round(ci) + di, j = Math.round(cj) + dj;
        if (i < 1 || j < 1 || i >= this.nx - 1 || j >= this.ny - 1) continue;
        const k = j * this.nx + i;
        if (!this.air[k]) continue;
        const g = amplitude * Math.exp(-((i - ci) ** 2 + (j - cj) ** 2) / (2 * sigmaCells * sigmaCells));
        this.p[k] += g;
        this.prev[k] += g;
      }
  }

  reset() {
    this.p.fill(0); this.prev.fill(0); this.next.fill(0);
    this.time = 0; this.steps = 0;
  }
}

/** Grid spacing that keeps ≥10 cells per wavelength at fmax. */
export const dxFor = (fmax: number) => SPEED_OF_SOUND / (fmax * 10);

export interface BassResponse {
  freqs: number[];
  /** Level relative to the (near) free-field reference, dB. */
  db: number[];
  /** Vertical (floor–ceiling) axial modes which the 2D plan simulation cannot contain. */
  verticalModes: number[];
  peaks: { f: number; db: number }[];
}

function record(room: Room, spec: GridSpec, duration: number, fmax: number): { data: Float64Array; dt: number } {
  const g = new WaveGrid(room, spec);
  const src = g.index(room.source);
  const rec = g.index(room.listener);
  const steps = Math.ceil(duration / g.dt);
  const data = new Float64Array(steps);
  if (src < 0 || rec < 0) return { data, dt: g.dt };
  const sigma = 0.34 / fmax;
  const t0 = 4 * sigma;
  for (let s = 0; s < steps; s++) {
    const t = s * g.dt;
    g.p[src] += Math.exp(-((t - t0) ** 2) / (2 * sigma * sigma));
    g.step();
    data[s] = g.p[rec];
  }
  return { data, dt: g.dt };
}

/**
 * Low-frequency response at the listener from 2D FDTD, normalised by a matched-boundary
 * (near-anechoic) run of the same geometry so that injection and 2D spreading cancel.
 */
export function bassResponse(room: Room, fmin = 20, fmax = 300, duration = 1.6): BassResponse {
  const fsim = fmax * 1.6;
  const dx = Math.max(0.04, dxFor(fsim));
  const roomRec = record(room, { dx, band: 0 }, duration, fsim);
  const freeRec = record(room, { dx, band: 0, forceBeta: 1 }, duration, fsim);
  const N = nextPow2(roomRec.data.length * 2);
  const spectrum = (d: Float64Array) => {
    const re = new Float64Array(N), im = new Float64Array(N);
    // Half-Hann taper on the tail limits truncation ripple.
    const L = d.length;
    for (let i = 0; i < L; i++) {
      const w = i < L * 0.7 ? 1 : 0.5 * (1 + Math.cos((Math.PI * (i - L * 0.7)) / (L * 0.3)));
      re[i] = d[i] * w;
    }
    fft(re, im);
    return { re, im };
  };
  const R = spectrum(roomRec.data);
  const F = spectrum(freeRec.data);
  const df = 1 / (N * roomRec.dt);
  const freqs: number[] = [];
  const out: number[] = [];
  const kmin = Math.max(1, Math.floor(fmin / df)), kmax = Math.ceil(fmax / df);
  const raw: number[] = [];
  for (let k = kmin; k <= kmax; k++) {
    const r = Math.hypot(R.re[k], R.im[k]);
    // The free-field reference is smooth; average it lightly to avoid dividing by residual ripple.
    let fsum = 0, cnt = 0;
    for (let q = Math.max(1, k - 3); q <= k + 3; q++) { fsum += Math.hypot(F.re[q], F.im[q]); cnt++; }
    raw.push(20 * Math.log10(Math.max(r, 1e-12) / Math.max(fsum / cnt, 1e-12)));
    freqs.push(k * df);
  }
  // 1/24-octave power smoothing.
  for (let i = 0; i < raw.length; i++) {
    const f = freqs[i];
    const lo = f * 2 ** (-1 / 48), hi = f * 2 ** (1 / 48);
    let acc = 0, n = 0;
    for (let j = Math.max(0, i - 40); j < Math.min(raw.length, i + 40); j++) {
      if (freqs[j] >= lo && freqs[j] <= hi) { acc += 10 ** (raw[j] / 10); n++; }
    }
    out.push(10 * Math.log10(acc / Math.max(n, 1)));
  }
  // Remove the overall offset so the mean level is 0 dB (absolute level is arbitrary in 2D).
  const mean = out.reduce((s, v) => s + v, 0) / out.length;
  const db = out.map((v) => v - mean);
  const peaks: { f: number; db: number }[] = [];
  for (let i = 2; i < db.length - 2; i++)
    if (db[i] > db[i - 1] && db[i] >= db[i + 1] && db[i] > db[i - 2] && db[i] >= db[i + 2] && db[i] > 3) peaks.push({ f: freqs[i], db: db[i] });
  const verticalModes: number[] = [];
  for (let n = 1; ; n++) {
    const f = (n * SPEED_OF_SOUND) / (2 * room.height);
    if (f > fmax) break;
    verticalModes.push(f);
  }
  return { freqs, db, verticalModes, peaks: peaks.slice(0, 12) };
}

export interface BassMap {
  nx: number;
  ny: number;
  ox: number;
  oy: number;
  dx: number;
  /** Steady-state level in dB relative to the room average; NaN outside the room. */
  db: Float32Array;
  freq: number;
}

/** Steady-state standing-wave pattern for a sinusoidal source at `freq`. */
export function bassMap(room: Room, freq: number, settle: number): BassMap {
  const dx = Math.min(0.08, Math.max(0.03, SPEED_OF_SOUND / (freq * 24)));
  const g = new WaveGrid(room, { dx, band: freq < 180 ? 0 : 1 });
  const src = g.index(room.source);
  const N = g.nx * g.ny;
  const acc = new Float64Array(N);
  const period = 1 / freq;
  const measure = Math.max(0.15, 12 * period);
  const total = Math.min(4, Math.max(0.5, settle)) + measure;
  const steps = Math.ceil(total / g.dt);
  const startMeasure = steps - Math.ceil(measure / g.dt);
  const w = 2 * Math.PI * freq;
  const ramp = 0.05;
  for (let s = 0; s < steps; s++) {
    const t = s * g.dt;
    if (src >= 0) g.p[src] += Math.min(1, t / ramp) * Math.sin(w * t);
    g.step();
    if (s >= startMeasure) for (const k of g.cells) acc[k] += g.p[k] * g.p[k];
  }
  const db = new Float32Array(N).fill(NaN);
  let mean = 0;
  for (const k of g.cells) mean += acc[k];
  mean /= Math.max(1, g.cells.length);
  for (const k of g.cells) db[k] = 10 * Math.log10(Math.max(acc[k], 1e-20) / Math.max(mean, 1e-20));
  return { nx: g.nx, ny: g.ny, ox: g.ox, oy: g.oy, dx, db, freq };
}
