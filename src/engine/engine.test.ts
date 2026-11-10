import { describe, expect, it } from 'vitest';
import { traceRays } from './raytrace';
import { computeMetrics, suggestedMaxTime } from './metrics';
import { bandWindow, synthesizeIR } from './ir';
import { fft } from './fft';
import { earlyReflections } from './reflections';
import { WaveGrid, bassResponse, bassMap } from './fdtd';
import { advise, flutterPairs } from './advisor';
import { PRESETS } from './presets';
import { isSimple, normaliseWinding, absorptionArea } from './geometry';
import type { Room } from './types';

const shoebox = (mat: string, scatter = true): Room => ({
  name: 't',
  vertices: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 5 }, { x: 0, y: 5 }],
  wallMaterials: [mat, mat, mat, mat],
  panels: [],
  floor: scatter ? 'bookshelf' : mat,
  ceiling: mat,
  height: 3,
  source: { x: 1.5, y: 1.2 },
  listener: { x: 4.3, y: 3.6 },
});

describe('ray tracer', () => {
  it('reproduces Eyring reverberation when absorption is uniform (diffuse field) within 10 %', () => {
    const room = shoebox('drywall', false);
    const res = traceRays(room, { rays: 12000, receiverRadius: 0.4, maxTime: suggestedMaxTime(room), seed: 1 });
    const m = computeMetrics(room, res);
    for (const b of [1, 2, 3, 4]) {
      const t = m.t30[b] ?? m.t20[b];
      expect(t).not.toBeNull();
      expect(Math.abs(t! - m.eyring[b]) / m.eyring[b]).toBeLessThan(0.1);
    }
    expect(m.volume).toBeCloseTo(90);
  });

  it('decays slower than Sabine when absorption is concentrated on the floor (non-diffuse field)', () => {
    const room: Room = { ...shoebox('concrete', false), floor: 'carpet' };
    const res = traceRays(room, { rays: 8000, receiverRadius: 0.4, maxTime: suggestedMaxTime(room), seed: 1 });
    const m = computeMetrics(room, res);
    expect(m.t30[4]!).toBeGreaterThan(m.sabine[4] * 1.5);
  });

  it('places direct sound at the right time and level', () => {
    const room = shoebox('concrete');
    const res = traceRays(room, { rays: 2000, receiverRadius: 0.3, maxTime: 0.3, seed: 2 });
    const d = Math.hypot(2.8, 2.4);
    expect(res.directTime).toBeCloseTo(d / 343, 6);
    expect(res.directEnergy).toBeCloseTo(1 / (4 * Math.PI * d * d), 8);
  });
});

describe('dsp', () => {
  it('fft round-trips', () => {
    const re = new Float64Array(64).map((_, i) => Math.sin(i) + i * 0.1);
    const im = new Float64Array(64);
    const orig = Float64Array.from(re);
    fft(re, im); fft(re, im, true);
    re.forEach((v, i) => expect(v).toBeCloseTo(orig[i], 9));
  });

  it('band windows form a partition of unity', () => {
    for (const f of [5, 60, 177, 300, 707, 1414, 3000, 9000, 20000]) {
      let s = 0;
      for (let b = 0; b < 6; b++) s += bandWindow(b, f);
      expect(s).toBeCloseTo(1, 9);
    }
  });

  it('synthesised IR carries the simulated energy', () => {
    const room = shoebox('drywall');
    const res = traceRays(room, { rays: 6000, receiverRadius: 0.4, maxTime: 1, seed: 3 });
    const ir = synthesizeIR(res, 48000, 90);
    let e = 0;
    for (const v of ir) e += v * v;
    let target = res.directEnergy;
    // Flat spectrum: broadband energy ≈ bandwidth-weighted band energies.
    const widths = [0, 1, 2, 3, 4, 5].map((b) => {
      let w = 0;
      for (let f = 0; f < 24000; f += 5) w += bandWindow(b, f) ** 2 * 5;
      return w / 24000;
    });
    res.histogram.forEach((h, b) => h.forEach((v) => (target += v * widths[b])));
    expect(e / target).toBeGreaterThan(0.6);
    expect(e / target).toBeLessThan(1.6);
    expect(ir.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('geometry & reflections', () => {
  it('finds four first-order reflections in a rectangle', () => {
    const first = earlyReflections(shoebox('concrete'), 1);
    expect(first).toHaveLength(4);
    first.forEach((p) => expect(p.delayMs).toBeGreaterThan(0));
  });

  it('keeps edge data aligned when reversing winding', () => {
    const r = shoebox('concrete');
    r.vertices.reverse();
    r.wallMaterials = ['glass', 'tile', 'brick', 'drywall'];
    r.panels = [{ id: 'a', wall: 0, t0: 0.1, t1: 0.3, material: 'absorber-50' }];
    const n = normaliseWinding(r);
    expect(isSimple(n.vertices)).toBe(true);
    const key = (room: Room, i: number) => {
      const a = room.vertices[i], b = room.vertices[(i + 1) % 4];
      return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), room.wallMaterials[i]].join();
    };
    expect([0, 1, 2, 3].map((i) => key(n, i)).sort()).toEqual([0, 1, 2, 3].map((i) => key(r, i)).sort());
    absorptionArea(n).forEach((v, b) => expect(v).toBeCloseTo(absorptionArea(r)[b], 6));
  });

  it('every preset is a valid simple polygon', () => {
    for (const p of PRESETS) {
      expect(isSimple(p.room.vertices)).toBe(true);
      expect(p.room.wallMaterials).toHaveLength(p.room.vertices.length);
    }
  });
});

describe('wave simulation', () => {
  it('stays bounded with rigid walls', () => {
    const g = new WaveGrid(shoebox('concrete'), { dx: 0.05, band: 3, forceBeta: 0 });
    g.pulse({ x: 3, y: 2.5 });
    for (let i = 0; i < 3000; i++) g.step();
    let max = 0;
    for (const k of g.cells) max = Math.max(max, Math.abs(g.p[k]));
    expect(max).toBeLessThan(2);
    expect(Number.isFinite(max)).toBe(true);
  });

  it('absorbing walls drain energy', () => {
    const g = new WaveGrid(shoebox('open'), { dx: 0.05, band: 3 });
    g.pulse({ x: 3, y: 2.5 });
    for (let i = 0; i < 2000; i++) g.step();
    let e = 0;
    for (const k of g.cells) e += g.p[k] ** 2;
    expect(e).toBeLessThan(0.05);
  });

  it('bass response shows the first axial mode of a 6 m wall pair', () => {
    const r = bassResponse({ ...shoebox('concrete'), source: { x: 0.3, y: 0.3 }, listener: { x: 5.7, y: 4.7 } }, 20, 120, 1.2);
    expect(r.freqs.length).toBeGreaterThan(50);
    const f1 = 343 / 12; // ≈ 28.6 Hz
    expect(r.peaks.some((p) => Math.abs(p.f - f1) < 3)).toBe(true);
    expect(r.verticalModes[0]).toBeCloseTo(343 / 6, 3);
  });

  it('bass map produces finite levels inside the room', () => {
    const m = bassMap(shoebox('drywall'), 60, 0.5);
    let finite = 0;
    m.db.forEach((v) => Number.isFinite(v) && finite++);
    expect(finite).toBeGreaterThan(100);
  });
});

describe('advisor', () => {
  it('a 120×60 cm panel adds 0.72 m² of its material, not a full-height strip', () => {
    const room = shoebox('concrete', false);
    const L = 6;
    const withPanel: Room = { ...room, panels: [{ id: 'x', wall: 0, t0: 0.4, t1: 0.4 + 1.2 / L, material: 'absorber-100' }] };
    const dA = absorptionArea(withPanel)[3] - absorptionArea(room)[3];
    expect(dA).toBeCloseTo(0.72 * (0.99 - 0.02), 1);
    const full: Room = { ...withPanel, panels: [{ ...withPanel.panels[0], height: 99 }] };
    expect(absorptionArea(full)[3] - absorptionArea(room)[3]).toBeCloseTo(1.2 * 3 * (0.99 - 0.02), 1);
  });
  it('flags flutter and long reverb in a bare tiled room', () => {
    const room = shoebox('tile', false);
    const res = traceRays(room, { rays: 4000, receiverRadius: 0.4, maxTime: suggestedMaxTime(room), seed: 4 });
    const findings = advise(room, computeMetrics(room, res), 'studio');
    expect(findings.find((f) => f.id === 'rt-long')).toBeTruthy();
    expect(flutterPairs(room).length).toBe(2);
    const add = findings.find((f) => f.id === 'rt-long')!.action!.panels(room);
    expect(add.length).toBeGreaterThan(0);
  });
});
