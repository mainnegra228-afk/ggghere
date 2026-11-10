import { BANDS } from './types';
import { SPEED_OF_SOUND } from './materials';
import { fft, nextPow2 } from './fft';
import { rng, type RayTraceResult } from './raytrace';

/**
 * Amplitude-complementary octave band windows (they sum to exactly 1 at every frequency),
 * built from raised-cosine transitions one octave wide centred on each crossover.
 */
export function bandWindow(band: number, f: number): number {
  const s = (k: number) => {
    if (k < 0) return 0;
    if (k >= BANDS.length - 1) return 1;
    const xo = BANDS[k] * Math.SQRT2;
    const x = Math.log2(Math.max(f, 1e-3) / xo) + 0.5;
    if (x <= 0) return 1;
    if (x >= 1) return 0;
    return 0.5 * (1 + Math.cos(Math.PI * x));
  };
  return s(band) - s(band - 1);
}

/**
 * Converts ray-traced energy envelopes into an audible impulse response using the
 * Poisson-distributed Dirac sequence method (Kuttruff / Vorländer): a random reflection
 * sequence with physically increasing density is weighted per octave band so that its
 * energy envelope matches the simulation, then band-limited and summed.
 */
export function synthesizeIR(res: RayTraceResult, sampleRate: number, volume: number, seed = 7): Float32Array {
  const c = SPEED_OF_SOUND;
  const fs = sampleRate;
  // Trim trailing silence (all bands below -90 dB of their peak).
  let lastBin = 0;
  for (let b = 0; b < 6; b++) {
    const h = res.histogram[b];
    let peak = 0;
    for (let k = 0; k < h.length; k++) peak = Math.max(peak, h[k]);
    for (let k = h.length - 1; k >= 0; k--) if (h[k] > peak * 1e-9) { lastBin = Math.max(lastBin, k); break; }
  }
  const durationSamples = Math.ceil((lastBin + 2) * res.binSize * fs);
  const binSamples = res.binSize * fs;
  const N = nextPow2(durationSamples + 1024);
  const dirac = new Float64Array(N);
  const random = rng(seed);

  // Reflection density 4πc³t²/V, clamped so early bins still contain events and late
  // bins do not become pathological.
  let t = Math.max(1e-4, res.directTime * 0.5);
  const end = durationSamples / fs;
  while (t < end) {
    const mu = Math.min(20000, Math.max(2000, (4 * Math.PI * c ** 3 * t * t) / volume));
    t += -Math.log(1 - random()) / mu;
    const idx = Math.round(t * fs);
    if (idx >= durationSamples) break;
    dirac[idx] += random() < 0.5 ? -1 : 1;
  }

  const bins = Math.ceil(durationSamples / binSamples);
  const diracEnergy = new Float64Array(bins);
  for (let i = 0; i < durationSamples; i++) diracEnergy[Math.min(bins - 1, Math.floor(i / binSamples))] += dirac[i] * dirac[i];

  const accRe = new Float64Array(N), accIm = new Float64Array(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let b = 0; b < 6; b++) {
    const h = res.histogram[b];
    const w = new Float64Array(bins);
    for (let k = 0; k < bins; k++) w[k] = diracEnergy[k] > 0 && k < h.length ? Math.sqrt(h[k] / diracEnergy[k]) : 0;
    re.fill(0); im.fill(0);
    for (let i = 0; i < durationSamples; i++) {
      if (dirac[i] === 0) continue;
      // Linear interpolation between bin centres avoids audible weight steps.
      const pos = i / binSamples - 0.5;
      const k0 = Math.max(0, Math.floor(pos));
      const k1 = Math.min(bins - 1, k0 + 1);
      const frac = Math.min(1, Math.max(0, pos - k0));
      re[i] = dirac[i] * (w[k0] * (1 - frac) + w[k1] * frac);
    }
    fft(re, im);
    for (let k = 0; k <= N / 2; k++) {
      const g = bandWindow(b, (k * fs) / N);
      if (g === 0) continue;
      accRe[k] += re[k] * g; accIm[k] += im[k] * g;
      if (k > 0 && k < N / 2) { accRe[N - k] += re[N - k] * g; accIm[N - k] += im[N - k] * g; }
    }
  }
  fft(accRe, accIm, true);

  const out = new Float32Array(durationSamples);
  for (let i = 0; i < durationSamples; i++) out[i] = accRe[i];
  if (res.directEnergy > 0) {
    const di = Math.round(res.directTime * fs);
    if (di < out.length) out[di] += Math.sqrt(res.directEnergy);
  }
  // Short fade-out to avoid a click at truncation.
  const fade = Math.min(out.length, Math.round(0.01 * fs));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}

/** Normalise an IR so that convolving full-scale material does not clip. */
export function normaliseIR(ir: Float32Array): Float32Array {
  let energy = 0, peak = 0;
  for (let i = 0; i < ir.length; i++) { energy += ir[i] * ir[i]; peak = Math.max(peak, Math.abs(ir[i])); }
  if (energy === 0) return ir;
  // Unit-energy keeps loudness comparable between rooms; cap the peak for safety.
  const g = Math.min(1 / Math.sqrt(energy), 0.98 / peak);
  const out = new Float32Array(ir.length);
  for (let i = 0; i < ir.length; i++) out[i] = ir[i] * g;
  return out;
}
