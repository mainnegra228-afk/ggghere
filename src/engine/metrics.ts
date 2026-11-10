import type { AcousticMetrics, Room } from './types';
import { AIR_ABSORPTION } from './materials';
import { absorptionArea, area, roomSurface, roomVolume } from './geometry';
import type { RayTraceResult } from './raytrace';

const db = (x: number) => 10 * Math.log10(Math.max(x, 1e-30));

/** Energy per bin including the direct sound, per band. */
export function totalEnergy(res: RayTraceResult): Float64Array[] {
  const di = Math.floor(res.directTime / res.binSize);
  return res.histogram.map((h) => {
    const e = Float64Array.from(h);
    if (di < e.length) e[di] += res.directEnergy;
    return e;
  });
}

/** Schroeder backward integration, returned in dB relative to total energy. */
export function schroeder(e: Float64Array): Float64Array {
  const out = new Float64Array(e.length);
  let acc = 0;
  for (let i = e.length - 1; i >= 0; i--) { acc += e[i]; out[i] = acc; }
  const total = out[0] || 1e-30;
  for (let i = 0; i < out.length; i++) out[i] = db(out[i] / total);
  return out;
}

/** Reverberation time from linear regression of the EDC between two levels (dB). */
export function decayTime(edc: Float64Array, binSize: number, from: number, to: number): number | null {
  let start = -1, stop = -1;
  for (let i = 0; i < edc.length; i++) {
    if (start < 0 && edc[i] <= from) start = i;
    if (edc[i] <= to) { stop = i; break; }
  }
  if (start < 0 || stop < 0 || stop - start < 3) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  const n = stop - start + 1;
  for (let i = start; i <= stop; i++) {
    const x = i * binSize, y = edc[i];
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  if (!(slope < 0)) return null;
  return -60 / slope;
}

function energyRatio(e: Float64Array, startBin: number, splitBin: number) {
  let early = 0, late = 0;
  for (let i = startBin; i < e.length; i++) (i < splitBin ? (early += e[i]) : (late += e[i]));
  return { early, late };
}

export function computeMetrics(room: Room, res: RayTraceResult): AcousticMetrics {
  const V = roomVolume(room);
  const S = roomSurface(room);
  const A = absorptionArea(room);
  const energy = totalEnergy(res);
  const edcs = energy.map(schroeder);
  const bs = res.binSize;
  // Clarity windows start at the first arrival (direct or, if occluded, first reflection).
  const firstArrival = (() => {
    if (res.directEnergy > 0) return Math.floor(res.directTime / bs);
    let first = Infinity;
    for (const h of res.histogram) for (let i = 0; i < h.length; i++) if (h[i] > 0) { first = Math.min(first, i); break; }
    return isFinite(first) ? first : 0;
  })();

  const sabine: number[] = [], eyring: number[] = [];
  for (let b = 0; b < 6; b++) {
    const air = 4 * AIR_ABSORPTION[b] * V;
    sabine.push((0.161 * V) / (A[b] + air));
    const meanAlpha = Math.min(0.999, A[b] / S);
    eyring.push((0.161 * V) / (-S * Math.log(1 - meanAlpha) + air));
  }

  const c50: number[] = [], c80: number[] = [], d50: number[] = [];
  for (let b = 0; b < 6; b++) {
    const r50 = energyRatio(energy[b], firstArrival, firstArrival + Math.round(0.05 / bs));
    const r80 = energyRatio(energy[b], firstArrival, firstArrival + Math.round(0.08 / bs));
    c50.push(db(r50.early / Math.max(r50.late, 1e-30)));
    c80.push(db(r80.early / Math.max(r80.late, 1e-30)));
    d50.push(r50.early / Math.max(r50.early + r50.late, 1e-30));
  }

  let reverb = 0;
  for (const b of [2, 3, 4]) for (let i = 0; i < res.histogram[b].length; i++) reverb += res.histogram[b][i];
  reverb /= 3;
  const drr = res.directEnergy > 0 ? db(res.directEnergy / Math.max(reverb, 1e-30)) : -Infinity;

  const tMid = (sabine[2] + sabine[3]) / 2;
  return {
    t30: edcs.map((e) => decayTime(e, bs, -5, -35)),
    t20: edcs.map((e) => decayTime(e, bs, -5, -25)),
    edt: edcs.map((e) => decayTime(e, bs, 0, -10)),
    sabine,
    eyring,
    c50,
    c80,
    d50,
    drr,
    criticalDistance: 0.057 * Math.sqrt(V / sabine[3]),
    absorptionArea: A,
    volume: V,
    surface: S,
    floorArea: area(room.vertices),
    schroeder: 2000 * Math.sqrt(tMid / V),
  };
}

/** Decimated EDC curves for plotting: [band][points] in dB, sampled every `step` seconds. */
export function edcCurves(res: RayTraceResult, step = 0.005): { step: number; curves: number[][] } {
  const edcs = totalEnergy(res).map(schroeder);
  const every = Math.max(1, Math.round(step / res.binSize));
  return {
    step: every * res.binSize,
    curves: edcs.map((e) => {
      const out: number[] = [];
      for (let i = 0; i < e.length; i += every) {
        out.push(Math.max(-80, e[i]));
        if (e[i] < -80) break;
      }
      return out;
    }),
  };
}

/** Practical estimate of how long to simulate: the slowest Sabine decay plus margin. */
export function suggestedMaxTime(room: Room): number {
  const V = roomVolume(room);
  const A = absorptionArea(room);
  let worst = 0;
  for (let b = 0; b < 6; b++) worst = Math.max(worst, (0.161 * V) / (A[b] + 4 * AIR_ABSORPTION[b] * V));
  return Math.min(6, Math.max(0.4, worst * 1.25));
}
